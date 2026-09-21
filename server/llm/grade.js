"use strict";
/* LLM answer grading, grounded in retrieved rubric.

   The deterministic analyzer scores by keyword coverage against a rubric. That
   is fast, free and explainable, but it has a known failure mode: a candidate
   who explains a concept correctly in their own words, without using the
   rubric's vocabulary, scores as though they didn't know it. That was visible
   in testing — a textbook-correct hash-table answer graded WEAK because it said
   "bucket" where the rubric said "collision".

   This call fixes exactly that, and nothing else. It receives the rubric
   retrieved by the RAG layer and returns a rubric-point-by-rubric-point
   judgement. It is not asked to invent criteria, and its score is blended with
   (not substituted for) the deterministic one, so a hallucinated grade can move
   a result but never define it. */

const { callJSON, available } = require("./client");

const SYSTEM = `You grade technical interview answers for an interview-practice tool used by university students and early-career engineers.

You will be given: the question asked, the rubric points a complete answer covers, any resume lines the claim relates to, and the candidate's verbatim answer.

Grade ONLY against the supplied rubric. Do not invent additional criteria and do not reward or penalise anything the rubric does not mention.

Rules that matter:
- Judge substance, not vocabulary. A correct explanation in the candidate's own words covers the rubric point even if it shares no words with it. This is the single most important rule.
- Judge only what was said. Do not credit knowledge the candidate plausibly has but did not state.
- A confident wrong statement is worse than an admitted gap. Flag factual errors explicitly in "errors".
- Never penalise grammar, accent, dialect, phrasing, or non-native English. Ignore transcription noise and filler words entirely — delivery is measured separately.
- "partial" means the idea is present but incomplete or imprecise. Reserve "covered" for points genuinely addressed.
- Be calibrated, not generous. Most real answers from this population land between 4 and 7. Reserve 9-10 for answers that would impress a senior engineer, and 0-2 for answers that are off-topic, empty, or substantially wrong.

Return only the JSON object the schema describes.`;

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 10, description: "Overall substance of the answer against the rubric." },
    rubric_points: {
      type: "array",
      description: "One entry per supplied rubric point, in the order given.",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          status: { type: "string", enum: ["covered", "partial", "missing"] },
          evidence: { type: "string", description: "A short verbatim quote from the answer, or empty if missing." },
        },
        required: ["point", "status", "evidence"],
        additionalProperties: false,
      },
    },
    errors: {
      type: "array",
      description: "Factually incorrect statements the candidate made. Empty if none.",
      items: {
        type: "object",
        properties: {
          claim: { type: "string", description: "What the candidate said, quoted or closely paraphrased." },
          correction: { type: "string", description: "One sentence stating what is actually true." },
        },
        required: ["claim", "correction"],
        additionalProperties: false,
      },
    },
    strengths: { type: "array", items: { type: "string" }, description: "At most two specific things done well." },
    missing: { type: "array", items: { type: "string" }, description: "At most three concepts the answer should have reached." },
    follow_up: { type: "string", description: "The single best next question, or empty string if the topic is exhausted." },
    reasoning: { type: "string", description: "One sentence explaining the score. Shown to the candidate in the report." },
  },
  required: ["score", "rubric_points", "errors", "strengths", "missing", "follow_up", "reasoning"],
  additionalProperties: false,
};

/**
 * Grade one answer. Resolves to null when the LLM layer is off or the call
 * fails — the caller then keeps its deterministic grade.
 *
 * @param {object}   question   the question object that was asked
 * @param {string}   answerText verbatim candidate answer
 * @param {object}   grounding  from rag.groundingFor()
 */
async function gradeAnswer({ question, answerText, grounding, role = "Software Engineer" }) {
  if (!available()) return null;
  const text = String(answerText || "").trim();
  if (text.length < 15) return null;              // too short to be worth a call

  const rubric = (grounding?.rubric || []).slice(0, 6);
  if (!rubric.length) return null;

  const resumeLines = (grounding?.resume || []).map(r => `- ${r.text}`).join("\n");
  const topic = grounding?.topics?.[0];

  const user = [
    `Role being interviewed for: ${role}`,
    topic ? `Topic: ${topic.subject} — ${topic.concept}` : "",
    "",
    `QUESTION ASKED:\n${question?.text || "(not recorded)"}`,
    "",
    `RUBRIC — a complete answer covers these points:\n${rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
    resumeLines ? `\nRELATED LINES FROM THE CANDIDATE'S RESUME:\n${resumeLines}` : "",
    "",
    `CANDIDATE'S ANSWER (verbatim):\n"""\n${text.slice(0, 6000)}\n"""`,
  ].filter(Boolean).join("\n");

  const out = await callJSON({
    system: SYSTEM, user, schema: SCHEMA,
    effort: "medium", maxTokens: 2000, label: "grade",
  });
  if (!out || typeof out.score !== "number") return null;

  return {
    source: "llm",
    score: Math.max(0, Math.min(10, Math.round(out.score))),
    rubricPoints: Array.isArray(out.rubric_points) ? out.rubric_points : [],
    errors: Array.isArray(out.errors) ? out.errors : [],
    strengths: (out.strengths || []).slice(0, 2),
    missing: (out.missing || []).slice(0, 3),
    followUp: (out.follow_up || "").trim() || null,
    reasoning: (out.reasoning || "").trim(),
  };
}

module.exports = { gradeAnswer };
