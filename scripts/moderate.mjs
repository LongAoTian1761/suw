#!/usr/bin/env node
/* 老师用的批处理工具（需要 service_role key，只能在自己电脑或 CI 上跑，
   千万不要把它写进网页）。

   用法：
     node scripts/moderate.mjs list
     node scripts/moderate.mjs list --status pending
     node scripts/moderate.mjs publish <id>              # 展示（verified）
     node scripts/moderate.mjs publish <id> --as peer    # 标成「同学解答」
     node scripts/moderate.mjs publish <id> --as alternative
     node scripts/moderate.mjs hide <id>                 # 从网站上撤下（rejected）
     node scripts/moderate.mjs rm <id>                   # 连同记录一起删除

   key 通过环境变量传入：
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/moderate.mjs list
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const course = JSON.parse(fs.readFileSync(path.join(root, "data/course.json"), "utf8"));
const sb = (course.site.submission && course.site.submission.supabase) || {};

const URL_BASE = (process.env.SUPABASE_URL || sb.url || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TABLE = sb.table || "submissions";

if (!URL_BASE || !KEY) {
  console.error(
    "需要 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY。\n" +
      "service_role key 在 Supabase 控制台 → Project Settings → API 里，\n" +
      "只能在本机或 CI 使用，绝不要放进网页或提交到仓库。",
  );
  process.exit(2);
}

const auth = {
  apikey: KEY,
  authorization: "Bearer " + KEY,
  "content-type": "application/json",
};

const argv = process.argv.slice(2);
const cmd = argv[0] || "list";
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const positional = argv.slice(1).filter((a) => !a.startsWith("--") && a !== flagValue("--as", ""));

async function req(method, pathname, body, prefer) {
  const res = await fetch(URL_BASE + pathname, {
    method,
    headers: prefer ? { ...auth, prefer } : auth,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function shortDate(s) {
  return String(s || "").slice(0, 16).replace("T", " ");
}

function printRows(rows) {
  if (!rows.length) {
    console.log("（没有记录）");
    return;
  }
  for (const r of rows) {
    console.log(
      `${r.status.padEnd(11)} ${shortDate(r.created_at)}  ${String(r.exercise).padEnd(6)} ` +
        `${String(r.author).slice(0, 10).padEnd(11)} ${r.id}`,
    );
    if (r.title) console.log(`            ${r.title}`);
  }
  console.log(`\n共 ${rows.length} 条`);
}

try {
  if (cmd === "list") {
    const status = flagValue("--status", "");
    const q = `/rest/v1/${TABLE}?select=id,created_at,exercise,author,title,status,attachments` +
      `&order=created_at.desc&limit=200` +
      (status ? `&status=eq.${encodeURIComponent(status)}` : "");
    printRows(await req("GET", q));
  } else if (cmd === "publish") {
    const id = positional[0];
    if (!id) throw new Error("用法：publish <id> [--as peer|alternative|verified]");
    const as = flagValue("--as", "verified");
    if (!["verified", "peer", "alternative"].includes(as)) {
      throw new Error("--as 只能是 verified / peer / alternative");
    }
    await req("PATCH", `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, { status: as }, "return=minimal");
    console.log(`已发布 ${id}（状态 ${as}）`);
  } else if (cmd === "hide") {
    const id = positional[0];
    if (!id) throw new Error("用法：hide <id>");
    await req("PATCH", `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`, { status: "rejected" }, "return=minimal");
    console.log(`已从网站撤下 ${id}（记录仍在库里）`);
  } else if (cmd === "rm") {
    const id = positional[0];
    if (!id) throw new Error("用法：rm <id>");
    await req("DELETE", `/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`);
    console.log(`已删除 ${id}`);
  } else {
    console.log("可用命令：list / publish <id> / hide <id> / rm <id>");
  }
} catch (err) {
  console.error("执行失败：" + err.message);
  process.exit(1);
}
