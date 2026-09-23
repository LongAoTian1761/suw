/* Submission backends.

   supabase  students fill the form and hit 提交 — no account, no GitHub.
             Attachments go straight to Supabase Storage, the answer goes into
             a table. A random "device token" kept in the student's browser is
             what proves ownership later, so they can edit or withdraw their
             own work without ever registering.
   github    hands off to a pre-filled GitHub issue form.
   local     no server at all: generate Markdown / keep a draft locally.

   Only the public key is used here. It is designed to be shipped to browsers;
   row-level security is what stops students from publishing their own grades,
   editing someone else's answer, or reading anything unapproved.

   No SDK: plain fetch against the REST and Storage HTTP APIs. */
(function () {
  "use strict";

  var CFG = (window.SITE_CONFIG && window.SITE_CONFIG.submission) || {};
  var SB = CFG.supabase || {};

  var MODE = CFG.backend || "local";
  var TABLE = SB.table || "submissions";
  var BUCKET = SB.bucket || "answer-uploads";
  var MAX_MB = Number(SB.maxFileMb) || 20;
  var URL_BASE = String(SB.url || "").replace(/\/+$/, "");
  var KEY = String(SB.anonKey || "");

  var supabaseReady = MODE === "supabase" && /^https?:\/\//.test(URL_BASE) && KEY.length > 20;

  var TOKEN_KEY = "oem-device-token-v1";

  /* 上一次读取公开答案成功了没有。null = 还没试过。
     首页统计要靠它区分「真的是 0 条」和「读不到」。 */
  var lastFetchOk = null;

  function BackendError(message, detail) {
    var e = new Error(message);
    e.name = "BackendError";
    e.detail = detail;
    return e;
  }

  /* ------------------------------------------------------- credentials */

  /* One token per browser, reused for every submission from this device. The
     student never sees it unless they want to open their work on another
     device, in which case they paste it into 「用恢复码找回」. */
  function deviceToken(force) {
    try {
      var t = force ? "" : localStorage.getItem(TOKEN_KEY);
      if (!t || t.length < 16) {
        t = uuid().replace(/-/g, "") + uuid().replace(/-/g, "").slice(0, 8);
        localStorage.setItem(TOKEN_KEY, t);
      }
      return t;
    } catch (e) {
      return uuid().replace(/-/g, "") + uuid().replace(/-/g, "").slice(0, 8);
    }
  }

  function adoptToken(token) {
    if (!token || token.length < 16) return false;
    try {
      localStorage.setItem(TOKEN_KEY, token);
      return true;
    } catch (e) {
      return false;
    }
  }

  function authHeaders(extra, withToken) {
    var h = { apikey: KEY, authorization: "Bearer " + KEY };
    if (withToken) h["x-edit-token"] = deviceToken();
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        h[k] = extra[k];
      });
    }
    return h;
  }

  /* --------------------------------------------------------------- util */

  function safeName(name) {
    return String(name || "file")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(-80);
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function humanSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function describe(res, body) {
    if (!body) return "HTTP " + res.status;
    try {
      var j = typeof body === "string" ? JSON.parse(body) : body;
      return j.message || j.error_description || j.error || "HTTP " + res.status;
    } catch (e) {
      return String(body).slice(0, 200) || "HTTP " + res.status;
    }
  }

  /* -------------------------------------------------------------- files */

  function uploadOne(file, exercise, index) {
    var path =
      exercise +
      "/" +
      Date.now().toString(36) +
      "-" +
      index +
      "-" +
      Math.random().toString(36).slice(2, 8) +
      "-" +
      safeName(file.name);

    return fetch(URL_BASE + "/storage/v1/object/" + BUCKET + "/" + encodeURI(path), {
      method: "POST",
      headers: authHeaders({
        "content-type": file.type || "application/octet-stream",
        "cache-control": "max-age=3600",
        "x-upsert": "false",
      }),
      body: file,
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw BackendError("附件「" + file.name + "」上传失败：" + describe(res, t), t);
        });
      }
      return {
        name: file.name,
        size: humanSize(file.size),
        url: URL_BASE + "/storage/v1/object/public/" + BUCKET + "/" + path,
      };
    });
  }

  function uploadAll(files, exercise, onProgress) {
    var uploaded = [];
    var chain = Promise.resolve();
    (files || []).forEach(function (file, i) {
      chain = chain.then(function () {
        if (file.size > MAX_MB * 1024 * 1024) {
          throw BackendError(
            "附件「" + file.name + "」超过 " + MAX_MB + " MB，请压缩后再上传。",
          );
        }
        if (onProgress) onProgress(i, files.length, file.name);
        return uploadOne(file, exercise, i).then(function (meta) {
          uploaded.push(meta);
          if (onProgress) onProgress(i + 1, files.length, file.name);
        });
      });
    });
    return chain.then(function () {
      return uploaded;
    });
  }

  function friendly(err) {
    if (err && err.name === "BackendError") return err;
    return BackendError("提交失败：" + (err && err.message ? err.message : "未知错误"), err);
  }

  /* ------------------------------------------------------------- submit */

  function submitSupabase(payload, files, onProgress) {
    var id = uuid();
    var row = {
      id: id,
      exercise: payload.exercise,
      author: payload.author,
      author_note: payload.authorNote || "",
      title: payload.title || "",
      tags: payload.tags || [],
      body: payload.body,
      attachments: [],
      status: payload.status || "verified",
      edit_token: deviceToken(),
      revision: 1,
    };

    return uploadAll(files, payload.exercise, onProgress)
      .then(function (uploaded) {
        row.attachments = uploaded;
        return fetch(URL_BASE + "/rest/v1/" + TABLE, {
          method: "POST",
          headers: authHeaders({
            "content-type": "application/json",
            prefer: "return=minimal",
          }),
          body: JSON.stringify(row),
        });
      })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw BackendError("提交失败：" + describe(res, t), t);
          });
        }
        return { id: id, status: row.status, mode: "supabase", attachments: row.attachments };
      })
      .catch(function (err) {
        throw friendly(err);
      });
  }

  /* ------------------------------------------------------------- update */

  /* Rewrites an existing answer. Kept attachments are passed in `attachments`;
     newly added files go through `files`. */
  function updateSubmission(id, payload, files, onProgress) {
    return uploadAll(files, payload.exercise, onProgress)
      .then(function (uploaded) {
        var patch = {
          author: payload.author,
          author_note: payload.authorNote || "",
          title: payload.title || "",
          tags: payload.tags || [],
          body: payload.body,
          attachments: (payload.attachments || []).concat(uploaded),
          status: payload.status || "verified",
          revision: Number(payload.revision || 1) + 1,
          updated_at: new Date().toISOString(),
        };
        return fetch(URL_BASE + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
          method: "PATCH",
          headers: authHeaders(
            { "content-type": "application/json", prefer: "return=minimal" },
            true,
          ),
          body: JSON.stringify(patch),
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw BackendError("保存失败：" + describe(res, t), t);
            });
          }
          return { id: id, status: patch.status, revision: patch.revision, attachments: patch.attachments };
        });
      })
      .catch(function (err) {
        throw friendly(err);
      });
  }

  /* 撤回 = status 改成 withdrawn；恢复 = 改回 verified。记录留在库里，
     老师仍然看得到，随时可以恢复或删除。 */
  function setStatus(id, status) {
    return fetch(URL_BASE + "/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: authHeaders(
        { "content-type": "application/json", prefer: "return=minimal" },
        true,
      ),
      body: JSON.stringify({ status: status, updated_at: new Date().toISOString() }),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw BackendError(
            (status === "withdrawn" ? "撤回失败：" : "恢复失败：") + describe(res, t),
            t,
          );
        });
      }
      return { id: id, status: status };
    });
  }

  /* ------------------------------------------- read back one's own work */

  var PUBLIC_COLS =
    "id,created_at,updated_at,exercise,author,title,body,tags,attachments,status,helpful,feedback,revision";

  function fetchApproved() {
    if (!supabaseReady) return Promise.resolve([]);
    var q =
      "/rest/v1/" +
      TABLE +
      "?select=" +
      PUBLIC_COLS +
      "&status=in.(verified,peer,alternative)&order=created_at.desc&limit=500";
    return fetch(URL_BASE + q, {
      headers: authHeaders({ accept: "application/json" }),
      /* 没有超时的话，网络卡住时页面会一直停在「正在统计…」 */
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(12000)
        : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (rows) {
        lastFetchOk = true;
        return (rows || []).map(toAnswer);
      })
      .catch(function (err) {
        lastFetchOk = false;
        if (window.console) console.warn("[backend] 读取云端答案失败：", err.message);
        return [];
      });
  }

  function toAnswer(r) {
    return {
      id: r.id,
      exercise: r.exercise,
      author: r.author || "匿名",
      title: r.title || "",
      date: String(r.created_at || "").slice(0, 10),
      updatedAt: r.updated_at ? String(r.updated_at).slice(0, 10) : "",
      status: r.status,
      helpful: Number(r.helpful) || 0,
      source: "server",
      tags: Array.isArray(r.tags) ? r.tags : [],
      body: r.body || "",
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      feedback: r.feedback || "",
      revision: Number(r.revision) || 1,
    };
  }

  /* Everything this device submitted, including private fields (老师给的等级),
     plus anything recoverable with a pasted recovery code. */
  function mySubmissions(token) {
    if (!supabaseReady) return Promise.resolve([]);
    return fetch(URL_BASE + "/rest/v1/rpc/my_submissions", {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json", accept: "application/json" }),
      body: JSON.stringify({ p_token: token || deviceToken() }),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(12000)
        : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (rows) {
        return (rows || []).map(function (r) {
          var a = toAnswer(r);
          a.authorNote = r.author_note || "";
          a.grade = r.grade || "";
          a.gradedAt = r.graded_at ? String(r.graded_at).slice(0, 10) : "";
          a.mine = true;
          return a;
        });
      })
      .catch(function (err) {
        if (window.console) console.warn("[backend] 取回我的提交失败：", err.message);
        return [];
      });
  }

  window.OEMBackend = {
    mode: MODE,
    supabaseReady: supabaseReady,
    lastFetchOk: function () {
      return lastFetchOk;
    },
    maxFileMb: MAX_MB,
    bucket: BUCKET,
    table: TABLE,
    deviceToken: deviceToken,
    adoptToken: adoptToken,
    fetchApproved: fetchApproved,
    mySubmissions: mySubmissions,
    submitSupabase: submitSupabase,
    updateSubmission: updateSubmission,
    setStatus: setStatus,
    BackendError: BackendError,
  };
})();
