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

/** Pull numeric claims ("1 million records", "94% accuracy") out of free text. */
const MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, m: 1e6, mn: 1e6, million: 1e6, crore: 1e7, b: 1e9, bn: 1e9, billion: 1e9 };
const CLAIM_KEYS = [
  ["dataset_size", /\b(records?|rows?|samples?|images?|data ?points?|examples?|documents?|entries)\b/i],
  ["users", /\b(users?|customers?|students?|clients?|concurrent)\b/i],
  ["throughput", /\b(requests? per second|rps|qps|req\/s|transactions? per second|tps)\b/i],
  ["accuracy", /\b(accuracy|f1|precision|recall|auc)\b/i],
  ["latency", /\b(latency|response time|p95|p99|ms\b|milliseconds?)\b/i],
  ["team_size", /\b(team of|people|members?|engineers?|developers?)\b/i],
  ["duration", /\b(months?|weeks?|days?|years?)\b/i],
];
function numericClaims(text) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(k|m|mn|b|bn|thousand|lakh|million|crore|billion)?\s*(%|percent)?/gi;
  let m;
  const src = String(text);
  while ((m = re.exec(src))) {
    const raw = m[0].trim();
    if (!raw || /^\d{4}$/.test(raw) && +raw > 1900 && +raw < 2100) continue;     // a year, not a claim
    let v = parseFloat(m[1].replace(/,/g, ""));
    if (m[2]) v *= MULT[m[2].toLowerCase()] || 1;
    const pct = !!m[3];
    const around = src.slice(Math.max(0, m.index - 40), m.index + raw.length + 40);
    const after = src.slice(m.index + raw.length, m.index + raw.length + 36);
    let key = null;
    for (const [k, r] of CLAIM_KEYS) if (r.test(after) || (k === "accuracy" && pct && r.test(around))) { key = k; break; }
    if (!key && pct) key = /accura|f1|precision|recall|auc/i.test(around) ? "accuracy" : null;
    if (!key) continue;
    out.push({ key, value: v, pct, quote: around.replace(/\s+/g, " ").trim() });
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
