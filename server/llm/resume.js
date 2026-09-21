"use strict";
/* LLM resume analysis.

   The deterministic ATS scorer already handles the mechanical half well —
   parseability, section presence, contact links, metric density, keyword
   overlap with the JD. Those are rules, and rules are the right tool: they are
   consistent, instant, and explainable to the candidate.

   What rules cannot do is read a bullet and tell you it says nothing. "Worked
   on the backend team to improve system performance" passes every structural
   check and is worthless. This call does that judgement, plus a concrete
   rewrite the candidate can paste, plus the interview angles the bullet exposes
   — which feed straight back into question selection. */

const { callJSON, available } = require("./client");

const SYSTEM = `You review resumes for an interview-practice tool used by university students and early-career engineers, mostly in India, applying for software and data roles.

You are given the resume text and (usually) a target job description.

What you are judging:
- Whether each bullet states something concrete and verifiable, or is filler that would survive on anyone's resume.
- Whether impact is quantified and whether the number is meaningful.
- Whether the candidate's own contribution is distinguishable from their team's.
- Which claims an interviewer would probe, because the candidate must be ready for exactly those.

How to write feedback:
- Be specific and actionable. "Add a metric" is useless; "say how much p95 dropped and how you measured it" is useful.
- Rewrites must stay truthful to what the original says. Never invent numbers, tools, or scope the candidate did not claim. If a number is needed but absent, write a placeholder like [X%] so the candidate fills it in.
- Be direct but not cruel. This person is about to interview; they need correction, not discouragement.
- Judge the writing, never the person, the university, or the English. Do not comment on grammar or phrasing except where it makes a technical claim ambiguous.

Return only the JSON object the schema describes.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", description: "Two sentences: the honest headline on this resume for this role." },
    strongest_bullet: { type: "string", description: "The single best line, quoted." },
    weak_bullets: {
      type: "array",
      description: "Up to four bullets that need work, worst first.",
      items: {
        type: "object",
        properties: {
          original: { type: "string", description: "The bullet, quoted verbatim." },
          problem: { type: "string", description: "One sentence: what is wrong with it." },
          rewrite: { type: "string", description: "A rewritten bullet, truthful to the original, with [X] placeholders where a number is needed." },
        },
        required: ["original", "problem", "rewrite"],
        additionalProperties: false,
      },
    },
    missing_for_role: {
      type: "array",
      description: "Up to four things this resume should show for the target role but doesn't.",
      items: { type: "string" },
    },
    claims_to_defend: {
      type: "array",
      description: "Up to five claims an interviewer will probe, with the question they will ask.",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          likely_question: { type: "string" },
        },
        required: ["claim", "likely_question"],
        additionalProperties: false,
      },
    },
    credibility_risks: {
      type: "array",
      description: "Claims that look inflated, vague about ownership, or unverifiable. Empty if none.",
      items: { type: "string" },
    },
  },
  required: ["verdict", "strongest_bullet", "weak_bullets", "missing_for_role", "claims_to_defend", "credibility_risks"],
  additionalProperties: false,
};

async function analyzeResumeLLM({ resumeText, jdText = "", role = "Software Engineer", atsScore = null }) {
  if (!available()) return null;
  const text = String(resumeText || "").trim();
  if (text.length < 120) return null;

  const user = [
    `TARGET ROLE: ${role}`,
    atsScore != null ? `Structural ATS score already computed: ${atsScore}/100 (mechanical checks only — do not restate them).` : "",
    jdText ? `\nJOB DESCRIPTION:\n"""\n${String(jdText).slice(0, 4000)}\n"""` : "\n(No job description supplied — judge against the target role generally.)",
    `\nRESUME:\n"""\n${text.slice(0, 12000)}\n"""`,
  ].filter(Boolean).join("\n");

  const out = await callJSON({
    system: SYSTEM, user, schema: SCHEMA,
    effort: "high", maxTokens: 4000, timeoutMs: 45000, label: "resume",
  });
  if (!out) return null;

  return {
    source: "llm",
    verdict: out.verdict || "",
    strongestBullet: out.strongest_bullet || "",
    weakBullets: (out.weak_bullets || []).slice(0, 4),
    missingForRole: (out.missing_for_role || []).slice(0, 4),
    claimsToDefend: (out.claims_to_defend || []).slice(0, 5),
    credibilityRisks: (out.credibility_risks || []).slice(0, 4),
  };
}

module.exports = { analyzeResumeLLM };
