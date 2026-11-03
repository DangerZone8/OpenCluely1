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
  try { name = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).replace(/^\\/+/, ""); }
  catch { res.writeHead(400).end("Bad URL"); return; }
  name = name || "latest.yml";
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
  if ((name !== "latest.yml" && path.basename(name) !== name) || name.includes("..")) { res.writeHead(400).end("Invalid path"); return; }
  const file = path.join(root, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, path: name, status: 404 }) + "\n");
    res.writeHead(404, { "Cache-Control": "no-store" }).end("Not found"); return;
  }
  const stat = fs.statSync(file);
  fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, path: name, status: 200, bytes: stat.size }) + "\n");
  res.writeHead(200, { "Content-Type": name.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream", "Content-Length": stat.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1", () => { fs.writeFileSync(portFile, String(server.address().port)); process.stdout.write("Controlled updater feed ready\n"); });
function stop() { server.close(() => process.exit(0)); }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
