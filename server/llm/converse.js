"use strict";
/* Making the interviewer sound like a person.

   The deterministic responder composes each turn from slots: a reaction
   phrase, a transition, an optional callback, then the question text. That
   structure is what keeps the interview coherent and on-syllabus, and it must
   stay — it is the thing that decides WHAT to ask. But its output has a tell.
   Every acknowledgement is drawn from a fixed pool ("That's a good
   explanation.", "Okay, that covers some of it."), so after six turns the
   candidate is listening to a form letter, and the acknowledgement never refers
   to anything they actually said.

   This call re-voices that same turn. The decision, the question and the
   rubric are already fixed before it runs; the model may only change the
   wording and add a genuine reference to the candidate's last answer. It is
   explicitly forbidden from changing the question, because that would let a
   model failure silently steer the interview off the syllabus.

   If it fails, the templated utterance ships. The candidate gets a slightly
   stiffer interviewer, not a broken one. */

const { callJSON, available } = require("./client");

const SYSTEM = `You are the voice of an interviewer in a realistic mock technical interview. You rewrite one scripted turn so it sounds like a real person conducting it.

You receive: the interviewer's persona, what the candidate just said, the reason the interview is moving where it's moving, and the EXACT next question that must be asked.

Your job is to produce the interviewer's spoken turn: a brief, genuine reaction to the candidate's actual answer, then the question.

Hard constraints:
- The question must be asked. You may adjust its wording for flow, but not its meaning, its subject, or what it asks for. Never substitute a different question. Never add a second question.
- React to the SPECIFIC content of their answer — name the thing they said. "Redis with event-based invalidation is the right instinct" is a reaction; "That's a good explanation" is not. If the answer was empty or off-topic there is nothing to react to, so go straight to the question.
- Never state or imply a score, a grade, or how they are doing overall.
- Do not praise a wrong answer. If the reason says the answer was incorrect or incomplete, your reaction must not congratulate them.
- 1-2 sentences of reaction, maximum. This is speech: contractions, plain words, no bullet points, no markdown, no stage directions.
- Match the persona's register exactly. A big-tech bar interviewer is terse and gives little away; a friendly mentor is warm.
- Never comment on grammar, accent, or fluency.

Return only the JSON object the schema describes.`;

const SCHEMA = {
  type: "object",
  properties: {
    utterance: { type: "string", description: "The complete spoken turn: reaction plus the question, as one natural piece of speech." },
    face: { type: "string", enum: ["neutral", "thinking", "curious", "encouraging", "impressed", "probing"], description: "The avatar expression that fits this turn." },
  },
  required: ["utterance", "face"],
  additionalProperties: false,
};

const PERSONA_BRIEF = {
  friendly: "A warm, encouraging mentor. Puts the candidate at ease, offers scaffolding, never sarcastic.",
  professional: "A neutral, competent panel interviewer. Courteous and efficient, gives little away either way.",
  faang: "A senior engineer at a big tech company setting a high bar. Terse, probing, unimpressed by generalities. Does not hand out praise.",
  startup: "A pragmatic startup founder. Fast, informal, cares about shipping and impact over theory.",
};

/**
 * Re-voice one interviewer turn.
 * Resolves to null when unavailable or on failure — caller keeps its own text.
 */
async function humanize({ persona = "professional", candidateName = "", lastAnswer = "", decisionReason = "", questionText, stageLabel = "", fallback = "", isCorrect = null }) {
  if (!available()) return null;
  if (!questionText) return null;

  const user = [
    `PERSONA: ${PERSONA_BRIEF[persona] || PERSONA_BRIEF.professional}`,
    candidateName ? `CANDIDATE'S FIRST NAME: ${candidateName} (use it sparingly — at most once every few turns)` : "",
    stageLabel ? `INTERVIEW STAGE: ${stageLabel}` : "",
    "",
    lastAnswer
      ? `WHAT THE CANDIDATE JUST SAID:\n"""\n${String(lastAnswer).slice(0, 2500)}\n"""`
      : "The candidate has not said anything substantive yet.",
    "",
    decisionReason ? `WHY THE INTERVIEW IS GOING HERE NEXT (internal note — never quote this to the candidate):\n${decisionReason}` : "",
    isCorrect === false ? "NOTE: the previous answer contained a factual error. Do not praise it." : "",
    "",
    `THE QUESTION THAT MUST BE ASKED:\n"""\n${questionText}\n"""`,
    fallback ? `\nFor reference, the scripted version of this turn was:\n"${fallback}"` : "",
  ].filter(Boolean).join("\n");

  const out = await callJSON({
    system: SYSTEM, user, schema: SCHEMA,
    effort: "low", thinking: false, maxTokens: 700, timeoutMs: 9000, label: "converse",
  });
  if (!out || !out.utterance) return null;

  const utterance = String(out.utterance).replace(/\s+/g, " ").trim();
  // A model that drops the question entirely would break the interview, so
  // sanity-check that something substantive survived before trusting it.
  if (utterance.length < 12) return null;

  return { utterance, face: out.face || "neutral" };
}

module.exports = { humanize, PERSONA_BRIEF };
