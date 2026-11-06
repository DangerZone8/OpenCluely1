"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const root = path.resolve(arg("--root") || "");
const portFile = path.resolve(arg("--port-file") || "");
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory() || !portFile) throw new Error("Missing --root or --port-file");
const accessLog = path.join(root, "controlled-feed-requests.jsonl");

function parseRange(spec, size) {
  const match = /^(\d*)-(\d*)$/.exec(spec.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || start > end) return null;
  return { start, end };
}

function readPart(fd, range) {
  const buffer = Buffer.alloc(range.end - range.start + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const read = fs.readSync(fd, buffer, offset, buffer.length - offset, range.start + offset);
    if (read <= 0) throw new Error("Unexpected end of file while reading requested range");
    offset += read;
  }
  return buffer;
}

const server = http.createServer((req, res) => {
  let requestedPath;
  try { requestedPath = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).split("/").filter(Boolean).join("/"); }
  catch { res.writeHead(400).end("Bad URL"); return; }
  // Do not disguise an invalid asset URL as a valid manifest or installer.
  // A root request is a useful diagnostic: the updater must request latest.yml
  // and the installer by their explicit paths.
  const name = requestedPath;
  if (!name) {
    fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: "/", range: req.headers.range || null, status: 404, error: "Root URL is not a valid update asset" }) + "\n");
    res.writeHead(404, { "Cache-Control": "no-store" }).end("Root URL is not a valid update asset");
    return;
  }
  fs.appendFileSync(accessLog, JSON.stringify({ event: "request", method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: req.headers.range || null }) + "\n");
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
  if (path.basename(name) !== name || name.includes("..")) { res.writeHead(400).end("Invalid path"); return; }
  const file = path.join(root, name);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: req.headers.range || null, status: 404 }) + "\n");
    res.writeHead(404, { "Cache-Control": "no-store" }).end("Not found");
    return;
  }

  const stat = fs.statSync(file);
  const type = name.endsWith(".yml") ? "text/yaml; charset=utf-8" : "application/octet-stream";
  const rangeHeader = req.method === "GET" ? req.headers.range : null;
  if (rangeHeader) {
    const match = /^bytes=(.+)$/i.exec(rangeHeader);
    const ranges = match ? match[1].split(",").map(part => parseRange(part, stat.size)) : null;
    if (!ranges || ranges.length === 0 || ranges.some(range => range == null)) {
      fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: rangeHeader, status: 416 }) + "\n");
      res.writeHead(416, { "Content-Range": "bytes */" + stat.size, "Cache-Control": "no-store" }).end();
      return;
    }

    if (ranges.length === 1) {
      const range = ranges[0];
      const length = range.end - range.start + 1;
      fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: rangeHeader, status: 206, bytes: length }) + "\n");
      res.writeHead(206, {
        "Content-Type": type,
        "Content-Length": length,
        "Content-Range": "bytes " + range.start + "-" + range.end + "/" + stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    const boundary = "slickly-range-" + process.pid + "-" + Date.now();
    const chunks = [];
    const fd = fs.openSync(file, "r");
    try {
      for (const range of ranges) {
        const header = "--" + boundary + "\r\n" +
          "Content-Type: " + type + "\r\n" +
          "Content-Range: bytes " + range.start + "-" + range.end + "/" + stat.size + "\r\n\r\n";
        chunks.push(Buffer.from(header), readPart(fd, range), Buffer.from("\r\n"));
      }
    } finally {
      fs.closeSync(fd);
    }
    chunks.push(Buffer.from("--" + boundary + "--\r\n"));
    const body = Buffer.concat(chunks);
    fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: rangeHeader, status: 206, ranges: ranges.length, bytes: body.length }) + "\n");
    res.writeHead(206, {
      "Content-Type": "multipart/byteranges; boundary=" + boundary,
      "Content-Length": body.length,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(body);
    return;
  }

  fs.appendFileSync(accessLog, JSON.stringify({ method: req.method, requestedPath: requestedPath || "/", resolvedPath: name, range: null, status: 200, bytes: stat.size }) + "\n");
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(portFile, String(server.address().port));
  process.stdout.write("Controlled updater feed ready\n");
});
function stop() { server.close(() => process.exit(0)); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
