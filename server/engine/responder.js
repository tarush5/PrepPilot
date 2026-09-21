"use strict";
/* How the interviewer talks.
   Personalities change wording, warmth and pace — never the evaluation. The
   library is deliberately broad and every pick avoids lines used recently,
   because repetition is the fastest tell of a script. */
const { pick, lc1, uc1, shortPoint, trimTo } = require("../text");

const PERSONALITIES = {
  professional: { label: "Professional", names: ["Arjun", "Meera"], warmth: .5, ack: .65 },
  friendly:     { label: "Friendly", names: ["Maya", "Rohan"], warmth: .9, ack: .9 },
  technical:    { label: "Technical", names: ["Priya", "Dev"], warmth: .45, ack: .55 },
  stress:       { label: "Stress interviewer", names: ["Vikram", "Anita"], warmth: .2, ack: .35 },
  faang:        { label: "FAANG-style technical", names: ["Priya", "Sam"], warmth: .4, ack: .5 },
  startup:      { label: "Startup founder", names: ["Sam", "Zoya"], warmth: .75, ack: .8 },
};
// the original UI's persona values map onto the new set
const LEGACY = { mentor: "friendly", panel: "professional", faang: "faang", startup: "startup" };
const normalizePersonality = p => PERSONALITIES[p] ? p : LEGACY[p] || "professional";

/* Reactions, by what the answer was, then by personality family. */
const REACT = {
  STRONG: {
    warm:  ["That's a really good explanation.", "Nice — that's exactly the kind of reasoning I was hoping for.", "Good. That's clear and well grounded.", "I like that answer."],
    neutral: ["That's a good explanation.", "Good. That's the kind of reasoning I'm looking for.", "Right, that's solid.", "Okay, that's well put."],
    sharp: ["Fine.", "Correct.", "Good.", "That's right."],
  },
  CORRECT: {
    warm: ["That's right.", "Yes, that works.", "Good, that's correct."],
    neutral: ["Okay, that's correct.", "Right.", "That's accurate."],
    sharp: ["Correct.", "Okay.", "Fine."],
  },
  PARTIALLY_CORRECT: {
    warm: ["You're on the right track.", "That's partly there.", "Good start — there's a bit more to it."],
    neutral: ["You're on the right track. Let me explore that a little further.", "That's partly right.", "Okay, that covers some of it."],
    sharp: ["Partially.", "That's incomplete.", "Some of that is right."],
  },
  INCOMPLETE: {
    warm: ["That's a start.", "Okay — let's build on that."],
    neutral: ["That's a bit thin.", "Okay, there's more to it than that."],
    sharp: ["That's not enough.", "Too thin."],
  },
  VAGUE: {
    warm: ["I think I follow, but I'd like to make it concrete."],
    neutral: ["That's a little general."],
    sharp: ["That's too general."],
  },
  INCORRECT: {
    warm: ["I see what you're getting at. Let's approach it from another angle.", "Hmm, I'm not sure that's quite right — let's look at it another way."],
    neutral: ["I see what you're getting at. Let's approach it from another angle.", "I don't think that's quite right."],
    sharp: ["That's not correct.", "No — that's not how it works."],
  },
  WEAK: {
    warm: ["Okay, thanks.", "Alright — no problem."],
    neutral: ["Okay.", "Alright."],
    sharp: ["Okay.", "Noted."],
  },
  INTERESTING: {
    warm: ["That's interesting.", "Oh, interesting."],
    neutral: ["That's interesting.", "Interesting."],
    sharp: ["Interesting.", "Okay."],
  },
};
const family = p => ({ friendly: "warm", startup: "warm", professional: "neutral", technical: "neutral", faang: "sharp", stress: "sharp" })[p] || "neutral";

const TRANSITIONS = {
  deeper: ["Let's go a little deeper into that.", "Let's go one level deeper.", "Let me push on that a bit."],
  scenario: ["Now let's consider a production scenario.", "Let's make it more realistic."],
  tradeoff: ["That's a good point. Now let's look at the tradeoff.", "Let's talk about the tradeoff there."],
  newTopic: ["Let's move to a different area.", "Okay, switching topics.", "Let's look at something else.", "I'd like to change direction a little."],
  stage: {
    resume_discussion: ["Let's talk about your background for a bit.", "I'd like to start with your experience."],
    technical_fundamentals: ["Let's move into some technical fundamentals.", "Let's get into the technical side."],
    technical_deep_dive: ["Let's go deeper technically.", "I want to spend some time going deeper on a few things."],
    project_deep_dive: ["I'd like to dig into one of your projects.", "Let's talk about something you've built."],
    behavioral: ["Let's switch gears to some experience-based questions.", "I'd like to ask about how you work with people and problems."],
    final_questions: ["We're nearly out of time."],
  },
  revisit: ["Let's come back to something from earlier.", "I want to return to a point from before."],
  redirect: ["That's helpful context. Let me bring you back to the original question —", "Let me steer us back to the question —", "I want to make sure we answer the question itself —"],
  example: ["Could you walk me through a concrete example?", "Can you give me a specific instance from one of your projects?", "What would that look like in something you've actually built?"],
  mention: [(x, y) => `You mentioned ${x} earlier. How does that relate to ${y}?`, x => `Earlier you brought up ${x} — let's build on that.`],
};

class Voice {
  constructor(personality, recent = []) { this.p = normalizePersonality(personality); this.recent = recent; }
  /** Pick a line not used in the last ~20 utterances. */
  vary(list) {
    const fresh = list.filter(l => !this.recent.includes(l));
    const line = pick(fresh.length ? fresh : list);
    this.recent.push(line); if (this.recent.length > 24) this.recent.shift();
    return line;
  }
  react(category) {
    const set = REACT[category]; if (!set) return "";
    const cfg = PERSONALITIES[this.p];
    // colder personalities acknowledge less often; stress interviewers mostly don't
    if (Math.random() > cfg.ack && category !== "INCORRECT") return "";
    return this.vary(set[family(this.p)]);
  }
  t(kind, ...args) {
    const src = kind.includes(".") ? kind.split(".").reduce((o, k) => o?.[k], TRANSITIONS) : TRANSITIONS[kind];
    if (!src) return "";
    const line = this.vary(src);
    return typeof line === "function" ? line(...args) : line;
  }
  /** Compose: reaction, transition, question — skipping empties and duplicate openers. */
  compose(...parts) {
    const out = [];
    for (const p of parts.filter(Boolean)) {
      const w = s => (s.toLowerCase().match(/^[a-z']+/) || [""])[0];
      if (out.length && w(out.at(-1)) === w(p)) continue;
      out.push(p.trim());
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
  }
}

/* Question phrasing helpers used by the decision engine. */
const Q = {
  clarify: (missing, topic) => pick([
    `How does ${lc1(shortPoint(missing))} fit into that?`,
    `What about ${lc1(shortPoint(missing))}?`,
    `You didn't touch on ${lc1(shortPoint(missing))} — can you expand on that part?`,
  ]),
  basics: node => pick([
    `Let's step back for a second. In simple terms, what is ${node.c.toLowerCase()} for?`,
    `Let's start from the basics — how would you explain ${node.c.toLowerCase()} to a junior engineer?`,
  ]),
  redirectCore: q => trimTo(q, 160),
  starFollow: [
    "What was your specific role in that?",
    "How did it turn out — and how did you measure that?",
    "Looking back, what would you do differently?",
    "What did you do when that happened, specifically?",
  ],
  intro: name => `Could you briefly introduce yourself and walk me through your background?`,
  highlight: "Before we wrap up, is there anything about your experience that you'd like to highlight?",
  candidateQs: "And do you have any questions for me?",
};

module.exports = { PERSONALITIES, normalizePersonality, Voice, Q, TRANSITIONS };
