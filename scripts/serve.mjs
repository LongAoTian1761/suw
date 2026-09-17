#!/usr/bin/env node
/* Zero-dependency static preview server.
   Usage: npm run dev  →  http://localhost:4173 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".m": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const target = path.join(root, path.normalize(pathname));

  if (!target.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<meta charset="utf-8"><body style="font:16px/1.7 system-ui;padding:48px;max-width:640px;margin:auto">
         <h1 style="font-family:Georgia,serif">404</h1>
         <p>没有找到 <code>${pathname}</code>。</p>
         <p>如果刚改过内容，请先运行 <code>npm run build</code> 再刷新。</p>
         <p><a href="/">回到首页</a></p></body>`,
      );
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`预览地址  http://localhost:${port}`);
  console.log(`站点目录  ${root}`);
});
