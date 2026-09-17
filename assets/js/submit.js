/* Submission form.

   Two modes:
     supabase  fill in, hit 提交, done. The answer lands on the server and the
               browser keeps a device token so the student can come back and
               edit or withdraw it — still without an account.
     offline   no server configured: generate Markdown / keep a local draft.

   Editing reuses the same form; `editing` holds the record being rewritten. */
(function () {
  "use strict";

  var OEM = window.OEM;
  if (!OEM) return;

  var CONFIG = window.SITE_CONFIG || {};
  var CATALOG = window.EXERCISE_CATALOG || [];
  var BACKEND = window.OEMBackend || null;
  var form = document.getElementById("submit-form");
  if (!form) return;

  var CAN_UPLOAD = !!(BACKEND && BACKEND.supabaseReady);
  var GITHUB_REPO = (CONFIG.submission && CONFIG.submission.githubRepo) || "";
  var GITHUB_READY = GITHUB_REPO.indexOf("your-") !== 0 && GITHUB_REPO.indexOf("/") > -1;
  var AUTO_APPROVE = !!(
    CONFIG.submission &&
    CONFIG.submission.supabase &&
    CONFIG.submission.supabase.autoApprove
  );
  var PUBLISHED_STATUS = AUTO_APPROVE ? "verified" : "pending";

  var els = {};
  [
    "f-exercise", "f-name", "f-note", "f-title", "f-body", "f-tags",
    "f-preview", "f-output", "f-output-wrap", "form-status",
    "f-dropzone", "f-files", "f-file-list", "my-submissions", "f-submit",
    "f-success", "f-success-body", "f-editing", "f-editing-info",
    "f-cancel-edit", "f-token", "f-token-copy", "f-token-input",
    "f-token-apply", "f-export", "f-kept",
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  var files = [];          // newly attached File objects
  var kept = [];           // attachments already stored on the server
  var editing = null;      // the record currently being rewritten
  var mineCache = [];      // this device's submissions, from the server

  /* --------------------------------------------------------- catalog  */

  (function buildCatalog() {
    if (!els["f-exercise"]) return;
    var groups = {};
    CATALOG.forEach(function (ex) {
      (groups[ex.chapterId] = groups[ex.chapterId] || { label: ex.chapterLabel, items: [] })
        .items.push(ex);
    });
    var html = ['<option value="">请选择习题…</option>'];
    Object.keys(groups).forEach(function (key) {
      html.push('<optgroup label="' + OEM.escAttr(groups[key].label) + '">');
      groups[key].items.forEach(function (ex) {
        html.push(
          '<option value="' + OEM.escAttr(ex.id) + '">习题 ' + OEM.esc(ex.id) +
            " — " + OEM.esc(ex.title || "") + "</option>",
        );
      });
      html.push("</optgroup>");
    });
    els["f-exercise"].innerHTML = html.join("");

    var want = new URLSearchParams(window.location.search).get("exercise");
    if (want) els["f-exercise"].value = want;
  })();

  /* -------------------------------------------------------- statuses  */

  function setStatus(msg, tone) {
    if (!els["form-status"]) return;
    els["form-status"].textContent = msg || "";
    if (tone) els["form-status"].setAttribute("data-tone", tone);
    else els["form-status"].removeAttribute("data-tone");
  }

  function setBusy(busy, label) {
    if (!els["f-submit"]) return;
    els["f-submit"].disabled = busy;
    els["f-submit"].textContent = busy ? label || "正在提交…" : submitLabel();
  }

  function submitLabel() {
    if (editing) return "保存修改";
    if (CAN_UPLOAD) return "提交我的答案";
    if (GITHUB_READY) return "生成提交内容并前往 GitHub";
    return "生成提交内容";
  }

  /* --------------------------------------------------------- preview  */

  var previewTimer = null;
  function refreshPreview() {
    var pane = els["f-preview"];
    if (!pane) return;
    var raw = els["f-body"].value.trim();
    if (!raw) {
      pane.setAttribute("data-empty", "true");
      pane.textContent = "在上方输入答案正文，这里会实时显示公式排版效果。";
      return;
    }
    pane.removeAttribute("data-empty");
    pane.innerHTML = OEM.md(raw);
    OEM.typeset();
  }

  if (els["f-body"]) {
    els["f-body"].addEventListener("input", function () {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(refreshPreview, 220);
    });
  }

  /* ----------------------------------------------------------- files  */

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function renderFiles() {
    if (!els["f-file-list"]) return;
    var html = kept
      .map(function (f, i) {
        return (
          "<li>" + OEM.ICONS.file + "<span>" + OEM.esc(f.name) + "</span><small>已上传</small>" +
          '<button type="button" data-drop-kept="' + i + '">移除</button></li>'
        );
      })
      .join("");
    html += files
      .map(function (f, i) {
        return (
          "<li>" + OEM.ICONS.file + "<span>" + OEM.esc(f.name) + "</span><small>" +
          OEM.esc(fmtSize(f.size)) + "</small>" +
          '<button type="button" data-drop="' + i + '">移除</button></li>'
        );
      })
      .join("");
    els["f-file-list"].innerHTML = html;
    if (els["f-kept"]) {
      els["f-kept"].textContent = kept.length
        ? "已有 " + kept.length + " 个附件（可单独移除）"
        : "";
    }
  }

  function addFiles(list) {
    Array.prototype.forEach.call(list || [], function (f) {
      var limit = (BACKEND && BACKEND.maxFileMb) || 20;
      if (f.size > limit * 1024 * 1024) {
        setStatus("「" + f.name + "」超过 " + limit + " MB，请压缩后再上传。", "warn");
        return;
      }
      var dup = files.some(function (x) {
        return x.name === f.name && x.size === f.size;
      });
      if (!dup) files.push(f);
    });
    renderFiles();
    setStatus(files.length + kept.length ? "已选择附件。" : "", "");
  }

  if (els["f-dropzone"] && els["f-files"]) {
    els["f-dropzone"].addEventListener("click", function () {
      els["f-files"].click();
    });
    els["f-dropzone"].addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els["f-files"].click();
      }
    });
    els["f-files"].addEventListener("change", function () {
      addFiles(els["f-files"].files);
      els["f-files"].value = "";
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      els["f-dropzone"].addEventListener(ev, function (e) {
        e.preventDefault();
        els["f-dropzone"].setAttribute("data-over", "true");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els["f-dropzone"].addEventListener(ev, function (e) {
        e.preventDefault();
        els["f-dropzone"].setAttribute("data-over", "false");
      });
    });
    els["f-dropzone"].addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
  }

  if (els["f-file-list"]) {
    els["f-file-list"].addEventListener("click", function (e) {
      var dropKept = e.target.closest("[data-drop-kept]");
      if (dropKept) {
        kept.splice(Number(dropKept.getAttribute("data-drop-kept")), 1);
        renderFiles();
        return;
      }
      var drop = e.target.closest("[data-drop]");
      if (drop) {
        files.splice(Number(drop.getAttribute("data-drop")), 1);
        renderFiles();
      }
    });
  }

  /* ------------------------------------------------------ validation  */

  function markInvalid(el, invalid) {
    var field = el.closest(".field");
    if (field) field.setAttribute("data-invalid", invalid ? "true" : "false");
  }

  function validate() {
    var ok = true;
    [
      [els["f-exercise"], els["f-exercise"].value === ""],
      [els["f-name"], !els["f-name"].value.trim()],
      [els["f-body"], els["f-body"].value.trim().length < 10],
    ].forEach(function (pair) {
      markInvalid(pair[0], pair[1]);
      if (pair[1]) ok = false;
    });
    return ok;
  }

  ["input", "change"].forEach(function (ev) {
    form.addEventListener(ev, function (e) {
      if (e.target.closest && e.target.closest(".field[data-invalid='true']")) {
        markInvalid(e.target, false);
      }
    });
  });

  /* ---------------------------------------------------------- record  */

  function exerciseTitle(id) {
    var hit = CATALOG.filter(function (x) {
      return x.id === id;
    })[0];
    return hit ? hit.title : "";
  }

  function buildRecord() {
    var ex = els["f-exercise"].value;
    return {
      id: editing ? editing.id : "local-" + ex + "-" + Date.now(),
      exercise: ex,
      exerciseLabel: "习题 " + ex + (exerciseTitle(ex) ? " " + exerciseTitle(ex) : ""),
      author: els["f-name"].value.trim(),
      authorNote: els["f-note"].value.trim(),
      title: els["f-title"].value.trim(),
      body: els["f-body"].value.trim(),
      tags: els["f-tags"].value
        .split(/[,，;；\s]+/)
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean),
      date: new Date().toISOString().slice(0, 10),
      status: PUBLISHED_STATUS,
      helpful: 0,
      source: "local",
      revision: editing ? Number(editing.revision || 1) : 1,
      attachments: kept.concat(
        files.map(function (f) {
          return { name: f.name, size: fmtSize(f.size) };
        }),
      ),
    };
  }

  function buildMarkdown(rec) {
    var lines = [];
    lines.push("### 习题编号 / Exercise", "", rec.exercise, "");
    lines.push("### 姓名或昵称 / Name", "", rec.author, "");
    lines.push("### 班级或学号（可选）", "", rec.authorNote || "—", "");
    lines.push("### 解答标题（可选）", "", rec.title || "—", "");
    lines.push("### 我的解答 / My answer", "", rec.body);
    if (rec.attachments.length) {
      lines.push("", "### 附件清单", "");
      lines.push("> 请把下面的文件直接拖拽到这个输入框内。", "");
      rec.attachments.forEach(function (f) {
        lines.push("- " + f.name + (f.size ? " （" + f.size + "）" : ""));
      });
    }
    lines.push("", "### 确认", "");
    lines.push("- [x] 这是我自己的解答，允许在课程网站上公开展示。");
    return lines.join("\n");
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 2000);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function showOutput(text) {
    if (!els["f-output"]) return;
    els["f-output"].value = text;
    if (els["f-output-wrap"]) els["f-output-wrap"].hidden = false;
  }

  function slug(s) {
    return String(s || "answer")
      .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  /* ------------------------------------------------------ my answers  */

  var STATUS_TEXT = {
    verified: "已发布",
    peer: "已发布",
    alternative: "已发布",
    pending: "待审核",
    withdrawn: "已撤回",
    rejected: "已撤下",
  };

  function renderMine() {
    var host = els["my-submissions"];
    if (!host) return;

    if (!CAN_UPLOAD) {
      var drafts = OEM.readLocal();
      host.innerHTML = drafts.length
        ? drafts
            .map(function (a) {
              return (
                '<article class="answer-card answer-card--pending">' +
                '<div class="answer-card__head"><span class="answer-card__author">' +
                OEM.esc(a.author) + "</span>" +
                '<span class="answer-card__when">' + OEM.esc(a.date || "") + "</span></div>" +
                '<h3 class="answer-card__title">习题 ' + OEM.esc(a.exercise) +
                (a.title ? " · " + OEM.esc(a.title) : "") + "</h3>" +
                '<div class="answer-card__body">' + OEM.md(a.body) + "</div>" +
                '<div class="answer-card__foot"><span class="tag">本机草稿</span>' +
                '<button type="button" class="btn btn--quiet btn--sm" data-drop="' +
                OEM.escAttr(a.id) + '">删除</button></div></article>'
              );
            })
            .join("")
        : '<div class="empty-state"><p>这台设备上还没有草稿。用「暂存到本机」可以存下来，稍后一起导出。</p></div>';
      OEM.typeset();
      return;
    }

    if (!mineCache.length) {
      host.innerHTML =
        '<div class="empty-state"><p>这台设备还没有提交过作业。提交之后，你会在这里看到它，并可以随时修改或撤回。</p></div>';
      return;
    }

    host.innerHTML = mineCache
      .map(function (a) {
        var withdrawn = a.status === "withdrawn";
        return (
          '<article class="answer-card answer-card--' +
          (withdrawn ? "pending" : "verified") +
          '" id="mine-' + OEM.escAttr(a.id) + '">' +
          '<div class="answer-card__head">' +
          '<span class="answer-card__author">习题 ' + OEM.esc(a.exercise) +
          (exerciseTitle(a.exercise) ? " · " + OEM.esc(exerciseTitle(a.exercise)) : "") +
          "</span>" +
          '<span class="answer-card__when">' + OEM.esc(a.date || "") + "</span>" +
          (a.revision > 1 ? '<span class="answer-card__when">已修改 ' + a.revision + " 次</span>" : "") +
          "</div>" +
          (a.title ? '<h3 class="answer-card__title">' + OEM.esc(a.title) + "</h3>" : "") +
          '<div class="answer-card__body">' + OEM.md(a.body) + "</div>" +
          (a.feedback
            ? '<div class="feedback"><span class="feedback__label">教师批语</span>' +
              '<div class="feedback__body">' + OEM.md(a.feedback) + "</div></div>"
            : "") +
          '<div class="answer-card__foot">' +
          '<span class="tag' + (withdrawn ? "" : " tag--official") + '">' +
          OEM.esc(STATUS_TEXT[a.status] || a.status) + "</span>" +
          (a.grade ? '<span class="tag tag--grade">等级 ' + OEM.esc(a.grade) + "</span>" : "") +
          (a.status === "withdrawn"
            ? '<button type="button" class="btn btn--outline btn--sm" data-restore="' +
              OEM.escAttr(a.id) + '">恢复提交</button>'
            : '<button type="button" class="btn btn--outline btn--sm" data-edit="' +
              OEM.escAttr(a.id) + '">修改</button>' +
              '<button type="button" class="btn btn--quiet btn--sm" data-withdraw="' +
              OEM.escAttr(a.id) + '">撤回</button>') +
          "</div></article>"
        );
      })
      .join("");
    OEM.typeset();
  }

  function loadMine() {
    if (!CAN_UPLOAD) return Promise.resolve([]);
    return BACKEND.mySubmissions().then(function (list) {
      mineCache = list || [];
      renderMine();
      return mineCache;
    });
  }

  function findMine(id) {
    return mineCache.filter(function (a) {
      return a.id === id;
    })[0];
  }

  function startEdit(id) {
    var rec = findMine(id);
    if (!rec) return;
    editing = rec;
    kept = (rec.attachments || []).slice();
    files = [];
    els["f-exercise"].value = rec.exercise;
    els["f-name"].value = rec.author;
    els["f-note"].value = rec.authorNote || "";
    els["f-title"].value = rec.title || "";
    els["f-tags"].value = (rec.tags || []).join(", ");
    els["f-body"].value = rec.body;
    renderFiles();
    refreshPreview();
    if (els["f-editing"]) {
      els["f-editing"].hidden = false;
      els["f-editing-info"].textContent =
        "习题 " + rec.exercise + "（提交编号 " + rec.id + "）" +
        (rec.status === "withdrawn" ? "，当前是已撤回状态，保存后会重新发布。" : "");
    }
    if (els["f-submit"]) els["f-submit"].textContent = submitLabel();
    setStatus("正在修改这条提交，改完点「保存修改」。", "");
    form.scrollIntoView({ block: "start" });
  }

  function cancelEdit() {
    editing = null;
    kept = [];
    files = [];
    form.reset();
    renderFiles();
    refreshPreview();
    if (els["f-editing"]) els["f-editing"].hidden = true;
    if (els["f-submit"]) els["f-submit"].textContent = submitLabel();
    setStatus("已退出修改，现在提交会是一条新答案。", "");
  }

  if (els["my-submissions"]) {
    els["my-submissions"].addEventListener("click", function (e) {
      var t = e.target.closest("[data-edit],[data-withdraw],[data-restore],[data-drop]");
      if (!t) return;

      if (t.hasAttribute("data-drop")) {
        OEM.writeLocal(
          OEM.readLocal().filter(function (a) {
            return a.id !== t.getAttribute("data-drop");
          }),
        );
        renderMine();
        return;
      }

      var id = t.getAttribute("data-edit") || t.getAttribute("data-withdraw") || t.getAttribute("data-restore");
      if (t.hasAttribute("data-edit")) {
        startEdit(id);
        return;
      }

      var withdraw = t.hasAttribute("data-withdraw");
      if (withdraw && !window.confirm("撤回后这条答案会从网站上消失，记录仍保留，你随时可以恢复。确定撤回吗？")) {
        return;
      }
      t.disabled = true;
      BACKEND.setStatus(id, withdraw ? "withdrawn" : "verified")
        .then(function () {
          if (editing && editing.id === id) cancelEdit();
          setStatus(withdraw ? "已撤回，可以随时点「恢复提交」。" : "已恢复发布。", "ok");
          return loadMine();
        })
        .catch(function (err) {
          setStatus(err.message || "操作失败", "warn");
          t.disabled = false;
        });
    });
  }

  if (els["f-cancel-edit"]) {
    els["f-cancel-edit"].addEventListener("click", cancelEdit);
  }

  /* ------------------------------------------------ recovery code ---- */

  function paintToken() {
    if (els["f-token"]) els["f-token"].textContent = BACKEND.deviceToken();
  }

  if (els["f-token-copy"]) {
    els["f-token-copy"].addEventListener("click", function () {
      copy(BACKEND.deviceToken()).then(function () {
        setStatus("恢复码已复制。换设备时粘贴它就能找回你交过的作业。", "ok");
      });
    });
  }

  if (els["f-token-apply"]) {
    els["f-token-apply"].addEventListener("click", function () {
      var v = (els["f-token-input"].value || "").trim();
      if (v.length < 16) {
        setStatus("恢复码看起来不完整（至少要 16 个字符）。", "warn");
        return;
      }
      if (!BACKEND.adoptToken(v)) {
        setStatus("这台浏览器不允许保存恢复码（可能开了隐私模式）。", "warn");
        return;
      }
      paintToken();
      els["f-token-input"].value = "";
      loadMine().then(function (list) {
        setStatus(
          list.length ? "找回成功，共 " + list.length + " 条。" : "这个恢复码名下没有找到提交。",
          list.length ? "ok" : "warn",
        );
      });
    });
  }

  if (els["f-export"]) {
    els["f-export"].addEventListener("click", function () {
      var list = CAN_UPLOAD ? mineCache : OEM.readLocal();
      if (!list.length) {
        setStatus("还没有可导出的提交。", "warn");
        return;
      }
      download(
        "answers-export.json",
        JSON.stringify({ updated: new Date().toISOString().slice(0, 10), answers: list }, null, 2) + "\n",
      );
      setStatus("已导出 " + list.length + " 条。", "ok");
    });
  }

  /* ---------------------------------------------------------- submit  */

  function showSuccess(rec, res, mode) {
    if (!els["f-success"]) return;
    els["f-success"].hidden = false;
    var stored = res && res.mode === "supabase";
    var verb = mode === "update" ? "修改已保存" : "答案已提交";
    els["f-success-body"].innerHTML =
      "<p><strong>" + OEM.esc(rec.author) + "</strong>，习题 " + OEM.esc(rec.exercise) +
      " 的" + verb + (stored ? "，已经保存在课程服务器上" : "（草稿已保存在本机）") + "。</p>" +
      (stored
        ? '<p>你可以在下面的<a href="#mine">「我的提交」</a>里随时<strong>修改</strong>或<strong>撤回</strong>它。' +
          (AUTO_APPROVE ? "这条现在就在网站上。" : "老师确认后会展示。") + "</p>"
        : "<p>请把下面生成的 Markdown（和附件）交给老师。</p>") +
      (res && res.id
        ? '<p class="field__hint">提交编号：' + OEM.esc(res.id) + "</p>"
        : "");
    els["f-success"].scrollIntoView({ block: "center" });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      setStatus("请先补全标红的必填项：习题、姓名、答案正文（至少 10 个字符）。", "warn");
      var bad = form.querySelector(
        ".field[data-invalid='true'] input, .field[data-invalid='true'] select, .field[data-invalid='true'] textarea",
      );
      if (bad) bad.focus();
      return;
    }

    var rec = buildRecord();
    showOutput(buildMarkdown(rec));
    refreshPreview();

    if (CAN_UPLOAD) {
      var isEdit = !!editing;
      setBusy(true, files.length ? "正在上传…" : isEdit ? "正在保存…" : "正在提交…");
      setStatus(
        files.length ? "正在上传 " + files.length + " 个附件，请不要关闭页面…" : isEdit ? "正在保存…" : "正在提交…",
      );
      var payload = {
        exercise: rec.exercise,
        author: rec.author,
        authorNote: rec.authorNote,
        title: rec.title,
        tags: rec.tags,
        body: rec.body,
        status: PUBLISHED_STATUS,
        revision: rec.revision,
        attachments: kept,
      };
      var task = isEdit
        ? BACKEND.updateSubmission(editing.id, payload, files, progress)
        : BACKEND.submitSupabase(payload, files, progress);

      task
        .then(function (res) {
          showSuccess(rec, res, isEdit ? "update" : "create");
          setStatus(isEdit ? "修改已保存。" : "提交成功。", "ok");
          editing = null;
          kept = [];
          files = [];
          form.reset();
          renderFiles();
          refreshPreview();
          if (els["f-editing"]) els["f-editing"].hidden = true;
          setBusy(false);
          return loadMine();
        })
        .catch(function (err) {
          setStatus(
            (err && err.message ? err.message : "提交失败") +
              "　你可以改用下面的「下载 .md」把答案直接发给老师。",
            "warn",
          );
          setBusy(false);
        });
      return;
    }

    function progress(done, total, name) {
      setStatus("正在上传附件 " + Math.min(done + 1, total) + "/" + total + "：" + name + "…");
    }

    if (GITHUB_READY) {
      var params = new URLSearchParams();
      params.set("template", "answer.yml");
      params.set("title", "[答案] 习题 " + rec.exercise + (rec.title ? " · " + rec.title : ""));
      params.set("exercise", rec.exercise);
      params.set("name", rec.author);
      params.set("affiliation", rec.authorNote);
      params.set("answer", rec.body);
      setStatus("已生成提交内容，正在打开 GitHub 提交页面。请把答案粘贴进去，并把文件拖入正文框完成上传。", "ok");
      window.open("https://github.com/" + GITHUB_REPO + "/issues/new?" + params.toString(), "_blank", "noopener");
      return;
    }

    setStatus("还没有配置接收服务器，已为你生成 Markdown。请复制或下载后交给老师。", "warn");
  });

  var copyBtn = document.getElementById("f-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = els["f-output"] && els["f-output"].value;
      if (!text) return setStatus("请先点击提交生成内容。", "warn");
      copy(text).then(function () {
        setStatus("Markdown 已复制到剪贴板。", "ok");
      });
    });
  }

  var downloadBtn = document.getElementById("f-download");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", function () {
      var text = els["f-output"] && els["f-output"].value;
      if (!text) return setStatus("请先点击提交生成内容。", "warn");
      download("习题" + slug(els["f-exercise"].value) + "-" + slug(els["f-name"].value) + ".md", text);
      setStatus("已下载 Markdown 文件。", "ok");
    });
  }

  var stashBtn = document.getElementById("f-stash");
  if (stashBtn) {
    stashBtn.addEventListener("click", function () {
      if (!validate()) return setStatus("请先填完必填项，再暂存到本机。", "warn");
      var list = OEM.readLocal();
      list.push(buildRecord());
      if (OEM.writeLocal(list)) {
        renderMine();
        setStatus("已暂存到本机浏览器。注意：草稿只保存在这台设备上。", "ok");
      } else {
        setStatus("本机存储空间不足，暂存失败。", "warn");
      }
    });
  }

  /* ------------------------------------------------------------ boot  */

  if (els["f-submit"]) els["f-submit"].textContent = submitLabel();
  renderFiles();
  refreshPreview();
  if (CAN_UPLOAD && BACKEND) {
    paintToken();
    loadMine();
  } else {
    renderMine();
  }
})();
