/* 老师用的网页批改界面。

   老师用自己的邮箱密码登录（Supabase 内置账号系统），登录后凭令牌读写数据。
   **不在 teachers 名单里的人什么也读不到** —— 这是数据库的行级权限说了算的，
   前端拦不住也没关系。公开密钥写在页面里是安全的。 */
(function () {
  "use strict";

  var OEM = window.OEM;
  if (!OEM) return;

  var CFG = (window.SITE_CONFIG && window.SITE_CONFIG.submission) || {};
  var SB = CFG.supabase || {};
  var BASE = String(SB.url || "").replace(/\/+$/, "");
  var KEY = String(SB.anonKey || "");
  var TABLE = SB.table || "submissions";
  var SESSION_KEY = "oem-admin-session-v1";

  var COLS =
    "id,created_at,updated_at,exercise,author,author_note,title,body,tags," +
    "attachments,status,grade,feedback,graded_at,revision";

  var LABEL = {
    verified: "已发布",
    peer: "同学解答",
    alternative: "另一种思路",
    pending: "待审核",
    withdrawn: "已撤回",
    rejected: "已撤下",
  };

  var els = {};
  [
    "admin-login", "admin-panel", "admin-email", "admin-password",
    "admin-signin", "admin-login-msg", "admin-who", "admin-signout",
    "admin-status", "admin-search", "admin-reload", "admin-count",
    "admin-list", "admin-detail",
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  var rows = [];
  var current = null;

  /* ------------------------------------------------------------ 会话 */

  function session() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function setSession(s) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function headers(extra) {
    var s = session();
    var h = { apikey: KEY, accept: "application/json", "content-type": "application/json" };
    h.authorization = "Bearer " + (s && s.access_token ? s.access_token : KEY);
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function msg(text, tone) {
    if (!els["admin-login-msg"]) return;
    els["admin-login-msg"].textContent = text || "";
    if (tone) els["admin-login-msg"].setAttribute("data-tone", tone);
    else els["admin-login-msg"].removeAttribute("data-tone");
  }

  function tokenRequest(body) {
    return fetch(BASE + "/auth/v1/token?grant_type=" + body.grant_type, {
      method: "POST",
      headers: { apikey: KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          throw new Error(
            data.error_description || data.msg || data.error || "HTTP " + res.status,
          );
        }
        return data;
      });
    });
  }

  function login(email, password) {
    return tokenRequest({ grant_type: "password", email: email, password: password }).then(
      function (d) {
        setSession({
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000,
          email: (d.user && d.user.email) || email,
        });
        return d;
      },
    );
  }

  /* 令牌一小时过期，过期前自动续期；续不了就请老师重新登录 */
  function ensureFresh() {
    var s = session();
    if (!s || !s.access_token) return Promise.resolve(null);
    if (s.expires_at && Date.now() < s.expires_at - 60000) return Promise.resolve(s);
    if (!s.refresh_token) {
      clearSession();
      return Promise.resolve(null);
    }
    return tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh_token })
      .then(function (d) {
        setSession({
          access_token: d.access_token,
          refresh_token: d.refresh_token || s.refresh_token,
          expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000,
          email: (d.user && d.user.email) || s.email,
        });
        return session();
      })
      .catch(function () {
        clearSession();
        return null;
      });
  }

  /* ------------------------------------------------------------ 数据 */

  function api(path, options) {
    return ensureFresh().then(function (s) {
      if (!s) throw new Error("登录已过期，请重新登录。");
      return fetch(BASE + path, Object.assign({ headers: headers() }, options || {}));
    });
  }

  function isTeacher() {
    return api("/rest/v1/rpc/is_teacher", {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(function (res) {
        return res.ok ? res.json() : false;
      })
      .catch(function () {
        return false;
      });
  }

  function load() {
    if (els["admin-count"]) els["admin-count"].textContent = "读取中…";
    return api(
      "/rest/v1/" + TABLE + "?select=" + COLS + "&order=created_at.desc&limit=500",
    )
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error("读取失败：" + t.slice(0, 160));
          });
        }
        return res.json();
      })
      .then(function (data) {
        rows = data || [];
        renderList();
      });
  }

  function save(id, patch) {
    return api("/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: headers({ prefer: "return=minimal" }),
      body: JSON.stringify(patch),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("保存失败：" + t.slice(0, 160));
        });
      }
      return load();
    });
  }

  function remove(id) {
    return api("/rest/v1/" + TABLE + "?id=eq." + encodeURIComponent(id), {
      method: "DELETE",
      headers: headers({ prefer: "return=minimal" }),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("删除失败：" + t.slice(0, 160));
        });
      }
      current = null;
      if (els["admin-detail"]) {
        els["admin-detail"].innerHTML = '<div class="admin-empty">左边选一条作业开始批改。</div>';
      }
      return load();
    });
  }

  /* -------------------------------------------------------------- 视图 */

  function filtered() {
    var q = (els["admin-search"] && els["admin-search"].value || "").trim().toLowerCase();
    var st = els["admin-status"] && els["admin-status"].value || "";
    return rows.filter(function (r) {
      if (st && r.status !== st) return false;
      if (!q) return true;
      return (
        r.exercise + " " + r.author + " " + (r.author_note || "") + " " +
        (r.title || "") + " " + r.body
      )
        .toLowerCase()
        .indexOf(q) > -1;
    });
  }

  function renderList() {
    if (!els["admin-list"]) return;
    var list = filtered().slice().sort(function (a, b) {
      var rank = function (r) {
        if (r.status === "pending") return 0;
        if (!r.grade && !r.feedback) return 1;
        return 2;
      };
      var d = rank(a) - rank(b);
      return d || String(b.created_at).localeCompare(String(a.created_at));
    });

    if (els["admin-count"]) {
      els["admin-count"].textContent = list.length + " / " + rows.length + " 条";
    }
    if (!list.length) {
      els["admin-list"].innerHTML = '<div class="admin-empty">没有符合条件的作业。</div>';
      return;
    }
    if (!current || !list.some(function (r) { return r.id === current.id; })) {
      open(list[0].id);
      return;
    }
    els["admin-list"].innerHTML = list
      .map(function (r) {
        var graded = r.grade || r.feedback ? " · 已批" : "";
        return (
          '<button type="button" class="admin-item" data-id="' + OEM.escAttr(r.id) + '"' +
          (current && current.id === r.id ? ' aria-selected="true"' : "") + ">" +
          '<span class="admin-item__top">' +
          '<span class="admin-item__ex">' + OEM.esc(r.exercise) + "</span>" +
          '<span class="admin-item__who">' + OEM.esc(r.author) + "</span>" +
          '<span class="pill pill--' + OEM.escAttr(r.status) + '">' +
          OEM.esc(LABEL[r.status] || r.status) + "</span></span>" +
          '<span class="admin-item__sub">' +
          OEM.esc(String(r.created_at).slice(0, 16).replace("T", " ")) + graded +
          (r.author_note ? " · " + OEM.esc(r.author_note) : "") +
          "</span></button>"
        );
      })
      .join("");
  }

  function open(id) {
    current = rows.filter(function (r) { return r.id === id; })[0] || null;
    if (!current) return;
    renderList();
    var r = current;
    els["admin-detail"].innerHTML =
      "<h2>习题 " + OEM.esc(r.exercise) + " · " + OEM.esc(r.author) + "</h2>" +
      '<p class="admin-meta">提交于 ' +
      OEM.esc(String(r.created_at).slice(0, 16).replace("T", " ")) +
      (r.updated_at && r.updated_at !== r.created_at
        ? "（修改于 " + OEM.esc(String(r.updated_at).slice(0, 16).replace("T", " ")) + "）"
        : "") +
      (r.author_note ? "　班级/学号：" + OEM.esc(r.author_note) : "") +
      (r.revision > 1 ? "　第 " + r.revision + " 版" : "") +
      "</p>" +
      (r.title ? "<h3>" + OEM.esc(r.title) + "</h3>" : "") +
      '<div class="admin-answer">' + OEM.bodyHtml(r.body, r.attachments) + "</div>" +
      /* 和习题页用同一套渲染：图片附件直接显示，其它文件给下载链接 */
      OEM.attachmentList(r.attachments) +
      '<div class="admin-form">' +
      '<div class="admin-row">' +
      '<label for="g-grade">等级 / 分数</label>' +
      '<input type="text" id="g-grade" maxlength="20" placeholder="例如：A、85、已阅" value="' +
      OEM.escAttr(r.grade || "") + '">' +
      '<select id="g-status">' +
      ["verified", "peer", "alternative", "pending", "withdrawn", "rejected"]
        .map(function (s) {
          return '<option value="' + s + '"' + (r.status === s ? " selected" : "") + ">" +
            LABEL[s] + "</option>";
        })
        .join("") +
      "</select></div>" +
      '<label for="g-feedback">批语（支持 Markdown 与 LaTeX，会公开显示在答案下面）</label>' +
      '<textarea id="g-feedback" maxlength="4000" placeholder="例如：第一步的符号约定要写清楚；结论正确。">' +
      OEM.esc(r.feedback || "") + "</textarea>" +
      '<div class="admin-actions">' +
      '<button type="button" class="btn btn--primary btn--sm" id="g-save">保存</button>' +
      '<button type="button" class="btn btn--outline btn--sm" id="g-hide">撤下这条</button>' +
      '<button type="button" class="btn btn--quiet btn--sm" id="g-delete">删除</button>' +
      '<span class="admin-msg" id="g-msg"></span></div></div>';

    OEM.typeset();

    var note = function (text, tone) {
      var m = document.getElementById("g-msg");
      if (!m) return;
      m.textContent = text;
      if (tone) m.setAttribute("data-tone", tone);
      else m.removeAttribute("data-tone");
    };

    document.getElementById("g-save").addEventListener("click", function () {
      var grade = document.getElementById("g-grade").value;
      var feedback = document.getElementById("g-feedback").value;
      note("保存中…");
      save(r.id, {
        grade: grade,
        feedback: feedback,
        status: document.getElementById("g-status").value,
        graded_at: grade || feedback ? new Date().toISOString() : null,
      })
        .then(function () { note("已保存。", "ok"); })
        .catch(function (e) { note(e.message, "warn"); });
    });

    document.getElementById("g-hide").addEventListener("click", function () {
      /* 不用 window.confirm：内置浏览器会把原生弹窗吞掉，点了没反应 */
      if (!twice(this, "确定撤下？")) return;
      note("处理中…");
      save(r.id, { status: "rejected" })
        .then(function () { note("已撤下。", "ok"); })
        .catch(function (e) { note(e.message, "warn"); });
    });

    document.getElementById("g-delete").addEventListener("click", function () {
      if (!twice(this, "确定彻底删除？")) return;
      note("删除中…");
      remove(r.id)
        .then(function () { note("已删除。", "ok"); })
        .catch(function (e) { note(e.message, "warn"); });
    });
  }

  /* 两步确认：第一次点改成「确定…？」，第二次点才真的执行。
     比 window.confirm 可靠——有些内置浏览器直接屏蔽原生弹窗。 */
  function twice(button, confirmLabel) {
    if (button.getAttribute("data-confirm") === "1") {
      button.removeAttribute("data-confirm");
      button.textContent = button.getAttribute("data-label") || button.textContent;
      return true;
    }
    button.setAttribute("data-label", button.textContent);
    button.setAttribute("data-confirm", "1");
    button.textContent = confirmLabel;
    setTimeout(function () {
      if (button.getAttribute("data-confirm") === "1") {
        button.removeAttribute("data-confirm");
        button.textContent = button.getAttribute("data-label");
      }
    }, 6000);
    return false;
  }

  /* -------------------------------------------------------------- 入口 */

  function showPanel(show) {
    if (els["admin-login"]) els["admin-login"].hidden = show;
    if (els["admin-panel"]) els["admin-panel"].hidden = !show;
  }

  function enter() {
    var s = session();
    if (els["admin-who"]) {
      els["admin-who"].textContent = s && s.email ? "已登录：" + s.email : "";
    }
    showPanel(true);
    isTeacher().then(function (ok) {
      if (!ok) {
        if (els["admin-detail"]) {
          els["admin-detail"].innerHTML =
            '<div class="admin-empty"><strong>这个账号不在老师名单里</strong>' +
            "<p>请把 " +
            OEM.esc((s && s.email) || "这个邮箱") +
            " 加进数据库的 teachers 表（在 Supabase 的 SQL Editor 里跑一句 " +
            "<code>insert into public.teachers (email) values ('…');</code>）。</p></div>";
        }
        return;
      }
      load().catch(function (e) {
        if (els["admin-detail"]) {
          els["admin-detail"].innerHTML =
            '<div class="admin-empty">' + OEM.esc(e.message) + "</div>";
        }
      });
    });
  }

  if (els["admin-signin"]) {
    els["admin-signin"].addEventListener("click", function () {
      var email = (els["admin-email"].value || "").trim();
      var pwd = els["admin-password"].value || "";
      if (!email || !pwd) {
        msg("请填写邮箱和密码。", "warn");
        return;
      }
      msg("登录中…");
      els["admin-signin"].disabled = true;
      login(email, pwd)
        .then(function () {
          msg("");
          enter();
        })
        .catch(function (e) {
          var m = String((e && e.message) || "");
          msg(
            /invalid|credential/i.test(m)
              ? "邮箱或密码不对。如果刚创建账号，请先在邮件里点确认链接。"
              : /fetch|network|load failed/i.test(m)
                ? "连不上服务器。检查一下网络，或者稍后再试。"
                : "登录失败：" + m,
            "warn",
          );
        })
        .then(function () {
          els["admin-signin"].disabled = false;
        });
    });
    els["admin-password"].addEventListener("keydown", function (e) {
      if (e.key === "Enter") els["admin-signin"].click();
    });
  }

  if (els["admin-signout"]) {
    els["admin-signout"].addEventListener("click", function () {
      clearSession();
      rows = [];
      current = null;
      showPanel(false);
      msg("");
    });
  }

  if (els["admin-list"]) {
    els["admin-list"].addEventListener("click", function (e) {
      var btn = e.target.closest("[data-id]");
      if (btn) open(btn.getAttribute("data-id"));
    });
  }
  if (els["admin-search"]) els["admin-search"].addEventListener("input", renderList);
  if (els["admin-status"]) els["admin-status"].addEventListener("change", renderList);
  if (els["admin-reload"]) {
    els["admin-reload"].addEventListener("click", function () {
      load().catch(function (e) {
        if (els["admin-detail"]) {
          els["admin-detail"].innerHTML = '<div class="admin-empty">' + OEM.esc(e.message) + "</div>";
        }
      });
    });
  }

  if (!BASE || !KEY) {
    msg("这个站点还没有配置接收服务器。", "warn");
    return;
  }

  if (session()) enter();
  else showPanel(false);
})();
