"use strict";
/* Contradiction detection.
   A candidate saying "1 million records" and later "50,000 records" is only a
   contradiction if both are about the same thing. Claims therefore carry a
   `context` (the project or topic under discussion), and only claims that
   share one are compared. Numbers get tolerance, because people round. */

const NUMERIC = new Set(["dataset_size", "users", "throughput", "latency", "team_size", "duration"]);

const fmt = v => {
  if (typeof v !== "number") return String(v);
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)} million`;
  if (v >= 1e3 && v % 1000 === 0) return `${v / 1e3} thousand`;
  return String(+v.toFixed(2));
};
const NOUN = { dataset_size: "the dataset", users: "the number of users", throughput: "the throughput",
  latency: "the latency", team_size: "the team size", duration: "how long it took", accuracy: "the accuracy" };

function conflict(a, b) {
  if (a.key !== b.key) return null;
  if ((a.context || null) !== (b.context || null)) return null;
  if (NUMERIC.has(a.key)) {
    if (!(a.value > 0 && b.value > 0)) return null;
    const ratio = Math.max(a.value, b.value) / Math.min(a.value, b.value);
    return ratio >= 2.5 ? { kind: "number", ratio } : null;
  }
  if (a.key === "accuracy") {
    const pa = a.value <= 1 ? a.value * 100 : a.value, pb = b.value <= 1 ? b.value * 100 : b.value;
    return Math.abs(pa - pb) >= 8 ? { kind: "number" } : null;
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
      const c = conflict(n, p);
      if (!c) continue;
      const id = `${n.key}:${n.context || ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const where = p.source === "resume" ? "Your resume says" : "Earlier you mentioned";
      let say;
      if (c.kind === "number") say = `${where} ${NOUN[n.key] || "it"} was around ${fmt(p.value)}${p.pct ? "%" : ""}, but just now you said ${fmt(n.value)}${n.pct ? "%" : ""}. Could you clarify the difference?`;
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

module.exports = { detectContradictions };
