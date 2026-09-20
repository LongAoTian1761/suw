#!/usr/bin/env node
/* Static site generator for the solutions site.
   Reads  data/course.json + data/answers.json
   Writes index.html, answers.html, submit.html, chapters/**. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const course = JSON.parse(fs.readFileSync(path.join(root, "data/course.json"), "utf8"));
const answersFile = JSON.parse(
  fs.readFileSync(path.join(root, "data/answers.json"), "utf8"),
);
const ANSWERS = (answersFile.answers || []).filter((a) => a.status !== "rejected");
const site = course.site;

/* Allow the receiving server to be supplied at build time instead of being
   committed, which is handy for CI and for pointing the site at the local
   mock backend during testing. */
if (site.submission && site.submission.supabase) {
  if (process.env.SUPABASE_URL) {
    site.submission.supabase.url = process.env.SUPABASE_URL;
  }
  if (process.env.SUPABASE_ANON_KEY) {
    site.submission.supabase.anonKey = process.env.SUPABASE_ANON_KEY;
  }
}

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escAttr = (s) => esc(s).replace(/'/g, "&#39;");

const jsonScript = (id, value) =>
  `<script type="application/json" id="${id}">${JSON.stringify(value).replace(
    /<\//g,
    "<\\/",
  )}</script>`;

/* --------------------------------------------------------------- search */

const searchIndex = [];

/* ------------------------------------------------------------- partials */

function head({ title, description, rootPrefix, pageTitle }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle || title)}</title>
<meta name="description" content="${escAttr(description || site.description)}">
<link rel="stylesheet" href="${rootPrefix}/assets/css/site.css">
<script>
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']] },
  options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'x-usd'] },
  svg: { fontCache: 'global' }
};
</script>
</head>`;
}

function header(rootPrefix, active) {
  const link = (href, label, key, cls) =>
    `<a class="nav__link${cls ? " " + cls : ""}" href="${rootPrefix}${href}"${
      active === key ? ' aria-current="page"' : ""
    }>${esc(label)}</a>`;
  const discussions =
    site.repo && site.repo.indexOf("your-") !== 0
      ? `https://github.com/${site.repo}/issues`
      : "#";
  return `<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="${rootPrefix}/index.html">
      <span class="brand__mark">OEM</span>
      <span class="brand__text">${esc(site.titleZh || site.title)}</span>
    </a>
    <button type="button" class="nav-toggle" id="nav-toggle" aria-expanded="false" aria-controls="site-nav">目录</button>
    <nav class="nav" id="site-nav" data-open="false" aria-label="主导航">
      <div class="nav__search">
        <input type="search" id="site-search" placeholder="搜索习题 / 解答  ( / )" autocomplete="off" aria-label="搜索习题或解答">
        <div class="search-results" id="site-search-results" data-open="false" role="listbox"></div>
      </div>
      ${link("/index.html", "首页", "home")}
      ${link("/answers.html", "全部答案", "answers")}
      ${link("/submit.html", "上传答案", "submit", "nav__cta")}
      <a class="nav__link" href="${discussions}" target="_blank" rel="noopener">讨论区</a>
    </nav>
  </div>
</header>`;
}

function footer(rootPrefix) {
  const repoUrl = site.repo && site.repo.indexOf("your-") !== 0 ? `https://github.com/${site.repo}` : "";
  return `<footer class="site-footer">
  <div class="site-footer__inner">
    <p class="site-footer__note">本网站的解答由课程师生共同贡献，仅供学习交流使用。题目版权归原书作者与出版社所有。</p>
    <nav>
      ${repoUrl ? `<a href="${repoUrl}" target="_blank" rel="noopener">GitHub 仓库</a> · ` : ""}<a href="${rootPrefix}/submit.html">上传答案</a> · <a href="${rootPrefix}/answers.html">全部答案</a>
    </nav>
  </div>
</footer>`;
}

function page({ rootPrefix, active, pageTitle, title, description, body, inlineAnswers }) {
  const inline =
    inlineAnswers === undefined
      ? ""
      : jsonScript("answers-data", { updated: answersFile.updated, answers: inlineAnswers });
  return `${head({ title: site.title, description, rootPrefix, pageTitle })}
<body>
${header(rootPrefix, active)}
<main>
${body}
</main>
${footer(rootPrefix)}
<script>window.SITE_ROOT = ${JSON.stringify(rootPrefix)};</script>
<script>
window.SITE_CONFIG = ${JSON.stringify({
    repo: site.repo,
    submission: site.submission,
  })};
window.SEARCH_INDEX = /*SEARCH_INDEX_TOKEN*/[];
</script>
${inline}
<script src="${rootPrefix}/assets/js/backend.js"></script>
<script src="${rootPrefix}/assets/js/site.js"></script>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- pages  */

const answersByExercise = {};
ANSWERS.forEach((a) => {
  const k = String(a.exercise);
  (answersByExercise[k] = answersByExercise[k] || []).push(a);
});

fs.mkdirSync(path.join(root, "chapters"), { recursive: true });

/* --- home ------------------------------------------------------------- */

searchIndex.push({
  t: "首页 · " + site.titleZh,
  u: "/index.html",
  k: "home 首页 索引 章节 solutions",
  c: site.title,
});
searchIndex.push({
  t: "全部答案",
  u: "/answers.html",
  k: "answers 答案墙 全部答案 搜索",
  c: "浏览所有已收录的同学解答",
});
searchIndex.push({
  t: "上传我的答案",
  u: "/submit.html",
  k: "submit 上传 提交 表单 upload",
  c: "把你自己写的解答提交到网站",
});

const totalExercises = course.chapters.reduce((s, c) => s + c.exercises.length, 0);

const sb = (site.submission && site.submission.supabase) || {};
const uploadReady =
  site.submission &&
  site.submission.backend === "supabase" &&
  /^https?:\/\//.test(sb.url || "") &&
  String(sb.anonKey || "").length > 20;
const autoApprove = !!sb.autoApprove;

const newThisMonth = ANSWERS.filter((a) =>
  String(a.date || "").startsWith(new Date().toISOString().slice(0, 7)),
).length;

const chapterRows = course.chapters
  .map((c, i) => {
    const solved = c.exercises.filter((e) => (answersByExercise[e.id] || []).length > 0).length;
    const prev = course.chapters[i - 1];
    const partHeading =
      c.part && (!prev || prev.part !== c.part)
        ? `      <li class="part-row">
        <span class="part-row__numeral">Part ${esc(c.part)}</span>
        <span class="part-row__title">${esc(c.partTitle)}</span>
        ${c.partTitleZh ? `<span class="part-row__zh">${esc(c.partTitleZh)}</span>` : ""}
      </li>
`
        : "";
    return `${partHeading}      <li>
        <a class="chapter-row" href="chapters/${c.id}/index.html">
          <span class="chapter-row__num">第 ${c.number} 章</span>
          <span class="chapter-row__body">
            <span class="chapter-row__title">${esc(c.title)}</span>
            <span class="chapter-row__zh">${esc(c.titleZh)}</span>
            <span class="chapter-row__summary">${esc(c.summary)}</span>
          </span>
          <span class="chapter-row__meta">${c.exercises.length} 题 · <b>${solved}</b> 题有解答</span>
        </a>
      </li>`;
  })
  .join("\n");

const homeBody = `  <div class="wrap">
    <section class="hero">
      <h1 class="hero__title">${esc(site.titleZh)}</h1>
      <p class="hero__lede">${esc(site.description)}</p>
      <p class="hero__lede" style="font-size:0.94rem;color:var(--muted);font-style:italic">${esc(
        site.subtitle,
      )}</p>
      <div class="hero__actions">
        <a class="btn btn--primary" href="#chapters">浏览章节</a>
        <a class="btn btn--outline" href="submit.html">上传我的答案</a>
      </div>
      <div class="hero__side">
        <h2>这个网站怎么用</h2>
        <ol>
          <li>在下面找到你正在做的章节和习题，先看题面与参考思路。</li>
          <li>把自己的完整推导写成 Markdown，公式用 <code>$...$</code> 包起来。</li>
          <li>在习题页点「上传我的答案」，提交后由教师确认，随后展示给全班。</li>
        </ol>
      </div>
    </section>
  </div>

  <div class="wrap">
    <section class="section" id="chapters">
      <div class="section__head">
        <h2>📚 按章节浏览</h2>
        <p>共 ${course.chapters.length} 章、${totalExercises} 道习题</p>
        <span class="section__count">本学期新增 ${newThisMonth} 条同学答案</span>
      </div>
      <ul class="chapter-list">
${chapterRows}
      </ul>
    </section>
  </div>

  <section class="section section--band">
    <div class="wrap">
      <div class="section__head">
        <h2>🆕 最新同学答案</h2>
        <p>按提交时间排列</p>
        <span class="section__count"><a href="answers.html">查看全部 →</a></span>
      </div>
      <div data-recent-answers data-limit="3"></div>
    </div>
  </section>

  <div class="wrap">
    <section class="section">
      <div class="section__head">
        <h2>✍️ 关于提交</h2>
      </div>
      <div class="prose">
        <p>每一道习题下面都有一段属于你自己的空间。${
          uploadReady
            ? "打开上传页面填好就可以直接提交，不需要注册账号，也不需要登录。" +
              (autoApprove
                ? "提交后你的答案会立刻出现在对应习题下面。"
                : "老师确认后才会公开展示。")
            : "填好之后可以生成 Markdown，发给老师或存进课程共享文件夹。"
        }你也可以选择只提交给老师、不公开署名。</p>
        <ul>
          <li><strong>公式排版</strong>：行内公式写 <code>$c_t = y_t - r d_{t-1}$</code>，独立成行的公式用 <code>$$ ... $$</code>。</li>
          <li><strong>附件</strong>：手写推导的照片、MATLAB / Python / Dynare 代码、PDF 都可以一起上传（单个 ${
            sb.maxFileMb || 20
          } MB 以内）。</li>
          <li><strong>署名</strong>：可以填真名、昵称或"匿名"；填了班级或学号只对教师可见。</li>
          <li><strong>更正</strong>：发现别人的解答有误，欢迎在习题页下方留言指出，或提交你自己的版本。</li>
        </ul>
        <div class="callout callout--action">
          <p>准备好你的解答了吗？上传后它会出现在对应习题的"同学答案"里。</p>
          <a class="btn btn--primary" href="submit.html">上传我的答案</a>
        </div>
      </div>
    </section>
  </div>`;

fs.writeFileSync(
  path.join(root, "index.html"),
  page({
    rootPrefix: ".",
    active: "home",
    pageTitle: `${site.title} · ${site.titleZh}`,
    description: site.description,
    body: homeBody,
    inlineAnswers: ANSWERS.slice(0, 200),
  }),
);

/* --- chapters --------------------------------------------------------- */

for (const c of course.chapters) {
  const prefix = "../..";
  const solved = c.exercises.filter((e) => (answersByExercise[e.id] || []).length > 0).length;
  const total = c.exercises.reduce(
    (s, e) => s + (answersByExercise[e.id] || []).length,
    0,
  );

  const rows = c.exercises
    .map((e) => {
      const n = (answersByExercise[e.id] || []).length;
      const badge = n
        ? `<span class="tag tag--count">${n} 个答案</span>`
        : `<span class="tag">待提交</span>`;
      return `      <li>
        <a class="exercise-row" href="${e.slug}.html">
          <span class="exercise-row__num">${esc(e.id)}</span>
          <span class="exercise-row__title">${esc(e.title)}${
            e.tags && e.tags.length
              ? "<em>" +
                e.tags
                  .map((t) => esc(t))
                  .join(" · ") +
                "</em>"
              : ""
          }</span>
          ${badge}
        </a>
      </li>`;
    })
    .join("\n");

  const body = `  <div class="page-head">
    <div class="page-head__inner">
      <p class="breadcrumb"><a href="${prefix}/index.html">首页</a><span aria-hidden="true">/</span>第 ${c.number} 章</p>
      <h1>第 ${c.number} 章 · ${esc(c.title)}</h1>
      <p class="page-head__meta">${esc(c.titleZh)}　${esc(c.summary)}</p>
    </div>
  </div>
  <div class="wrap">
    <section class="section">
      <div class="section__head">
        <h2>习题列表</h2>
        <p>${c.exercises.length} 道习题</p>
        <span class="section__count">${solved} 题有解答 · 共 ${total} 条答案</span>
      </div>
      <ul class="exercise-list">
${rows}
      </ul>
      <div class="callout callout--action" style="margin-top:28px">
        <p>没找到你想做的题？直接按"习题编号"上传，教师会把它归到正确的章节。</p>
        <a class="btn btn--primary" href="${prefix}/submit.html">上传我的答案</a>
      </div>
    </section>
  </div>`;

  fs.mkdirSync(path.join(root, "chapters", c.id), { recursive: true });
  fs.writeFileSync(
    path.join(root, "chapters", c.id, "index.html"),
    page({
      rootPrefix: prefix,
      active: "",
      pageTitle: `第 ${c.number} 章 ${c.title} · ${site.titleZh}`,
      description: `${c.title} — ${c.summary}`,
      body,
      inlineAnswers: ANSWERS.filter(
        (a) => String(a.exercise || "").split(".")[0] === String(c.number),
      ),
    }),
  );

  searchIndex.push({
    t: `第 ${c.number} 章 · ${c.title}`,
    u: `/chapters/${c.id}/index.html`,
    k: `chapter ${c.number} ${c.id} ${c.title} ${c.titleZh}`,
    c: `${c.exercises.length} 道习题 · ${solved} 题有解答`,
  });
}

/* --- exercise pages --------------------------------------------------- */

function chapterOf(num) {
  return course.chapters.find((c) => String(c.number) === String(num));
}

for (const c of course.chapters) {
  c.exercises.forEach((e, idx) => {
    const prefix = "../..";
    const prev = c.exercises[idx - 1];
    const next = c.exercises[idx + 1];
    const list = answersByExercise[e.id] || [];
    const chapter = chapterOf(String(e.id).split(".")[0]) || c;

    const showProblem = site.showProblemText !== false && !!e.problem;
    const problemNote =
      e.problemSource === "pdf"
        ? `<p class="field__hint" style="margin-top:14px">题面由教材 PDF 自动提取，分式、上下标等复杂公式可能有偏差，请以教材原文为准。发现错误欢迎在「上传我的答案」里一并说明。</p>`
        : "";
    const problemBlock = showProblem
      ? `<section class="block">
        <div class="block__head"><h2>题目</h2><span class="tag tag--muted">Problem</span></div>
        <div class="problem prose" data-md>${esc(e.problem)}</div>
        ${problemNote}
      </section>`
      : "";

    const refBlock = e.reference
      ? `<section class="block">
        <div class="block__head"><h2>参考思路</h2><span class="tag tag--official">教师维护</span></div>
        <div class="answer-ref prose">
          <span class="answer-ref__label">${esc(e.reference.note || "参考思路")}</span>
          <div data-md>${esc(e.reference.body)}</div>
        </div>
      </section>`
      : "";

    const missingProblem = showProblem
      ? ""
      : `<div class="callout callout--note">
        <h3>${e.problem ? "题面未在网页上展示" : "题目原文待补充"}</h3>
        <p>${
          e.problem
            ? "本站已关闭题面展示（<code>site.showProblemText: false</code>），请对照教材完成本题。下面仍然可以提交你的解答。"
            : "教师可在 <code>data/course.json</code> 的 <code>chapters[…].exercises[…].problem</code> 字段填入本题原文（支持 Markdown 与 LaTeX）。下面仍然可以提交你的解答。"
        }</p>
      </div>`;

    const pager = `
      <nav class="section" style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:22px;margin-top:44px">
        <span class="btn--quiet btn" style="padding-left:0">${
          prev
            ? `<a class="btn btn--quiet" href="${prev.slug}.html">← 习题 ${esc(prev.id)}</a>`
            : ""
        }</span>
        <span style="margin-left:auto">${
          next
            ? `<a class="btn btn--quiet" href="${next.slug}.html">习题 ${esc(next.id)} →</a>`
            : ""
        }</span>
      </nav>`;

    const body = `  <div class="page-head">
    <div class="page-head__inner">
      <p class="breadcrumb"><a href="${prefix}/index.html">首页</a><span aria-hidden="true">/</span><a href="index.html">第 ${c.number} 章</a><span aria-hidden="true">/</span>习题 ${esc(e.id)}</p>
      <h1>习题 ${esc(e.id)}</h1>
      <p class="page-head__meta">${esc(e.title)}　·　第 ${c.number} 章 ${esc(c.titleZh)}</p>
    </div>
  </div>
  <div class="wrap">
    <div class="prose" style="margin-top:26px">
      <a class="backlink" href="index.html">${"←"} 返回第 ${c.number} 章目录</a>
      ${missingProblem}
      ${problemBlock}
      ${refBlock}

      <section class="block block--submit">
        <div class="block__head">
          <h2>同学答案</h2>
          <span class="tag tag--muted" data-answer-count></span>
        </div>
        <div data-answers-for="${escAttr(e.id)}"></div>
        <div class="callout callout--action" style="margin-top:22px">
          <p>你的解法可能比参考思路更巧妙。写下来，让同学也看到。</p>
          <a class="btn btn--primary" href="${prefix}/submit.html?exercise=${encodeURIComponent(
            e.id,
          )}">上传我的答案</a>
        </div>
      </section>

      ${pager}
    </div>
  </div>`;

    fs.writeFileSync(
      path.join(root, "chapters", c.id, `${e.slug}.html`),
      page({
        rootPrefix: prefix,
        active: "",
        pageTitle: `习题 ${e.id} ${e.title} · ${site.titleZh}`,
        description: `Exercises ${e.id} ${e.title} — ${c.title}`,
        body,
        inlineAnswers: list,
      }),
    );

    searchIndex.push({
      t: `习题 ${e.id} · ${e.title}`,
      u: `/chapters/${c.id}/${e.slug}.html`,
      k: `${e.id} ${e.slug} ${e.title} chapter${c.number} ${c.id} ${(e.tags || []).join(" ")}`,
      c: `第 ${c.number} 章 ${chapter.titleZh} · ${
        list.length ? list.length + " 个同学答案" : "暂无同学答案"
      }`,
    });
  });
}

/* --- answers wall ----------------------------------------------------- */

const chapterOptions = course.chapters
  .map((c) => `<option value="${c.number}">第 ${c.number} 章</option>`)
  .join("");

const wallBody = `  <div class="page-head">
    <div class="page-head__inner">
      <p class="breadcrumb"><a href="index.html">首页</a><span aria-hidden="true">/</span>全部答案</p>
      <h1>全部同学答案</h1>
      <p class="page-head__meta">${
        ANSWERS.length
          ? "共 " +
            ANSWERS.length +
            " 条已收录的解答，按提交时间从新到旧排列。" +
            (answersFile.updated ? "数据最后更新：" + esc(answersFile.updated) + "。" : "")
          : "还没有同学在这里提交答案。同学从「上传答案」提交之后，就会出现在这里，并且可以按习题或关键词筛选。"
      }</p>
    </div>
  </div>
  <div class="wrap">
    <section class="section">
      <div class="filters">
        <input type="search" id="wall-search" placeholder="搜索关键词，例如：永久收入、欧拉方程、托宾 q" aria-label="搜索答案">
        <select id="wall-chapter" aria-label="按章节筛选"><option value="">全部章节</option>${chapterOptions}</select>
        <select id="wall-status" aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option value="verified">精选解答</option>
          <option value="peer">同学解答</option>
          <option value="alternative">另一种思路</option>
          <option value="pending">待审核</option>
        </select>
        <span class="filter-count" id="wall-count"></span>
      </div>
      <div data-answer-wall></div>
    </section>
  </div>`;

fs.writeFileSync(
  path.join(root, "answers.html"),
  page({
    rootPrefix: ".",
    active: "answers",
    pageTitle: `全部答案 · ${site.titleZh}`,
    description: "浏览所有已收录的同学解答，支持按章节与关键词筛选。",
    body: wallBody,
    inlineAnswers: ANSWERS.slice(0, 400),
  }),
);

/* --- submit ----------------------------------------------------------- */

const repoReady = site.repo && site.repo.indexOf("your-") !== 0;

const configNotice = uploadReady
  ? `<div class="callout callout--note">
        <h3>不需要注册，也不需要登录</h3>
        <p>填完下面的表单直接提交就可以。答案和附件会保存在课程服务器上，${
          autoApprove ? "提交后立刻展示" : "老师确认后展示"
        }。你的姓名可以填昵称或「匿名」。</p>
      </div>`
  : `<div class="callout callout--note" style="border-left-color:#8a5310;background:#fbf1e2;border-color:#e8d4b4">
        <h3>接收服务器尚未配置</h3>
        <p>同学现在可以正常填写表单，但提交时会退回到「生成 Markdown 交给老师」的方式，附件不能直接上传。老师按 README 的「三步接入接收服务器」填好 Supabase 的两个值并重新构建，即可开启直接上传。</p>
      </div>`;

const submitBody = `  <div class="page-head">
    <div class="page-head__inner">
      <p class="breadcrumb"><a href="index.html">首页</a><span aria-hidden="true">/</span>上传答案</p>
      <h1>上传我的答案</h1>
      <p class="page-head__meta">写下你的推导，公式、图片、代码都可以一起提交。${
        uploadReady
          ? "无需注册账号，填完直接提交。"
          : "填完后可生成 Markdown 交给老师。"
      }</p>
    </div>
  </div>
  <div class="wrap">
    <section class="section">
      ${configNotice}
      <div class="section__head">
        <h2>提交步骤</h2>
      </div>
      <div class="prose">
        <ol class="steps">
          <li>
            <h3>填好下面的表单</h3>
            <p>选好习题编号，填写姓名与答案正文，公式用 LaTeX 写。下方会实时预览排版效果。</p>
          </li>
          <li>
            <h3>把附件拖进来（可选）</h3>
            <p>手写推导的照片、PDF、MATLAB / Python / Dynare 代码都可以一起传，${
              sb.maxFileMb || 20
            } MB 以内。</p>
          </li>
          <li>
            <h3>点「提交我的答案」</h3>
            <p>${
              uploadReady
                ? "提交即上传，整个过程不需要注册、不需要登录、不需要任何账号。"
                : "如果还没有配置接收服务器，可以生成 Markdown 或下载 <code>.md</code> 文件交给老师。"
            }</p>
          </li>
          <li>
            <h3>${autoApprove ? "立刻展示" : "等待确认"}</h3>
            <p>${
              autoApprove
                ? "提交成功后，你的解答会出现在对应习题的「同学答案」里，全班都能看到。"
                : "老师确认后，你的解答会出现在对应习题的「同学答案」中。"
            }${
              uploadReady
                ? "写错了不用慌 —— 页面下方「我的提交」里可以随时修改或撤回。"
                : ""
            }</p>
          </li>
        </ol>
      </div>

      <div class="section__head" style="margin-top:44px">
        <h2>答案内容</h2>
        <span class="section__count"><span class="req">*</span> 为必填</span>
      </div>

      <div class="callout callout--official" id="f-success" hidden style="border-left:3px solid var(--official);background:#fbfefd;border-color:#cfe0dc">
        <h3>提交成功</h3>
        <div id="f-success-body"></div>
      </div>

      <div class="callout" id="f-editing" hidden style="border-left:3px solid var(--peer);background:#fdf9f2;border-color:#e8d4b4">
        <h3>正在修改已有提交</h3>
        <p id="f-editing-info"></p>
        <button type="button" class="btn btn--outline btn--sm" id="f-cancel-edit">取消修改，改为提交新答案</button>
      </div>

      <form id="submit-form" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="f-exercise">习题编号 <span class="req">*</span></label>
            <select id="f-exercise" name="exercise" required></select>
            <span class="field__hint">包含全部 12 章共 ${totalExercises} 道习题。</span>
            <span class="field__error">请选择你解答的习题。</span>
          </div>

          <div class="field">
            <label for="f-name">姓名或昵称 <span class="req">*</span></label>
            <input type="text" id="f-name" name="name" placeholder="例如：张一鸣 / 匿名" maxlength="40" required>
            <span class="field__hint">想匿名展示就填「匿名」，真实姓名只对教师可见。</span>
            <span class="field__error">请填写姓名或昵称。</span>
          </div>

          <div class="field">
            <label for="f-note">班级 / 学号（可选）</label>
            <input type="text" id="f-note" name="affiliation" placeholder="例如：2024 级经济学基地班 2024010234" maxlength="60">
            <span class="field__hint">仅用于教师核对，不会公开展示。</span>
          </div>

          <div class="field">
            <label for="f-tags">标签（可选）</label>
            <input type="text" id="f-tags" name="tags" placeholder="例如：欧拉方程, 永久收入, 数值求解" maxlength="80">
            <span class="field__hint">用逗号分隔，方便别人检索。</span>
          </div>

          <div class="field field--wide">
            <label for="f-title">解答标题（可选）</label>
            <input type="text" id="f-title" name="title" placeholder="例如：用跨期预算约束直接求解，比迭代更快" maxlength="90">
          </div>

          <div class="field field--wide">
            <label for="f-body">答案正文 <span class="req">*</span></label>
            <span class="field__hint">支持 Markdown 与 LaTeX。行内公式 <code>$c_t = y_t - r d_{t-1}$</code>，独立公式用 <code>$$ … $$</code>；<code>- </code> 开头是列表，<code>**加粗**</code> 可以强调关键结论。</span>
            <textarea id="f-body" name="answer" required placeholder="第一步，写出家庭的跨期预算约束：&#10;&#10;$$ \\sum_{j=0}^{\\infty} \\frac{c_{t+j}}{(1+r)^j} = (1+r)a_{t-1} + \\sum_{j=0}^{\\infty} \\frac{y_{t+j}}{(1+r)^j} $$&#10;&#10;因为禀赋服从 AR(1) 过程，所以……"></textarea>
            <span class="field__error">答案正文至少需要 10 个字符。</span>
          </div>

          <div class="field field--wide">
            <label>实时预览</label>
            <div class="preview-pane" id="f-preview" data-empty="true"></div>
          </div>

          <div class="field field--wide">
            <label for="f-files">附件（可选）</label>
            <span class="field__hint" id="f-kept"></span>
            <div class="dropzone" id="f-dropzone" tabindex="0" role="button" aria-describedby="f-files-hint">
              <strong>把文件拖到这里，或点击选择</strong>
              <span id="f-files-hint">支持 PDF、图片（PNG / JPG）、MATLAB / Python / Dynare 代码，单个文件不超过 20 MB</span>
            </div>
            <input type="file" id="f-files" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.m,.py,.mod,.ipynb,.csv,.txt,.md,.docx,.zip" style="display:none">
            <ul class="file-list" id="f-file-list"></ul>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn--primary" id="f-submit">${
            uploadReady ? "提交我的答案" : "生成提交内容"
          }</button>
          <button type="button" class="btn btn--outline" id="f-copy">复制 Markdown</button>
          <button type="button" class="btn btn--outline" id="f-download">下载 .md</button>
          <button type="button" class="btn btn--outline" id="f-stash">暂存到本机</button>
          <span class="form-status" id="form-status" role="status" aria-live="polite"></span>
        </div>

        <div class="field field--wide" id="f-output-wrap" hidden style="margin-top:22px">
          <label for="f-output">提交内容（Markdown，可直接粘贴到 GitHub 或邮件里）</label>
          <textarea id="f-output" readonly spellcheck="false" style="min-height:260px"></textarea>
        </div>
      </form>

      <section class="block" id="mine" style="margin-top:52px">
        <div class="section__head">
          <h2>我的提交</h2>
          <p>${
            uploadReady
              ? "这台设备交过的作业，可以随时修改或撤回"
              : "只保存在这台设备的浏览器里"
          }</p>
          <span class="section__count"><button type="button" class="btn btn--quiet btn--sm" id="f-export">导出为 JSON</button></span>
        </div>
        ${
          uploadReady
            ? `<div class="recovery">
          <div class="recovery__row">
            <span class="recovery__label">本机恢复码</span>
            <code id="f-token"></code>
            <button type="button" class="btn btn--outline btn--sm" id="f-token-copy">复制</button>
          </div>
          <details class="recovery__details">
            <summary>换了一台设备？用恢复码找回我交过的作业</summary>
            <p class="field__hint">在原来那台设备上复制「本机恢复码」，粘到这里，就能继续修改。（换手机、清空浏览器记录、重装系统之后用得上。）</p>
            <div class="recovery__apply">
              <input type="text" id="f-token-input" placeholder="粘贴恢复码" autocomplete="off">
              <button type="button" class="btn btn--primary btn--sm" id="f-token-apply">找回</button>
            </div>
          </details>
        </div>`
            : ""
        }
        <div id="my-submissions"></div>
      </section>
    </div>
  </div>`;

fs.writeFileSync(
  path.join(root, "submit.html"),
  page({
    rootPrefix: ".",
    active: "submit",
    pageTitle: `上传我的答案 · ${site.titleZh}`,
    description: "填写并提交你为本课程习题撰写的解答。",
    body: submitBody,
    inlineAnswers: [],
  }),
);

/* --- submit.js needs the exercise catalog; patch it into submit.html --- */

const catalog = [];
for (const c of course.chapters) {
  for (const e of c.exercises) {
    catalog.push({
      id: e.id,
      title: e.title,
      chapterId: c.id,
      chapterLabel: `第 ${c.number} 章 · ${c.titleZh}`,
    });
  }
}

const submitPath = path.join(root, "submit.html");
let submitHtml = fs.readFileSync(submitPath, "utf8");
submitHtml = submitHtml.replace(
  '<script src="./assets/js/site.js"></script>',
  `<script>window.EXERCISE_CATALOG = ${JSON.stringify(catalog)};</script>\n<script src="./assets/js/site.js"></script>\n<script src="./assets/js/submit.js"></script>`,
);
fs.writeFileSync(submitPath, submitHtml);

/* --- inject the fully populated search index --------------------------- */

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
      return walk(p);
    }
    return entry.name.endsWith(".html") ? [p] : [];
  });
}

const TOKEN = "/*SEARCH_INDEX_TOKEN*/[]";
const serialized = JSON.stringify(searchIndex);
let patched = 0;

for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (html.indexOf(TOKEN) === -1) continue;
  fs.writeFileSync(file, html.split(TOKEN).join(serialized));
  patched++;
}

fs.writeFileSync(path.join(root, ".nojekyll"), "");

if (patched === 0) {
  throw new Error("search index token not found in any page — build is broken");
}

console.log(
  `built: 1 home + ${course.chapters.length} chapters + ${totalExercises} exercises + 2 utility pages`,
);
console.log(`answers: ${ANSWERS.length} · search entries: ${searchIndex.length}`);
