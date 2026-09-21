"use strict";
/* The interview orchestrator.
   Owns the interview state and runs every turn through the same loop:
     understand → evaluate → remember → reason about the next step → react.
   All functions here are synchronous and deterministic enough to unit-test;
   the LLM layer (service.js) can only enrich what this produces. */
const { analyzeResume } = require("../resume");
const { analyzeJD, coverageMatrix } = require("../jd");
const { NODE, SKILL_TOPICS } = require("../knowledge");
const { analyzeAnswer } = require("./analyzer");
const { initialDifficulty, updateDifficulty, LABEL } = require("./difficulty");
const { decide, advance, firstQuestion, planStages, buildTopicQueue, STAGES, STAGE_LABEL } = require("./decision");
const { Voice, PERSONALITIES, normalizePersonality, Q } = require("./responder");
const { coveredBy } = require("../projects");
const { clamp, trimTo, uniq, pick, shortPoint, lc1, uc1 } = require("../text");

const now = () => Date.now();

/* ---------- creation ---------- */
function createInterview({ resumeText, jdText, role = "Software Engineer (SDE-1)", personality = "professional", length = 10, type = "mixed", name, mode = "voice" }) {
  const resume = analyzeResume(resumeText);
  const jd = jdText ? analyzeJD(jdText) : null;
  const matrix = coverageMatrix(jd, resume);
  const p = normalizePersonality(personality);
  const total = clamp(Math.round(+length || 10), 4, 20);
  const minutes = clamp(Math.round(total * 1.7), 8, 40);
  const seniority = jd?.seniority || "entry";
  const candidateName = (name || resume.name || "").split(/\s+/)[0] || "";

  const state = {
    version: 1,
    status: "active",
    candidate_profile: { name: candidateName, full_name: name || resume.name || "", role, seniority, mode },
    resume, job_description: jd, jd_matrix: matrix,
    interview_type: ["technical", "behavioral", "mixed"].includes(type) ? type : "mixed",
    personality: p, interviewer_name: pick(PERSONALITIES[p].names),
    current_stage: "introduction",
    stage_quota: planStages(total, type), stage_turns: {},
    difficulty: initialDifficulty({ seniority, resume }), difficulty_history: [],
    questions_asked: [], answers: [],
    topics_covered: [], topics_to_explore: buildTopicQueue({ role, resumeText, matrix }),
    candidate_strengths: [], candidate_weaknesses: [], technical_gaps: [],
    communication_score: 0, confidence_score: 0,
    current_topic: "", previous_claims: [], follow_up_chain: [],
    time_budget_sec: minutes * 60, started_at: now(), paused_ms: 0, paused_at: null, time_remaining: minutes * 60,
    current_question: null, thread: null,
    hist: { streakGood: 0, streakBad: 0, mistakesBySubject: {} },
    challenged: [], redirected: [], scaffolded: [], hooks_used: [],
    projects_discussed: [], experience_discussed: [], hr_asked: [],
    candidate_questions: [], recent_lines: [], final_step: 0, total_budget: total,
    decisions: [],
  };
  return state;
}

const voiceOf = state => new Voice(state.personality, state.recent_lines);

function tick(state) {
  const paused = state.paused_ms + (state.paused_at ? now() - state.paused_at : 0);
  const elapsed = (now() - state.started_at - paused) / 1000;
  state.time_remaining = Math.round(state.time_budget_sec - elapsed);
  return elapsed;
}

/* ---------- asking ---------- */
function ask(state, q, { decision } = {}) {
  const id = "q" + (state.questions_asked.length + 1);
  const stageChanged = q.stage && q.stage !== state.current_stage;
  if (q.stage) state.current_stage = q.stage;
  state.stage_turns[state.current_stage] = (state.stage_turns[state.current_stage] || 0) + 1;

  if (q.followUp) {
    state.follow_up_chain.push(id);
    const th = state.thread || {};
    if (q.markVague) th.vagueAsked = true;
    if (q.markClarified) th.clarified = true;
    if (q.markBasics) th.basics = true;
    if (q.markScenario) th.scenario = true;
    if (q.starQ) (th.starAsked ||= []).push(q.starQ);
    if (q.projectNode) (th.asked ||= []).push(q.projectNode);
    if (q.hookId) state.hooks_used.push(q.hookId);
    if (q.challengeKey) state.challenged.push(q.challengeKey);
    if (q.redirectOf) state.redirected.push(q.redirectOf);
  } else {
    state.follow_up_chain = [];
    state.thread = q.thread ? { ...q.thread, asked: [...(q.thread.asked || [])], covered: [...(q.thread.covered || [])] } : null;
    if (q.projectNode && state.thread) state.thread.asked.push(q.projectNode);
    if (q.markProject) state.projects_discussed.push(q.markProject);
    if (q.markExperience) state.experience_discussed.push(q.markExperience);
    if (q.markHr) state.hr_asked.push(q.markHr);
    if (q.topicId) {
      state.topics_covered = uniq([...state.topics_covered, q.topicId]);
      const t = state.topics_to_explore.find(x => x.id === q.topicId); if (t) t.revisit = false;
    }
  }
  if (q.finalStep) state.final_step = q.finalStep;
  if (q.topicId) state.current_topic = q.topicId;
  else if (state.thread?.key) state.current_topic = state.thread.key;

  const question = {
    id, text: q.text, kind: q.kind, stage: state.current_stage, topicId: q.topicId || null, topicText: q.topicText || "",
    rubric: q.rubric || [], forceQualitative: !!q.forceQualitative, difficulty: state.difficulty,
    parent: q.followUp ? (state.current_question?.id || null) : null, action: decision?.action || q.action || "NEW_TOPIC",
    reason: decision?.reason || q.why || "", asked_at: now(), hint_used: false,
  };
  state.questions_asked.push(question);
  state.current_question = question;
  return { question, stageChanged };
}

/* ---------- the opening ---------- */
function start(state) {
  const v = voiceOf(state);
  const n = state.candidate_profile.name;
  const who = state.interviewer_name;
  const tech = state.interview_type !== "behavioral";
  const greet = {
    friendly: `Hi${n ? " " + n : ""}, it's lovely to meet you. I'm ${who}, and I'll be your interviewer today.`,
    stress: `${n ? n + ", " : ""}I'm ${who}. Let's get started — we have a lot to cover.`,
    faang: `Hi${n ? " " + n : ""}, thanks for joining. I'm ${who}; I'll be running your technical interview today.`,
  }[state.personality] || `Hi${n ? " " + n : ""}, thanks for joining. I'm ${who}, and I'll be conducting your interview today.`;
  const plan = tech ? "We'll start with a brief introduction and then move into your technical experience." : "We'll start with a brief introduction and then talk through your experience.";
  const q = firstQuestion(state, "introduction");
  const { question } = ask(state, q);
  const text = v.compose(greet, plan, question.text);
  return { utterance: text, question, cue: { face: "encouraging", gestures: ["browFlash", "smile"] } };
}

/* ---------- requests that aren't answers ---------- */
function rephrase(q) {
  if (q.kind === "tech" && q.topicId && NODE[q.topicId]) return `Put simply: explain ${NODE[q.topicId].c.toLowerCase()} in your own words, then give me one place you've used it, or would.`;
  if (q.kind === "project") return "What I'm after is how it actually worked — the decisions you made yourself, and why.";
  if (q.kind === "behavioral") return "What I'm looking for is one real situation — what happened, what you did yourself, and how it turned out.";
  if (q.kind === "intro") return "Just a short overview — where you're coming from, what you've built, and what you're looking for next.";
  return "Let me put it differently — " + lc1(q.text);
}
function hintFor(q) {
  const point = q.kind === "tech" && NODE[q.topicId] ? NODE[q.topicId].rubric.find(r => r.split(/\s+/).length > 2) : null;
  if (point) return `Here's a nudge — a good answer starts from ${lc1(shortPoint(point))}.`;
  if (q.kind === "project") return "Here's a nudge — say what you built yourself, give me one number, and name one decision you made.";
  return "Here's a nudge — pick one specific moment, tell me what you did, and finish with how it turned out.";
}

function handleRequest(state, intent, text) {
  const v = voiceOf(state), q = state.current_question;
  switch (intent) {
    case "repeat": return { utterance: v.compose(v.vary(["Sure.", "Of course.", "No problem."]), q.text), cue: { face: "neutral", gestures: ["microNod"] }, hold: true };
    case "clarify": return { utterance: v.compose(v.vary(["Sure.", "Of course —", "Good question."]), rephrase(q)), cue: { face: "encouraging", gestures: ["tilt"] }, hold: true, rephrase: true };
    case "time": return { utterance: v.vary(["Of course — take your time.", "Sure, no rush.", "Take a moment."]), cue: { face: "encouraging", gestures: ["smile"] }, hold: true, extendSilence: true };
    case "hint": q.hint_used = true; return { utterance: hintFor(q), cue: { face: "encouraging", gestures: ["tilt", "smile"] }, hold: true };
    case "nervous": return { utterance: v.vary(["That's completely normal. Take a breath — I'm not here to trip you up. Whenever you're ready.", "Totally understandable. There's no trick here; just talk me through what you know."]), cue: { face: "encouraging", gestures: ["smile"] }, hold: true };
    case "ask":
      state.candidate_questions.push(text);
      return { utterance: v.compose(v.vary(["Good question — let's save it for the end, I'll make time for it.", "Hold that thought — I'll leave time for your questions at the end."]), "So, back to it: " + trimTo(q.text, 150)), cue: { face: "encouraging", gestures: ["microNod"] }, hold: true };
    case "skip": return null;          // handled as a skipped answer
  }
  return null;
}

/* ---------- memory updates ---------- */
function remember(state, q, a, text, meta) {
  state.answers.push({ qid: q.id, text, secs: meta.secs || null, latency_ms: meta.latency || null, mode: meta.mode || null, at: now(), analysis: a });
  state.previous_claims.push(...(a.claims || []));
  const subject = q.topicId ? NODE[q.topicId]?.s : q.kind;
  const topicLabel = q.topicId ? NODE[q.topicId]?.c : q.kind === "project" ? (state.thread?.label || "project work") : q.kind;
  const quality = a.answer_quality ?? 0;

  if (quality >= 7) { state.hist.streakGood++; state.hist.streakBad = 0; }
  else if (quality < 4) { state.hist.streakBad++; state.hist.streakGood = 0; }
  else { state.hist.streakGood = 0; state.hist.streakBad = 0; }
  if (a.categories?.includes("INCORRECT") || quality < 4) state.hist.mistakesBySubject[subject] = (state.hist.mistakesBySubject[subject] || 0) + 1;

  const upsert = (list, item) => { const i = list.findIndex(x => x.topic === item.topic); i >= 0 ? (list[i] = { ...list[i], ...item, n: (list[i].n || 1) + 1 }) : list.push({ ...item, n: 1 }); };
  if (quality >= 7) upsert(state.candidate_strengths, { topic: topicLabel, subject, evidence: (a.strengths || [])[0] || "" });
  if (quality < 5) upsert(state.candidate_weaknesses, { topic: topicLabel, subject, missing: (a.missing_concepts || []).slice(0, 2) });
  for (const m of a.incorrect || []) state.technical_gaps.push({ topic: m.topic || q.topicId, fix: m.fix, qid: q.id });
  if (a.categories?.includes("INCORRECT") && (a.incorrect[0]?.topic || q.topicId)) {
    const id = a.incorrect[0]?.topic || q.topicId;
    const t = state.topics_to_explore.find(x => x.id === id);
    if (t) t.revisit = true; else state.topics_to_explore.push({ kind: "topic", id, priority: 2, reason: "revisit after incorrect answer", revisit: true });
  }

  // running averages the report reads
  const n = state.answers.length;
  state.communication_score = +(((state.communication_score * (n - 1)) + (a.clarity ?? 0)) / n).toFixed(2);
  state.confidence_score = +(((state.confidence_score * (n - 1)) + (a.confidence ?? 0)) / n).toFixed(2);

  // project threads: note what the answer already covered so we don't ask it again
  if (state.thread?.type === "project") state.thread.covered = uniq([...(state.thread.covered || []), ...coveredBy(state.thread, text)]);

  // interview evidence feeds the JD matrix
  for (const row of state.jd_matrix) {
    if (!q.topicId || !row.topics.includes(q.topicId)) continue;
    const prev = row.interview_scores || [];
    prev.push(quality);
    row.interview_scores = prev;
    const avg = prev.reduce((x, y) => x + y, 0) / prev.length;
    row.interview = avg >= 7 ? "Strong" : avg >= 5 ? "Medium" : "Weak";
  }

  const d = updateDifficulty(state.difficulty, a, state.hist, { subject, secs: meta.secs, words: a.signals?.words });
  state.difficulty_history.push({ qid: q.id, from: state.difficulty, to: d.d, why: d.why });
  state.difficulty = d.d;
}

/* ---------- a turn ---------- */
function answer(state, text, meta = {}) {
  if (state.status !== "active") throw Object.assign(new Error("This interview has already finished."), { status: 409 });
  tick(state);
  const q = state.current_question;
  const v = voiceOf(state);
  const context = state.thread?.context || state.thread?.key || q.topicId || null;
  const resumeMetrics = (state.resume.metrics || []).map(m => ({ ...m, context: "resume:" + (state.resume.claims.find(c => c.metrics.includes(m))?.project || "") }));
  const a = analyzeAnswer({
    question: q, text, secs: meta.secs, turn: state.answers.length + 1, context,
    history: state.answers.map(x => ({ text: x.text })), claims: state.previous_claims,
    resumeMetrics: resumeMetrics.map(m => ({ ...m, context: m.context === "resume:" ? null : m.context })),
  });
  a._text = text;

  // 1 · a request, not an answer
  if (a.primary === "REQUEST" && a.intent !== "skip") {
    const r = handleRequest(state, a.intent, text);
    return { ...r, question: q, analysis: a, decision: { action: "HANDLE_REQUEST", reason: `Candidate request: ${a.intent}` }, public: publicView(state) };
  }

  // 2 · "I don't know": help them reason once, then move on without penalty spiral
  if (a.primary === "DONT_KNOW" && !state.scaffolded.includes(q.id) && q.kind !== "final") {
    state.scaffolded.push(q.id);
    const scaffold = q.kind === "tech" && NODE[q.topicId]
      ? `That's alright — most people haven't met it head-on. Let's reason it out: if you had to guess, what problem do you think ${NODE[q.topicId].c.toLowerCase()} is there to solve?`
      : q.kind === "project" ? "Okay — then just tell me the part of it you do remember doing yourself."
      : "No problem — it doesn't have to be dramatic. Any small example from college or a project works.";
    return { utterance: scaffold, question: q, analysis: a, decision: { action: "CLARIFY", reason: "Candidate didn't know — offering a scaffold." }, cue: { face: "encouraging", gestures: ["smile"] }, public: publicView(state), hold: true };
  }

  // 3 · a real answer (or a skip): remember it
  const skipped = a.intent === "skip";
  remember(state, q, skipped ? { ...a, answer_quality: 0, categories: ["SKIPPED"], primary: "SKIPPED" } : a, skipped ? "(skipped)" : text, meta);

  // 4 · the closing exchange
  if (q.kind === "final") return finalTurn(state, q, text, v, a);

  // 5 · reason about the next step
  const decision = skipped ? advance(state, "Candidate asked to skip.") : decide(state, a);
  state.decisions.push({ qid: q.id, action: decision.action, reason: decision.reason, difficulty: state.difficulty, at: now() });
  if (!decision.next) return conclude(state, v, a);

  // 6 · phrase it the way a person would
  const next = decision.next;
  if (next.exampleRequest) next.text = v.t("example");
  const reaction = skipped ? v.vary(["Sure, let's move on.", "Okay — we'll leave that one."])
    : decision.action === "CHALLENGE" ? v.vary(["Hmm, let me check something.", "One moment —", ""])
    : decision.action === "REDIRECT" ? ""
    : v.react(reactionCategory(a, decision));
  let lead = "";
  if (decision.action === "REDIRECT") lead = v.t("redirect");
  else if (next.lead === "deeper") lead = v.t("deeper");
  else if (decision.stageChanged && next.stage) lead = v.t("stage." + next.stage);
  else if (decision.action === "REVISIT") lead = v.t("revisit");
  else if (!next.followUp && decision.action === "NEW_TOPIC" && state.follow_up_chain.length) lead = v.t("newTopic");
  const mention = !next.followUp ? memoryCallback(state, next, v) : "";

  const { question } = ask(state, next, { decision });
  const utterance = v.compose(reaction, lead, mention, question.text);
  return { utterance, question, analysis: a, decision, cue: cueFor(a, decision), public: publicView(state) };
}

function reactionCategory(a, d) {
  if (d.action === "DIAGNOSE") return "INCORRECT";
  if (d.action === "EXAMPLE") return "VAGUE";
  if (a.primary === "STRONG" || a.primary === "CORRECT") return a.primary;
  if (a.categories.includes("INTERESTING") && d.action === "FOLLOW_UP") return "INTERESTING";
  return a.primary;
}

/** "You mentioned Redis earlier —" when the next topic touches something already said. */
function memoryCallback(state, next, v) {
  if (next.kind !== "tech" || !next.topicId || state._callbacks >= 2) return "";
  const n = NODE[next.topicId]; if (!n) return "";
  const said = state.answers.map(x => x.text).join(" ").toLowerCase();
  const term = n.keys.find(k => k.length > 3 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(said));
  if (!term) return "";
  state._callbacks = (state._callbacks || 0) + 1;
  const pretty = term.length <= 4 ? term.toUpperCase() : uc1(term);
  return v.t("mention", pretty, n.c.toLowerCase()).replace(/How does that relate to .*\?$/, "").trim()
    || `You mentioned ${pretty} earlier —`;
}

function cueFor(a, d) {
  const g = [];
  let face = "neutral";
  if (a.primary === "STRONG") { face = "impressed"; g.push("nod", "smile"); }
  else if (a.primary === "CORRECT") { face = "encouraging"; g.push("nod"); }
  else if (a.primary === "PARTIALLY_CORRECT") { face = "curious"; g.push("microNod"); }
  if (d.action === "CHALLENGE") { face = "probing"; g.push("tilt", "leanIn"); }
  if (d.action === "DIAGNOSE" || d.action === "EXAMPLE") { face = "curious"; g.push("tilt"); }
  if (d.action === "REDIRECT") { face = "probing"; g.push("leanIn"); }
  if (d.action === "FOLLOW_UP" || d.action === "PROJECT_DEEP_DIVE" || d.action === "DIFFICULTY_INCREASE") g.push("leanIn");
  if (d.action === "DIFFICULTY_DECREASE") { face = "encouraging"; g.push("smile"); }
  return { face, gestures: uniq(g) };
}

/* ---------- the end ---------- */
function answerCandidateQuestion(q) {
  if (/feedback|how did i do|how was i|perform|improve/i.test(q)) return "I'll leave the detail to your report, which is ready in a moment — it breaks down every answer.";
  if (/day.to.day|work on|typical day|stack|first (90|ninety)/i.test(q)) return "Asking about the day-to-day is smart. In a real interview, push for what a new hire actually ships in their first ninety days.";
  if (/team|culture|people|work with|environment/i.test(q)) return "That's a great one to ask for real. Listen for specifics — how code review works, who you'd pair with — not just \"we're like a family\".";
  if (/grow|learn|mentor|career|promot/i.test(q)) return "Good question. In a real interview, a strong answer names a concrete path — mentorship, rotations, or how promotions actually get decided.";
  if (/next|process|hear back|when|timeline/i.test(q)) return "Always worth asking. Here, your next step is the full report — it's ready in a moment.";
  return "That's a thoughtful question — the kind that makes a candidate memorable. In a real interview, ask it just like that.";
}

function finalTurn(state, q, text, v, a) {
  const noQs = /^(no|nope|nothing|not really|none|i'?m good|that'?s (all|it)|no questions|i think i'?m good)\b/i.test(text.trim());
  if (state.final_step === 1) {
    const ack = noQs || a.signals.words < 6 ? "No problem." : v.vary(["Thanks — that's useful to know.", "Good, I'll make a note of that.", "Thank you for sharing that."]);
    const pending = state.candidate_questions[0];
    const next = pending
      ? { action: "CONCLUDE", kind: "final", stage: "final_questions", text: `Earlier you asked: "${trimTo(pending, 90)}". ${answerCandidateQuestion(pending)} Anything else you'd like to ask me?`, rubric: [], finalStep: 2 }
      : firstQuestion(state, "final_questions");
    const { question } = ask(state, next);
    return { utterance: v.compose(ack, question.text), question, analysis: a, decision: { action: "CONCLUDE", reason: "Wrap-up: inviting candidate questions." }, cue: { face: "encouraging", gestures: ["smile"] }, public: publicView(state) };
  }
  const reply = noQs || a.signals.words < 4 ? "No problem at all." : answerCandidateQuestion(text);
  return conclude(state, v, a, reply);
}

function conclude(state, v, a, prefix = "") {
  state.status = "completed";
  state.completed_at = now();
  state.current_stage = "final_questions";
  const n = state.candidate_profile.name;
  const close = {
    friendly: `That's everything from me. Thank you so much for your time today${n ? ", " + n : ""} — I really enjoyed this. Your full report is ready now.`,
    stress: `That's all. Thank you${n ? ", " + n : ""}. Your report is ready.`,
  }[state.personality] || `That's all from my side. Thank you for your time today${n ? ", " + n : ""} — your full report is ready now.`;
  return { utterance: v.compose(prefix, close), question: null, analysis: a, decision: { action: "CONCLUDE", reason: "Interview complete." }, cue: { face: "encouraging", gestures: ["smile", "nod"] }, public: publicView(state), done: true };
}

/** End early (candidate left, or pressed End). */
function endInterview(state) {
  if (state.status === "active") { state.status = "completed"; state.completed_at = now(); state.ended_early = true; }
  return publicView(state);
}

function pause(state, on) {
  if (on && !state.paused_at) state.paused_at = now();
  if (!on && state.paused_at) { state.paused_ms += now() - state.paused_at; state.paused_at = null; }
  tick(state);
  return publicView(state);
}

/* ---------- what the candidate is allowed to see ---------- */
function publicView(state) {
  tick(state);
  const idx = STAGES.indexOf(state.current_stage);
  const stages = STAGES.filter(s => (state.stage_quota[s] || 0) > 0).map(s => ({
    id: s, label: STAGE_LABEL[s],
    status: state.status === "completed" ? "done" : STAGES.indexOf(s) < idx ? "done" : s === state.current_stage ? "current" : "pending",
  }));
  const elapsed = Math.max(0, state.time_budget_sec - state.time_remaining);
  const stageProgress = stages.filter(s => s.status === "done").length / Math.max(stages.length, 1);
  const timeProgress = elapsed / state.time_budget_sec;
  return {
    status: state.status,
    stage: state.current_stage, stage_label: STAGE_LABEL[state.current_stage], stages,
    progress: state.status === "completed" ? 100 : Math.round(clamp(Math.max(stageProgress, timeProgress * .9), 0, .99) * 100),
    difficulty_label: LABEL(state.difficulty),
    elapsed_sec: Math.round(elapsed), remaining_sec: Math.max(0, state.time_remaining), budget_sec: state.time_budget_sec,
    questions: state.questions_asked.length,
    interviewer_name: state.interviewer_name, personality: PERSONALITIES[state.personality].label,
    candidate_name: state.candidate_profile.name, paused: !!state.paused_at,
    current_question: state.current_question ? { id: state.current_question.id, text: state.current_question.text, kind: state.current_question.kind } : null,
  };
}

/** Compressed memory for the LLM — never the whole transcript. */
function memorySummary(state, lastN = 3) {
  const R = state.resume;
  const lines = [];
  lines.push(`Candidate: ${state.candidate_profile.full_name || "unknown"}, applying for ${state.candidate_profile.role} (${state.candidate_profile.seniority}).`);
  if (R.skills.length) lines.push(`Resume skills: ${R.skills.slice(0, 14).join(", ")}.`);
  if (R.claims.length) lines.push(`Key resume claims: ${R.claims.slice(0, 4).map(c => `"${trimTo(c.text, 110)}"`).join("; ")}.`);
  if (state.jd_matrix.length) lines.push(`JD coverage: ${state.jd_matrix.slice(0, 10).map(r => `${r.skill}=${r.interview || r.resume}`).join(", ")}.`);
  if (state.candidate_strengths.length) lines.push(`Strong so far: ${state.candidate_strengths.map(s => s.topic).slice(0, 5).join(", ")}.`);
  if (state.candidate_weaknesses.length) lines.push(`Weak so far: ${state.candidate_weaknesses.map(s => s.topic).slice(0, 5).join(", ")}.`);
  if (state.technical_gaps.length) lines.push(`Misconceptions shown: ${state.technical_gaps.slice(-3).map(g => g.fix).join(" | ")}.`);
  const claims = state.previous_claims.filter(c => c.key !== "ownership" && !c.key.startsWith("never_used")).slice(-5);
  if (claims.length) lines.push(`Claims made: ${claims.map(c => `"${trimTo(c.quote, 70)}"`).join("; ")}.`);
  lines.push(`Topics covered: ${state.topics_covered.map(id => NODE[id]?.c).filter(Boolean).join(", ") || "none yet"}.`);
  lines.push(`Stage: ${STAGE_LABEL[state.current_stage]}. Difficulty ${state.difficulty}/10 (${LABEL(state.difficulty)}). ${Math.max(0, Math.round(state.time_remaining / 60))} min left.`);
  const recent = state.answers.slice(-lastN).map(x => {
    const q = state.questions_asked.find(qq => qq.id === x.qid);
    return `Q: ${trimTo(q?.text || "", 180)}\nA: ${trimTo(x.text, 360)}`;
  });
  return lines.join("\n") + (recent.length ? `\n\nRecent exchange:\n${recent.join("\n---\n")}` : "");
}

module.exports = { createInterview, start, answer, endInterview, pause, publicView, memorySummary, rephrase, hintFor, answerCandidateQuestion };
