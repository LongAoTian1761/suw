#!/usr/bin/env node
/* ===========================================================================
   老师批改界面（只在本机跑）

   service_role key 只留在这个 Node 进程里，浏览器一行都看不到；
   页面通过 http://127.0.0.1 的本地接口读写数据。

   用法：
     1. 把密钥写进项目根目录的 .env.local（已在 .gitignore 里，不会提交）：
          SUPABASE_URL=https://xxxx.supabase.co
          SUPABASE_SERVICE_ROLE_KEY=eyJ...
     2. node scripts/grade-ui.mjs
     3. 浏览器打开 http://127.0.0.1:4190

   也可以直接用环境变量传进来。
   =========================================================================== */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4190);
const TABLE = "submissions";

/* ------------------------------------------------------------ 读取配置 */

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i === -1) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(root, ".env.local"));
const course = JSON.parse(fs.readFileSync(path.join(root, "data/course.json"), "utf8"));
const sbCfg = (course.site.submission && course.site.submission.supabase) || {};

const URL_BASE = (process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || sbCfg.url || "").replace(/\/+$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "";

if (!URL_BASE || !SERVICE) {
  console.error(
    "\n缺少配置。请在项目根目录建一个 .env.local 文件，写入两行：\n\n" +
      "  SUPABASE_URL=" + (URL_BASE || "https://xxxx.supabase.co") + "\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=<Supabase → Project Settings → API Keys → Secret key>\n\n" +
      "注意：Secret key 只能放在本机，千万不要提交到 GitHub，也不要写进网页。\n",
  );
  process.exit(2);
}

const AUTH = { apikey: SERVICE, authorization: "Bearer " + SERVICE };

/* --------------------------------------------------------------- 静态文件 */

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "tools/grade.html" : pathname.replace(/^\/+/, "");
  const target = path.join(root, path.normalize(rel));
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(fs.readFileSync(target));
}

/* ------------------------------------------------------------------- API */

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const COLS =
  "id,created_at,updated_at,exercise,author,author_note,title,body,tags," +
  "attachments,status,grade,feedback,graded_at,revision";

async function apiList(url, res) {
  const status = url.searchParams.get("status") || "";
  const q =
    `/rest/v1/${TABLE}?select=${COLS}&order=created_at.desc&limit=500` +
    (status && status !== "all" ? `&status=eq.${encodeURIComponent(status)}` : "");
  const r = await fetch(URL_BASE + q, { headers: { ...AUTH, accept: "application/json" } });
  const text = await r.text();
  if (!r.ok) return json(res, r.status, { error: text.slice(0, 400) });
  json(res, 200, JSON.parse(text));
}

async function apiSave(body, res) {
  const data = JSON.parse(body || "{}");
  if (!data.id) return json(res, 400, { error: "缺少 id" });

  const patch = {};
  if (typeof data.grade === "string") patch.grade = data.grade.slice(0, 20);
  if (typeof data.feedback === "string") patch.feedback = data.feedback.slice(0, 4000);
  if (typeof data.status === "string") patch.status = data.status;

  const grading = "grade" in patch || "feedback" in patch;
  if (grading) {
    patch.graded_at =
      (patch.grade || "").length || (patch.feedback || "").length
        ? new Date().toISOString()
        : null;
  }
  if (!Object.keys(patch).length) return json(res, 400, { error: "没有要保存的内容" });

  const r = await fetch(URL_BASE + `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  const text = await r.text();
  if (!r.ok) return json(res, r.status, { error: text.slice(0, 400) });
  json(res, 200, { ok: true, id: data.id, patch });
}

/* --------------------------------------------------------------- 服务器 */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  try {
    if (url.pathname === "/api/list") return await apiList(url, res);
    if (url.pathname === "/api/save" && req.method === "POST") {
      return await apiSave(await readBody(req), res);
    }
    if (url.pathname === "/api/config") {
      return json(res, 200, {
        url: URL_BASE,
        autoApprove: !!(sbCfg.autoApprove),
        course: course.site.titleZh || course.site.title,
      });
    }
    return serveStatic(decodeURIComponent(url.pathname), res);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  批改界面  http://127.0.0.1:" + PORT);
  console.log("  数据来源  " + URL_BASE);
  console.log("  密钥      只在本进程内存里，不会进浏览器");
  console.log("");
  console.log("  Ctrl+C 退出。改完作业记得回来看看有没有「待审核」。");
  console.log("");
});
