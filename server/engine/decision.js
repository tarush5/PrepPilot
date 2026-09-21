"use strict";
/* The decision engine — "what would a good human interviewer ask next?"
   Pure with respect to the state it's given: it reads the state and the
   latest analysis and returns a decision plus the next question to ask. The
   orchestrator owns all state changes. */
const { KG, HR_Q, NODE, SCENARIOS } = require("../knowledge");
const { hasTerm, clamp, pick, trimTo, shortPoint, lc1 } = require("../text");
const { nextProjectQuestion, ARCH } = require("../projects");
const { probePriority } = require("../jd");
const { Q } = require("./responder");

const STAGES = ["introduction", "resume_discussion", "technical_fundamentals", "technical_deep_dive", "project_deep_dive", "behavioral", "final_questions"];
const STAGE_LABEL = { introduction: "Introduction", resume_discussion: "Resume", technical_fundamentals: "Fundamentals",
  technical_deep_dive: "Deep dive", project_deep_dive: "Projects", behavioral: "Behavioral", final_questions: "Wrap-up" };

// how many follow-ups a thread may run before a person would move on
const MAX_DEPTH = { introduction: 1, resume_discussion: 2, technical_fundamentals: 2, technical_deep_dive: 3, project_deep_dive: 4, behavioral: 2, final_questions: 0 };

const ROLE_NODES = {
  "Machine Learning Engineer": ["ml-basics", "ml-overfit", "ml-eval", "dl-nn", "ml-deploy", "llm-core"],
  "AI Engineer": ["llm-core", "rag-core", "ml-eval", "dl-nlp", "ml-deploy", "sd-api"],
  "Data Scientist": ["ds-stats", "ml-basics", "ml-eval", "ml-feature", "db-sql"],
  "Data Analyst": ["db-sql", "ds-stats", "ml-feature"],
  "Full-Stack Developer": ["web-front", "web-back", "sd-api", "db-index"],
  "Backend Engineer": ["web-back", "sd-api", "sd-cache", "db-txn", "sd-queue"],
  "Frontend Engineer": ["web-front", "cn-http", "se-test"],
  "DevOps / Cloud Engineer": ["cloud-core", "sd-scale", "os-process", "sec-core"],
  "Cybersecurity Analyst": ["sec-core", "cn-tcp", "os-memory"],
  "QA / SDET": ["qa-core", "se-test", "sd-api"],
  "Embedded / IoT Engineer": ["iot-core", "coa-cache", "os-sched"],
  "Software Engineer (SDE-1)": ["dsa-hash", "dsa-graph", "sd-scale", "se-sdlc", "db-index"],
};
const CORE = ["dsa-complexity", "os-process", "db-index", "cn-tcp", "oop-core"];

/** Question budget per stage, from the total budget and the interview type. */
function planStages(total, type = "mixed") {
  const w = {
    mixed:      { introduction: 1, resume_discussion: 1.5, technical_fundamentals: 2, technical_deep_dive: 2, project_deep_dive: 2.5, behavioral: 1.5, final_questions: 1 },
    technical:  { introduction: 1, resume_discussion: 1, technical_fundamentals: 2.5, technical_deep_dive: 3, project_deep_dive: 2.5, behavioral: .8, final_questions: 1 },
    behavioral: { introduction: 1, resume_discussion: 2, technical_fundamentals: 0, technical_deep_dive: 0, project_deep_dive: 1.5, behavioral: 4, final_questions: 1 },
  }[type] || {};
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const quota = {};
  for (const s of STAGES) quota[s] = w[s] ? Math.max(1, Math.round(total * w[s] / sum)) : 0;
  quota.introduction = 1; quota.final_questions = 1;
  return quota;
}

/** Topics worth covering, in priority order: JD gaps, then resume, then role core. */
function buildTopicQueue({ role, resumeText, matrix }) {
  const score = {};
  const add = (id, s, reason) => { if (!NODE[id]) return; if (!score[id] || score[id].s < s) score[id] = { s, reason }; else score[id].s += s * .3; };
  for (const row of matrix || []) for (const t of row.topics) add(t, probePriority(row) * 2, `${row.importance} skill: ${row.skill} (${row.resume} on resume)`);
  const hay = " " + String(resumeText || "").toLowerCase() + " ";
  for (const n of KG) { const hits = n.keys.filter(k => hasTerm(hay, k)).length; if (hits) add(n.id, 1.5 + hits * .5, "on resume"); }
  for (const id of ROLE_NODES[role] || []) add(id, 2.2, "core to the role");
  for (const id of CORE) add(id, 1.2, "CS fundamentals");
  return Object.entries(score).sort((a, b) => b[1].s - a[1].s)
    .map(([id, v]) => ({ kind: "topic", id, priority: +v.s.toFixed(2), reason: v.reason, revisit: false }));
}

/** Pick an unasked topic that fits the stage and difficulty, spreading across subjects. */
function chooseTopic(state, { deep = false } = {}) {
  const covered = new Set(state.topics_covered);
  const subjSeen = {};
  for (const id of state.topics_covered) { const s = NODE[id]?.s; if (s) subjSeen[s] = (subjSeen[s] || 0) + 1; }
  const target = state.difficulty / 2;                    // graph difficulty is 1–5
  const strong = new Set(state.candidate_strengths.map(s => s.subject));
  let best = null;
  for (const t of state.topics_to_explore) {
    const n = NODE[t.id]; if (!n) continue;
    if (covered.has(t.id) && !t.revisit) continue;
    let s = t.priority;
    s -= Math.abs(n.d - target) * .8;
    s -= (subjSeen[n.s] || 0) * 1.4;                      // breadth before depth
    if (t.revisit) s += 2.5;
    if (deep && strong.has(n.s)) s += 1.2;                // deep-dive where they've shown strength
    if (!deep && n.d > 3 && state.difficulty < 6) s -= 1;
    if (!best || s > best.s) best = { t, n, s };
  }
  return best;
}

/** The question text for a graph topic at the current difficulty. */
function topicQuestion(state, n) {
  const used = new Set(state.questions_asked.map(q => q.text));
  const hard = state.difficulty >= n.d * 2 + 1.5;
  const pool = hard ? [...n.probes, ...n.q] : [...n.q, ...n.probes];
  return pool.find(q => !used.has(q)) || pool[0];
}

/**
 * Decide what to do after an answer.
 * Returns { action, reason, topic, difficulty, question_type, stage, next }
 * where `next` = { text, kind, rubric, topicText, thread?, lead?, reaction? }.
 */
function decide(state, a) {
  const cq = state.current_question;
  const th = state.thread;
  const stage = state.current_stage;
  const depth = state.follow_up_chain.length;
  const maxDepth = MAX_DEPTH[stage] ?? 2;
  const room = depth < maxDepth && !stageOverTime(state);
  const decision = (action, reason, next, extra = {}) => ({
    action, reason, topic: next?.topicId || cq?.topicId || state.current_topic || null,
    difficulty: state.difficulty, question_type: next?.kind || cq?.kind, stage: next?.stage || stage, next, ...extra,
  });
  const followUp = (text, extra = {}) => ({ text, kind: cq.kind === "intro" ? "resume" : cq.kind, rubric: extra.rubric || cq.rubric,
    topicText: cq.topicText, topicId: cq.topicId, followUp: true, stage, ...extra });

  // 0 · the clock always wins
  if (state.time_remaining <= 0 && stage !== "final_questions") return advance(state, "Time is up — moving to wrap-up.", "final_questions");

  // 1 · a contradiction is raised once, politely
  const con = (a.contradictions || []).find(c => !state.challenged.includes(c.key + ":" + (c.now.context || "")));
  if (con) return decision("CHALLENGE", `Candidate contradicted an earlier statement (${con.key}).`,
    followUp(con.say, { challengeKey: con.key + ":" + (con.now.context || ""), rubric: ["Explains the discrepancy clearly", "Gives the accurate figure and context"], forceQualitative: true }));

  // 2 · off-topic, evasive or rambling: bring them back — once per question
  if ((a.primary === "OFF_TOPIC" || a.primary === "RAMBLING") && !state.redirected.includes(cq.id))
    return decision("REDIRECT", a.primary === "RAMBLING" ? "Answer ran long without landing." : "Answer didn't address the question.",
      followUp(Q.redirectCore(cq.text), { redirectOf: cq.id, redirect: true }));

  // 3 · something wrong: diagnose the misunderstanding, and plan to revisit later
  if (a.incorrect?.length && room) {
    const m = a.incorrect[0];
    return decision("DIAGNOSE", `Incorrect statement: ${m.fix}`, followUp(m.probe, { rubric: [m.fix], revisitTopic: m.topic || cq.topicId }));
  }

  // 4 · vague: ask for something concrete, once per thread
  if (a.primary === "VAGUE" && room && !th?.vagueAsked)
    return decision("EXAMPLE", "Answer was general — asking for a concrete example.", followUp(null, { exampleRequest: true, markVague: true }));

  // 5 · stay on the thread while it's productive
  if (room && cq.kind !== "final") {
    const hook = (a.hooks || []).find(h => !state.hooks_used.includes(h.id));
    const good = a.answer_quality >= 7;
    const partial = a.answer_quality >= 4 && a.answer_quality < 7;

    if (th?.type === "project") {
      const nxt = nextProjectQuestion(th, a._text, state.difficulty + (good ? 1 : 0));
      if (hook && (a.primary === "CORRECT" || a.primary === "STRONG" || a.primary === "PARTIALLY_CORRECT"))
        return decision("FOLLOW_UP", `Candidate mentioned something worth exploring (${hook.id}).`, followUp(hook.q, { hookId: hook.id, projectNode: null }));
      if (partial && a.missing_concepts?.[0] && !th.clarified)
        return decision("CLARIFY", "Partial answer on the project — asking about the gap.", followUp(Q.clarify(a.missing_concepts[0]), { markClarified: true }));
      if (nxt) return decision(good ? "PROJECT_DEEP_DIVE" : "VERIFY_CLAIM",
        good ? "Strong on the project — going deeper into the design." : "Checking how well the candidate knows their own project.",
        followUp(nxt.q(th.label), { projectNode: nxt.id, rubric: [nxt.keys, "Explains their own decisions with specifics"] }));
    }

    if (good && hook)
      return decision("FOLLOW_UP", `Strong answer that opens a thread (${hook.id}).`, followUp(hook.q, { hookId: hook.id, lead: "deeper" }), { difficulty_change: +1 });

    if (a.primary === "STRONG" && cq.kind === "tech" && cq.topicId) {
      const n = NODE[cq.topicId];
      const used = new Set(state.questions_asked.map(q => q.text));
      const probe = n?.probes.find(p => !used.has(p));
      if (probe) return decision("DIFFICULTY_INCREASE", "Strong answer — raising the difficulty on the same topic.", followUp(probe, { lead: "deeper" }), { difficulty_change: +1 });
      if (!th?.scenario) return decision("FOLLOW_UP", "Strong answer — testing it against a production scenario.",
        followUp(SCENARIOS[n?.s] || SCENARIOS.default, { lead: null, markScenario: true, rubric: [...(cq.rubric || []), "Reasons about failure modes and tradeoffs in production"] }), { difficulty_change: +1 });
    }

    if (partial && a.missing_concepts?.[0] && !th?.clarified && cq.kind !== "behavioral")
      return decision("CLARIFY", "Partially correct — asking about the missing piece.", followUp(Q.clarify(a.missing_concepts[0]), { markClarified: true }));

    if (hook && a.categories?.includes("INTERESTING"))
      return decision("FOLLOW_UP", `Following up on something the candidate mentioned (${hook.id}).`, followUp(hook.q, { hookId: hook.id }));

    if (cq.kind === "behavioral" && depth < 2) {
      const used = th?.starAsked || [];
      const needs = !/\b(result|outcome|turned out|ended|measured|improved|reduced|increased)\b/i.test(a._text) ? 1
        : !/\bI\b/.test(a._text) ? 0 : 2;
      const q = Q.starFollow[needs];
      if (!used.includes(q)) return decision("FOLLOW_UP", "Behavioral answer is missing part of the story.", followUp(q, { starQ: q, rubric: cq.rubric }));
    }

    if (a.answer_quality < 4 && cq.kind === "tech" && !th?.basics && NODE[cq.topicId])
      return decision("DIFFICULTY_DECREASE", "Weak answer — checking the fundamentals of the same topic.",
        followUp(Q.basics(NODE[cq.topicId]), { markBasics: true, rubric: NODE[cq.topicId].rubric.slice(0, 2) }), { difficulty_change: -1 });
  }

  // 6 · thread is done: move on within the stage, or to the next stage
  return advance(state, a.answer_quality >= 7 ? "Thread explored — moving on." : "Enough signal on this — moving on.");
}

function stageOverTime(state) {
  const q = state.stage_quota[state.current_stage] || 1;
  return (state.stage_turns[state.current_stage] || 0) >= q + 2;
}

/** Leave the current thread: next item in this stage, or the next stage. */
function advance(state, reason, forceStage) {
  let stage = forceStage || state.current_stage;
  const used = state.stage_turns[stage] || 0;
  const lowTime = state.time_remaining < state.time_budget_sec * .15;
  if (!forceStage) {
    if (used >= (state.stage_quota[stage] || 0) || lowTime) stage = nextStage(state, stage, lowTime);
  }
  const next = firstQuestion(state, stage);
  if (!next) {
    // nothing left in that stage: keep advancing
    let s = stage;
    for (let i = 0; i < STAGES.length; i++) {
      s = nextStage(state, s, lowTime);
      const q = firstQuestion(state, s);
      if (q) return { action: q.action, reason: reason + ` (${s})`, topic: q.topicId || null, difficulty: state.difficulty, question_type: q.kind, stage: s, next: q, stageChanged: s !== state.current_stage };
      if (s === "final_questions") break;
    }
    return { action: "CONCLUDE", reason: "Nothing left to ask.", stage: "final_questions", next: null };
  }
  return { action: next.action, reason, topic: next.topicId || null, difficulty: state.difficulty, question_type: next.kind, stage, next, stageChanged: stage !== state.current_stage };
}

function nextStage(state, stage, lowTime) {
  if (stage === "final_questions") return "final_questions";
  if (lowTime && stage !== "behavioral" && (state.stage_quota.behavioral || 0) > 0 && !(state.stage_turns.behavioral > 0)) return "behavioral";
  if (lowTime) return "final_questions";
  let i = STAGES.indexOf(stage) + 1;
  while (i < STAGES.length - 1 && !(state.stage_quota[STAGES[i]] > 0)) i++;
  return STAGES[Math.min(i, STAGES.length - 1)];
}

/** The opening question of a stage (or of the next thread within it). */
function firstQuestion(state, stage) {
  const R = state.resume || {};
  switch (stage) {
    case "introduction":
      return { action: "NEW_TOPIC", kind: "intro", stage, text: Q.intro(), rubric: ["Concise, under 90 seconds", "Narrative, not a list of sections", "Ends pointed at this role", "Specific over generic"], forceQualitative: true };

    case "resume_discussion": {
      const done = new Set(state.experience_discussed);
      const exp = [...(R.internships || []), ...(R.experience || [])].find(e => !done.has(e.title));
      if (exp) return { action: "NEW_TOPIC", kind: "resume", stage, thread: { type: "resume", key: exp.title }, markExperience: exp.title,
        text: `I see ${exp.kind === "internship" || /intern/i.test(exp.title) ? "an internship" : "some experience"} on your resume — ${trimTo(exp.title, 70)}. What did you work on there, and what was your own contribution?`,
        rubric: ["Specific over generic", "Clear personal ownership", "Concrete outcome or metric"], forceQualitative: true, topicText: exp.bullets.join(" ") };
      const skills = (R.skills || []).slice(0, 6);
      if (skills.length >= 3 && !done.has("__skills")) return { action: "NEW_TOPIC", kind: "resume", stage, markExperience: "__skills",
        text: `You list ${skills.slice(0, 3).join(", ")} among your skills. Which of those have you used most deeply, and on what?`,
        rubric: ["Specific over generic", "Concrete evidence of depth"], forceQualitative: true, topicText: skills.join(" ") };
      if (R.education?.length && !done.has("__edu")) return { action: "NEW_TOPIC", kind: "resume", stage, markExperience: "__edu",
        text: "Tell me about your education — which courses or projects from it actually shaped how you work today?",
        rubric: ["Specific over generic", "Connects to the role"], forceQualitative: true };
      return null;
    }

    case "technical_fundamentals":
    case "technical_deep_dive": {
      const deep = stage === "technical_deep_dive";
      const pickT = chooseTopic(state, { deep });
      if (!pickT) return null;
      const n = pickT.n;
      return { action: pickT.t.revisit ? "REVISIT" : "NEW_TOPIC", kind: "tech", stage, topicId: n.id, text: topicQuestion(state, n),
        rubric: n.rubric, topicText: `${n.c} ${n.s}`, thread: { type: "topic", key: n.id }, revisit: pickT.t.revisit, why: pickT.t.reason };
    }

    case "project_deep_dive": {
      const done = new Set(state.projects_discussed);
      const claim = (R.claims || []).find(c => !done.has(c.project || c.text));
      if (!claim) return null;
      const label = claim.project && claim.project.length < 70 && claim.project !== trimTo(claim.text, 70)
        ? `the ${claim.project} project` : `your ${ARCH[claim.archetype]?.label || "project"} — "${trimTo(claim.text, 90)}"`;
      const thread = { type: "project", key: claim.project || claim.text, archetype: claim.archetype, label, asked: [], covered: [], context: "resume:" + (claim.project || claim.text) };
      const node = nextProjectQuestion(thread, "", state.difficulty);
      return { action: "PROJECT_DEEP_DIVE", kind: "project", stage, thread, projectNode: node.id, markProject: claim.project || claim.text,
        text: node.q(label), rubric: [node.keys, "Explains their own decisions with specifics"], topicText: claim.text };
    }

    case "behavioral": {
      const asked = new Set(state.hr_asked);
      const pool = HR_Q.filter(h => h.id !== "hr-intro" && !asked.has(h.id));
      if (!pool.length) return null;
      const pref = state.personality === "stress" ? ["hr-fail", "hr-pressure", "hr-weak"] : ["hr-conflict", "hr-hard", "hr-prod", "hr-fail"];
      const h = pool.find(x => pref.includes(x.id)) || pool[0];
      return { action: "NEW_TOPIC", kind: "behavioral", stage, markHr: h.id, text: h.q, rubric: h.rubric, forceQualitative: true, topicText: h.c, thread: { type: "behavioral", key: h.id } };
    }

    case "final_questions":
      if (state.final_step === 0) return { action: "CONCLUDE", kind: "final", stage, text: Q.highlight, rubric: [], finalStep: 1 };
      if (state.final_step === 1) return { action: "CONCLUDE", kind: "final", stage, text: Q.candidateQs, rubric: [], finalStep: 2 };
      return null;
  }
  return null;
}

module.exports = { STAGES, STAGE_LABEL, MAX_DEPTH, planStages, buildTopicQueue, chooseTopic, decide, advance, firstQuestion, ROLE_NODES };
