"use strict";
/* Job description analysis and the skill coverage matrix.
   The matrix is what makes the interview JD-aware: skills the role requires
   but the resume barely evidences are exactly what an interviewer probes. */
const { detectSkills } = require("./resume");
const { SKILL_TOPICS } = require("./knowledge");

const REQ = /^(requirements?|required|must.have|minimum qualifications?|qualifications?|what you('ll)? need|what we('re)? looking for|you have|basic qualifications?)\b/i;
const PREF = /^(preferred|nice.to.have|bonus|plus|good to have|preferred qualifications?|desired)\b/i;
const RESP = /^(responsibilities|what you('ll)? do|the role|duties|your impact|day.to.day|key responsibilities)\b/i;
const MAX_CHARS = 30000;

function analyzeJD(raw) {
  const text = String(raw || "").slice(0, MAX_CHARS).replace(/\r/g, "");
  if (text.replace(/\s/g, "").length < 40) return null;
  const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const bucket = { required: [], preferred: [], responsibilities: [], other: [] };
  let cur = "other";
  for (const l of lines) {
    const body = l.replace(/^[-•*●▪]\s*/, "").replace(/:$/, "");
    if (body.split(/\s+/).length <= 6) {
      if (REQ.test(body)) { cur = "required"; continue; }
      if (PREF.test(body)) { cur = "preferred"; continue; }
      if (RESP.test(body)) { cur = "responsibilities"; continue; }
    }
    bucket[cur].push(body);
  }
  // an unstructured JD: treat every mentioned skill as required
  const reqText = bucket.required.length ? bucket.required.join("\n") : text;
  const required = Object.keys(detectSkills(reqText));
  const preferred = Object.keys(detectSkills(bucket.preferred.join("\n"))).filter(s => !required.includes(s));
  const years = (text.match(/(\d+)\s*\+?\s*(?:-\s*\d+\s*)?years?/i) || [])[1];
  const seniority = /\b(senior|sr\.|lead|principal|staff)\b/i.test(text) ? "senior"
    : /\b(intern|fresher|graduate|entry.level|junior|new grad)\b/i.test(text) ? "entry" : years && +years >= 4 ? "senior" : "mid";
  const domain = (text.match(/\b(fintech|healthcare|e-?commerce|edtech|saas|gaming|logistics|banking|insurance|automotive|ev|telecom|retail)\b/ig) || [])
    .map(d => d.toLowerCase());
  return {
    required, preferred,
    responsibilities: bucket.responsibilities.slice(0, 12),
    experience_years: years ? +years : null,
    seniority, domain: [...new Set(domain)],
    technologies: [...new Set([...required, ...preferred])],
  };
}

/** Skill → Strong / Medium / Weak / Missing, from resume evidence. */
function coverageMatrix(jd, resume) {
  if (!jd) return [];
  const ev = resume?.skill_evidence || {};
  const level = s => ({ strong: "Strong", medium: "Medium", listed: "Weak", mentioned: "Weak" })[ev[s]] || "Missing";
  return [
    ...jd.required.map(s => ({ skill: s, importance: "required", resume: level(s), interview: null, topics: SKILL_TOPICS[s] || [] })),
    ...jd.preferred.map(s => ({ skill: s, importance: "preferred", resume: level(s), interview: null, topics: SKILL_TOPICS[s] || [] })),
  ];
}

/** How much the interview should care about probing a skill right now. */
function probePriority(row) {
  const base = row.importance === "required" ? 3 : 1.5;
  // a claimed-but-thin skill is the most informative thing to test;
  // a completely missing one is worth one check, not an interrogation
  const gap = { Missing: 1.2, Weak: 2, Medium: 1.6, Strong: 1 }[row.resume] || 1;
  const tested = row.interview ? .35 : 1;
  return base * gap * tested;
}

module.exports = { analyzeJD, coverageMatrix, probePriority };
