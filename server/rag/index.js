"use strict";
/* Retrieval over the interview corpus.

   Two indexes, built for two different jobs:

   · The KNOWLEDGE index is global and built once at boot. It holds one document
     per syllabus topic (concept, keywords, rubric points, probes). It answers
     "what is this candidate actually talking about, and what should a complete
     answer to it contain?" — which is what turns a free-text answer into a
     graded one, and what grounds the LLM so it marks against this syllabus
     rather than inventing its own.

   · A RESUME index is built per interview from the candidate's own document,
     chunked by bullet and section. It answers "did they already tell us this?"
     and "which line on the resume does this claim belong to?" — that is what
     lets the interviewer say *you wrote X, but you just said Y* and attach a
     claim to the right project instead of to the whole document.

   Everything here is synchronous and deterministic. The LLM layer consumes
   these results; it never replaces them, so retrieval quality is identical
   whether or not an API key is configured. */

const { BM25, tokenize } = require("./bm25");
const { KG, NODE, HR_Q } = require("../knowledge");

/* ---------- knowledge index ---------- */

function buildKnowledgeIndex() {
  const ix = new BM25();
  for (const n of KG) {
    // Weight the concept name and keywords by repeating them: a query that
    // names the topic outright should beat one that merely shares rubric words.
    const text = [
      n.c, n.c, n.c,
      (n.keys || []).join(" "), (n.keys || []).join(" "),
      n.s,
      (n.q || []).join(" "),
      (n.rubric || []).join(" "),
      (n.probes || []).join(" "),
    ].join(" ");
    ix.add(n.id, text, { kind: "topic", subject: n.s, depth: n.d, concept: n.c });
  }
  for (const h of HR_Q) {
    ix.add(h.id, [h.c, h.q, (h.rubric || []).join(" ")].join(" "),
      { kind: "behavioural", subject: "Behavioural", trait: h.trait || null, concept: h.c });
  }
  return ix.finalize();
}

const knowledge = buildKnowledgeIndex();

/** Which syllabus topics does this text look like it's about? */
function retrieveTopics(text, { k = 5, subject = null, maxDepth = null } = {}) {
  return knowledge.search(text, {
    k,
    filter: (meta) => meta.kind === "topic"
      && (!subject || meta.subject === subject)
      && (maxDepth == null || meta.depth <= maxDepth),
  });
}

/** The rubric points most relevant to an answer — grading grounding. */
function retrieveRubric(text, { k = 3 } = {}) {
  const hits = retrieveTopics(text, { k });
  const out = [];
  for (const h of hits) {
    const n = NODE[h.id];
    if (!n) continue;
    out.push({ topicId: n.id, concept: n.c, subject: n.s, score: h.score, rubric: n.rubric || [] });
  }
  return out;
}

/* ---------- per-interview resume index ---------- */

/** Split a resume into retrievable chunks: bullets stay whole, prose is grouped. */
function chunkResume(resumeText, resume = {}) {
  const chunks = [];
  const lines = String(resumeText || "").split(/\r?\n/);
  let section = "header";
  let buf = [];

  const flush = () => {
    const text = buf.join(" ").trim();
    if (text.length > 25) chunks.push({ text, section });
    buf = [];
  };

  const SECTION_RE = /^\s*(education|experience|work experience|employment|projects?|skills?|technical skills|achievements?|certifications?|summary|objective|publications?|activities|interests)\b[:\s]*$/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (SECTION_RE.test(line)) { flush(); section = line.replace(/[:\s]+$/, "").toLowerCase(); continue; }
    // A bullet is a self-contained claim — index it on its own.
    if (/^[-•*·▪]\s+/.test(line)) { flush(); chunks.push({ text: line.replace(/^[-•*·▪]\s+/, ""), section }); continue; }
    buf.push(line);
    if (buf.join(" ").length > 240) flush();
  }
  flush();

  // Attach the owning project/role to each chunk so claims get the right context.
  let owner = null;
  for (const c of chunks) {
    const named = (resume.projects || []).find(p => c.text.startsWith(String(p.name || p.title || "").slice(0, 24)) && p.name);
    if (named) owner = named.name || named.title;
    else if (/^[A-Z][^.]{3,60}(\||—|-|,)\s*(20\d\d|[A-Z])/.test(c.text) && c.section !== "skills") owner = c.text.split(/[|—]|\s-\s/)[0].trim();
    c.project = owner;
  }
  return chunks;
}

/** Build a searchable index of one candidate's resume. */
function buildResumeIndex(resumeText, resume = {}) {
  const ix = new BM25();
  const chunks = chunkResume(resumeText, resume);
  chunks.forEach((c, i) => ix.add("r" + i, c.text, { kind: "resume", section: c.section, project: c.project || null }));
  ix.finalize();

  return {
    size: ix.size,
    chunks,
    /** Resume lines that back up (or contradict) what was just said. */
    search: (q, k = 3) => ix.search(q, { k }),
    /** The project/role a free-text answer is most likely describing. */
    contextFor(text) {
      const hit = ix.search(text, { k: 1 })[0];
      return hit && hit.score > 1.2 ? (hit.meta.project || hit.meta.section) : null;
    },
    /** Resume claims this answer has now elaborated on — drives coverage. */
    covered(text) {
      const t = new Set(tokenize(text));
      return chunks
        .filter(c => {
          const ct = tokenize(c.text).filter(x => x.length > 3);
          if (ct.length < 4) return false;
          return ct.filter(x => t.has(x)).length / ct.length >= 0.45;
        })
        .map(c => c.text);
    },
  };
}

/* ---------- grounding pack for the LLM ---------- */

/** Everything the model needs to grade one answer, and nothing it doesn't. */
function groundingFor(question, answerText, { resumeIndex = null, topK = 3 } = {}) {
  const probe = [question?.text || "", answerText || ""].join(" ");
  const topics = retrieveRubric(probe, { k: topK });

  // The asked topic's own rubric always leads — retrieval supplements it,
  // it does not get to overrule what the interviewer actually asked about.
  if (question?.topicId && NODE[question.topicId]) {
    const n = NODE[question.topicId];
    const already = topics.findIndex(t => t.topicId === n.id);
    if (already >= 0) topics.splice(already, 1);
    topics.unshift({ topicId: n.id, concept: n.c, subject: n.s, score: 99, rubric: n.rubric || [] });
  }

  const resumeHits = resumeIndex && answerText ? resumeIndex.search(answerText, 2) : [];
  return {
    topics: topics.slice(0, topK),
    rubric: (question?.rubric && question.rubric.length ? question.rubric : (topics[0]?.rubric || [])),
    resume: resumeHits.map(h => ({ text: h.text, project: h.meta.project, score: h.score })),
  };
}

module.exports = {
  knowledge, retrieveTopics, retrieveRubric,
  buildResumeIndex, chunkResume, groundingFor, tokenize,
  stats: () => ({ knowledgeDocs: knowledge.size }),
};
