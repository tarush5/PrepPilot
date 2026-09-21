"use strict";
/* BM25 lexical retrieval.

   Why lexical rather than embeddings: the Anthropic API has no embeddings
   endpoint, and pulling in a second vendor (or a local ONNX model) for a
   feature that has to keep working with no API key at all would be the wrong
   trade. It also happens to be the right retrieval method here — the queries
   are full of exact technical tokens ("p99", "B+ tree", "SMOTE", "idempotency")
   and those are precisely what dense vectors blur and BM25 nails.

   When a key IS present, `llm/rerank.js` puts a cross-encoder-style reranking
   pass on top, which is the standard hybrid shape: cheap wide lexical recall,
   expensive precise reordering over the top few.

   Scoring is textbook Robertson/Sparck-Jones BM25:
     idf(q) * (f * (k1+1)) / (f + k1 * (1 - b + b * |d|/avgdl))  */

const K1 = 1.4;   // term-frequency saturation
const B = 0.72;   // length normalisation

const STOP = new Set(("a an the and or of to in for with on at by from as is are was were be been being this that these those it its how what when why which who do does did can could should would will your you i we they them their there here not no if then than so such about into over under more most some any all each other".split(" ")));

/** Lowercase, keep technical tokens intact (c++, node.js, p99, f1), drop stopwords. */
function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z][a-z0-9+#._-]*|\d+[a-z]+/g) || [])
    .map(t => t.replace(/^[._-]+|[._-]+$/g, ""))
    .filter(t => t.length > 1 && !STOP.has(t));
}

class BM25 {
  constructor() {
    this.docs = [];            // { id, text, meta, len, tf:Map }
    this.df = new Map();       // term -> number of docs containing it
    this.avgdl = 0;
    this._dirty = false;
  }

  add(id, text, meta = {}) {
    const terms = tokenize(text);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    this.docs.push({ id, text, meta, len: terms.length, tf });
    this._dirty = true;
    return this;
  }

  finalize() {
    const total = this.docs.reduce((n, d) => n + d.len, 0);
    this.avgdl = this.docs.length ? total / this.docs.length : 0;
    this._dirty = false;
    return this;
  }

  idf(term) {
    const n = this.docs.length;
    const df = this.df.get(term) || 0;
    // +1 inside the log keeps this positive even for terms in every document
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Top-k documents for a query. `filter` narrows the candidate set first. */
  search(query, { k = 5, filter = null, minScore = 0.1 } = {}) {
    if (this._dirty) this.finalize();
    const qt = tokenize(query);
    if (!qt.length) return [];
    const uniqQ = [...new Set(qt)];
    const out = [];
    for (const d of this.docs) {
      if (filter && !filter(d.meta, d)) continue;
      let score = 0;
      for (const t of uniqQ) {
        const f = d.tf.get(t);
        if (!f) continue;
        const norm = f + K1 * (1 - B + B * (d.len / (this.avgdl || 1)));
        score += this.idf(t) * (f * (K1 + 1)) / norm;
      }
      if (score > minScore) out.push({ id: d.id, score: +score.toFixed(4), text: d.text, meta: d.meta });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k);
  }

  get size() { return this.docs.length; }
}

module.exports = { BM25, tokenize };
