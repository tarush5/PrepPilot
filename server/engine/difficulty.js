"use strict";
/* Dynamic difficulty, 1–10.
   Moves toward what the evidence says, but never more than one step a turn,
   so the interview never lurches from "what is an index" to "design Spanner". */
const { clamp } = require("../text");

const LABEL = d => d < 4 ? "Beginner" : d < 7 ? "Intermediate" : d < 9 ? "Advanced" : "Expert";

/** Starting point from the role's seniority and how much the resume evidences. */
function initialDifficulty({ seniority = "entry", resume }) {
  const base = { entry: 4.5, mid: 5.5, senior: 6.5 }[seniority] ?? 4.5;
  const evidence = resume ? Math.min(resume.claims.filter(c => c.metrics.length).length, 4) * .15 : 0;
  return +clamp(base + evidence, 3, 7).toFixed(1);
}

/**
 * One update. `a` is the answer analysis; `hist` is the rolling record:
 * { streakGood, streakBad, mistakesBySubject }.
 */
function updateDifficulty(d, a, hist, { subject, secs, words } = {}) {
  if (!a || a.primary === "REQUEST") return { d, delta: 0, why: "request" };
  const q = a.answer_quality ?? 0;
  let delta = (q - 5.5) / 3.5;                               // -1.6 … +1.3 from quality alone
  delta += ((a.technical_accuracy ?? q) - 5.5) / 10;         // correctness weighs a little extra
  delta += ((a.confidence ?? 5) - 5) / 20;                   // delivery counts, but barely
  if (a.categories?.includes("INCORRECT")) delta -= .4;
  if (a.primary === "DONT_KNOW") delta -= .5;

  // response time: a strong answer that took very long to produce is less strong
  if (secs && words && q >= 7 && secs / Math.max(words, 1) > 1.2) delta -= .25;

  // momentum: consistent performance moves faster than one-offs
  if (hist.streakGood >= 2 && q >= 7) delta += .3;
  if (hist.streakBad >= 2 && q < 4) delta -= .3;
  // repeated mistakes in one area: drop back to fundamentals there
  if (subject && (hist.mistakesBySubject?.[subject] || 0) >= 2 && q < 5) delta -= .3;

  delta = clamp(delta * .8, -1, 1);                          // never more than one step
  const next = +clamp(d + delta, 1, 10).toFixed(1);
  return { d: next, delta: +delta.toFixed(2), why: delta > .15 ? "up" : delta < -.15 ? "down" : "hold" };
}

module.exports = { LABEL, initialDifficulty, updateDifficulty };
