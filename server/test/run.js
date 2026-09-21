"use strict";
/* Test suite. Run with `npm test`.
   No framework — this project has one runtime dependency and adding a test
   runner to check 1,700 lines of pure functions is not a trade worth making.

   Every regression test here corresponds to a defect that was actually found
   in this codebase, named so a failure says what broke rather than which
   assertion number failed. */

const assert = require("assert");

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; process.stdout.write("."); }
  catch (err) { fail++; failures.push({ name, err }); process.stdout.write("F"); }
}
async function testAsync(name, fn) {
  try { await fn(); pass++; process.stdout.write("."); }
  catch (err) { fail++; failures.push({ name, err }); process.stdout.write("F"); }
}

const T = require("../text");
const O = require("../engine/orchestrator");
const rag = require("../rag");
const knowledge = require("../knowledge");
const { detectContradictions } = require("../engine/contradictions");
const { buildReport } = require("../engine/report");

const RESUME = `Priya Sharma
priya.sharma@gmail.com | +91 98765 43210 | linkedin.com/in/priyasharma | github.com/priyasharma

EDUCATION
B.Tech Computer Science, VIT Vellore, 2021-2025, CGPA 8.7/10

EXPERIENCE
Software Engineering Intern, Zomato (May 2024 - Aug 2024)
- Built a Redis caching layer for the restaurant search API, reducing p95 latency by 40% (from 500ms to 300ms)
- Migrated 3 legacy endpoints to FastAPI, serving 12000 requests per second
- Wrote unit tests with pytest raising coverage from 45% to 82%

PROJECTS
ChurnGuard - Customer Churn Prediction
- Trained a Random Forest on 50000 telecom records achieving 91% accuracy
- Deployed with Docker and FastAPI on AWS EC2
DocuChat - RAG document assistant
- Built retrieval over 2000 PDFs using LangChain, FAISS and OpenAI embeddings

SKILLS
Python, SQL, FastAPI, Docker, AWS, Redis, PostgreSQL, scikit-learn, PyTorch, Git, Kafka`;

const JD = `Software Engineer - Backend (SDE-1)
Requirements: Strong Python, REST API design, PostgreSQL and query optimization,
Redis caching, Docker and Kubernetes, AWS, Kafka event streaming, system design, unit testing.`;

const claims = t => T.numericClaims(t).map(c => c.key + "=" + (+c.value.toFixed(2)));

/* ===================== number parsing ===================== */
/* Every case below produced a wrong answer before the parser was rebuilt. */

test("'5 minute' is a duration, not five million", () => {
  const c = T.numericClaims("a 5 minute TTL");
  assert.ok(!c.some(x => x.value >= 1e6), "the 'm' of minute was read as a million multiplier: " + JSON.stringify(c));
});

test("'300ms' is 300 milliseconds, not 300 million", () => {
  const c = T.numericClaims("latency was 300ms");
  assert.deepStrictEqual(claims("latency was 300ms"), ["latency=300"], JSON.stringify(c));
});

test("seconds normalise to milliseconds so 1.2s and 300ms compare", () => {
  assert.deepStrictEqual(claims("answer latency to 1.2s"), ["latency=1200"]);
});

test("p99 is a percentile label, not a latency of 99", () => {
  assert.deepStrictEqual(claims("I watch p99 query latency"), []);
});

test("big-O notation is not a quantity", () => {
  assert.deepStrictEqual(claims("it is O(1) average and O(n) worst case"), []);
});

test("'5-fold cross validation' is not a quantity", () => {
  assert.deepStrictEqual(claims("used 5-fold stratified cross-validation"), []);
});

test("a percentage delta is not a level", () => {
  assert.deepStrictEqual(claims("reducing p95 latency by 40%"), []);
});

test("version and port numbers are not quantities", () => {
  assert.deepStrictEqual(claims("Node 18 and Python 3.11 on port 8080"), []);
});

test("a date range is not a quantity", () => {
  assert.deepStrictEqual(claims("VIT Vellore, 2021-2025"), []);
});

test("an adjective between number and noun still parses", () => {
  assert.deepStrictEqual(claims("50000 telecom records"), ["dataset_size=50000"]);
});

test("different metrics get different keys", () => {
  const c = T.numericClaims("precision 0.72, recall 0.65, PR-AUC 0.78");
  const keys = c.map(x => x.key);
  assert.strictEqual(new Set(keys).size, 3, "precision/recall/auc collapsed into one key: " + keys.join(","));
});

/* ===================== contradictions ===================== */

test("two different metrics are never a contradiction", () => {
  const now = T.numericClaims("recall was 0.65").map(c => ({ ...c, context: "p" }));
  const prior = T.numericClaims("precision was 0.92").map(c => ({ ...c, context: "p" }));
  assert.deepStrictEqual(detectContradictions(now, prior), []);
});

test("claims about different projects are never a contradiction", () => {
  const a = [{ key: "dataset_size", value: 50000, context: "ChurnGuard" }];
  const b = [{ key: "dataset_size", value: 120, context: "DocuChat" }];
  assert.deepStrictEqual(detectContradictions(a, b), []);
});

test("rounding is not a contradiction", () => {
  const a = [{ key: "dataset_size", value: 50000, context: "x" }];
  const b = [{ key: "dataset_size", value: 52000, context: "x" }];
  assert.deepStrictEqual(detectContradictions(a, b), []);
});

test("a genuine order-of-magnitude disagreement IS raised", () => {
  const a = [{ key: "dataset_size", value: 1000000, context: "x" }];
  const b = [{ key: "dataset_size", value: 50000, context: "x" }];
  const out = detectContradictions(a, b);
  assert.strictEqual(out.length, 1);
  assert.ok(/million/.test(out[0].say), out[0].say);
});

/* ===================== knowledge corpus ===================== */

test("the corpus loads and is substantially larger than the HTML graph alone", () => {
  const s = knowledge.stats();
  assert.ok(s.topics >= 90, "expected 90+ topics, got " + s.topics);
  assert.ok(s.rubricPoints >= 300, "expected 300+ rubric points, got " + s.rubricPoints);
});

test("every topic id referenced by a skill actually exists", () => {
  const missing = [];
  for (const [skill, ids] of Object.entries(knowledge.SKILL_TOPICS))
    for (const id of ids) if (!knowledge.NODE[id]) missing.push(`${skill} -> ${id}`);
  assert.deepStrictEqual(missing, []);
});

test("every topic id referenced by a hook or misconception exists", () => {
  const bad = [
    ...knowledge.HOOKS.filter(h => h.topic && !knowledge.NODE[h.topic]).map(h => "hook:" + h.id),
    ...knowledge.MISCONCEPTIONS.filter(m => m.topic && !knowledge.NODE[m.topic]).map(m => "misc:" + m.topic),
  ];
  assert.deepStrictEqual(bad, []);
});

test("no topic is missing its rubric — the report grades against it", () => {
  const bare = knowledge.KG.filter(n => !n.rubric || !n.rubric.length).map(n => n.id);
  assert.deepStrictEqual(bare, []);
});

/* ===================== retrieval ===================== */

test("retrieval finds the right topic for a RAG answer", () => {
  const hits = rag.retrieveTopics("I chunked documents at 512 tokens and measured recall@5 with FAISS", { k: 3 });
  assert.ok(hits.some(h => /rag/.test(h.id)), hits.map(h => h.id).join(","));
});

test("retrieval finds the right topic for an idempotency answer", () => {
  const hits = rag.retrieveTopics("the payment request timed out so the client retried it", { k: 3 });
  assert.ok(hits.some(h => h.id === "sd-idempotency"), hits.map(h => h.id).join(","));
});

test("the resume index chunks a real resume and attributes claims to projects", () => {
  const ix = rag.buildResumeIndex(RESUME, {});
  assert.ok(ix.size >= 8, "expected 8+ chunks, got " + ix.size);
  const ctx = ix.contextFor("I added a Redis cache with a TTL and p95 dropped to 300ms");
  assert.ok(ctx && /zomato/i.test(ctx), "expected the Zomato role, got " + ctx);
});

/* ===================== the interview loop ===================== */

function runInterview(answers, opts = {}) {
  const s = O.createInterview({ resumeText: RESUME, jdText: JD, length: 10, name: "Priya Sharma", mode: "text", ...opts });
  O.start(s);
  for (const t of answers) { if (s.status !== "active") break; O.answer(s, t, { secs: 40 }); }
  return s;
}

test("a resume that is not a resume is rejected with a usable message", () => {
  assert.throws(() => O.createInterview({ resumeText: "hi" }), e => e.status === 422 && /resume/i.test(e.message));
});

test("an interview cannot be answered after it ends", () => {
  const s = runInterview(["hello there, I am a candidate with some experience"]);
  O.endInterview(s);
  assert.throws(() => O.answer(s, "more", {}), e => e.status === 409);
});

test("degenerate answers never throw", () => {
  const s = O.createInterview({ resumeText: RESUME, length: 6 });
  O.start(s);
  for (const v of ["", null, 42, {}, [], "a ".repeat(20000)]) {
    if (s.status !== "active") break;
    O.answer(s, v, {});
  }
  assert.ok(true);
});

test("REGRESSION: off-topic answers never lock the interview on one question", () => {
  // Before the fix, every redirect created a new question id, so the
  // "redirect once per question" guard reset each turn and the same question
  // was re-asked indefinitely.
  const s = runInterview(Array(8).fill("Let me tell you instead about something completely unrelated to that."));
  const texts = s.questions_asked.map(q => q.text);
  const counts = {};
  for (const t of texts) counts[t] = (counts[t] || 0) + 1;
  const worst = Math.max(...Object.values(counts));
  assert.ok(worst <= 2, `the same question was asked ${worst} times: ${Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]}`);
});

test("REGRESSION: a correct answer is not accused of contradicting the resume", () => {
  // "tree a bucket past 8 entries" used to parse as dataset_size=8 and collide
  // with the resume's 50,000 records.
  const s = runInterview([
    "I'm Priya, a final year CS student who interned at Zomato on the backend team.",
    "Hash table lookup is O(1) on average. You hash the key to a bucket and scan it. Java converts a bucket to a red-black tree past 8 entries, so the worst case is O(log n).",
  ]);
  const challenged = s.decisions.filter(d => d.action === "CHALLENGE");
  assert.deepStrictEqual(challenged.map(d => d.reason), [], "a false contradiction was raised");
});

test("the interview reaches later stages instead of stalling in one", () => {
  const s = runInterview([
    "I'm Priya, final year CS at VIT, I interned at Zomato on the search platform team.",
    "I owned the Redis caching layer. I profiled the endpoint, found repeated Postgres queries, cached them with a TTL and event invalidation, and p95 went from 500ms to 300ms measured with k6.",
    "Indexes speed reads and slow writes because every insert maintains the B+ tree, and they cost storage.",
    "A B+ tree keeps data in the leaves and links them so range scans are cheap; a hash index cannot do ranges at all.",
    "1NF is atomic values, 2NF removes partial dependencies, 3NF removes transitive dependencies between non-key columns.",
    "I test with many fast unit tests, fewer integration tests, and a small number of end-to-end tests in CI nightly.",
  ]);
  assert.ok(s.stage_turns && Object.keys(s.stage_turns).length >= 3,
    "only reached stages: " + JSON.stringify(s.stage_turns));
});

/* ===================== grading calibration ===================== */

const { analyzeAnswer } = require("../engine/analyzer");
const INTRO_Q = { text: "Introduce yourself.", kind: "intro", forceQualitative: true,
  rubric: ["Concise, under 90 seconds", "Narrative, not a list of sections", "Ends pointed at this role", "Specific over generic"] };
const BEH_Q = { text: "Tell me about a time you disagreed with someone.", kind: "behavioral", forceQualitative: true,
  rubric: ["A specific, real disagreement", "How it was resolved, not just who won", "What they would do differently"] };
const grade = (q, t) => analyzeAnswer({ question: q, text: t, secs: 45, turn: 1 });

test("REGRESSION: a good introduction is never OFF_TOPIC", () => {
  // An intro rubric describes qualities, not subject matter. Scoring it as
  // relevance made the opening answer of every interview trigger a redirect.
  const a = grade(INTRO_Q, "I'm Priya, final year CS at VIT. I interned at Zomato where I owned the Redis caching layer, profiling a slow search endpoint and cutting p95 from 500ms to 300ms. I want a backend role working on systems at real scale.");
  assert.notStrictEqual(a.primary, "OFF_TOPIC", "a correct introduction graded off-topic");
  assert.ok(a.answer_quality >= 5, "a strong intro scored only " + a.answer_quality);
});

test("a weak introduction still grades weak", () => {
  const a = grade(INTRO_Q, "um yeah so like stuff and things");
  assert.ok(a.answer_quality <= 3, "an empty intro scored " + a.answer_quality);
});

test("REGRESSION: a complete STAR story grades well", () => {
  const a = grade(BEH_Q, "At Zomato my mentor wanted a write-through cache and I thought TTL plus event invalidation was simpler. I wrote both up with their failure modes, we measured staleness on a shadow traffic replay, and the data showed TTL met our freshness requirement. In the end we went with TTL. I learned to argue with a measurement rather than an opinion.");
  assert.ok(a.answer_quality >= 5, "a complete STAR story scored only " + a.answer_quality + " (" + a.primary + ")");
});

test("a non-story answer to a behavioural question is still caught", () => {
  const a = grade(BEH_Q, "A B+ tree keeps data in the leaves so range scans are cheap.");
  assert.strictEqual(a.primary, "OFF_TOPIC");
});

test("a vague non-answer to a behavioural question grades low", () => {
  const a = grade(BEH_Q, "Yeah we disagreed about something once but it worked out fine in the end.");
  assert.ok(a.answer_quality <= 4, "a content-free story scored " + a.answer_quality);
});

test("a confidently wrong technical answer is marked incorrect", () => {
  const q = { text: "What is the complexity of a hash table lookup?", kind: "tech", topicId: "dsa-hash",
    rubric: knowledge.NODE["dsa-hash"].rubric };
  const a = grade(q, "Hash map lookup is O(log n) because it has to search the buckets in order.");
  assert.ok(a.incorrect.length > 0, "a textbook misconception was not flagged");
});

/* ===================== the report ===================== */

test("the report contains a score, axes, turns and a study plan", () => {
  const s = runInterview([
    "I'm Priya, final year CS at VIT, interned at Zomato on the backend platform team.",
    "I owned the Redis caching layer. Profiled it, found repeated Postgres queries, added a TTL cache with Kafka invalidation, p95 dropped 500ms to 300ms on k6.",
    "Indexes speed reads and slow writes; every insert maintains the B+ tree and costs storage.",
    "A B+ tree keeps data in leaves and links them, so range scans and ordering are cheap.",
    "1NF atomic, 2NF no partial dependency, 3NF no transitive dependency. It removes update and delete anomalies.",
    "Unit tests for logic, integration for the database layer, a few end-to-end in nightly CI.",
    "I disagreed with my mentor about write-through caching; we measured staleness on shadow traffic and the data settled it.",
  ]);
  const r = O.endInterview(s);
  assert.ok(r.overall && typeof r.overall.score === "number", "no overall score");
  assert.strictEqual(r.axes.length, 7, "expected 7 axes");
  assert.ok(r.turns.length >= 5, "expected per-question turns, got " + r.turns.length);
  assert.ok(r.study_plan.sevenDay.length > 0, "no 7-day plan");
  assert.ok(Array.isArray(r.jd_coverage), "no JD coverage");
});

test("ACCURACY: an axis with no evidence reports null, never zero", () => {
  const s = runInterview(["I'm Priya and I studied computer science at VIT in Vellore."]);
  const r = O.endInterview(s);
  const thin = r.axes.filter(a => a.n < 2);
  assert.ok(thin.length > 0, "expected some axes to lack evidence in a 1-answer interview");
  for (const a of thin) {
    assert.strictEqual(a.score, null, `${a.label} reported ${a.score} from only ${a.n} answers`);
    assert.strictEqual(a.confidence.level, "insufficient");
    assert.ok(a.reason, `${a.label} gave no reason for being unscored`);
  }
});

test("ACCURACY: a short interview is labelled provisional with a caveat", () => {
  const s = runInterview(["I'm Priya and I studied computer science at VIT."]);
  const r = O.endInterview(s);
  assert.strictEqual(r.overall.provisional, true);
  assert.ok(r.overall.caveat && /indicative/i.test(r.overall.caveat), "no honest caveat on a 1-answer report");
});

test("ACCURACY: every axis states how many answers it was computed from", () => {
  const s = runInterview([
    "I'm Priya, final year CS at VIT, interned at Zomato.",
    "I owned the caching layer; p95 went from 500ms to 300ms measured with k6.",
    "Indexes speed reads and slow writes because the B+ tree is maintained on every insert.",
  ]);
  const r = O.endInterview(s);
  for (const a of r.axes) {
    assert.ok(typeof a.n === "number", `${a.label} has no evidence count`);
    assert.ok(a.confidence && a.confidence.level, `${a.label} has no confidence band`);
  }
});

test("the overall score ignores unmeasured axes instead of averaging in zeros", () => {
  const s = runInterview([
    "I'm Priya, final year CS at VIT, interned at Zomato on the backend team.",
    "I owned the Redis cache. Profiled, found repeated queries, TTL plus event invalidation, p95 500ms to 300ms on k6.",
    "Indexes speed reads and slow writes; every insert maintains the B+ tree.",
  ]);
  const r = O.endInterview(s);
  const scored = r.axes.filter(a => a.score != null);
  if (scored.length && r.overall.score != null) {
    const lo = Math.min(...scored.map(a => a.score));
    const hi = Math.max(...scored.map(a => a.score));
    assert.ok(r.overall.score >= lo - 1 && r.overall.score <= hi + 1,
      `overall ${r.overall.score} sits outside the range of its own scored axes [${lo}, ${hi}]`);
  }
});

/* ===================== llm layer (no key required) ===================== */

(async () => {
  const llm = require("../llm/client");
  const { gradeAnswer } = require("../llm/grade");
  const { humanize } = require("../llm/converse");
  const { rerankTopics } = require("../llm/rerank");

  await testAsync("the LLM layer reports its own status honestly", () => {
    const s = llm.status();
    assert.strictEqual(typeof s.available, "boolean");
    if (!s.available) assert.ok(s.reason, "unavailable but gave no reason");
  });

  await testAsync("grading resolves to null rather than throwing when unavailable", async () => {
    if (llm.available()) return;                       // real call covered by the live test
    const out = await gradeAnswer({ question: { text: "q" }, answerText: "a real answer of some length here", grounding: { rubric: ["a point"] } });
    assert.strictEqual(out, null);
  });

  await testAsync("humanize resolves to null rather than throwing when unavailable", async () => {
    if (llm.available()) return;
    assert.strictEqual(await humanize({ questionText: "What is an index?" }), null);
  });

  await testAsync("rerank returns the input order when unavailable", async () => {
    if (llm.available()) return;
    const hits = [{ id: "a", score: 2 }, { id: "b", score: 1 }];
    assert.deepStrictEqual((await rerankTopics("q", hits)).map(h => h.id), ["a", "b"]);
  });

  await testAsync("answerAsync works with or without a key", async () => {
    const s = O.createInterview({ resumeText: RESUME, length: 6, mode: "text" });
    O.start(s);
    const turn = await O.answerAsync(s, "I'm Priya, I interned at Zomato on the backend platform team building a Redis caching layer.", { secs: 30 });
    assert.ok(turn.utterance, "no utterance returned");
    assert.ok(["rules", "llm"].includes(turn.graded_by));
  });

  /* ---- summary ---- */
  console.log("\n");
  for (const f of failures) {
    console.log(`FAIL: ${f.name}`);
    console.log(`      ${f.err.message.split("\n")[0]}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (!llm.available()) console.log("(LLM live paths skipped — no ANTHROPIC_API_KEY set)");
  process.exit(fail ? 1 : 0);
})();
