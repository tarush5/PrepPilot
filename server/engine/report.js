"use strict";
/* The performance report.

   The old `endInterview` returned the progress view and nothing else — no
   score, no axes, no per-question breakdown. This builds the real thing.

   The design principle here is that every number must be traceable to the
   evidence that produced it, and an axis with no evidence must say so rather
   than quietly reporting zero. That was the previous engine's worst analytics
   bug: an interview that never reached a system-design question still printed a
   confident Domain Fit score, and a candidate who answered two questions got a
   difficulty label of "Beginner" computed from two data points. A score built
   on one sample is not a score, and presenting it as one is the part that makes
   the whole report untrustworthy.

   So: every axis carries `n` (how many answers fed it) and a `confidence` band,
   axes below the evidence floor are returned as null, and the headline score is
   computed only from axes that actually have evidence — then explicitly labelled
   as provisional when the interview was too short to support it. */

const { NODE } = require("../knowledge");
const { clamp, uniq, trimTo } = require("../text");

/* Minimum graded answers before an axis is reportable at all. */
const MIN_EVIDENCE = 2;

const AXES = [
  { id: "technical",   label: "Technical",       weight: 0.26 },
  { id: "problem",     label: "Problem solving", weight: 0.16 },
  { id: "communication", label: "Communication", weight: 0.14 },
  { id: "confidence",  label: "Confidence",      weight: 0.08 },
  { id: "structure",   label: "Structure",       weight: 0.12 },
  { id: "domain",      label: "Domain fit",      weight: 0.12 },
  { id: "resume",      label: "Resume fit",      weight: 0.12 },
];

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = x => (x == null ? null : Math.round(x * 10) / 10);

/** Wider band on thin evidence — an honest statement of how much to trust it. */
function confidenceFor(n) {
  if (n >= 8) return { level: "high", margin: 4 };
  if (n >= 5) return { level: "moderate", margin: 8 };
  if (n >= MIN_EVIDENCE) return { level: "low", margin: 14 };
  return { level: "insufficient", margin: null };
}

/** One axis: score 0-100, the evidence count behind it, how much to trust it. */
function axis(values, { n = null } = {}) {
  const vals = values.filter(v => typeof v === "number" && isFinite(v));
  const count = n == null ? vals.length : n;
  if (!vals.length || count < MIN_EVIDENCE) {
    return { score: null, n: count, confidence: confidenceFor(count), reason: count === 0 ? "no answers covered this" : "not enough answers to score this fairly" };
  }
  const m = mean(vals);
  return { score: Math.round(clamp(m, 0, 100)), n: count, confidence: confidenceFor(count), reason: null };
}

/* ---------- axis computation ---------- */

/* A turn is technical evidence if it was a technical or project question, or
   if it landed on a syllabus topic regardless of how the question was typed —
   a candidate who explains indexing in response to a resume question has still
   demonstrated indexing, and the earlier version threw that evidence away. */
const isTechnical = g => g.kind === "tech" || g.kind === "project" || !!g.topicId;

function technicalAxis(graded) {
  return axis(graded.filter(isTechnical).map(g => g.quality * 10));
}

function problemAxis(graded) {
  // Reasoning shows up as structure words plus concrete specifics, and is
  // penalised by confident errors — guessing is not problem solving.
  const vals = graded.filter(isTechnical).map(g => {
    const s = g.signals || {};
    let v = g.quality * 10;
    v += clamp((s.discourse || 0) * 2.5, 0, 12);
    v += clamp((s.specifics || 0) * 2.5, 0, 12);
    v -= (g.errors || 0) * 9;
    return clamp(v, 0, 100);
  });
  return axis(vals);
}

function communicationAxis(graded) {
  const vals = graded.map(g => {
    const s = g.signals || {};
    const w = s.words || 0;
    let v = 62;
    v += clamp((s.discourse || 0) * 4, 0, 16);            // signposting
    v += w >= 60 && w <= 260 ? 10 : w < 25 ? -22 : w > 420 ? -12 : 0;
    v -= clamp((w ? (s.fillers || 0) / w : 0) * 260, 0, 20);
    v -= clamp((s.generic || 0) * 4, 0, 14);
    v += clamp(((s.variety || 0) - 0.45) * 40, -8, 8);
    return clamp(v, 0, 100);
  });
  return axis(vals);
}

function confidenceAxis(graded) {
  const vals = graded.map(g => {
    const s = g.signals || {};
    let v = (s.confidence != null ? s.confidence : 0.5) * 100;
    v -= clamp((s.hedges || 0) * 5, 0, 22);
    return clamp(v, 0, 100);
  });
  return axis(vals);
}

function structureAxis(graded) {
  // Did the answer land on the question, and did it get organised?
  const vals = graded.map(g => {
    const s = g.signals || {};
    let v = 58;
    if (g.onTopic === false) v -= 34;
    v += clamp((s.discourse || 0) * 5, 0, 22);
    v += (s.sentences || 0) >= 3 ? 8 : -6;
    if ((s.words || 0) > 400 && (s.discourse || 0) < 3) v -= 12;   // long and unstructured
    return clamp(v, 0, 100);
  });
  return axis(vals);
}

function domainAxis(state, graded) {
  // Breadth across the syllabus subjects the role actually requires.
  const bySubject = {};
  for (const g of graded) {
    if (!g.subject) continue;
    (bySubject[g.subject] ||= []).push(g.quality * 10);
  }
  const subjects = Object.keys(bySubject);
  if (!subjects.length) return { score: null, n: 0, confidence: confidenceFor(0), reason: "no technical topics were covered" };
  const perSubject = subjects.map(s => mean(bySubject[s]));
  const base = mean(perSubject);
  // A candidate strong in one subject and untested elsewhere is not a
  // demonstrated domain fit; breadth is part of the measure, so say so.
  const breadth = clamp(subjects.length / 4, 0.55, 1);
  return axis([clamp(base * breadth + (1 - breadth) * 22, 0, 100)], { n: graded.filter(g => g.subject).length });
}

function resumeAxis(state, graded) {
  // How well did they defend what they wrote? Only resume/project turns count.
  const own = graded.filter(g => g.kind === "project" || g.kind === "resume");
  if (own.length < MIN_EVIDENCE) return { score: null, n: own.length, confidence: confidenceFor(own.length), reason: "the interview didn't test the resume enough to score this" };
  const vals = own.map(g => {
    let v = g.quality * 10;
    if (g.contradicted) v -= 26;
    if ((g.signals?.specifics || 0) >= 2) v += 8;
    return clamp(v, 0, 100);
  });
  return axis(vals);
}

/* ---------- per-question breakdown ---------- */

function buildTurns(state) {
  return state.questions_asked.map(q => {
    const ans = state.answers.find(a => a.qid === q.id);
    if (!ans) return null;
    const a = ans.analysis || {};
    const node = q.topicId ? NODE[q.topicId] : null;
    const rubric = (q.rubric && q.rubric.length ? q.rubric : node?.rubric) || [];
    const hits = a.hits || [];
    const missed = (a.missing_concepts || []).slice(0, 3);
    return {
      qid: q.id,
      question: q.text,
      kind: q.kind,
      stage: q.stage,
      topic: node ? node.c : (q.kind === "project" ? "Your project work" : q.kind),
      subject: node ? node.s : null,
      difficulty: q.difficulty,
      answer: trimTo(ans.text, 600),
      words: a.signals?.words ?? null,
      seconds: ans.secs ?? null,
      quality: a.answer_quality ?? 0,
      verdict: a.primary || "UNGRADED",
      graded_by: a.graded_by || "rules",
      rubric,
      covered: hits,
      missed,
      errors: (a.incorrect || []).map(e => ({ correction: e.fix })),
      why: a.llm_reasoning || null,
      hint_used: !!q.hint_used,
    };
  }).filter(Boolean);
}

/* ---------- study plan ---------- */

function studyPlan(weakTopics, turns) {
  const seven = [], thirty = [];
  const ordered = weakTopics.slice(0, 6);
  ordered.slice(0, 3).forEach((t, i) => {
    const n = NODE[t.topicId];
    seven.push({
      day: `Day ${i * 2 + 1}-${i * 2 + 2}`,
      topic: t.concept,
      task: n
        ? `Write out ${n.rubric.slice(0, 2).map(r => r.toLowerCase()).join(" and ")} longhand, then say it aloud without notes.`
        : `Re-answer "${trimTo(t.concept, 60)}" out loud and record yourself.`,
      why: t.why,
    });
  });
  if (seven.length) seven.push({ day: "Day 7", topic: "Re-run", task: "Take this interview again at the same difficulty and compare the per-question scores.", why: "Measures whether the gaps actually closed." });

  ordered.forEach((t, i) => {
    const n = NODE[t.topicId];
    thirty.push({
      week: `Week ${Math.floor(i / 2) + 1}`,
      topic: t.concept,
      task: n ? `${n.s}: work ${n.c.toLowerCase()} until you can answer the probe "${trimTo((n.probes || [])[0] || "", 90)}" cold.` : `Build one small project that forces you to use ${t.concept}.`,
    });
  });
  return { sevenDay: seven, thirtyDay: thirty };
}

/* ---------- the report ---------- */

function buildReport(state, publicView) {
  const graded = state.answers
    .filter(a => a.analysis && a.analysis.primary !== "REQUEST")
    .map(a => {
      const q = state.questions_asked.find(x => x.id === a.qid) || {};
      const an = a.analysis || {};
      const node = q.topicId ? NODE[q.topicId] : null;
      return {
        qid: a.qid, kind: q.kind, subject: node?.s || null, topicId: q.topicId || null,
        concept: node?.c || null,
        quality: an.answer_quality ?? 0,
        signals: an.signals || {},
        errors: (an.incorrect || []).length,
        contradicted: (an.contradictions || []).length > 0,
        onTopic: an.primary !== "OFF_TOPIC",
      };
    });

  const n = graded.length;

  const axes = {
    technical: technicalAxis(graded),
    problem: problemAxis(graded),
    communication: communicationAxis(graded),
    confidence: confidenceAxis(graded),
    structure: structureAxis(graded),
    domain: domainAxis(state, graded),
    resume: resumeAxis(state, graded),
  };

  /* Headline score: weighted mean over axes that actually have evidence, with
     the weights renormalised across those. An axis we couldn't measure must not
     silently drag the total toward zero. */
  const scored = AXES.filter(a => axes[a.id].score != null);
  const wsum = scored.reduce((s, a) => s + a.weight, 0);
  const overall = wsum > 0
    ? Math.round(scored.reduce((s, a) => s + axes[a.id].score * a.weight, 0) / wsum)
    : null;

  /* Provisional means "do not compare this number to anything". A score built
     on a handful of answers, or on fewer than five of the seven dimensions, is
     not wrong so much as not yet meaningful — and saying so is the difference
     between an honest report and a confident-looking one. */
  const provisional = n < 6 || scored.length < 5;

  /* Delivery is measured across the whole interview, not per answer. */
  const words = graded.reduce((s, g) => s + (g.signals.words || 0), 0);
  const secs = graded.reduce((s, g) => s + (g.signals.secs || 0), 0);
  const delivery = {
    wpm: secs > 0 ? Math.round(words / (secs / 60)) : null,
    fillers: graded.reduce((s, g) => s + (g.signals.fillers || 0), 0),
    fillersPer100: words ? +((graded.reduce((s, g) => s + (g.signals.fillers || 0), 0) / words) * 100).toFixed(1) : null,
    hedges: graded.reduce((s, g) => s + (g.signals.hedges || 0), 0),
    avgAnswerWords: n ? Math.round(words / n) : 0,
    answers: n,
    totalWords: words,
  };

  /* Strengths and gaps, per topic, with the evidence attached. */
  const byTopic = {};
  for (const g of graded) {
    if (!g.topicId && !g.concept) continue;
    const key = g.topicId || g.concept;
    (byTopic[key] ||= { topicId: g.topicId, concept: g.concept || g.kind, subject: g.subject, scores: [], errors: 0 });
    byTopic[key].scores.push(g.quality);
    byTopic[key].errors += g.errors;
  }
  const topics = Object.values(byTopic).map(t => ({
    topicId: t.topicId, concept: t.concept, subject: t.subject,
    score: round1(mean(t.scores) / 2),                 // out of 5, as the UI shows
    outOf: 5, n: t.scores.length, errors: t.errors,
  }));
  const strengths = topics.filter(t => t.score >= 3.4).sort((a, b) => b.score - a.score).slice(0, 5);
  const weak = topics.filter(t => t.score < 3.4).sort((a, b) => a.score - b.score).slice(0, 6);

  const weakForPlan = weak.map(t => {
    const node = t.topicId ? NODE[t.topicId] : null;
    return {
      topicId: t.topicId, concept: t.concept, score: t.score,
      why: t.errors > 0 ? "You stated something incorrect here." : "The answer missed core rubric points.",
      rubric: node ? node.rubric : [],
    };
  });

  /* Subject-level rollup — what the history view aggregates on. */
  const bySubject = {};
  for (const g of graded) if (g.subject) (bySubject[g.subject] ||= []).push(g.quality);
  const subjects = Object.entries(bySubject)
    .map(([s, xs]) => ({ subject: s, score: round1(mean(xs) / 2), outOf: 5, n: xs.length }))
    .sort((a, b) => a.score - b.score);

  /* JD coverage — what the role needs vs what we actually saw. */
  const jd = (state.jd_matrix || []).map(r => ({
    skill: r.skill, importance: r.importance,
    resume: r.resume, interview: r.interview || null,
    tested: !!(r.interview_scores && r.interview_scores.length),
  }));

  return {
    ...publicView,
    generated_at: Date.now(),
    overall: {
      score: overall,
      outOf: 100,
      provisional,
      band: overall == null ? "not enough evidence"
        : overall >= 78 ? "strong" : overall >= 62 ? "solid" : overall >= 45 ? "developing" : "needs work",
      caveat: provisional
        ? `Based on ${n} graded ${n === 1 ? "answer" : "answers"} across ${scored.length} of 7 dimensions — treat this as indicative, not a verdict. Run a full-length interview for a score worth comparing.`
        : null,
      axesScored: scored.length, axesTotal: AXES.length,
    },
    axes: AXES.map(a => ({ id: a.id, label: a.label, weight: a.weight, ...axes[a.id] })),
    delivery,
    turns: buildTurns(state),
    strengths, weaknesses: weak, subjects,
    jd_coverage: jd,
    topics_covered: uniq(state.topics_covered).map(id => NODE[id]?.c).filter(Boolean),
    difficulty_path: (state.difficulty_history || []).map(d => ({ qid: d.qid, from: d.from, to: d.to, why: d.why })),
    decisions: (state.decisions || []).map(d => ({ qid: d.qid, action: d.action, reason: d.reason })),
    study_plan: studyPlan(weakForPlan, state.answers),
    graded_by: state.answers.some(a => a.analysis?.graded_by === "llm") ? "rules+llm" : "rules",
  };
}

module.exports = { buildReport, AXES, MIN_EVIDENCE };
