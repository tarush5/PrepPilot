"use strict";
/* Shared language utilities. Mirrors the browser engine's tokeniser so the
   server and the offline client grade the same way. */

const STOP = new Set(("a an the and or of to in for with on at by from as is are was were be been being this that these those we you i our your their it its will would can could should may might using use used able strong good great work works working experience experienced knowledge etc into across per over under more most than then also such very both each any all other another which who whom while during within about between through after before same own").split(" "));

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uniq = a => [...new Set(a)];
const pick = a => a[Math.floor(Math.random() * a.length)];

/** Crude suffix stemmer — makes "indexing"/"indexes"/"index" one token. */
function stem(w) {
  if (w.length <= 4) return w;
  return w
    .replace(/(ational|ization|isation)$/, "ize")
    .replace(/(ing|edly|ed|ly|ies|es|s)$/, "")
    .replace(/(ment|ness|ity|ance|ence)$/, "");
}

function contentTokens(s) {
  return uniq((String(s || "").toLowerCase().match(/[a-z][a-z0-9+#.]{1,}/g) || [])
    .filter(w => w.length > 2 && !STOP.has(w))
    .map(stem));
}

/** Fraction of `need` present in `have`. */
function coverage(need, have) {
  if (!need.length) return 0;
  const set = new Set(have);
  return need.filter(t => set.has(t)).length / need.length;
}

/** Symmetric similarity between two token lists. */
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  return coverage(a, b) * .5 + coverage(b, a) * .5;
}

const wordCount = s => (String(s || "").trim().match(/\b[\w']+\b/g) || []).length;

/** Word-boundary term match that tolerates + # . inside tokens (c++, node.js). */
function hasTerm(hay, term) {
  const t = String(term).trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#.])${esc}([^a-z0-9+#.]|$)`, "i").test(hay);
}

const FILLERS = /\b(um+|uh+|er+|ah+|hmm+|like|you know|actually|basically|i mean|sort of|kind of|so yeah)\b/gi;
const HEDGES = /\b(i think|maybe|probably|i guess|not sure|might be|i believe|possibly|something like|or something)\b/gi;
const DISCOURSE = /\b(first|firstly|second|secondly|third|then|next|after that|finally|lastly|because|since|therefore|so that|as a result|which means|for example|for instance|such as|in my case|the tradeoff|on the other hand|however|whereas)\b/gi;
const SPECIFIC = /(\d+(?:\.\d+)?\s*(?:[a-z]+\s+)?(?:%|percent|ms\b|sec\b|s\b|x\b|k\b|m\b|gb\b|mb\b|qps|rps|fps|users?|rows?|records?|requests?|queries|classes|images?|connections?)|\b\d{3,}\b|\b(?:redis|kafka|postgres(?:ql)?|mongodb|mysql|docker|kubernetes|pytorch|tensorflow|react|node(?:\.js)?|express|nginx|flask|django|s3|ec2|lambda|graphql|websockets?|grpc|k6|jmeter|numpy|pandas|sklearn|scikit-learn|jenkins|terraform|prometheus|grafana|xgboost|lstm|bert|langchain|faiss|pinecone|chroma)\b)/gi;
const GENERIC = /\b(stuff|things|something|somehow|various|etc|and so on|basically|handled it|took care of|worked on it|a lot of|many things|different things|kind of|general(ly)?)\b/gi;

/** Delivery signals from one answer. `secs` may be estimated for typed answers. */
function speechSignals(text, secs) {
  const tokens = String(text).match(/\b[\w']+\b/g) || [];
  const words = tokens.length;
  const mins = Math.max((secs || words / 2.4) / 60, .05);
  const wpm = Math.round(words / mins);
  const fillers = (text.match(FILLERS) || []).length;
  const hedges = (text.match(HEDGES) || []).length;
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const variety = words ? uniq(tokens.map(t => t.toLowerCase())).length / words : 0;
  const discourse = (text.match(DISCOURSE) || []).length;
  const specifics = (text.match(SPECIFIC) || []).length;
  const generic = (text.match(GENERIC) || []).length;
  let conf = .5;
  conf += clamp((wpm - 85) / 120, -.25, .2);
  conf -= clamp((words ? fillers / words : 0) * 8, 0, .3);
  conf -= clamp((words ? hedges / words : 0) * 10, 0, .25);
  conf += words > 45 ? .15 : words > 20 ? .05 : -.2;
  return {
    words, secs: Math.round(secs || words / 2.4), wpm, fillers, hedges, sentences,
    variety: +variety.toFixed(2), discourse, specifics, generic,
    confidence: +clamp(conf, .05, .98).toFixed(2),
  };
}

/* ---------- numeric claims ----------
   Pull quantitative claims ("1 million records", "94% accuracy", "p95 300ms")
   out of free text so the interviewer can cross-examine them.

   This parser is deliberately conservative. A false positive here is expensive:
   it makes the interviewer accuse an honest candidate of contradicting
   themselves, which is worse than missing a claim entirely. Three rules keep it
   honest:
     1. A magnitude suffix only counts when it ends the word — "5 m" is five
        million, "5 minutes" is not, and "300ms" is a latency, not 300 million.
     2. Notation that merely contains a digit (p95, O(1), 5-fold, v2, top-3,
        HTTP 200) is excluded outright — those are names, not measurements.
     3. Metrics are keyed by which metric they are, so precision 0.72 and
        recall 0.65 never look like the same number disagreeing with itself. */

const MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, m: 1e6, mn: 1e6, million: 1e6, crore: 1e7, b: 1e9, bn: 1e9, billion: 1e9 };

/* A unit written immediately after the number settles what it measures.
   `norm` puts every member of a family on one scale so 1.2s and 300ms compare. */
const UNITS = [
  [/^(ms|millisecs?|milliseconds?)\b/i,            "latency",     v => v],
  [/^(s|secs?|seconds?)\b/i,                        "latency",     v => v * 1e3],
  [/^(m|mins?|minutes?)\b/i,                        "duration",    v => v / 60],
  [/^(h|hrs?|hours?)\b/i,                           "duration",    v => v],
  [/^(d|days?)\b/i,                                 "duration",    v => v * 24],
  [/^(w|weeks?)\b/i,                                "duration",    v => v * 168],
  [/^(mo|months?)\b/i,                              "duration",    v => v * 730],
  [/^(y|yrs?|years?)\b/i,                           "duration",    v => v * 8760],
  [/^(rps|qps|tps|req\/s|reqs?\/sec)\b/i,           "throughput",  v => v],
  [/^(requests?|queries|transactions?)\s+per\s+sec/i, "throughput", v => v],
  [/^(bytes?|kb|mb|gb|tb|kilobytes?|megabytes?|gigabytes?|terabytes?)\b/i, "data_volume", v => v],
  [/^(x|times)\b/i,                                 null,          v => v],   // "10x" is a factor, not a quantity
];

/* When no unit is attached, the noun that follows names the quantity. Up to two
   modifier words may sit in between — "50000 telecom records", "2000 scanned
   PDF documents" — but no more, so a noun a whole clause away doesn't count. */
const GAP = "^[\\s,]*(?:[a-z][a-z-]*\\s+){0,2}";
const CLAIM_KEYS = [
  ["dataset_size", new RegExp(GAP + "(records?|rows?|samples?|images?|data ?points?|examples?|documents?|docs?|pdfs?|files?|entries|tuples?)\\b", "i")],
  ["users",        new RegExp(GAP + "(users?|customers?|students?|clients?|subscribers?)\\b", "i")],
  ["team_size",    new RegExp(GAP + "(people|members?|engineers?|developers?|interns?|devs?)\\b", "i")],
  ["duration",     new RegExp(GAP + "(months?|weeks?|days?|years?|hours?|sprints?|semesters?)\\b", "i")],
  ["throughput",   new RegExp(GAP + "(requests?|queries|transactions?|events?|messages?)\\s+(per|a)\\s+(second|sec|min|minute)\\b", "i")],
];

/* Metric names, kept distinct so two different metrics never "contradict". */
const METRICS = [
  ["accuracy",  /\b(accuracy|accurate)\b/i],
  ["precision", /\bprecision\b/i],
  ["recall",    /\brecall\b/i],
  ["f1",        /\bf1(?:[ -]?score)?\b/i],
  ["auc",       /\b(auc|roc[ -]?auc|pr[ -]?auc)\b/i],
  ["coverage",  /\b(test |code )?coverage\b/i],
];

/* "precision 0.72, recall 0.65" — pick the metric name nearest the number,
   not the first one that happens to appear in the window. */
function nearestMetric(src, pos, radius = 44) {
  let best = null, bestD = Infinity;
  for (const [name, r] of METRICS) {
    const rg = new RegExp(r.source, "gi");
    let mm;
    while ((mm = rg.exec(src))) {
      const end = mm.index + mm[0].length;
      const d = end <= pos ? pos - end : mm.index - pos;
      if (d >= 0 && d <= radius && d < bestD) { bestD = d; best = name; }
    }
  }
  return best;
}

/* Digit-bearing notation that is a name, not a measurement. Checked against the
   few characters on either side of the match. */
const NOT_A_QUANTITY = [
  /\bp\d{1,3}$/i,                 // p50, p95, p99 — a percentile label
  /\bo\s*\($/i,                   // O(1), O(n log n) — complexity notation
  /\bv$/i,                        // v2, v3 — a version
  /\btop[- ]$/i,                  // top-5, top-k
  /\bk[- ]?$/i,                   // k-fold written as "k 5"
  /\bhttp[s]?\s*$/i,              // HTTP 200
  /\bport\s*$/i,
  /\bnode\.?js\s*$/i, /\bpython\s*$/i, /\bes\s*$/i,   // Node 18, Python 3, ES6
];
const NOT_A_QUANTITY_AFTER = [
  /^[- ]?fold\b/i,                // 5-fold cross validation
  /^[- ]?gram\b/i,                // n-gram, 3-gram
  /^\s*\)/,                       // trailing half of O(1)
  /^\.\d+\.\d+/,                  // semver 1.2.3
  /^[- ]?bit\b/i,                 // 8-bit
];

function numericClaims(text) {
  const out = [];
  const src = String(text == null ? "" : text);
  // number, optional magnitude word (must END the word), optional percent
  const re = /(\d+(?:[.,]\d+)?)\s*(?:(k|m|mn|b|bn|thousand|lakh|million|crore|billion)(?![a-z]))?\s*(%|percent\b)?/gi;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[0].trim();
    if (!raw) { re.lastIndex++; continue; }

    const before = src.slice(Math.max(0, m.index - 14), m.index);
    const afterRaw = src.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (NOT_A_QUANTITY.some(r => r.test(before))) continue;
    if (NOT_A_QUANTITY_AFTER.some(r => r.test(afterRaw))) continue;

    const digits = m[1].replace(/,/g, "");
    // A bare year never survives key detection below (nothing quantifiable
    // follows it), so it needs no special case here — but "2021-2025" would
    // otherwise read the second year as a quantity, so drop explicit ranges.
    if (/^\d{4}$/.test(digits) && +digits > 1900 && +digits < 2100 && /[-–—]\s*$/.test(before)) continue;

    let v = parseFloat(digits);
    if (!isFinite(v)) continue;
    if (m[2]) v *= MULT[m[2].toLowerCase()] || 1;

    const pct = !!m[3];
    const around = src.slice(Math.max(0, m.index - 48), m.index + raw.length + 48);
    let key = null, unit = null;

    // 1 · an explicit unit wins
    for (const [r, k, norm] of UNITS) {
      if (!r.test(afterRaw)) continue;
      if (k === null) { key = null; unit = "skip"; break; }
      key = k; v = norm(v); unit = k; break;
    }
    if (unit === "skip") continue;

    // 2 · a percentage next to a named metric
    if (!key && pct) {
      const name = nearestMetric(src, m.index);
      if (name) key = "metric:" + name;
      else if (/\b(improv|increas|reduc|decreas|drop|cut|grew|faster|slower)\w*\b/i.test(around)) continue; // "improved by 40%" is a delta, not a level
    }
    // 3 · a bare decimal next to a named metric ("precision 0.72")
    if (!key && !pct && v <= 1 && /\./.test(digits)) {
      const name = nearestMetric(src, m.index);
      if (name) key = "metric:" + name;
    }
    // 4 · the noun that follows
    if (!key) for (const [k, r] of CLAIM_KEYS) if (r.test(afterRaw)) { key = k; break; }

    if (!key) continue;
    if (key === "data_volume") continue;                 // tracked but never cross-examined
    out.push({ key, value: v, pct, unit: unit || null, quote: around.replace(/\s+/g, " ").trim() });
  }
  return out;
}

const sentenceSplit = t => (String(t).match(/[^.!?]+[.!?]*/g) || [t]).map(s => s.trim()).filter(Boolean);
const trimTo = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const lc1 = s => s ? s[0].toLowerCase() + s.slice(1) : s;
const uc1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const shortPoint = p => String(p).split(/[;:(—]| - /)[0].trim().split(/\s+/).slice(0, 8).join(" ");

module.exports = {
  STOP, clamp, uniq, pick, stem, contentTokens, coverage, similarity, wordCount, hasTerm,
  speechSignals, numericClaims, sentenceSplit, trimTo, lc1, uc1, shortPoint,
  RE: { FILLERS, HEDGES, DISCOURSE, SPECIFIC, GENERIC },
};
