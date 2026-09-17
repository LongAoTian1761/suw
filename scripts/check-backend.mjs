#!/usr/bin/env node
/* 体检脚本：用**和浏览器完全相同的 anon key** 去戳一遍接收服务器，
   确认「同学免账号直接提交」这条路真的通，而且没有把数据库整张表暴露出去。

   用法：
     node scripts/check-backend.mjs
     SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/check-backend.mjs
     # 想让它顺手清理测试数据，再给一个 service_role key：
     SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-backend.mjs
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const course = JSON.parse(fs.readFileSync(path.join(root, "data/course.json"), "utf8"));
const sb = (course.site.submission && course.site.submission.supabase) || {};

const URL_BASE = (process.env.SUPABASE_URL || sb.url || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || sb.anonKey || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const TABLE = sb.table || "submissions";
const BUCKET = sb.bucket || "answer-uploads";
const AUTO = sb.autoApprove !== false;

if (!URL_BASE || !ANON) {
  console.error(
    "还没有配置 Supabase。\n" +
      "请编辑 data/course.json → site.submission.supabase 的 url 与 anonKey，\n" +
      "或者用环境变量 SUPABASE_URL / SUPABASE_ANON_KEY 传进来。",
  );
  process.exit(2);
}

const auth = { apikey: ANON, authorization: "Bearer " + ANON };
const results = [];
let failures = 0;

function record(ok, label, detail) {
  results.push({ ok, label, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  — " + detail : ""}`);
}

const testId = crypto.randomUUID();
const testPath = `_healthcheck/${Date.now()}-probe.txt`;
/* 体检记录带一个设备令牌，跑完就能自己把它撤下来，不在网站上留垃圾 */
const testToken = "healthcheck" + crypto.randomUUID().replace(/-/g, "");
const testAnswer = {
  id: testId,
  exercise: "2.1",
  author: "自动体检",
  author_note: "",
  title: "check-backend 测试记录，可删除",
  tags: ["healthcheck"],
  body: "这条记录由 scripts/check-backend.mjs 写入，用来确认同学可以直接提交。删掉它不影响任何东西。",
  attachments: [],
  status: AUTO ? "verified" : "pending",
  edit_token: testToken,
};

async function post(pathname, body, extraHeaders) {
  try {
    const res = await fetch(URL_BASE + pathname, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json", ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
    return { res, text: await res.text() };
  } catch (err) {
    /* Keep the failure readable instead of dumping a stack trace. */
    record(false, "无法连接 " + URL_BASE, err.cause ? err.cause.message : err.message);
    if (/ENOTFOUND|EAI_AGAIN|EACCES|ECONNREFUSED|CERT|fetch failed/i.test(String(err.message) + String(err.cause))) {
      console.error(
        "\n网络不通：如果是在受限环境里跑，请先放行对该域名的访问；\n" +
          "如果是在自己电脑上跑，检查一下能不能用浏览器打开 " + URL_BASE + "。\n",
      );
    }
    process.exit(1);
  }
}

console.log(`\n目标：${URL_BASE}\n表：${TABLE}   存储桶：${BUCKET}   展示模式：${AUTO ? "提交后立刻展示" : "先审核后展示"}\n`);
console.log("1. 读取已发布的作业");

/* 只看得到白名单里的列；device token、等级、学号都读不到 */
const PUBLIC_COLS =
  "id,created_at,updated_at,exercise,author,title,body,tags,attachments,status,helpful,feedback,revision";

let readRes;
try {
  readRes = await fetch(
    `${URL_BASE}/rest/v1/${TABLE}?select=${PUBLIC_COLS}&order=created_at.desc&limit=5`,
    { headers: { ...auth, accept: "application/json" } },
  );
} catch (err) {
  record(false, "连不上 " + URL_BASE, (err.cause && err.cause.message) || err.message);
  console.error(
    "\n网络不通，后面的检查没有意义，先解决连通性：\n" +
      "  - 在浏览器里打开 " + URL_BASE + " 看能不能通；\n" +
      "  - 如果这台机器有防火墙或代理，放行该域名后重试。\n",
  );
  process.exit(1);
}
if (readRes.ok) {
  const rows = await readRes.json();
  const leaked = rows.filter((r) => !["verified", "peer", "alternative"].includes(r.status));
  record(leaked.length === 0, "公开读取只返回已发布的作业", `${rows.length} 条，未发布 ${leaked.length} 条`);
} else {
  record(false, "公开读取失败", `HTTP ${readRes.status} ${(await readRes.text()).slice(0, 160)}`);
}

const star = await fetch(`${URL_BASE}/rest/v1/${TABLE}?select=*&limit=1`, {
  headers: { ...auth, accept: "application/json" },
});
record(
  !star.ok,
  "select=* 被拒绝（学号 / 等级 / 设备令牌读不到）",
  "HTTP " + star.status,
);

console.log("\n2. 同学直接提交（免账号写入）");
const submit = await post(`/rest/v1/${TABLE}`, testAnswer, { prefer: "return=minimal" });
record(
  submit.res.status === 201 || submit.res.status === 200,
  "匿名提交一条作业",
  `HTTP ${submit.res.status} ${submit.text.slice(0, 160)}`,
);

console.log("\n3. 越权与约束检查");
const tooShort = await post(
  `/rest/v1/${TABLE}`,
  { ...testAnswer, id: crypto.randomUUID(), body: "短" },
  { prefer: "return=minimal" },
);
record(tooShort.res.status >= 400, "过短的正文被拒绝", `HTTP ${tooShort.res.status}`);

const wrongStatus = await post(
  `/rest/v1/${TABLE}`,
  { ...testAnswer, id: crypto.randomUUID(), status: AUTO ? "pending" : "verified" },
  { prefer: "return=minimal" },
);
record(
  wrongStatus.res.status >= 400,
  "绕过前端指定另一种状态被拒绝",
  `HTTP ${wrongStatus.res.status}`,
);

const patch = await fetch(`${URL_BASE}/rest/v1/${TABLE}?id=eq.${testId}`, {
  method: "PATCH",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify({ status: "rejected" }),
});
const patched = patch.ok ? await patch.json().catch(() => []) : [];
/* PostgREST answers 204 with no body whether or not rows were touched, so read
   the row back and confirm its status is unchanged. */
let stillVerified = null;
try {
  const back = await fetch(
    `${URL_BASE}/rest/v1/${TABLE}?id=eq.${testId}&select=id,status`,
    { headers: { ...auth, accept: "application/json" } },
  );
  const rows = back.ok ? await back.json() : [];
  stillVerified = rows.length === 0 ? null : rows[0].status === testAnswer.status;
} catch {
  stillVerified = null;
}
record(
  stillVerified === true || (!patch.ok && stillVerified !== false),
  "匿名无法修改自己提交的记录（已回读确认）",
  stillVerified === true
    ? "状态仍为 " + testAnswer.status
    : stillVerified === false
      ? "!! 记录被改动了"
      : "HTTP " + patch.status + "（回读不可用）",
);

console.log("\n4. 附件上传");
const upRes = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${testPath}`, {
  method: "POST",
  headers: { ...auth, "content-type": "text/plain", "x-upsert": "false" },
  body: new TextEncoder().encode("healthcheck"),
});
record(upRes.ok, "匿名上传附件", `HTTP ${upRes.status} ${(await upRes.text()).slice(0, 120)}`);

if (upRes.ok) {
  const getRes = await fetch(`${URL_BASE}/storage/v1/object/public/${BUCKET}/${testPath}`);
  record(getRes.ok, "附件可通过公开地址取回", `HTTP ${getRes.status}`);
}

console.log("\n5. 清理测试数据");
const withdraw = await fetch(`${URL_BASE}/rest/v1/${TABLE}?id=eq.${testId}`, {
  method: "PATCH",
  headers: {
    ...auth,
    "content-type": "application/json",
    "x-edit-token": testToken,
    prefer: "return=minimal",
  },
  body: JSON.stringify({ status: "withdrawn" }),
});
record(
  withdraw.ok,
  "把体检记录撤下来（不在网站上留测试数据）",
  "HTTP " + withdraw.status,
);

if (SERVICE) {
  const h = { apikey: SERVICE, authorization: "Bearer " + SERVICE };
  const d1 = await fetch(`${URL_BASE}/rest/v1/${TABLE}?id=eq.${testId}`, {
    method: "DELETE",
    headers: h,
  });
  const d2 = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${testPath}`, {
    method: "DELETE",
    headers: h,
  });
  record(d1.ok && d2.ok, "已删除测试记录与测试附件", `HTTP ${d1.status}/${d2.status}`);
} else {
  console.log("  – 未提供 SUPABASE_SERVICE_ROLE_KEY，测试数据保留在库里。");
  console.log(`    测试记录 id：${testId}`);
  console.log(`    测试附件：${BUCKET}/${testPath}`);
  console.log("");
  console.log("    清理办法（任选其一）：");
  console.log("    A. Supabase 左侧 SQL Editor 里执行：");
  console.log("");
  console.log("         delete from public.submissions where tags @> array['healthcheck'];");
  console.log("");
  console.log("    B. 左侧 Table Editor → submissions，勾选作者是「自动体检」的那行 → Delete row；");
  console.log("       左侧 Storage → answer-uploads → _healthcheck 文件夹 → 删除里面的文件。");
}

console.log(
  `\n${failures === 0 ? "全部通过 —— 同学现在可以打开网页直接提交了。" : `有 ${failures} 项未通过，请照上面的提示修正。`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
