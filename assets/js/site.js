/* Open Economy Macroeconomics — Solutions
   Client runtime: mini-markdown, answer rendering, search, submission flow. */
(function () {
  "use strict";

  var ROOT = (window.SITE_ROOT || ".").replace(/\/$/, "");
  var CONFIG = window.SITE_CONFIG || {};
  var STORE_KEY = "oem-submissions-v1";
  var VOTE_KEY = "oem-helpful-v1";

  function url(path) {
    return (ROOT ? ROOT + "/" : "") + path.replace(/^\//, "");
  }

  /* ------------------------------------------------------------ escaping */

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escAttr(s) {
    return esc(s).replace(/'/g, "&#39;");
  }

  /* --------------------------------------------------- mini markdown --- */

  var MATH_RE = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]*?\$)/g;

  /* A literal dollar sign (currency, not math) is written `\$` in the source.
     It cannot be left as a bare "$" in the DOM: MathJax would pair it with the
     next one and typeset the text in between as a formula. Wrapping it in an
     element that MathJax is told to skip keeps it visible and copyable. */
  var DOLLAR = "\u0000U\u0000";
  var DOLLAR_HTML = '<x-usd aria-hidden="false">$</x-usd>';

  function protectDollars(text) {
    return text.split("\\$").join(DOLLAR);
  }

  function restoreDollars(html) {
    return html.split(DOLLAR).join(DOLLAR_HTML);
  }

  function extractMath(escaped, store) {
    return escaped.replace(MATH_RE, function (m) {
      store.push(m);
      return "\u0000M" + (store.length - 1) + "\u0000";
    });
  }

  function restoreMath(html, store) {
    return html.replace(/\u0000M(\d+)\u0000/g, function (_, i) {
      return store[Number(i)];
    });
  }

  function inline(text) {
    return text
      .replace(/`([^`]+)`/g, function (_, c) {
        return "<code>" + c + "</code>";
      })
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, src) {
        return '<img src="' + src + '" alt="' + alt + '" loading="lazy">';
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
        return '<a href="' + href + '">' + label + "</a>";
      })
      .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  }

  /* Converts a markdown subset (plus LaTeX) to HTML. */
  function md(src) {
    if (!src) return "";
    var store = [];
    var text = protectDollars(esc(src).replace(/\r\n/g, "\n"));
    text = extractMath(text, store);
    var lines = text.split("\n");
    var out = [];
    var para = [];
    var list = null;

    function flushPara() {
      if (para.length) {
        out.push("<p>" + inline(para.join(" ")) + "</p>");
        para = [];
      }
    }
    function flushList() {
      if (list) {
        var start =
          list.type === "ol" && list.start > 1 ? ' start="' + list.start + '"' : "";
        out.push(
          "<" +
            list.type +
            start +
            ">" +
            list.items
              .map(function (t) {
                return "<li>" + inline(t) + "</li>";
              })
              .join("") +
            "</" +
            list.type +
            ">",
        );
        list = null;
      }
    }
    function flushAll() {
      flushPara();
      flushList();
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (/^\u0000M\d+\u0000$/.test(trimmed)) {
        flushAll();
        out.push("<p>" + trimmed + "</p>");
        continue;
      }
      if (!trimmed) {
        flushAll();
        continue;
      }
      if (/^(```|~~~)/.test(trimmed)) {
        flushAll();
        var fence = trimmed.slice(0, 3);
        var code = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) {
          code.push(lines[i]);
          i++;
        }
        out.push("<pre><code>" + code.join("\n") + "</code></pre>");
        continue;
      }
      var h = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushAll();
        var lvl = Math.min(h[1].length + 2, 6);
        out.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">");
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushAll();
        out.push("<hr>");
        continue;
      }
      var ul = line.match(/^\s*[-*+]\s+(.*)$/);
      var ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        var type = ul ? "ul" : "ol";
        /* A blank line or a display equation can split one ordered list into
           two <ol> elements; keep the original numbering across the gap. */
        var start = ol ? Number(ol[1]) : 1;
        if (!list || list.type !== type) {
          flushList();
          list = { type: type, items: [], start: start };
        }
        list.items.push(ul ? ul[1] : ol[2]);
        continue;
      }
      var bq = line.match(/^\s*&gt;\s?(.*)$/);
      if (bq) {
        flushAll();
        out.push("<blockquote><p>" + inline(bq[1]) + "</p></blockquote>");
        continue;
      }
      /* Lazy continuation: prose lines that follow a list item without a blank
         line belong to that item. Without this the item's own text is emitted
         as separate paragraphs and ends up above the list. */
      if (list && list.items.length) {
        list.items[list.items.length - 1] += " " + trimmed;
        continue;
      }
      para.push(trimmed);
    }
    flushAll();
    return restoreDollars(restoreMath(out.join("\n"), store));
  }

  /* ------------------------------------------------------------ typeset */

  var typesetTimer = null;
  function typeset() {
    if (!window.MathJax || !window.MathJax.typesetPromise) return;
    clearTimeout(typesetTimer);
    typesetTimer = setTimeout(function () {
      window.MathJax.typesetPromise().catch(function () {});
    }, 60);
  }

  /* ------------------------------------------------------------- icons */

  var ICONS = {
    arrowLeft:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
    file:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10A1.5 1.5 0 0 0 4.5 14.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5Z"/><path d="M9 1.5V5.5H13"/></svg>',
    thumb:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 14V6.5l2.6-4.6a1.2 1.2 0 0 1 2.2.9L9.2 6h3.4a1.3 1.3 0 0 1 1.3 1.6l-1.3 5.3a1.5 1.5 0 0 1-1.5 1.1H5Z"/><path d="M5 14H2.5V6.5H5"/></svg>',
    upload:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 11V2.5"/><path d="M4.5 6 8 2.5 11.5 6"/><path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11"/></svg>',
  };

  /* -------------------------------------------------------------- data  */

  function inlineData(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      return null;
    }
  }

  /* Prefers freshly built data/answers.json; falls back to the copy baked
     into the page so the site also works when opened from the filesystem. */
  function loadAnswers() {
    return fetch(url("data/answers.json"), { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function () {
        return inlineData("answers-data") || { updated: "", answers: [] };
      });
  }

  function mergeLocal(all) {
    /* With a server configured, the server is the source of truth; older local
       drafts would only show up as stale duplicates. */
    if (window.OEMBackend && window.OEMBackend.supabaseReady) return all;
    var mine = readLocal();
    if (!mine.length) return all;
    var ids = {};
    all.forEach(function (a) {
      ids[a.id] = true;
    });
    var extra = mine.filter(function (a) {
      return !ids[a.id];
    });
    return all.concat(extra);
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readVotes() {
    try {
      var raw = localStorage.getItem(VOTE_KEY);
      var v = raw ? JSON.parse(raw) : {};
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  function writeVotes(v) {
    try {
      localStorage.setItem(VOTE_KEY, JSON.stringify(v));
    } catch (e) {}
  }

  /* ---------------------------------------------------------- fragments */

  var STATUS = {
    verified: { label: "精选解答", cls: "tag--official" },
    peer: { label: "同学解答", cls: "tag--peer" },
    pending: { label: "待审核", cls: "" },
    alternative: { label: "另一种思路", cls: "tag--peer" },
    withdrawn: { label: "已撤回", cls: "" },
  };

  /* 自己撤回的作业不出现在公开页面上，只在「我的提交」里可见。 */
  function visible(list) {
    return list.filter(function (a) {
      return a.status !== "withdrawn";
    });
  }

  function statusOf(a) {
    return STATUS[a.status] || STATUS.peer;
  }

  function attachmentList(files) {
    if (!files || !files.length) return "";
    return (
      '<ul class="attachments">' +
      files
        .map(function (f) {
          var raw = f.url || "";
          var href = raw ? (/^https?:/.test(raw) ? raw : url(raw)) : "";
          var inner =
            ICONS.file +
            "<span>" +
            esc(f.name) +
            "</span>" +
            (f.size ? "<small>" + esc(f.size) + "</small>" : "");
          /* A draft kept in this browser has no uploaded file behind it yet,
             so render a plain chip instead of a dead link. */
          if (!href) {
            return '<li><span class="chip">' + inner + "</span></li>";
          }
          return (
            "<li><a href=\"" +
            escAttr(href) +
            '" target="_blank" rel="noopener">' +
            inner +
            "</a></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function answerCard(a, opts) {
    opts = opts || {};
    var st = statusOf(a);
    var votes = readVotes();
    var voted = !!votes[a.id];
    var count = (Number(a.helpful) || 0) + (voted ? 1 : 0);
    var head =
      '<div class="answer-card__head">' +
      '<span class="answer-card__author">' +
      esc(a.author || "匿名同学") +
      "</span>" +
      /* 班级 / 学号只在自己这台设备上回显，不对外公开 */
      (a.mine && a.authorNote
        ? '<span class="answer-card__when">' + esc(a.authorNote) + "</span>"
        : "") +
      '<span class="answer-card__when">' +
      esc(a.date || "") +
      "</span>" +
      (Number(a.revision) > 1
        ? '<span class="answer-card__when">已修改 ' + Number(a.revision) + " 次</span>"
        : "") +
      (a.mine ? '<span class="tag tag--mine">我的</span>' : "") +
      "</div>";

    return (
      '<article class="answer-card answer-card--' +
      esc(a.status || "peer") +
      '" id="' +
      escAttr(a.id) +
      '"' +
      (a.exercise ? ' data-exercise="' + escAttr(a.exercise) + '"' : "") +
      ">" +
      head +
      (a.title ? '<h3 class="answer-card__title">' + esc(a.title) + "</h3>" : "") +
      '<div class="answer-card__body">' +
      md(a.body) +
      "</div>" +
      attachmentList(a.attachments) +
      (a.feedback
        ? '<div class="feedback">' +
          '<span class="feedback__label">教师批语</span>' +
          '<div class="feedback__body">' +
          md(a.feedback) +
          "</div>" +
          "</div>"
        : "") +
      '<div class="answer-card__foot">' +
      (opts.hideExercise || !a.exercise
        ? ""
        : '<span class="tag tag--count">' +
          esc(a.exerciseLabel || "习题 " + a.exercise) +
          "</span>") +
      '<span class="tag ' +
      st.cls +
      '">' +
      st.label +
      "</span>" +
      (a.tags && a.tags.length
        ? '<span class="answer-card__tags">' +
          a.tags
            .map(function (t) {
              return '<span class="tag tag--muted">' + esc(t) + "</span>";
            })
            .join("") +
          "</span>"
        : "") +
      (a.mine && a.grade
        ? '<span class="tag tag--grade">等级 ' + esc(a.grade) + "</span>"
        : "") +
      '<button type="button" class="helpful" data-vote="' +
      escAttr(a.id) +
      '" data-voted="' +
      (voted ? "true" : "false") +
      '" aria-pressed="' +
      (voted ? "true" : "false") +
      '">' +
      ICONS.thumb +
      "<span>有帮助 " +
      count +
      "</span></button>" +
      "</div>" +
      "</article>"
    );
  }

  /* ------------------------------------------------------------ render  */

  function renderExercise(payload) {
    var host = document.querySelector("[data-answers-for]");
    if (!host) return;
    var id = host.getAttribute("data-answers-for");
    var list = visible(
      (payload.answers || []).filter(function (a) {
        return String(a.exercise) === String(id);
      }),
    );
    var countEl = document.querySelector("[data-answer-count]");
    if (countEl) countEl.textContent = list.length ? String(list.length) : "";

    if (!list.length) {
      host.innerHTML =
        '<div class="empty-state">' +
        "<h3>还没有同学提交这道题的解答</h3>" +
        "<p>你可以成为第一个。上传的解答经教师确认后会展现在这里。</p>" +
        '<a class="btn btn--primary btn--sm" href="' +
        url("submit.html?exercise=" + encodeURIComponent(id)) +
        '">' +
        ICONS.upload +
        " 上传我的答案</a>" +
        "</div>";
      return;
    }

    list.sort(function (a, b) {
      var rank = { verified: 0, alternative: 1, peer: 1, pending: 2 };
      var ra = rank[a.status] === undefined ? 1 : rank[a.status];
      var rb = rank[b.status] === undefined ? 1 : rank[b.status];
      if (ra !== rb) return ra - rb;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    host.innerHTML = list.map(function (a) {
      return answerCard(a, { hideExercise: true });
    }).join("");
  }

  function renderRecent(payload) {
    var host = document.querySelector("[data-recent-answers]");
    if (!host) return;
    var list = visible(payload.answers || []).slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    var limit = Number(host.getAttribute("data-limit")) || 4;
    list = list.slice(0, limit);
    if (!list.length) {
      host.innerHTML =
        '<div class="empty-state"><p>还没有收录任何同学答案。</p></div>';
      return;
    }
    host.innerHTML = list
      .map(function (a) {
        return answerCard(a, { hideExercise: false });
      })
      .join("");
  }

  function renderWall(payload) {
    var host = document.querySelector("[data-answer-wall]");
    if (!host) return;
    var searchEl = document.getElementById("wall-search");
    var chapterEl = document.getElementById("wall-chapter");
    var statusEl = document.getElementById("wall-status");
    var countEl = document.getElementById("wall-count");
    var all = (payload.answers || []).slice();
    all = visible(all);

    function apply() {
      var q = (searchEl && searchEl.value ? searchEl.value : "").trim().toLowerCase();
      var ch = chapterEl ? chapterEl.value : "";
      var st = statusEl ? statusEl.value : "";
      var list = all.filter(function (a) {
        if (ch && String(a.exercise || "").split(".")[0] !== ch) return false;
        if (st && a.status !== st) return false;
        if (!q) return true;
        return (
          String(a.exercise || "") +
          " " +
          (a.title || "") +
          " " +
          (a.author || "") +
          " " +
          (a.body || "") +
          " " +
          (a.tags || []).join(" ")
        )
          .toLowerCase()
          .indexOf(q) !== -1;
      });
      list.sort(function (a, b) {
        return String(b.date || "").localeCompare(String(a.date || ""));
      });
      if (countEl) countEl.textContent = list.length + " / " + all.length + " 条";
      host.innerHTML = list.length
        ? list
            .map(function (a) {
              return answerCard(a, {});
            })
            .join("")
        : '<div class="empty-state"><h3>没有匹配的答案</h3><p>试试换一个关键词，或清除筛选条件。</p></div>';
      typeset();
    }

    [searchEl, chapterEl, statusEl].forEach(function (el) {
      if (el && !el.dataset.wallBound) {
        el.dataset.wallBound = "1";
        el.addEventListener("input", apply);
        el.addEventListener("change", apply);
      }
    });
    apply();
  }

  /* ------------------------------------------------------------ search  */

  function initSearch() {
    var input = document.getElementById("site-search");
    var panel = document.getElementById("site-search-results");
    if (!input || !panel) return;
    var index = Array.isArray(window.SEARCH_INDEX) ? window.SEARCH_INDEX : [];
    var active = -1;

    function close() {
      panel.setAttribute("data-open", "false");
      active = -1;
    }

    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 1) {
        close();
        return;
      }
      var tokens = q.split(/\s+/);
      var hits = index
        .map(function (item) {
          var hay = (item.t + " " + item.k + " " + (item.c || "")).toLowerCase();
          var score = 0;
          for (var i = 0; i < tokens.length; i++) {
            var pos = hay.indexOf(tokens[i]);
            if (pos === -1) return null;
            score += pos === 0 ? 4 : 1;
          }
          return { item: item, score: score };
        })
        .filter(Boolean)
        .sort(function (a, b) {
          return b.score - a.score;
        })
        .slice(0, 24);

      if (!hits.length) {
        panel.innerHTML = '<div class="search-results__empty">没有找到匹配的习题或解答。</div>';
      } else {
        panel.innerHTML = hits
          .map(function (h) {
            return (
              '<a class="search-results__item" href="' +
              escAttr(url(h.item.u)) +
              '"><b>' +
              esc(h.item.t) +
              "</b><small>" +
              esc(h.item.c || "") +
              "</small></a>"
            );
          })
          .join("");
      }
      panel.setAttribute("data-open", "true");
      active = -1;
    }

    input.addEventListener("input", run);
    input.addEventListener("focus", run);
    input.addEventListener("keydown", function (e) {
      var items = panel.querySelectorAll(".search-results__item");
      if (e.key === "Escape") {
        input.value = "";
        close();
        return;
      }
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active += e.key === "ArrowDown" ? 1 : -1;
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        for (var i = 0; i < items.length; i++) {
          items[i].setAttribute("data-active", i === active ? "true" : "false");
        }
        items[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        window.location.href = items[active].getAttribute("href");
      }
    });
    document.addEventListener("click", function (e) {
      if (!panel.contains(e.target) && e.target !== input) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== input) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  /* -------------------------------------------------------- nav toggle  */

  function initNav() {
    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.getAttribute("data-open") === "true";
      nav.setAttribute("data-open", open ? "false" : "true");
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
    });
  }

  /* ------------------------------------------------------------- votes  */

  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-vote]") : null;
    if (!btn) return;
    var id = btn.getAttribute("data-vote");
    var votes = readVotes();
    var nowVoted = !votes[id];
    if (nowVoted) votes[id] = 1;
    else delete votes[id];
    writeVotes(votes);
    btn.setAttribute("data-voted", nowVoted ? "true" : "false");
    btn.setAttribute("aria-pressed", nowVoted ? "true" : "false");
    var label = btn.querySelector("span");
    if (label) {
      var m = label.textContent.match(/(\d+)/);
      var n = m ? Number(m[1]) : 0;
      label.textContent = "有帮助 " + (nowVoted ? n + 1 : Math.max(0, n - 1));
    }
  });

  /* -------------------------------------------------------------- boot  */

  /* Problem statements and reference solutions are shipped as escaped
     markdown inside the HTML, so the same renderer handles them. */
  function renderMarkdownBlocks() {
    var nodes = document.querySelectorAll("[data-md]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-md-done") === "true") continue;
      var raw = el.textContent;
      if (!raw || !raw.trim()) continue;
      el.innerHTML = md(raw);
      el.setAttribute("data-md-done", "true");
    }
  }

  function boot() {
    initNav();
    initSearch();
    loadAnswers().then(function (payload) {
      payload.answers = mergeLocal(payload.answers || []);
      renderAll(payload);

      /* Answers published on the server arrive a moment later; re-render so
         the page is useful immediately without waiting on the network. */
      var backend = window.OEMBackend;
      if (!backend || !backend.supabaseReady) return;
      /* Ask for the public answers and — in parallel — for everything this
         device submitted, so the author sees their own private grade. */
      Promise.all([backend.fetchApproved(), backend.mySubmissions()]).then(function (res) {
        var cloud = res[0] || [];
        var mine = res[1] || [];
        if (!cloud.length && !mine.length) return;
        payload.mine = mine;

        /* The server copy is authoritative: a student's own draft is kept in
           this browser under the same id but without uploaded file URLs. */
        var byId = {};
        cloud.forEach(function (a) {
          byId[a.id] = a;
        });
        var mineById = {};
        mine.forEach(function (m) {
          mineById[m.id] = m;
        });
        var changed = false;
        payload.answers = payload.answers.map(function (a) {
          var merged = byId[a.id] ? byId[a.id] : a;
          if (mineById[a.id]) {
            merged = Object.assign({}, merged, {
              mine: true,
              grade: mineById[a.id].grade,
              gradedAt: mineById[a.id].gradedAt,
              feedback: merged.feedback || mineById[a.id].feedback,
              revision: mineById[a.id].revision,
              status: mineById[a.id].status,
            });
          }
          if (merged !== a) {
            changed = true;
            return merged;
          }
          return a;
        });
        var known = {};
        payload.answers.forEach(function (a) {
          known[a.id] = true;
        });
        /* own withdrawn answers must not be injected back into the public list */
        cloud
          .filter(function (a) {
            /* Replies only ever come back as published, so a withdrawn answer
               is already absent here — no need to exclude my own rows. */
            return !known[a.id];
          })
          .forEach(function (a) {
            payload.answers.push(a);
            changed = true;
          });
        if (!changed) return;
        cloud.concat(mine).forEach(function (a) {
          if (a.date && (!payload.updated || a.date > payload.updated)) {
            payload.updated = a.date;
          }
        });
        renderAll(payload);
      });
    });
  }

  function renderAll(payload) {
    renderExercise(payload);
    renderRecent(payload);
    renderWall(payload);
    typeset();
    document.dispatchEvent(new CustomEvent("answers:loaded", { detail: payload }));
  }

  /* Expose the small toolkit for the submit page. */
  window.OEM = {
    url: url,
    md: md,
    esc: esc,
    escAttr: escAttr,
    typeset: typeset,
    readLocal: readLocal,
    writeLocal: writeLocal,
    inlineData: inlineData,
    answerCard: answerCard,
    ICONS: ICONS,
  };

  /* Problem statements and reference solutions ship as escaped markdown in the
     page. They must be converted *now*, while this script runs during parsing,
     because MathJax is loaded with `defer` and would otherwise consume the raw
     `$...$` delimiters first. */
  renderMarkdownBlocks();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
