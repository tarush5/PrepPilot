"use strict";
/* Reranking — the precision half of hybrid retrieval.

   BM25 gives wide, cheap recall, and it is genuinely good at the exact
   technical tokens that matter here. Its weakness is polysemy: in testing,
   "the connection pool saturated" retrieved the CNN topic, because "pool"
   also means pooling layer. No amount of lexical tuning fixes that — the words
   really do match; the meaning doesn't.

   That is exactly what a reranker is for. BM25 proposes a shortlist, the model
   reads each candidate against the query and reorders by actual relevance.
   Cheap (one small call over ~8 short candidates), and it fails safe: if the
   call fails, the BM25 order stands, which is what the app used anyway. */

const { callJSON, available } = require("./client");

const SYSTEM = `You reorder candidate interview topics by how relevant each one is to what a candidate just said.

You get a passage of interview speech and a numbered list of syllabus topics. Score each topic 0-10 for how directly it is the subject of that passage.

Judge the topic the passage is ABOUT, not topics that merely share a word. A passage about database connection pools is about databases, not about pooling layers in neural networks. A passage about caching invalidation is about caching, not about computer-architecture caches, unless it discusses CPU cache lines.

Score 0 for topics that only share vocabulary. Return every topic you were given, with its original index.`;

const SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The 0-based index from the supplied list." },
          relevance: { type: "integer", minimum: 0, maximum: 10 },
        },
        required: ["index", "relevance"],
        additionalProperties: false,
      },
    },
  },
  required: ["ranked"],
  additionalProperties: false,
};

/**
 * Reorder BM25 hits by semantic relevance.
 * Returns the reordered array, or the input unchanged on any failure.
 *
 * @param {string} query   the text being classified
 * @param {Array}  hits    from rag.retrieveTopics()
 * @param {number} keep    how many to return
 */
async function rerankTopics(query, hits, { keep = 3, minRelevance = 3 } = {}) {
  if (!available() || !Array.isArray(hits) || hits.length < 2) return hits;

  const list = hits.slice(0, 8);
  const user = [
    `PASSAGE:\n"""\n${String(query).slice(0, 2500)}\n"""`,
    "",
    "CANDIDATE TOPICS:",
    ...list.map((h, i) => `${i}. [${h.meta?.subject || "?"}] ${h.meta?.concept || h.id}`),
  ].join("\n");

  const out = await callJSON({
    system: SYSTEM, user, schema: SCHEMA,
    effort: "low", thinking: false, maxTokens: 700, timeoutMs: 8000, label: "rerank",
  });
  if (!out || !Array.isArray(out.ranked) || !out.ranked.length) return hits.slice(0, keep);

  const scored = out.ranked
    .filter(r => Number.isInteger(r.index) && list[r.index])
    .map(r => ({ ...list[r.index], rerank: r.relevance }))
    .filter(r => r.rerank >= minRelevance)
    .sort((a, b) => b.rerank - a.rerank || b.score - a.score);

  // If the model rejected everything, the passage genuinely matched nothing —
  // that is a real signal, but returning empty would break callers, so keep one.
  return (scored.length ? scored : hits).slice(0, keep);
}

module.exports = { rerankTopics };
