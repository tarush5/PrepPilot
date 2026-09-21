"use strict";
/* Contradiction detection.
   A candidate saying "1 million records" and later "50,000 records" is only a
   contradiction if both are about the same thing. Claims therefore carry a
   `context` (the project or topic under discussion), and only claims that
   share one are compared. Numbers get tolerance, because people round.

   The bar for raising one of these is deliberately high. Accusing an honest
   candidate of contradicting themselves is the single most damaging thing this
   interviewer can do, so a claim has to clear four gates: same key, same
   context, a gap too large to be rounding, and a gap too large to be two
   different-but-related facts. Anything short of that, we stay quiet. */

/* Per-key tolerance. `ratio` is how many times bigger the larger value must be
   before it counts as a disagreement; `floor` is an absolute gap below which we
   never bother (rounding, or two genuinely small numbers). */
const NUMERIC = {
  //             ratio: how many times bigger before it's a disagreement
  //             floor: absolute gap below which we never bother
  //             min:   below this the number is implausible as this quantity,
  //                    so it is almost certainly a different kind of number
  //                    that happened to sit next to a matching noun ("a tree
  //                    past 8 entries" is not a claim about a dataset)
  dataset_size: { ratio: 3.0, floor: 50, min: 100 },
  users:        { ratio: 3.0, floor: 50, min: 50 },
  throughput:   { ratio: 3.0, floor: 20, min: 10 },
  latency:      { ratio: 4.0, floor: 25, min: 1 },   // ms; p50 vs p99 legitimately differ a lot
  team_size:    { ratio: 2.5, floor: 2,  min: 2 },
  duration:     { ratio: 2.5, floor: 24, min: 1 },   // hours
};
/* Model metrics are absolute percentages — compared by points, not ratio. */
const METRIC_GAP = 10;

const NOUN = {
  dataset_size: "the dataset", users: "the number of users", throughput: "the throughput",
  latency: "the latency", team_size: "the team size", duration: "how long it took",
  "metric:accuracy": "the accuracy", "metric:precision": "the precision",
  "metric:recall": "the recall", "metric:f1": "the F1", "metric:auc": "the AUC",
  "metric:coverage": "the test coverage",
};

/** Render a normalised value back into something a person would say. */
function fmt(v, key) {
  if (typeof v !== "number") return String(v);
  if (key === "latency") {
    if (v >= 1000) return `${+(v / 1000).toFixed(2)}s`;
    return `${Math.round(v)}ms`;
  }
  if (key === "duration") {
    if (v >= 8760) return `${+(v / 8760).toFixed(1)} years`;
    if (v >= 730) return `${Math.round(v / 730)} months`;
    if (v >= 168) return `${Math.round(v / 168)} weeks`;
    if (v >= 24) return `${Math.round(v / 24)} days`;
    return `${Math.round(v * 60)} minutes`;
  }
  if (String(key).startsWith("metric:")) return v <= 1 ? `${+(v * 100).toFixed(1)}%` : `${+v.toFixed(1)}%`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)} million`;
  if (v >= 1e3 && v % 1000 === 0) return `${v / 1e3} thousand`;
  return String(+v.toFixed(2));
}

/** Put a metric on a 0-100 scale so 0.72 and 72% compare. */
const asPct = v => (v <= 1 ? v * 100 : v);

function conflict(a, b) {
  if (a.key !== b.key) return null;

  const isNumeric = String(a.key).startsWith("metric:") || !!NUMERIC[a.key];
  if (isNumeric) {
    /* Both claims must be pinned to the SAME KNOWN subject. A null context
       means "we don't know what this number was about", and comparing two
       unknowns is what produced every false accusation this engine has made —
       a hash-table answer mentioning "8 entries" was matched against the
       resume's "50000 records" purely because neither had a context. If we
       cannot say what two numbers describe, we have no business calling them
       a contradiction. */
    if (!a.context || !b.context || a.context !== b.context) return null;
  } else if ((a.context || null) !== (b.context || null)) {
    return null;
  }

  if (String(a.key).startsWith("metric:")) {
    const pa = asPct(a.value), pb = asPct(b.value);
    if (!(pa > 0 && pb > 0)) return null;
    return Math.abs(pa - pb) >= METRIC_GAP ? { kind: "number" } : null;
  }
  const tol = NUMERIC[a.key];
  if (tol) {
    if (!(a.value > 0 && b.value > 0)) return null;
    if (a.value < tol.min || b.value < tol.min) return null;
    const hi = Math.max(a.value, b.value), lo = Math.min(a.value, b.value);
    if (hi - lo < tol.floor) return null;
    return hi / lo >= tol.ratio ? { kind: "number", ratio: hi / lo } : null;
  }
  if (a.key === "ownership") return a.value !== b.value ? { kind: "ownership" } : null;
  if (a.key.startsWith("never_used:")) return a.value !== b.value ? { kind: "usage" } : null;
  return null;
}

/** Compare new claims against earlier ones and the resume. Returns what a polite interviewer would raise. */
function detectContradictions(newClaims, priorClaims = [], resumeMetrics = []) {
  const out = [];
  const seen = new Set();
  for (const n of newClaims) {
    for (const p of [...priorClaims, ...resumeMetrics]) {
      if (p === n) continue;
      const c = conflict(n, p);
      if (!c) continue;
      const id = `${n.key}:${n.context || ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const where = p.source === "resume" ? "Your resume says" : "Earlier you mentioned";
      let say;
      if (c.kind === "number") say = `${where} ${NOUN[n.key] || "it"} was around ${fmt(p.value, p.key)}, but just now you said ${fmt(n.value, n.key)}. Could you clarify the difference?`;
      else if (c.kind === "ownership") say = p.value === "alone"
        ? "Earlier it sounded like you built this on your own, but now you're describing a team. Can you help me understand who did what?"
        : "Earlier you described working with a team on this, but now it sounds like you did it alone. Which parts were yours?";
      else say = p.value === false
        ? `Earlier you said you hadn't used ${n.key.split(":")[1]}, but now it sounds like you did. Could you clarify?`
        : `Earlier you mentioned using ${n.key.split(":")[1]}, but now it sounds like you haven't. Which is it?`;
      out.push({ key: n.key, before: p, now: n, say });
    }
  }
  return out;
}

module.exports = { detectContradictions, fmt };
