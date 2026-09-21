"use strict";
/* Vercel serverless entry point.

   `server.js` is a long-lived Node process: it serves the static app and
   mounts the API underneath it. Vercel serves the static app itself from the
   repo root, so all this function has to do is be the API half — it receives
   everything under /api/* and hands it to the same router the standalone
   server uses. One implementation, two hosts.

   What works here and what doesn't:

   · Stateless endpoints — /api/health, /api/grade, /api/retrieve,
     /api/resume/analyze — work exactly as they do locally. These are the ones
     the browser actually calls, so a Vercel deploy gets the full syllabus,
     BM25 retrieval and Claude grading.

   · Session endpoints — /api/interview/* — keep their state in an in-process
     Map. Serverless invocations don't share memory and are recycled freely,
     so a session created by one invocation may not exist for the next. They
     are left routed rather than removed (a warm instance will serve them),
     but anything depending on them belongs on a persistent host — see
     render.yaml. The browser engine never needs them.

   Cold starts pay for building the knowledge corpus and the BM25 index, which
   is why `includeFiles` in vercel.json ships preppilot.html alongside this
   function: the syllabus is read from it. If that file were ever missing,
   server/knowledge.js falls back to the server-side corpus rather than
   failing to boot. */

let api;
let loadError = null;
try {
  api = require("../server/api");
} catch (err) {
  loadError = err;
  console.error("api: failed to load the interview engine:", err && err.stack || err);
}

module.exports = async function handler(req, res) {
  if (loadError) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({
      ok: false,
      error: "The interview engine failed to start on this deployment. The app still works — the browser engine takes over.",
    }));
  }

  // Vercel hands us the full request path; the router matches on "/api/...".
  let pathname = "/api";
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch { /* keep the default */ }
  if (!pathname.startsWith("/api")) pathname = "/api" + (pathname === "/" ? "" : pathname);

  /* Vercel pre-parses JSON bodies onto req.body and leaves the stream
     consumed, so the router's own reader would hang waiting for data that has
     already been read. Replay it as a stream when that has happened. */
  if (req.body !== undefined && typeof req.on === "function") {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const { Readable } = require("stream");
    // Must be a Buffer: the router concatenates chunks with Buffer.concat,
    // which rejects strings outright.
    const replay = Readable.from([Buffer.from(raw, "utf8")]);
    req.on = replay.on.bind(replay);
    req.once = replay.once.bind(replay);
    req.removeListener = replay.removeListener.bind(replay);
    req.pipe = replay.pipe.bind(replay);
  }

  try {
    return await api.handle(req, res, pathname);
  } catch (err) {
    console.error("api handler failed:", err && err.stack || err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Something went wrong handling that request." }));
    }
  }
};
