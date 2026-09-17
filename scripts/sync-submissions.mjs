#!/usr/bin/env node
/* Turns GitHub issues created from the "提交答案" issue form into entries in
   data/answers.json.

   Usage:
     GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/sync-submissions.mjs
     node scripts/sync-submissions.mjs --repo owner/repo --dry-run

   Behaviour:
     - every issue labelled `answer` is parsed
     - labels choose the display status:
         accepted / 已接受  → verified   (精选解答)
         alternative / 另解 → alternative
         otherwise, if the issue is closed → peer
         otherwise → pending (待审核，默认不公开)
     - existing entries whose id is not produced by GitHub are preserved,
       so hand-curated answers in data/answers.json survive a sync. */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const answersPath = path.join(root, "data/answers.json");
const coursePath = path.join(root, "data/course.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const dryRun = flag("--dry-run");

if (!dryRun && !token) {
  console.error(
    "缺少 GITHUB_TOKEN。在 GitHub Actions 中会自动注入；本地运行请设置后重试。\n" +
      "想在没有任何 token 的情况下查看解析结果，可以加 --dry-run 并配合 --fixture <file>。",
  );
  process.exit(1);
}

/* ------------------------------------------------------------- course  */

const courseTitle = {};
try {
  const course = JSON.parse(fs.readFileSync(coursePath, "utf8"));
  for (const c of course.chapters) {
    for (const e of c.exercises) courseTitle[e.id] = e.title;
  }
} catch {
  /* course.json is optional for the sync itself */
}

/* --------------------------------------------------------------- repo  */

function detectRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const explicit = value("--repo", "");
  if (explicit) return explicit;
  try {
    const remote = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = remote.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  try {
    const configured = JSON.parse(fs.readFileSync(coursePath, "utf8")).site.repo || "";
    return configured.indexOf("your-") === 0 ? "" : configured;
  } catch {
    return "";
  }
}

const repo = detectRepo();
if (!dryRun && (!repo || repo.indexOf("/") === -1)) {
  console.error("无法确定仓库。请设置 GITHUB_REPOSITORY=owner/repo 或传 --repo owner/repo。");
  process.exit(1);
}

/* ------------------------------------------------------------- fetch  */

async function gh(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "oem-solutions-sync",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${pathname} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchIssues() {
  const fixture = value("--fixture", "");
  if (fixture) {
    return JSON.parse(fs.readFileSync(fixture, "utf8"));
  }
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(
      `/repos/${repo}/issues?state=all&labels=answer&per_page=100&page=${page}`,
    );
    out.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return out;
}

/* ------------------------------------------------------------- parse  */

const LABEL_KEYS = [
  ["exercise", ["习题编号", "exercise"]],
  ["name", ["姓名或昵称", "姓名", "name"]],
  ["affiliation", ["班级或学号", "班级", "affiliation"]],
  ["title", ["解答标题", "title"]],
  ["answer", ["我的解答", "解答", "answer"]],
  ["tags", ["标签", "tags"]],
];

function parseIssueBody(body) {
  const sections = {};
  const parts = String(body || "").split(/^###\s+/m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const content = (nl === -1 ? "" : part.slice(nl + 1)).trim();
    for (const [key, aliases] of LABEL_KEYS) {
      if (aliases.some((a) => heading.toLowerCase().startsWith(a.toLowerCase()))) {
        sections[key] = content === "_No response_" ? "" : content;
        break;
      }
    }
  }
  return sections;
}

function extractAttachments(text) {
  const files = [];
  const seen = new Set();
  const re = /!?\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const url = m[2];
    const isUpload =
      /github\.com\/user-attachments\//.test(url) ||
      /\.(pdf|png|jpe?g|gif|webp|svg|zip|m|py|mod|ipynb|csv|txt|md|docx?)(\?|$)/i.test(url);
    if (!isUpload || seen.has(url)) continue;
    seen.add(url);
    let name = m[1].trim();
    if (!name) {
      const tail = url.split("/").pop().split("?")[0];
      name = decodeURIComponent(tail || "attachment");
    }
    files.push({ name, url });
  }
  return files;
}

const LABELS = (issue) =>
  (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name || "").toLowerCase());

function statusFor(issue) {
  const labels = LABELS(issue);
  if (labels.some((l) => ["accepted", "verified", "已接受", "精选", "merged"].includes(l))) {
    return "verified";
  }
  if (labels.some((l) => ["alternative", "另解"].includes(l))) return "alternative";
  if (labels.some((l) => ["rejected", "不采用"].includes(l))) return "rejected";
  if (issue.state === "closed") return "peer";
  return "pending";
}

function toAnswer(issue) {
  const s = parseIssueBody(issue.body);
  const exercise = String(s.exercise || "").replace(/[^0-9.]/g, "").trim();
  const body = (s.answer || "").replace(/\n*---\n*$/g, "").trim();
  if (!exercise || !body) return null;

  const title = courseTitle[exercise];
  return {
    id: `${exercise}-gh${issue.number}`,
    exercise,
    exerciseLabel: `习题 ${exercise}${title ? " · " + title : ""}`,
    author: (s.name || "匿名").trim(),
    authorNote: (s.affiliation || "").trim(),
    title: (s.title || "").trim(),
    date: String(issue.created_at || "").slice(0, 10),
    status: statusFor(issue),
    helpful: Math.max(0, (issue.reactions && issue.reactions["+1"]) || 0),
    source: `issue#${issue.number}`,
    url: issue.html_url,
    tags: (s.tags || "")
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter(Boolean),
    body,
    attachments: extractAttachments(body),
  };
}

/* -------------------------------------------------------------- main  */

const issues = await fetchIssues();
const synced = issues.map(toAnswer).filter(Boolean);
const syncedIds = new Set(synced.map((a) => a.id));

const existing = JSON.parse(fs.readFileSync(answersPath, "utf8"));
const curated = (existing.answers || []).filter((a) => !syncedIds.has(a.id));

const merged = [...synced, ...curated];
const visible = merged.filter((a) => a.status !== "rejected");

const next = {
  updated: new Date().toISOString().slice(0, 10),
  answers: merged.sort((a, b) => String(b.date).localeCompare(String(a.date))),
};

const counts = visible.reduce((acc, a) => {
  acc[a.status] = (acc[a.status] || 0) + 1;
  return acc;
}, {});

console.log(`repo        ${repo || "(dry run)"}`);
console.log(`issues      ${issues.length} labelled "answer"`);
console.log(`parsed      ${synced.length} answers, ${visible.length} visible`);
console.log(
  `status      ${Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join("  ")}`,
);

if (flag("--json")) {
  console.log(JSON.stringify(next, null, 2));
}

if (dryRun) {
  console.log("dry run — data/answers.json unchanged");
} else {
  fs.writeFileSync(answersPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote       ${path.relative(process.cwd(), answersPath)}`);
}
