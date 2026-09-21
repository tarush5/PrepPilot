"use strict";
/* Behavioural and wrap-up questions.
   The original set had nine, which meant a 15-question interview repeated
   itself. These are grouped by `trait` so the decision engine can cover
   different ground rather than asking three variations of "tell me about a
   conflict", and each carries the rubric the report grades against.

   `follow` is what a real interviewer asks when the story lands but the
   candidate stops short of the part that actually carries signal. */

const HR_Q = [
  { id: "hr-conflict", c: "Conflict", trait: "collaboration",
    q: "Tell me about a time you disagreed with someone on a technical decision. How did it end?",
    rubric: ["A specific, real disagreement", "Their reasoning and the other person's", "How it was resolved, not just who won", "What they'd do differently"],
    follow: "What convinced the other person — or what convinced you?" },

  { id: "hr-failure", c: "Failure", trait: "self-awareness",
    q: "Tell me about something you built that didn't work. What did you actually do about it?",
    rubric: ["Owns the failure without deflecting", "Concrete description of what went wrong", "The diagnosis, not just the outcome", "A changed behaviour afterwards"],
    follow: "What would you check earlier next time?" },

  { id: "hr-deadline", c: "Pressure", trait: "delivery",
    q: "Tell me about a time you were not going to make a deadline. What did you do?",
    rubric: ["Communicated early rather than hoping", "Explicit tradeoff — scope, quality or time", "Stakeholder handling", "Outcome stated honestly"],
    follow: "Who did you tell, and how early?" },

  { id: "hr-learn", c: "Learning", trait: "growth",
    q: "Tell me about something technical you had to learn quickly. How did you go about it?",
    rubric: ["A concrete thing, not 'I'm a fast learner'", "An actual method — docs, source, a small project", "Evidence it stuck", "Knows what they still don't know"],
    follow: "How did you know you'd actually understood it rather than copied it?" },

  { id: "hr-feedback", c: "Feedback", trait: "self-awareness",
    q: "What's a piece of critical feedback you've received, and what did you do with it?",
    rubric: ["Real feedback, not a humblebrag", "Understood why it was given", "A specific change", "No defensiveness"],
    follow: "Did the person notice the change afterwards?" },

  { id: "hr-ownership", c: "Ownership", trait: "delivery",
    q: "Tell me about something you did that nobody asked you to do.",
    rubric: ["Self-directed, not assigned", "Judgment about why it mattered", "Saw it through", "Impact on someone other than themselves"],
    follow: "How did you decide it was worth your time?" },

  { id: "hr-teach", c: "Communication", trait: "collaboration",
    q: "Tell me about a time you had to explain something technical to someone who didn't have the background.",
    rubric: ["Adapted to the audience", "A concrete analogy or framing", "Checked for understanding", "Outcome — did the person act on it?"],
    follow: "How did you know they'd actually followed it?" },

  { id: "hr-ambiguity", c: "Ambiguity", trait: "judgment",
    q: "Tell me about a time the requirements were unclear. How did you proceed?",
    rubric: ["Didn't just guess and build", "Asked or prototyped to reduce uncertainty", "Made the assumption explicit", "Adjusted when it turned out wrong"],
    follow: "What assumption did you write down, and did it hold?" },

  { id: "hr-priority", c: "Prioritisation", trait: "judgment",
    q: "You have three things due and time for two. Walk me through how you decide.",
    rubric: ["A stated basis for the decision, not vibes", "Considers blast radius and who is blocked", "Communicates the tradeoff", "Doesn't silently drop the third"],
    follow: "Who needs to know about the one you dropped?" },

  { id: "hr-team", c: "Teamwork", trait: "collaboration",
    q: "Tell me about a time you helped someone else on your team succeed.",
    rubric: ["Specific person and situation", "Actual effort, not just encouragement", "Their success, not the candidate's", "Repeatable behaviour"],
    follow: "What did that cost you in your own work?" },

  { id: "hr-why-role", c: "Motivation", trait: "fit",
    q: "Why this role, and why now? Be specific — 'I like coding' won't get you far with me.",
    rubric: ["Connects to something they've actually done", "Specific about the work, not the brand", "Honest about what they want to learn", "Forward-looking"],
    follow: "What part of the job do you think you'd be worst at?" },

  { id: "hr-strength", c: "Self-assessment", trait: "self-awareness",
    q: "What's the thing you're genuinely best at, and how do you know?",
    rubric: ["A specific, testable claim", "Evidence from real work", "Not a disguised weakness", "Proportionate — no overclaiming"],
    follow: "Who would vouch for that, and what would they say?" },

  { id: "hr-weakness", c: "Self-assessment", trait: "self-awareness",
    q: "What's something you're working on getting better at?",
    rubric: ["A real weakness, not 'I care too much'", "Concrete evidence it's a real gap", "Active steps being taken", "Realistic about progress"],
    follow: "What's the most recent time it cost you something?" },

  { id: "hr-scale-you", c: "Growth", trait: "growth",
    q: "What's the most complex thing you've worked on, and what made it complex?",
    rubric: ["Complexity named precisely", "Their specific part in it", "How they managed the complexity", "What they'd simplify now"],
    follow: "If you started it again tomorrow, what would you do differently?" },
];

/* Asked at the very end, and worth grading — candidates who ask nothing read as
   disengaged, and candidates who ask well read as serious. */
const CLOSING = {
  id: "hr-questions", c: "Candidate questions",
  q: "Before we wrap up — do you have any questions for me?",
  rubric: ["Asks something specific to the role or team", "Shows they've thought about doing the job", "Not answerable from the careers page"],
};

module.exports = { HR_Q, CLOSING };
