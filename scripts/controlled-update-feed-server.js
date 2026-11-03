"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const root = path.resolve(arg("--root") || "");
const portFile = path.resolve(arg("--port-file") || "");
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !portFile) throw new Error("Missing --root or --port-file");
const accessLog = path.join(root, "controlled-feed-requests.jsonl");
const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).split("/").filter(Boolean).join("/"); }
  catch { res.writeHead(400).end("Bad URL"); return; }
  name = name || "latest.yml";
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
  if (path.basename(name) !== name || name.includes("..")) { res.writeHead(400).end("Invalid path"); return; }
  const file = path.join(root, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, path: name, range: req.headers.range || null, status: 404 }) + "\n");
    res.writeHead(404, { "Cache-Control": "no-store" }).end("Not found"); return;
  }
  const stat = fs.statSync(file);
  const type = name.endsWith(".yml") ? "text/yaml; charset=utf-8" : name.endsWith(".blockmap") ? "application/octet-stream" : "application/octet-stream";
  const range = req.method === "GET" && req.headers.range ? /^bytes=(\d+)-(\d*)$/.exec(req.headers.range) : null;
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (req.headers.range && !range) { res.writeHead(416, { "Content-Range": "bytes */" + stat.size }).end(); return; }
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
      res.writeHead(416, { "Content-Range": "bytes */" + stat.size }).end(); return;
    }
    status = 206;
  }
  const length = end - start + 1;
  fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, path: name, range: req.headers.range || null, status, bytes: length }) + "\n");
  const headers = { "Content-Type": type, "Content-Length": length, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (status === 206) headers["Content-Range"] = "bytes " + start + "-" + end + "/" + stat.size;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
});
server.listen(0, "127.0.0.1", () => { fs.writeFileSync(portFile, String(server.address().port)); process.stdout.write("Controlled updater feed ready\n"); });
function stop() { server.close(() => process.exit(0)); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
