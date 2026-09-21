"use strict";
/* Resume analysis: turns raw resume text into the structured profile the
   interviewer works from — sections, projects, experience, skills, metrics,
   and the specific claims that deserve verification. */
const { SKILLS } = require("./knowledge");
const { hasTerm, numericClaims, uniq, trimTo } = require("./text");
const { archetypeOf } = require("./projects");

const HEAD = {
  summary: /^(professional\s+)?(summary|objective|profile|about( me)?)\b/i,
  education: /^(education|academics?|academic background|qualifications?)\b/i,
  skills: /^(technical\s+)?(skills|technologies|tech stack|competencies|tools)\b/i,
  experience: /^(work\s+|professional\s+)?(experience|employment|work history)\b/i,
  internships: /^internships?\b/i,
  projects: /^(academic\s+|personal\s+|key\s+)?projects?\b/i,
  certifications: /^(certifications?|certificates?|courses?|licen[cs]es?)\b/i,
  achievements: /^(achievements?|awards?|honou?rs?|accomplishments?|publications?|extra.?curricular)\b/i,
};
const BULLET = /^[-•●▪*‣◦·–—>»]\s*/;
const VERB = /^(built|building|designed|developed|implemented|engineered|architected|optimi[sz]ed|reduced|increased|improved|led|launched|shipped|automated|migrated|scaled|deployed|created|analy[sz]ed|trained|integrated|refactored|debugged|mentored|owned|delivered|streamlined|configured|benchmarked|wrote|authored|spearheaded|drove|cut|boosted|achieved|published|won|rebuilt|prototyped|researched|modell?ed|fine.?tuned|containeri[sz]ed)\b/i;
const EDU = /\b(b\.?tech|b\.?e\.?|m\.?tech|b\.?sc|m\.?sc|mca|bca|mba|ph\.?d|bachelor|master|cgpa|gpa|university|college|institute|school)\b/i;
const DATES = /\b((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*[-–—to]+\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((19|20)\d{2}|present|current|now)\b/i;
const MAX_CHARS = 60000;

function detectSkills(text) {
  const hay = " " + text.toLowerCase().replace(/\s+/g, " ") + " ";
  const found = {};
  for (const [skill, aliases] of Object.entries(SKILLS)) {
    const hits = aliases.filter(a => hasTerm(hay, a));
    if (hits.length) found[skill] = hits;
  }
  return found;
}

function guessName(lines) {
  for (const l of lines.slice(0, 4)) {
    const t = l.trim();
    if (!t || /[@\d|:/]/.test(t)) continue;
    const words = t.split(/\s+/);
    if (words.length >= 1 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z'.-]*$/.test(w)) && !Object.values(HEAD).some(r => r.test(t)))
      return t;
  }
  return "";
}

function analyzeResume(raw) {
  const text = String(raw || "").slice(0, MAX_CHARS).replace(/\r/g, "");
  if (text.replace(/\s/g, "").length < 80) {
    const err = new Error("That doesn't look like a resume — there's barely any text in it.");
    err.status = 422;
    throw err;
  }
  const lines = text.split("\n").map(l => l.replace(/\s+/g, " ").trim());
  const sections = {};
  let current = "header";
  for (const l of lines) {
    if (!l) continue;
    const body = l.replace(BULLET, "");
    const head = Object.entries(HEAD).find(([, re]) => re.test(body) && body.split(/\s+/).length <= 5);
    if (head && !BULLET.test(l)) { current = head[0]; sections[current] ||= []; continue; }
    (sections[current] ||= []).push(l);
  }

  // projects and roles: a title line followed by bullets, or standalone bullets
  const groupItems = (rows, kind) => {
    const items = [];
    let cur = null;
    for (const r of rows || []) {
      const isBullet = BULLET.test(r);
      const body = r.replace(BULLET, "").trim();
      if (!body) continue;
      // a short non-bullet line that isn't an achievement is a heading: project name or role
      const isTitle = !isBullet && !VERB.test(body) && body.split(/\s+/).length <= 14;
      if (isTitle) { cur = { title: body, bullets: [], kind }; items.push(cur); continue; }
      if (cur && cur.title) { cur.bullets.push(body); continue; }
      // an untitled achievement line stands alone: in a projects section each
      // such bullet is its own project ("Built a URL shortener…")
      items.push({ title: "", bullets: [body], kind });
      cur = null;
    }
    return items.filter(i => i.title || i.bullets.length).map(i => {
      const all = [i.title, ...i.bullets].join(" ");
      const tech = Object.keys(detectSkills(all));
      return {
        title: i.title || trimTo(i.bullets[0], 70),
        bullets: i.bullets,
        tech,
        metrics: numericClaims(all),
        dates: (all.match(DATES) || [])[0] || "",
        archetype: archetypeOf(all),
        kind,
      };
    });
  };
  const projects = groupItems(sections.projects, "project");
  const experience = groupItems(sections.experience, "experience");
  const internships = groupItems(sections.internships, "internship")
    .concat(experience.filter(e => /intern/i.test(e.title)));

  const skills = detectSkills(text);
  const listed = (sections.skills || []).join(", ");
  const skillEvidence = {};
  for (const s of Object.keys(skills)) {
    const inWork = [...projects, ...experience].filter(p => p.tech.includes(s)).length;
    const inList = Object.keys(detectSkills(listed)).includes(s);
    skillEvidence[s] = inWork >= 2 ? "strong" : inWork === 1 ? (inList ? "strong" : "medium") : inList ? "listed" : "mentioned";
  }

  /* Claims worth cross-examining: things the candidate says they did, ranked
     by how checkable they are — a number, a named technology, an owner verb. */
  const claimSource = [...projects, ...experience, ...internships];
  const claims = [];
  for (const item of claimSource) {
    for (const b of item.bullets.length ? item.bullets : [item.title]) {
      if (b.split(/\s+/).length < 6) continue;
      const tech = Object.keys(detectSkills(b));
      const metrics = numericClaims(b);
      const score = (VERB.test(b) ? 2 : 0) + (metrics.length ? 2 : 0) + Math.min(tech.length, 3) * .6;
      claims.push({ text: b, project: item.title, tech, metrics, archetype: archetypeOf(b + " " + item.title), score: +score.toFixed(2) });
    }
  }
  claims.sort((a, b) => b.score - a.score);

  return {
    name: guessName(lines),
    email: (text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}(?:\.[a-z]{2,})?/i) || [])[0] || "",
    education: (sections.education || []).filter(l => EDU.test(l) || DATES.test(l)).slice(0, 6),
    summary: (sections.summary || []).join(" ").slice(0, 500),
    projects, experience, internships,
    certifications: (sections.certifications || []).map(l => l.replace(BULLET, "")).slice(0, 12),
    achievements: (sections.achievements || []).map(l => l.replace(BULLET, "")).slice(0, 12),
    skills: Object.keys(skills),
    skill_evidence: skillEvidence,
    technologies: uniq(Object.values(skills).flat()),
    metrics: claims.flatMap(c => c.metrics.map(m => ({ ...m, source: "resume" }))),
    claims: claims.slice(0, 16),
    word_count: (text.match(/[A-Za-z0-9][A-Za-z0-9+#./-]*/g) || []).length,
  };
}

module.exports = { analyzeResume, detectSkills };
