#!/usr/bin/env node
/* 本地假后端 —— 只用于在自己电脑上试跑「免账号直接上传」的完整流程，
   不需要注册 Supabase。它模仿 Supabase 的 REST 与 Storage 接口形状，
   数据存在内存里，进程一停就没了。

   用法：
     node scripts/mock-backend.mjs            # http://localhost:4174
   然后把 data/course.json 里 site.submission.supabase.url 指向它：
     "url": "http://localhost:4174",
     "anonKey": "local-test-key-000000000000000000"
   重新 build 之后，submit.html 就能直接上传了。

   生产环境请改用真正的 Supabase，不要用这个。
*/

import http from "node:http";

const PORT = Number(process.env.PORT || 4174);

/** @type {Array<Record<string, any>>} */
const rows = [];
/** @type {Map<string, Buffer>} */
const objects = new Map();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "*",
};

function send(res, status, body, type) {
  const payload =
    body === undefined || body === null
      ? ""
      : typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": type || "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function parseQuery(qs) {
  const out = {};
  for (const [k, v] of new URLSearchParams(qs)) out[k] = v;
  return out;
}

/* 用 service_role key 发来的请求按管理员处理（真 Supabase 里 service_role
   会直接绕过 RLS；这里用前缀简单模拟）。 */
function isService(req) {
  const apikey = String(req.headers.apikey || "");
  const bearer = String(req.headers.authorization || "");
  return apikey.startsWith("service-role") || bearer.startsWith("Bearer service-role");
}

/* 对应 schema.sql 里的 public.can_edit()：请求头里的令牌要能对上这一行 */
function anonCanEdit(req, row) {
  const t = String(req.headers["x-edit-token"] || "");
  return t.length >= 16 && row.edit_token === t;
}

/* tiny PostgREST-ish filter: status=in.(verified,peer), exercise=eq.2.1 */
function applyFilters(list, query) {
  let out = list.slice();
  for (const [key, raw] of Object.entries(query)) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const m = String(raw).match(/^(eq|neq|in|like)\.(.*)$/);
    if (!m) continue;
    const [, op, value] = m;
    if (op === "eq") out = out.filter((r) => String(r[key]) === value);
    else if (op === "neq") out = out.filter((r) => String(r[key]) !== value);
    else if (op === "like") {
      const needle = value.replace(/%/g, "").toLowerCase();
      out = out.filter((r) => String(r[key]).toLowerCase().includes(needle));
    } else if (op === "in") {
      const set = value
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      out = out.filter((r) => set.includes(String(r[key])));
    }
  }
  const order = query.order;
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const av = String(a[col] ?? "");
      const bv = String(b[col] ?? "");
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  if (query.limit) out = out.slice(0, Number(query.limit));
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);

  const url = new URL(req.url, "http://localhost");
  const path = decodeURIComponent(url.pathname);

  try {
    /* ------------------------------------------------------ debug ----- */
    if (path === "/_rows") {
      if (req.method === "DELETE") {
        rows.length = 0;
        objects.clear();
        return send(res, 200, { cleared: true });
      }
      return send(res, 200, rows);
    }

    /* ------------------------------------------- 学生取回自己的作业 ----- */
    if (path === "/rest/v1/rpc/my_submissions") {
      const raw = await readBody(req);
      const token = String(JSON.parse(raw.toString("utf8") || "{}").p_token || "");
      if (token.length < 16) return send(res, 200, []);
      return send(
        res,
        200,
        rows
          .filter((r) => r.edit_token === token)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      );
    }

    /* ---------------------------------------------------- storage ----- */
    if (path.startsWith("/storage/v1/object/")) {
      const rest = path.slice("/storage/v1/object/".length);
      const key = rest.replace(/^public\//, "");
      if (req.method === "POST") {
        const body = await readBody(req);
        objects.set(key, body);
        return send(res, 200, { Key: key });
      }
      if (req.method === "GET") {
        const buf = objects.get(key);
        if (!buf) return send(res, 404, { message: "Object not found" });
        return send(res, 200, buf, "application/octet-stream");
      }
      if (req.method === "DELETE") {
        if (!isService(req)) {
          return send(res, 403, { message: "anon has no delete policy" });
        }
        objects.delete(key);
        return send(res, 200, {});
      }
      return send(res, 405, { message: "Method not allowed" });
    }

    /* ----------------------------------------------------------- rest -- */
    if (path === "/rest/v1/submissions") {
      if (req.method === "POST") {
        const raw = await readBody(req);
        let row;
        try {
          row = JSON.parse(raw.toString("utf8"));
        } catch {
          return send(res, 400, { message: "Invalid JSON body" });
        }
        if (!row.exercise || !row.author || !row.body) {
          return send(res, 400, { message: "Missing required fields" });
        }
        if (row.status !== "verified") {
          return send(res, 403, {
            message:
              'new row violates row-level security policy (status must be "verified")',
          });
        }
        if (String(row.body).length < 10 || String(row.body).length > 20000) {
          return send(res, 400, { message: "body length out of range" });
        }
        const record = {
          id: row.id || crypto.randomUUID(),
          created_at: new Date().toISOString(),
          helpful: 0,
          tags: [],
          attachments: [],
          author_note: "",
          title: "",
          ...row,
        };
        rows.push(record);
        return send(res, 201, "", "application/json");
      }
      if (req.method === "GET") {
        const q = parseQuery(url.search);
        const filtered = applyFilters(rows, q).filter(
          (r) =>
            isService(req) || ["verified", "peer", "alternative"].includes(r.status),
        );
        return send(res, 200, filtered);
      }
      if (req.method === "PATCH") {
        const raw = await readBody(req);
        const patch = JSON.parse(raw.toString("utf8") || "{}");
        const q = parseQuery(url.search);
        const targets = applyFilters(rows, q);

        if (isService(req)) {
          targets.forEach((r) => Object.assign(r, patch));
          return send(res, 200, "", "application/json");
        }

        /* 学生：只能改自己那台设备交的，而且不能自己改成「精选」 */
        const editable = targets.filter((r) => anonCanEdit(req, r));
        const violates =
          !editable.length ||
          (patch.status && !["verified", "withdrawn"].includes(patch.status)) ||
          (patch.body != null &&
            (String(patch.body).length < 10 || String(patch.body).length > 20000));
        if (violates) {
          return send(res, 403, {
            message: 'new row violates row-level security policy for table "submissions"',
          });
        }
        editable.forEach((r) => Object.assign(r, patch));
        return send(res, 200, "", "application/json");
      }
      if (req.method === "DELETE") {
        if (!isService(req)) {
          return send(res, 403, { message: "anon has no delete policy" });
        }
        const q = parseQuery(url.search);
        for (const r of applyFilters(rows, q)) {
          rows.splice(rows.indexOf(r), 1);
        }
        return send(res, 200, "", "application/json");
      }
    }

    send(res, 404, { message: "Not found: " + path });
  } catch (err) {
    send(res, 500, { message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[mock-backend] http://localhost:${PORT}`);
  console.log(`[mock-backend] rows: GET /_rows · reset: DELETE /_rows`);
});
