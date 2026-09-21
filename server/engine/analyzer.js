"use strict";
/* Answer analysis — the "understand" step.
   Produces the structured, internal-only judgement of one answer. Nothing
   here is ever sent to the candidate during the interview. */
const { HOOKS, MISCONCEPTIONS } = require("../knowledge");
const T = require("../text");
const { detectContradictions } = require("./contradictions");

/* --------- requests that are not answers --------- */
const INTENTS = [
  ["repeat",   /\b(repeat (that|the question|it)|say (that|it) again|come again|pardon( me)?|didn'?t (catch|hear) (that|it|you)|one more time)\b/i],
  ["clarify",  /\b(what do you mean|could you clarify|can you clarify|not sure what you('re| are) asking|rephrase|do you mean|what exactly (do|are) you|in what sense|elaborate on the question)\b/i],
  ["hint",     /\b(hint|clue|a nudge|help me (get )?start(ed)?)\b/i],
  ["skip",     /^(can we |could we |let'?s |i'?d like to |i want to )?(skip|pass)\b|\bnext question\b|\bcan we move on\b/i],
  ["time",     /\b(give me a (moment|second|minute|sec)|let me think|one (moment|second|sec)|just a (moment|second|sec)|hold on|need a (moment|second|minute))\b/i],
  ["dontknow", /\b(i (really |honestly )?(don'?t|do not) know|no idea|not sure about (this|that)|i'?m not familiar|never (used|worked with|heard of)|i haven'?t (used|worked|done))\b/i],
  ["nervous",  /\b(i'?m (so |a (bit|little) |really |quite )?(nervous|anxious)|my mind (went|is|has gone) blank|i'?m blanking)\b/i],
];
function classifyIntent(text) {
  const t = String(text || "").trim();
  const words = T.wordCount(t);
  for (const [name, re] of INTENTS) {
    if (words > (name === "dontknow" ? 30 : 22) || !re.test(t)) continue;
    // "Let me think — an index is a B-tree…" is an answer, not a stall
    if (T.contentTokens(t.replace(re, " ")).length < 5) return name;
  }
  if (words <= 25 && /\?\s*$/.test(t) && /\b(you|your|the team|the role|this role|company|work here|day to day|expect|culture)\b/i.test(t)) return "ask";
  return null;
}

/* --------- qualitative rubric points --------- */
const QUALITY_WORDS = new Set(("concise brief short under seconds minutes narrative story list sections structure structured star specific concrete evidence example honest genuine real owns own ownership personal clear aware awareness self reflects reflection tone committed sought seeking prioritisation prioritization tradeoff explicit named communicated stakeholders changed behaviour behavior afterwards plan method sources applied directed motivated pointed ends generic humblebrag ego substance corrective action impact role roles disagreed decided ended shows showing baseline topic reason reasons choices past research researched flattery not nobody measurable outcome genuinely diagnosed").split(" ").map(T.stem));
const domainTokens = p => T.contentTokens(p).filter(t => !QUALITY_WORDS.has(t) && !/^\d+$/.test(t));
const isQualitative = p => domainTokens(p).length < 2;
const PROBES = [
  { test: /concise|under \d+|brief|short/i, score: s => s.words >= 35 && s.words <= 170 ? 1 : s.words < 35 ? .2 : .45 },
  { test: /narrative|story|star|structur/i, score: s => T.clamp(s.discourse / 3, 0, 1) },
  { test: /specific|concrete|evidence|example|number|measur|quantif|outcome/i, score: (s, a) => T.clamp(s.specifics / 3, 0, 1) * .7 + (/\b(for example|specifically|in my case|such as|namely)\b/i.test(a) ? .3 : 0) },
  { test: /own|personal|i did|responsib|corrective|action/i, score: (s, a) => (/\b(I|my)\b/.test(a) ? .45 : 0) + (/\bI (built|wrote|designed|implemented|led|owned|fixed|added|rewrote|chose|decided|profiled|found)\b/i.test(a) ? .55 : 0) },
  { test: /honest|real|genuine|aware|weakness|humblebrag/i, score: (s, a) => /\b(honestly|weakest|I haven'?t|I don'?t|not yet|struggl|failed|didn'?t work|mistake|wrong)\b/i.test(a) ? 1 : .3 },
  { test: /tradeoff|prioritis|prioritiz|cut|decision/i, score: (s, a) => /\b(tradeoff|trade-off|instead of|rather than|I cut|chose|decided|because|versus|vs\b)\b/i.test(a) ? 1 : .25 },
  { test: /role|pointed|motivat|research|why/i, score: (s, a) => /\b(this role|that'?s why|which is why|I'?m aiming|I want to|drew me|pushed me)\b/i.test(a) ? 1 : .3 },
  { test: /communicat|stakeholder|team|disagree|committed/i, score: (s, a) => /\b(I told|I asked|we agreed|the team|my teammate|stakeholder|manager|flagged|raised it)\b/i.test(a) ? 1 : .3 },
  { test: /diagnos|shift|monitor|baseline|data/i, score: (s, a) => /\b(check(ed)?|compar(e|ed)|monitor|distribution|drift|baseline|logs?|profil)\b/i.test(a) ? 1 : .25 },
  { test: /break|fail|load|limit|scale|bottleneck/i, score: (s, a) => /\b(break|fail|bottleneck|saturat|run out|ceiling|limit|times the load|under load|scal(e|es|ing))\b/i.test(a) ? 1 : .25 },
];
function scoreQualitative(point, answer, sig) {
  const hits = PROBES.filter(p => p.test.test(point));
  if (!hits.length) return T.clamp(sig.words / 90, 0, 1) * .6 + T.clamp(sig.discourse / 3, 0, 1) * .4;
  return hits.reduce((a, p) => a + T.clamp(p.score(sig, answer), 0, 1), 0) / hits.length;
}

/**
 * Analyse one answer against the question it answers.
 * question: { text, kind, rubric[], topicText, forceQualitative }
 * history:  prior answers [{ text, turn }] for repetition checks
 */
function analyzeAnswer({ question, text, secs, history = [], claims = [], resumeMetrics = [], turn = 0, context = null }) {
  const answer = String(text || "").trim();
  const sig = T.speechSignals(answer, secs);
  const intent = classifyIntent(answer);
  const base = { intent, signals: sig, categories: [], claims: [], hooks: [], incorrect: [], contradictions: [], hits: [], missing_concepts: [], strengths: [] };
  if (intent && intent !== "dontknow") return { ...base, primary: "REQUEST", recommended_next_action: "handle_request" };

  const ansTok = T.contentTokens(answer);
  const rubric = question.rubric || [];

  if (intent === "dontknow" || ansTok.length < 3 || sig.words < 5) {
    return {
      ...base, primary: intent === "dontknow" ? "DONT_KNOW" : "INCOMPLETE",
      categories: [intent === "dontknow" ? "DONT_KNOW" : "INCOMPLETE", "WEAK"],
      answer_quality: 0, technical_accuracy: 0, depth: 0, clarity: sig.words ? 2 : 0, confidence: intent ? 3 : 1, relevance: intent ? 5 : 0,
      missing_concepts: rubric.slice(0, 3), recommended_next_action: intent === "dontknow" ? "scaffold" : "clarify",
      diag: { cover: 0, onTopic: 0, repeat: 0, tooShort: true },
    };
  }

  // 1 · rubric coverage — topical points by vocabulary, qualities by proxy
  const perPoint = rubric.map(r => {
    if (question.forceQualitative || isQualitative(r)) { const cov = scoreQualitative(r, answer, sig); return { point: r, cov, hit: cov >= .5, q: true }; }
    const cov = T.coverage(domainTokens(r), ansTok);
    return { point: r, cov, hit: cov >= .34 };
  });
  const cover = perPoint.length ? perPoint.filter(p => p.hit).length / perPoint.length : .45;

  // 2 · relevance to the question actually asked
  let onTopic;
  if (question.kind === "behavioral" || question.kind === "intro" || question.kind === "final") {
    onTopic = T.clamp(cover * .75 + T.clamp(sig.words / 70, 0, 1) * .25, 0, 1);
  } else {
    const qTok = domainTokens(question.text || "");
    const topicTok = domainTokens((question.topicText || "") + " " + rubric.join(" "));
    onTopic = T.clamp(Math.max(T.coverage(qTok, ansTok) * 1.15, T.coverage(topicTok, ansTok) * 1.3, cover), 0, 1);
  }

  // 3 · repetition — reusing an earlier answer engages nothing new
  let repeat = 0;
  for (const h of history) repeat = Math.max(repeat, T.similarity(ansTok, T.contentTokens(h.text)));
  const repeated = repeat > .72;

  // 4 · shape
  const tooShort = sig.words < 14;
  const rambling = sig.words > 230 || (sig.words > 160 && sig.variety < .42);
  const vague = sig.specifics === 0 && sig.generic >= 1 && cover < .6 || (sig.specifics === 0 && sig.words > 25 && cover < .45 && question.kind !== "intro");
  const lenScore = T.clamp(sig.words / 85, 0, 1);

  // 5 · things that are simply wrong
  const incorrect = MISCONCEPTIONS.filter(m => m.re.test(answer)).map(m => ({ fix: m.fix, probe: m.probe, topic: m.topic }));

  // 6 · claims and contradictions against everything said so far
  const newClaims = T.numericClaims(answer).map(c => ({ ...c, turn, context, source: "answer" }));
  const ownership = /\b(i (built|did|worked on) (it|this|that|everything) (alone|by myself|solo)|on my own|single.handedly|solo project)\b/i.test(answer) ? "alone"
    : /\b(my teammates?|our team|team of \d+|we split|my (co.?founder|partner))\b/i.test(answer) ? "team" : null;
  if (ownership) newClaims.push({ key: "ownership", value: ownership, turn, context, quote: T.trimTo(answer, 120), source: "answer" });
  // tool usage is a fact about the person, not the project — no context
  for (const m of answer.matchAll(/\b(?:i(?:'ve| have)? never (?:used|worked with|touched))\s+([a-z0-9.+#-]+)/gi))
    newClaims.push({ key: "never_used:" + m[1].toLowerCase(), value: false, turn, context: null, quote: m[0], source: "answer" });
  for (const m of answer.matchAll(/\b(?:i|we) (?:used|built with|worked with|deployed (?:on|with)|wrote it in)\s+([a-z0-9.+#-]+)/gi))
    newClaims.push({ key: "never_used:" + m[1].toLowerCase(), value: true, turn, context: null, quote: m[0], source: "answer" });
  const contradictions = detectContradictions(newClaims, claims, resumeMetrics);

  // 7 · what's worth following up on
  const ctx = { text: answer, context: (question.text || "") + " " + answer + " " + (question.topicText || ""),
    problem: (answer.match(/\b(churn|fraud|spam|default|disease|anomaly|sentiment)\b/i) || [])[1],
    number: (answer.match(/\b\d[\d,.]*\s?(%|x\b|rps|qps|ms|requests per second|users)/i) || [])[0] };
  const hooks = HOOKS.filter(h => h.re.test(answer) && !(h.unless && h.unless.test(answer)) && (!h.when || h.when(ctx)))
    .map(h => ({ id: h.id, topic: h.topic, level: h.level, q: typeof h.q === "function" ? h.q(ctx) : h.q }));

  // 8 · scores, 0–10, with the penalties that matter
  const offPen = onTopic < .25 ? .75 : onTopic < .45 ? .4 : 0;
  const repPen = repeated ? .6 : repeat > .55 ? .25 : 0;
  const cut = v => T.clamp(v * (1 - offPen) * (1 - repPen), 0, 1);
  const s10 = v => Math.round(T.clamp(v, 0, 1) * 10);
  const specific = T.clamp(sig.specifics / 4, 0, 1);
  const structured = T.clamp(sig.discourse / 3, 0, 1);
  const wrongPen = incorrect.length ? .45 : 0;

  const technical_accuracy = s10(cut((cover * .8 + specific * .2) * (1 - wrongPen)));
  const depth = s10(cut(cover * .45 + lenScore * .25 + specific * .3));
  const clarity = s10(T.clamp((structured * .45 + lenScore * .25 + (tooShort ? 0 : .15) + .15 - (rambling ? .3 : 0)) * (repeated ? .55 : 1)
    - T.clamp(sig.fillers / Math.max(sig.words, 1) * 6, 0, .3), 0, 1));
  const confidence = s10(sig.confidence);
  const relevance = s10(onTopic * (repeated ? .45 : 1));
  const answer_quality = Math.round((technical_accuracy * .35 + depth * .25 + clarity * .15 + relevance * .25));

  // 9 · categories
  const cats = new Set();
  if (contradictions.length) cats.add("CONTRADICTORY");
  if (incorrect.length) cats.add("INCORRECT");
  if (onTopic < .25 || repeated) cats.add("OFF_TOPIC");
  if (rambling) cats.add("RAMBLING");
  if (vague && !incorrect.length) cats.add("VAGUE");
  if (answer_quality >= 8 && !incorrect.length) { cats.add("STRONG"); cats.add("CORRECT"); }
  else if (answer_quality >= 6 && !incorrect.length) cats.add(cover >= .7 ? "CORRECT" : "PARTIALLY_CORRECT");
  else if (answer_quality >= 4) { cats.add("PARTIALLY_CORRECT"); if (cover < .6) cats.add("INCOMPLETE"); }
  else cats.add("WEAK");
  if (tooShort) cats.add("INCOMPLETE");
  if (hooks.length || newClaims.some(c => c.source === "answer" && c.key !== "ownership")) cats.add("INTERESTING");
  if (answer_quality >= 7 && hooks.length) cats.add("NEEDS_DEEPER_EXPLORATION");

  const order = ["CONTRADICTORY", "INCORRECT", "OFF_TOPIC", "RAMBLING", "VAGUE", "STRONG", "CORRECT", "PARTIALLY_CORRECT", "INCOMPLETE", "WEAK"];
  const primary = order.find(c => cats.has(c)) || "PARTIALLY_CORRECT";

  const missing = perPoint.filter(p => !p.hit).sort((a, b) => a.cov - b.cov).map(p => p.point).slice(0, 3);
  const hits = perPoint.filter(p => p.hit && !p.q).sort((a, b) => b.cov - a.cov).map(p => p.point);
  const strengths = [];
  if (hits.length) strengths.push(`Covered: ${T.shortPoint(hits[0]).toLowerCase()}`);
  if (sig.specifics >= 2) strengths.push("Grounded in concrete numbers or tools");
  if (sig.discourse >= 3) strengths.push("Well structured");
  if (/\bI (built|designed|implemented|chose|decided|led)\b/.test(answer)) strengths.push("Clear personal ownership");

  const recommended_next_action = {
    CONTRADICTORY: "challenge", INCORRECT: "diagnose", OFF_TOPIC: "redirect", RAMBLING: "redirect",
    VAGUE: "concrete_example", STRONG: hooks.length ? "deep_follow_up" : "increase_difficulty",
    CORRECT: hooks.length ? "deep_follow_up" : "new_topic", PARTIALLY_CORRECT: "clarify", INCOMPLETE: "clarify", WEAK: "decrease_difficulty",
  }[primary];

  return {
    ...base, primary, categories: [...cats],
    answer_quality, technical_accuracy, depth, clarity, confidence, relevance,
    missing_concepts: missing, strengths, hits, incorrect, claims: newClaims, contradictions, hooks,
    recommended_next_action,
    diag: { cover: +cover.toFixed(2), onTopic: +onTopic.toFixed(2), repeat: +repeat.toFixed(2), repeated, tooShort, rambling, vague },
  };
}

module.exports = { analyzeAnswer, classifyIntent, isQualitative, domainTokens };
