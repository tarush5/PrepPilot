"use strict";
/* The interview HTTP API.

   Deliberately small and stateful-in-memory. Sessions live in a Map with a TTL
   sweep — no database, because the browser already persists history in
   localStorage and the server is the optional half of this system. If the
   process restarts, the client falls back to its own engine and the candidate
   keeps going.

   Every handler answers in the same envelope: { ok, ... } or
   { ok:false, error }. Errors carry a `status` where the engine set one (422 for
   an unusable resume, 409 for a finished interview) so the client can tell a
   user mistake from a server fault. */

const { randomUUID } = require("crypto");
const O = require("./engine/orchestrator");
const { analyzeResume } = require("./resume");
const { analyzeJD, coverageMatrix } = require("./jd");
const knowledge = require("./knowledge");
const rag = require("./rag");
const llm = require("./llm/client");
const { analyzeResumeLLM } = require("./llm/resume");

const MAX_BODY = 1_000_000;               // 1MB — a resume, not a file upload
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;

const sessions = new Map();               // id -> { state, createdAt, touchedAt }

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.touchedAt < cutoff) sessions.delete(id);
  // Hard cap as a second line of defence against unbounded growth.
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (let i = 0; i < oldest.length - MAX_SESSIONS; i++) sessions.delete(oldest[i][0]);
  }
}
const sweeper = setInterval(sweep, 10 * 60 * 1000);
if (sweeper.unref) sweeper.unref();       // never hold the process open

/* ---------- plumbing ---------- */

function json(res, status, body) {
  if (res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error("Request body too large."), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Request body was not valid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function getSession(id) {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error("No such interview — it may have expired. Start a new one."), { status: 404 });
  s.touchedAt = Date.now();
  return s;
}

const str = (v, max = 100000) => String(v == null ? "" : v).slice(0, max);

/* ---------- routes ---------- */

const routes = {

  /* Liveness plus a description of what this server can actually do, so the
     client can decide whether to use it at all. */
  "GET /api/health": async () => ({
    ok: true,
    service: "preppilot",
    engine: "server",
    llm: llm.status(),
    corpus: knowledge.stats(),
    retrieval: rag.stats(),
    sessions: sessions.size,
    usage: llm.usage,
    uptime_sec: Math.round(process.uptime()),
  }),

  /* Resume + JD analysis. Structural scoring always; LLM judgement when a key
     is configured and the caller asked for it. */
  "POST /api/resume/analyze": async body => {
    const resumeText = str(body.resumeText, 200000);
    const jdText = str(body.jdText, 40000);
    const role = str(body.role, 120) || "Software Engineer (SDE-1)";

    const resume = analyzeResume(resumeText);                 // throws 422 if unusable
    const jd = jdText ? analyzeJD(jdText) : null;
    const matrix = coverageMatrix(jd, resume);
    const index = rag.buildResumeIndex(resumeText, resume);

    const out = {
      ok: true,
      resume: {
        name: resume.name, email: resume.email, wordCount: resume.word_count,
        skills: resume.skills, projects: resume.projects, metrics: resume.metrics,
        claims: (resume.claims || []).map(c => ({ text: c.text, project: c.project || null })),
      },
      jd_matrix: matrix,
      chunks: index.chunks.length,
      topics: rag.retrieveTopics(resume.skills.join(" ") + " " + (resume.technologies || []).join(" "), { k: 12 })
        .map(h => ({ id: h.id, concept: h.meta.concept, subject: h.meta.subject })),
      llm: null,
    };

    if (body.deep !== false && llm.available()) {
      out.llm = await analyzeResumeLLM({ resumeText, jdText, role, atsScore: body.atsScore ?? null });
    }
    return out;
  },

  /* Create an interview and get the opening line. */
  "POST /api/interview/start": async body => {
    sweep();
    const resumeText = str(body.resumeText, 200000);
    const state = O.createInterview({
      resumeText,
      jdText: str(body.jdText, 40000),
      role: str(body.role, 120) || "Software Engineer (SDE-1)",
      personality: str(body.personality, 40) || "professional",
      length: Number(body.length) || 10,
      type: str(body.type, 20) || "mixed",
      name: str(body.name, 120),
      mode: str(body.mode, 20) || "text",
    });
    const id = randomUUID();
    sessions.set(id, { state, createdAt: Date.now(), touchedAt: Date.now() });
    const opening = O.start(state);
    return { ok: true, sessionId: id, ...opening, public: O.publicView(state), llm: llm.available() };
  },

  /* One turn. This is the hot path. */
  "POST /api/interview/answer": async body => {
    const s = getSession(str(body.sessionId, 64));
    const text = str(body.text, 20000);
    const meta = {
      secs: Number(body.secs) || null,
      mode: str(body.mode, 20) || "text",
      latency: Number(body.latency) || null,
      llm: body.llm !== false,
    };
    const turn = await O.answerAsync(s.state, text, meta);
    return { ok: true, ...turn };
  },

  "POST /api/interview/pause": async body => {
    const s = getSession(str(body.sessionId, 64));
    return { ok: true, public: O.pause(s.state, !!body.paused) };
  },

  /* End and return the full report. */
  "POST /api/interview/end": async body => {
    const s = getSession(str(body.sessionId, 64));
    const report = O.endInterview(s.state);
    return { ok: true, report };
  },

  "GET /api/interview/report": async (_body, url) => {
    const s = getSession(url.searchParams.get("sessionId") || "");
    return { ok: true, report: O.report(s.state) };
  },

  "GET /api/interview/state": async (_body, url) => {
    const s = getSession(url.searchParams.get("sessionId") || "");
    return { ok: true, public: O.publicView(s.state), memory: O.memorySummary(s.state) };
  },

  /* Stateless grading of a single question/answer pair.

     This exists for the browser engine, which picks its own questions. Routing
     its answers through /interview/answer would grade them against whatever
     the SERVER's interview had asked next — a different question — so the
     score would be meaningless. This endpoint grades exactly the pair it is
     given: retrieve rubric for it, grade against that, return. No session, no
     ordering assumptions, safe to call from any client loop. */
  "POST /api/grade": async body => {
    const question = {
      text: str(body.question, 2000),
      kind: str(body.kind, 24) || "tech",
      topicId: str(body.topicId, 64) || null,
      rubric: Array.isArray(body.rubric) ? body.rubric.slice(0, 8).map(r => str(r, 400)) : [],
      forceQualitative: !!body.forceQualitative,
    };
    const text = str(body.answer, 20000);
    if (!text.trim()) throw Object.assign(new Error("No answer to grade."), { status: 400 });

    const resumeIndex = body.resumeText ? rag.buildResumeIndex(str(body.resumeText, 200000), {}) : null;
    const grounding = rag.groundingFor(question, text, { resumeIndex });

    // Deterministic pass always runs; it owns delivery signals and shape.
    const { analyzeAnswer } = require("./engine/analyzer");
    const rules = analyzeAnswer({
      question: { ...question, rubric: grounding.rubric },
      text, secs: Number(body.secs) || null, turn: Number(body.turn) || 1,
      history: Array.isArray(body.history) ? body.history.slice(-8).map(h => ({ text: str(h, 4000) })) : [],
    });

    let graded = {
      technical_accuracy: rules.technical_accuracy, depth: rules.depth,
      clarity: rules.clarity, relevance: rules.relevance, confidence: rules.confidence,
      answer_quality: rules.answer_quality, primary: rules.primary,
      missing_concepts: rules.missing_concepts, strengths: rules.strengths,
      incorrect: rules.incorrect, signals: rules.signals, graded_by: "rules",
    };

    if (body.llm !== false && llm.available()) {
      const { gradeAnswer } = require("./llm/grade");
      const g = await gradeAnswer({ question: { ...question, rubric: grounding.rubric }, answerText: text, grounding, role: str(body.role, 120) });
      if (g) {
        const blend = (rule, model) => Math.round(rule * 0.4 + model * 0.4 + rule * 0.2);
        graded.answer_quality = Math.round(rules.answer_quality * 0.4 + g.score * 0.6);
        graded.technical_accuracy = Math.round(blend(rules.technical_accuracy, g.score));
        graded.depth = Math.round(blend(rules.depth, g.score));
        graded.missing_concepts = g.missing.length ? g.missing : rules.missing_concepts;
        graded.strengths = g.strengths.length ? g.strengths : rules.strengths;
        graded.incorrect = [...rules.incorrect, ...g.errors.map(e => ({ fix: e.correction, source: "llm" }))];
        graded.reasoning = g.reasoning;
        graded.follow_up = g.followUp;
        graded.rubric_detail = g.rubricPoints;
        graded.graded_by = "llm";
      }
    }

    return {
      ok: true,
      grade: graded,
      rubric: grounding.rubric,
      retrieved: grounding.topics.map(t => ({ id: t.topicId, concept: t.concept, subject: t.subject })),
      resume_lines: grounding.resume.map(r => r.text),
    };
  },

  /* Retrieval, exposed on its own — useful for debugging relevance and for the
     Resume Lab to show which syllabus topics a resume actually implies. */
  "POST /api/retrieve": async body => {
    const q = str(body.q, 8000);
    if (!q.trim()) throw Object.assign(new Error("Nothing to retrieve for."), { status: 400 });
    const hits = rag.retrieveTopics(q, { k: Number(body.k) || 5 });
    return {
      ok: true,
      hits: hits.map(h => ({ id: h.id, score: h.score, subject: h.meta.subject, concept: h.meta.concept })),
      rubric: rag.retrieveRubric(q, { k: 2 }),
    };
  },
};

/* ---------- dispatcher ---------- */

async function handle(req, res, reqPath) {
  if (req.method === "OPTIONS") return json(res, 204, {});

  const key = `${req.method} ${reqPath.replace(/\/+$/, "") || reqPath}`;
  const route = routes[key];
  if (!route) return json(res, 404, { ok: false, error: `No such endpoint: ${key}` });

  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const url = new URL(req.url, "http://localhost");
    const out = await route(body, url);
    return json(res, 200, out);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`api ${key} failed:`, err && err.stack || err);
    return json(res, status, { ok: false, error: err.message || "Something went wrong." });
  }
}

module.exports = { handle, routes, sessions };
