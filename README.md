# PrepPilot — AI Interview Coach & ATS Analyzer

> A voice-first AI interview coach that reads your resume, scores it against ATS rules, runs an adaptive spoken interview with an animated agent, and returns a scored report with a study plan.

---

## How it's put together

PrepPilot runs in **two halves**, and the second one is optional.

**`preppilot.html`** is the whole app in one file. It parses the resume, scores it, picks questions, drives the avatar and speech, grades answers and renders the report — with no server, no build step and no network. Open it from disk and it works. That property is deliberate and is not going away.

**`server/`** is a Node engine that sits behind it when you run `npm start`. It carries a larger syllabus, retrieval over that syllabus and over your own resume, and — if you supply an API key — Claude grading each answer against retrieved rubric. The browser probes for it once at boot and uses it when it answers.

```
                  ┌─ server up?  → Node engine + BM25 retrieval + Claude
Browser ─ /api/health ─┤
                  └─ server down? → the in-browser engine, unchanged
```

The badge in the top bar tells you which one graded your interview: **Browser engine**, **Server engine**, or **Server engine · Claude**.

---

## Quick start

```bash
npm start
```

Then open <http://localhost:3000>.

To enable the Claude-backed grading and resume review, set a key in your environment before starting — the app reads it from there and never stores it:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

On Windows PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Everything works without it. `/api/health` reports exactly which features are live.

```bash
npm test
```

### Voice and video need a real browser

Open **`http://localhost:3000` in Chrome or Edge** for the spoken interview. Speech recognition is Chromium-only, and both the microphone and the camera need permission you can actually grant.

Embedded webviews — a desktop app's preview pane, an in-app browser, some IDE panels — **block capture outright**, no matter what the page asks for. PrepPilot detects this at boot, says so, and selects text mode instead of starting an interview that cannot respond to you.

Typed mode runs the identical interview: same questions, same adaptive difficulty, same report. The only things it loses are the spoken delivery metrics and the video analysis.

**Check audio & camera** in Setup tests all four capabilities separately — the interviewer's voice, speech recognition, the microphone and the camera — and tells you which one failed and why.

---

## Features

### Resume intake & ATS scoring
* PDF, DOCX or pasted text (`pdf.js` / `mammoth.js`, in-browser — the file never leaves your machine).
* 0–100 score across parseability, contact links, section structure, quantified impact, language quality and JD keyword match.
* Interactive Resume Lab with red/amber/green highlighting and text export.
* **With a key:** a deeper review that reads each bullet, says what's wrong with it, and gives you a rewrite you can paste — plus the claims an interviewer will probe and the questions they'll ask.

### Adaptive interview
* Full voice with Web Speech API, or typed.
* Questions drawn from your resume, your projects and a 94-topic CS syllabus; difficulty moves with your answers.
* Interviewer personas: Friendly mentor, Neutral panel, Big-tech bar, Startup founder.
* Cross-examines your own resume claims — and only raises a discrepancy when it can attribute both numbers to the same project.

### Speech & substance analysis
* Speaking pace, filler frequency, hedging and confidence, measured separately from correctness.
* Grading never considers accent, dialect, grammar or fluency.

### Report
* Score out of 100 across seven axes, each reported **with the number of answers behind it** and a confidence band.
* An axis with too little evidence reports "not enough data" rather than a number.
* Per-question replay with rubric gaps, model answers and the interviewer's reasoning.
* 7-day and 30-day study plans, and history across sessions.

---

## The API

Mounted at `/api` when the server is running. Every response is `{ok: true, ...}` or `{ok: false, error}`.

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | What this server can do: corpus size, retrieval stats, whether the LLM is live |
| `POST /api/resume/analyze` | Structural analysis, JD coverage matrix, implied topics, optional deep review |
| `POST /api/grade` | Grade one question/answer pair against retrieved rubric. Stateless |
| `POST /api/retrieve` | Which syllabus topics a passage is about, and their rubric |
| `POST /api/interview/start` | Begin a server-driven interview |
| `POST /api/interview/answer` | One turn: retrieve → grade → decide → respond |
| `POST /api/interview/end` | Finish and return the full report |
| `GET  /api/interview/report` | The report for a finished interview |

```bash
curl -s localhost:3000/api/health | head -20
```

---

## Retrieval, and why it's lexical

Retrieval uses BM25 over two indexes: the syllabus (one document per topic — concept, keywords, rubric, probes) and your resume (chunked by bullet, each attributed to the project it belongs to).

It is lexical rather than vector-based on purpose. The Anthropic API has no embeddings endpoint, and adding a second vendor for a feature that must keep working with no key at all would be the wrong trade. It also happens to suit the problem: these queries are full of exact technical tokens — `p99`, `B+ tree`, `SMOTE`, `recall@5` — and those are precisely what dense vectors blur and BM25 nails.

Its known weakness is polysemy: "connection **pool** saturated" can retrieve the CNN **pooling** topic, because the words genuinely match and the meaning doesn't. When a key is present, an LLM reranking pass reorders the shortlist and fixes that. Without one, BM25's order stands.

---

## Grading

Two passes, blended — not one handing over to the other.

The **rules pass** always runs. It measures rubric coverage, STAR structure on behavioural answers, delivery signals, repetition and whether the answer addressed the question. It is instant, free, explainable, and it sees things a model can't — that this paragraph was already used two questions ago.

The **model pass** runs when a key is configured. It judges substance rather than vocabulary, which is the one thing keyword coverage genuinely cannot do: a correct explanation in the candidate's own words used to score as though they didn't know the topic.

The final score is `0.4 × rules + 0.6 × model`. A failed or hallucinated model response degrades the grade; it never defines it. Every LLM call is bounded by a timeout and resolves to `null` on failure, so a flaky network costs you nuance, not a working interview.

---

## Layout

```
preppilot.html          the entire client app
server.js               static host + API mount
server/
  api.js                HTTP routes
  knowledge.js          merges the HTML syllabus with the extension corpus
  resume.js  jd.js      parsing, ATS scoring, JD coverage
  projects.js text.js   project archetypes, language utilities
  data/                 the corpora
    knowledge-graph.js  42 added syllabus topics
    signals.js          follow-up hooks and misconceptions
    behavioral.js       behavioural bank, grouped by trait
  rag/
    bm25.js             the retriever
    index.js            syllabus + resume indexes, grounding
  llm/
    client.js           Claude client, timeouts, graceful degradation
    grade.js            answer grading
    resume.js           deep resume review
    rerank.js           retrieval reranking
    converse.js         human phrasing of the interviewer's turn
  engine/
    orchestrator.js     interview state and the turn loop
    analyzer.js         answer analysis
    decision.js         what to ask next
    difficulty.js       the difficulty ladder
    responder.js        personas and phrasing
    contradictions.js   claim cross-examination
    report.js           scoring and analytics
  test/run.js           the suite
```

---

## Deployment

Config for both targets is in the repo. Pick either, or run both.

### Vercel — static site + serverless API (recommended)

The static app is served from the repo root; `api/index.js` handles `/api/*` as a serverless function using the same router the standalone server uses.

1. [vercel.com/new](https://vercel.com/new) → import `tarush5/PrepPilot`.
2. Framework preset: **Other**. Leave build and output settings empty — there is no build step.
3. Deploy.
4. **Settings → Environment Variables** → add `ANTHROPIC_API_KEY`, then redeploy so the function picks it up.

What you get: the 94-topic syllabus, BM25 retrieval and Claude grading, on the free tier, auto-deploying on every push.

One limitation worth knowing: `/api/interview/*` keeps session state in memory, and serverless invocations don't share memory. Those endpoints work on a warm instance and can 404 on a cold one. The browser never calls them — it uses the stateless `/api/grade` — so this doesn't affect the app. If you want the server-driven interview loop, use Render.

Verify with:

```bash
curl -s https://YOUR-APP.vercel.app/api/health
```

`corpus.topics` should read 94 and `llm.available` should be `true` once the key is set.

### Render — the full Node server

Runs `npm start` as a long-lived process, so every endpoint works including the stateful session flow.

1. [render.com](https://render.com) → **New → Blueprint** → point at this repo. It reads `render.yaml`.
2. **Environment** tab → add `ANTHROPIC_API_KEY`.

The free plan sleeps after inactivity, so the first request after idle takes ~50 seconds. `healthCheckPath` is set to `/api/health`.

### GitHub Pages — static only

Settings → Pages → Branch `main`, folder `/ (root)`. Only the in-browser engine runs; the badge reads "Browser engine". No API, no retrieval, no Claude.

### Never commit the key

`.env` is gitignored and `render.yaml` marks the key `sync: false`. Set it in the host's dashboard, not in the repo. If one ever leaks, rotate it first — removing the commit does not undo exposure.

---

## Tech

Vanilla JS (ES2022), CSS custom properties, Web Speech API, Web Audio API, `pdf.js`, `mammoth.js`. Backend is Node ≥18 with one dependency, `@anthropic-ai/sdk`. No build step.

## License

MIT.
