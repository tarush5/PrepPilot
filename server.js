"use strict";
/* PrepPilot host.
   Serves the single-page app and mounts the interview API underneath it.
   The API is optional: if anything in server/ fails to load (a bad edit, a
   missing dependency), the static site still comes up and the browser engine
   carries the app on its own. That fallback is the whole deployment story —
   preppilot.html works with no server at all, and this process only ever adds
   capability on top of it. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

/* Nothing outside the app itself is web-content. `.git` in particular would
   otherwise hand a visitor the entire repository and its history. */
const DENY = [
  /(^|[\\/])\./,                    // dotfiles and dotdirs: .git, .env, .claude
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])server([\\/]|$)/,       // backend source
  /(^|[\\/])server\.js$/,
  /\.d\.ts$/,
  /(^|[\\/])package(-lock)?\.json$/,
  /\.(md|backup|log)$/i,
];

let api = null;
try {
  api = require("./server/api");
  console.log("   API      : mounted at /api");
} catch (err) {
  console.warn("   API      : unavailable (" + err.message + ")");
  console.warn("              The app still works — the browser engine takes over.");
}

function send(res, code, body, type = "text/plain; charset=utf-8") {
  if (res.writableEnded) return;
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(req, res, reqPath) {
  if (reqPath === "/" || reqPath === "") reqPath = "/preppilot.html";

  const rel = path.normalize(reqPath).replace(/^([\\/])+/, "");
  const full = path.resolve(PUBLIC_DIR, rel);

  // Containment by relative path, not string prefix: a sibling directory named
  // "interdwsd-backup" would satisfy startsWith(PUBLIC_DIR) but is not inside it.
  const inside = path.relative(PUBLIC_DIR, full);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return send(res, 403, "403 Forbidden");
  if (DENY.some(r => r.test(inside))) return send(res, 404, "404 Not Found");

  fs.stat(full, (err, stats) => {
    if (err || !stats.isFile()) return send(res, 404, "404 Not Found");
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    const stream = fs.createReadStream(full);
    stream.on("error", () => { if (!res.writableEnded) res.end(); });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // One malformed escape in a URL used to take the whole process down:
  // decodeURI throws URIError, and an uncaught throw inside a request handler
  // exits Node. Every request now runs inside this guard.
  try {
    const raw = String(req.url || "/").split("?")[0];
    let reqPath;
    try {
      reqPath = decodeURIComponent(raw);
    } catch {
      return send(res, 400, "400 Bad Request — malformed URL escape");
    }
    if (reqPath.includes("\0")) return send(res, 400, "400 Bad Request");

    if (api && reqPath.startsWith("/api/")) return api.handle(req, res, reqPath);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "405 Method Not Allowed");
    return serveStatic(req, res, reqPath);
  } catch (err) {
    console.error("request failed:", err && err.stack || err);
    return send(res, 500, "500 Internal Server Error");
  }
});

// A crash in a stray async callback should not take the site down either.
process.on("uncaughtException", err => console.error("uncaught:", err && err.stack || err));
process.on("unhandledRejection", err => console.error("unhandled rejection:", err && err.stack || err));

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  PrepPilot running at: http://localhost:${PORT}`);
  console.log(`   LLM      : ${process.env.ANTHROPIC_API_KEY ? "enabled (ANTHROPIC_API_KEY set)" : "off — set ANTHROPIC_API_KEY to enable"}`);
  console.log(`==================================================\n`);
});

module.exports = server;
