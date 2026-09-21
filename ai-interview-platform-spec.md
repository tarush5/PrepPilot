# PrepPilot — AI Interview Coach & ATS Analyzer
### Complete project specification + ready-to-paste build prompt

---

## 0. One-line pitch

A voice-first AI platform that reads your resume, scores it against ATS systems, conducts a realistic spoken interview with an animated agent that adapts to how you actually answer, and returns a detailed scored report with a personalized improvement plan.

---

## 1. Scope and an honest note on "mind reading"

Your idea had one part that needs reframing before it goes into a spec: an agent cannot read a candidate's mind. What it *can* do — and what actually produces the effect you want — is **multimodal signal inference**:

| You asked for | What we build instead | Signals used |
|---|---|---|
| "Read the interviewee's mind" | Confidence & comprehension estimation | Speech pace, filler-word density, pause length before answering, pitch variance, self-corrections, answer hedging words |
| "Human interaction through expression" | Affective-response engine driving avatar + tone | Real-time sentiment of transcript, detected stress/uncertainty, answer quality score |
| "Know if they're bluffing" | Depth-probing follow-ups | Any claim on the resume gets 1–3 escalating follow-ups; shallow answers trigger deeper probes |

This is more defensible, actually buildable, and in evaluations it *feels* like mind reading to the candidate. Webcam-based emotion detection should be **opt-in, clearly disclosed, and never used to penalize a score** — facial-affect inference is scientifically contested and using it for grading is a legal risk in several jurisdictions (EU AI Act classes emotion inference in hiring-adjacent contexts as high-risk/prohibited). Use it only to make the avatar more empathetic, never to mark someone down.

---

## 2. Feature set

### 2.1 Core (must-have — your original idea)

**A. Resume intake & ATS scoring**
- Upload PDF / DOCX / paste text; parse with layout awareness
- ATS score 0–100 broken into sub-scores: parseability, keyword match vs. target JD, formatting hygiene, quantified-impact density, section completeness, tense/voice consistency, contact & link validity
- Section-by-section red/amber/green annotation shown *on* the rendered resume
- Rewrite suggestions: one-click bullet rewriter (weak bullet → STAR-formatted, metric-bearing bullet)
- JD-match mode: paste a job description, get a gap report and missing-keyword list
- Downloadable ATS-safe resume export

**B. Knowledge base of B.Tech CSE + domain expertise**
- Subject graph covering: DSA, OS, DBMS, CN, OOPS, COA, TOC, Compiler Design, SE, Discrete Math, OS internals, System Design
- Domain packs: AI/ML, Deep Learning, NLP, CV, Data Science, Data Engineering, Web (MERN/Django/Spring), Mobile, Cloud/DevOps, Cybersecurity, Blockchain, Embedded/IoT, Testing/QA
- Each node stores: concept, difficulty 1–5, prerequisite edges, 8–15 seed questions, ideal-answer rubric, common wrong answers, 3 follow-up probes
- Resume skills are entity-linked into this graph → the agent knows exactly which nodes the candidate claims to own

**C. Voice interview agent (the centerpiece)**
- Full-duplex spoken interview: agent speaks, candidate speaks, barge-in supported
- Animated avatar (2D rigged or 3D) with lip-sync, eye contact, nods, thinking pose, and expression states (neutral / encouraging / curious / pleased / probing)
- Voice-activity detection with adaptive end-of-turn so it doesn't cut people off mid-thought
- Interview structure: intro → resume deep-dive → project cross-examination → core CS fundamentals → domain-specific → coding/system-design (optional) → HR & behavioral → candidate Q&A → close
- Adaptive difficulty: correct answer → harder; struggle → scaffold or switch topic; never grill someone into collapse

**D. Live chat panel**
- Running transcript, speaker-labeled, timestamped
- Current question always pinned at top; "repeat that" and "show as text" buttons
- Candidate can type instead of speak at any moment (accessibility + noisy-room fallback)
- Post-answer inline chips: *answered · partially answered · follow-up incoming*

**E. Intelligence layer (the reframed "mind reading")**
- Per-answer evaluation: correctness, depth, structure, relevance, confidence
- Rolling candidate model updated after every answer: strong topics, shaky topics, communication style, stress level
- The next question is chosen by this model, not from a fixed list
- Drives avatar behavior: if stress is high → warmer tone, slower pace, an encouraging line before the next question

**F. Result & improvement report**
- Overall score + radar chart across: Technical Depth, Problem Solving, Communication, Confidence, Structure (STAR), Domain Fit, Resume Alignment
- Question-by-question replay: your answer, ideal answer, what was missing, score
- Top 5 strengths, top 5 gaps, and a **7-day / 30-day study plan** linked to specific knowledge-graph nodes
- Filler-word count, speaking pace (WPM), longest pause, talk-time ratio
- Shareable PDF report + audio/video replay

---

### 2.2 Features to add (this is where the project stops looking like a college demo)

1. **Coding round** — in-browser Monaco editor, Judge0/Piston execution, agent watches your code as you type and asks "why did you choose a hashmap here?" out loud
2. **System design whiteboard** — Excalidraw-style canvas; agent reads your diagram (vision model) and challenges scaling, consistency, bottlenecks
3. **Company personas** — "Interview me like Google SDE-1" / "Amazon LP-heavy" / "TCS NQT" / "startup founder"; changes tone, rubric weights, question mix
4. **Interviewer personalities** — Friendly Mentor, Neutral Panel, Stress Interviewer (opt-in, with a warning and an exit hatch)
5. **Multilingual + Indian-accent robustness** — English, Hindi, Tamil, Telugu, Bengali; code-mixed speech handled (huge for Indian campus hiring, and a genuine differentiator)
6. **Barge-in & clarification** — candidate can say "can you repeat that?" or "can I get a hint?" naturally
7. **Progress dashboard** — score trend over sessions, per-topic mastery heatmap, streaks
8. **Spaced-repetition drill mode** — weak nodes resurface as 5-minute rapid-fire voice quizzes
9. **Group Discussion simulator** — 3 AI participants + you, with an evaluator
10. **HR / behavioral round with STAR coach** — real-time structure nudges
11. **Answer teleprompter mode (practice only)** — bullet hints appear while you speak; disabled in graded mode
12. **Resume ↔ interview loop** — gaps found in the interview become resume suggestions and vice versa
13. **Peer benchmark** — percentile against anonymized cohort for the same role
14. **Recruiter/placement-cell portal** — bulk invite, cohort analytics, exportable readiness reports (this is the monetizable piece)
15. **Bias & fairness guardrails** — no scoring on accent, gender, name, appearance; audit log of every scoring decision
16. **Offline-lite mode** — text-only interview for low bandwidth
17. **Accessibility** — full keyboard nav, captions on avatar speech, screen-reader labels, dyslexia-friendly font toggle
18. **Anti-cheat (soft)** — tab-switch and paste detection flagged in the report as a practice signal, not a punishment
19. **Interview highlight reel** — auto-clipped 60-second reel of your best answers
20. **Voice cloning of the candidate for playback comparison** (optional, consent-gated) — hear a model answer in your own voice

---

## 3. Technical architecture

```
                      ┌────────────────────────────┐
   Browser (React)    │  Avatar • Mic • Chat • Code │
                      └──────────┬─────────────────┘
                     WebRTC audio │ WebSocket events
                      ┌──────────▼─────────────────┐
                      │   Realtime Orchestrator     │  (FastAPI + WS)
                      │  turn-taking • barge-in      │
                      └──┬────────┬────────┬────────┘
             ┌───────────┘        │        └────────────┐
      ┌──────▼──────┐   ┌─────────▼────────┐   ┌────────▼───────┐
      │ STT stream  │   │ Interview Brain  │   │ TTS stream     │
      │ Whisper/    │   │ LLM + state      │   │ low-latency    │
      │ Deepgram    │   │ machine + RAG    │   │ neural voice   │
      └─────────────┘   └───┬──────────┬───┘   └────────────────┘
                            │          │
                   ┌────────▼──┐   ┌───▼────────────┐
                   │ Knowledge │   │ Candidate Model│
                   │ Graph +   │   │ (per-turn)     │
                   │ Vector DB │   └───┬────────────┘
                   └───────────┘       │
                                ┌──────▼──────┐
                                │ Scoring &   │
                                │ Report Gen  │
                                └─────────────┘
```

**Stack**
- Frontend: React + TypeScript, Vite, TailwindCSS, Framer Motion, Zustand, Recharts, Monaco, Excalidraw, Rive or Three.js for avatar
- Backend: FastAPI (async), WebSockets, Celery + Redis for report jobs
- LLM: an instruction-tuned model with function calling; small fast model for per-turn routing, larger model for evaluation and report
- Speech: streaming STT (Whisper large-v3 / Deepgram Nova) + streaming TTS with sub-400ms first-byte
- Retrieval: PostgreSQL + pgvector, or Qdrant; Neo4j (or Postgres recursive CTEs) for the subject graph
- Resume parsing: PyMuPDF + docx2python, spaCy NER + LLM extraction fallback
- Storage: S3-compatible for audio/video; Postgres for everything relational
- Deploy: Docker Compose → Kubernetes; CDN for avatar assets

**Latency budget (the difference between "robot" and "human")**

| Stage | Target |
|---|---|
| End-of-speech detection | ≤ 300 ms |
| STT final transcript | ≤ 250 ms after EOS |
| Brain decides next question | ≤ 600 ms (stream while thinking) |
| TTS first audio byte | ≤ 400 ms |
| **Total perceived gap** | **≤ 1.2 s** |

Tricks to hit it: pre-generate the 2–3 likeliest follow-ups during the candidate's answer; play a natural filler ("Mm, okay —") while the real response streams; run evaluation *asynchronously* so scoring never blocks the conversation.

---

## 4. The interview brain — how questions are actually chosen

```python
# pseudocode, per turn
signals = analyze(answer_audio, answer_text)
# → correctness, depth, structure, confidence, hesitation, fillers, wpm

candidate_model.update(topic=current_node, signals=signals)

if signals.correctness > 0.8 and signals.depth > 0.7:
    next_node = graph.deeper(current_node)          # escalate
    avatar.state = "impressed"
elif signals.correctness < 0.4 and consecutive_struggles >= 2:
    next_node = graph.sibling(current_node, easier=True)  # rescue
    avatar.state = "encouraging"
    agent.say(scaffold_hint(current_node))
elif resume_claim_unverified(current_node):
    next_node = current_node
    question = probe_claim(current_node, depth=+1)   # cross-examine
    avatar.state = "curious"
else:
    next_node = planner.next_by_coverage(candidate_model, jd_profile)
```

**Coverage planner** ensures every session touches: ≥3 resume claims, ≥4 core CS subjects, ≥3 domain-specific nodes, ≥2 behavioral — weighted by the target JD.

---

## 5. Scoring rubric (per answer, 0–5 each)

| Dimension | What earns a 5 |
|---|---|
| Correctness | Factually right, no misconceptions |
| Depth | Explains *why*, mentions trade-offs and edge cases |
| Structure | STAR for behavioral; definition → mechanism → example → trade-off for technical |
| Relevance | Answers the question asked, no padding |
| Communication | Clear, ≤2 fillers/min, 120–160 WPM, no rambling |
| Ownership (projects) | Specific personal contribution, real numbers, honest about limits |

Final score = weighted mean, weights set by company persona. **Never** include accent, grammar of non-native speech, or facial affect as scoring inputs.

---

## 6. UI/UX design direction

**Personality:** warm, calm, confidence-building. This product's users are nervous 21-year-olds. Every screen should lower the heart rate, not raise it.

- **Palette:** deep indigo `#1E1B4B` base, soft lilac `#A5B4FC` accent, mint `#6EE7B7` for success, warm amber `#FBBF24` for "needs work" (never red — red spikes anxiety), off-white `#FAFAF9` surfaces
- **Type:** Sora or Outfit for headings, Inter for body, JetBrains Mono for code
- **Motion:** slow, organic easing (300–500ms); avatar breathes and blinks even when idle; a gentle audio waveform pulses while the candidate speaks so they know they're heard
- **Feel:** rounded 16px cards, soft shadows, glassmorphism only on the interview HUD

**Screens**
1. **Onboarding** — 3 steps: upload resume → pick target role/company → mic check with a friendly "say hello to warm up"
2. **Resume Lab** — split view: rendered resume left with inline annotations, ATS score dial + fix-list right
3. **Interview Room** — avatar center-stage, chat transcript in a collapsible right rail, question card pinned top, mic orb bottom-center with live waveform, subtle progress ring showing round completion; a visible **"Pause"** and **"End early"** — always give the user an exit
4. **Coding Round** — editor left, avatar shrinks to picture-in-picture, run/test panel bottom
5. **Report** — hero score with an animated reveal, radar chart, expandable per-question cards, "Your 7-day plan" as a checklist
6. **Dashboard** — mastery heatmap, session history, streak, next recommended drill

**Micro-copy examples:** "Take your time — I'm not going anywhere." / "Good. Let's push on that a bit." / "That one was tough. Want a hint, or shall we move on?"

---

## 7. Optimized workflow

```
Upload resume (8s parse)
   └→ ATS score + skill entities extracted
        └→ Skills linked to knowledge graph → interview blueprint generated
             └→ Mic check (10s)
                  └→ INTERVIEW (15 / 30 / 45 min)
                       ├─ async per-answer scoring (never blocks speech)
                       └─ live candidate model updates
                            └→ Report generated during the closing question
                                 └→ Report ready 0–3s after "thanks for your time"
                                      └→ Study plan → drill mode → re-interview
```

Key optimizations: parse + blueprint happen while the user does the mic check; evaluation runs on a side channel; report is 80% assembled before the interview ends; audio chunks stream both directions, nothing is ever batched.

---

## 8. Build phases

| Phase | Duration | Deliverable |
|---|---|---|
| 1 | Week 1–2 | Resume parser + ATS scorer + JD match. Text-only. |
| 2 | Week 3–4 | Knowledge graph seeded (300+ nodes), text-based adaptive interview |
| 3 | Week 5–6 | Voice loop: STT → brain → TTS, barge-in, latency tuning |
| 4 | Week 7 | Avatar + expression engine + chat panel |
| 5 | Week 8 | Scoring, report, study plan, dashboard |
| 6 | Week 9–10 | Coding round, system-design canvas, company personas |
| 7 | Week 11–12 | Multilingual, accessibility, recruiter portal, polish |

For a college major project, Phases 1–5 are a complete, impressive submission. Phases 6–7 are what turn it into a product.

---

## 9. Datasets & content sourcing

- **Subjects:** GATE CSE syllabus + standard textbooks (Galvin, Korth, Tanenbaum, CLRS, Sipser) as topic scaffolding; generate seed questions with an LLM, then human-review
- **Questions:** Glassdoor/LeetCode/InterviewBit style question *categories* (write your own questions — don't scrape copyrighted banks)
- **Resumes:** synthetic corpus generated across roles for parser testing + any public resume dataset
- **ATS keywords:** mine real job postings via a jobs API for role-specific keyword frequency
- **Speech:** test on Indian-accented English corpora (e.g., SVARAH, IndicVoices) — most STT fails here and fixing it is your edge

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Latency kills the illusion | Filler audio + speculative pre-generation + streaming everywhere |
| STT fails on accents | Domain-biased vocabulary, per-user adaptation, always show text fallback |
| LLM hallucinates a wrong "ideal answer" | Ground every evaluation in retrieved rubric text; cite the graph node |
| Scoring feels unfair | Show the rubric, show the evidence, allow "I disagree" feedback that retrains prompts |
| Emotion detection legal exposure | Opt-in, never score on it, disclose clearly, allow full deletion |
| Cost per interview | Route cheap model for turn-taking, expensive model only for eval + report |

---

# 11. THE MASTER BUILD PROMPT

*Copy everything below into your AI coding assistant.*

---

> **Build PrepPilot, a full-stack AI interview preparation platform.**
>
> **Stack:** React + TypeScript + Vite + TailwindCSS frontend; FastAPI + WebSockets backend; PostgreSQL with pgvector; Redis; Docker Compose for local dev.
>
> **Build these modules in order:**
>
> **1. Resume & ATS module.** Accept PDF/DOCX/text upload. Parse layout-aware text, extract structured entities (contact, education, skills, projects, experience, achievements) using spaCy NER with an LLM extraction fallback. Compute an ATS score 0–100 from six weighted sub-scores: parseability, JD keyword coverage, formatting hygiene, quantified-impact density, section completeness, consistency. Return per-section red/amber/green annotations with specific fix suggestions and a one-click STAR-format bullet rewriter. Support pasting a job description for a gap report.
>
> **2. Knowledge graph.** Model B.Tech CSE subjects (DSA, OS, DBMS, CN, OOPS, COA, TOC, Compiler Design, Software Engineering, Discrete Math, System Design) and domain packs (AI/ML, DL, NLP, CV, Data Science, Data Engineering, Web, Mobile, Cloud/DevOps, Cybersecurity, Blockchain, IoT, QA). Each node: `{concept, subject, domain, difficulty 1–5, prerequisites[], seed_questions[], ideal_answer_rubric, common_misconceptions[], followup_probes[]}`. Seed 300+ nodes. Store embeddings in pgvector. Entity-link parsed resume skills to nodes.
>
> **3. Realtime voice interview.** WebRTC audio in, streaming STT out, LLM brain, streaming TTS back. Implement voice-activity detection with adaptive end-of-turn, barge-in support, and filler audio played while the brain thinks. Hard target: ≤1.2s perceived response gap. Interview flow: intro → resume deep-dive → project cross-examination → CS fundamentals → domain questions → optional coding/system-design → behavioral → candidate Q&A → close. Configurable 15/30/45 minutes.
>
> **4. Adaptive question engine.** After each answer compute `{correctness, depth, structure, relevance, confidence, hesitation, filler_rate, wpm}`. Maintain a rolling candidate model. Escalate difficulty on strong answers, scaffold or pivot after two consecutive struggles, and cross-examine any unverified resume claim with escalating probes. A coverage planner guarantees ≥3 resume claims, ≥4 core subjects, ≥3 domain nodes, ≥2 behavioral questions per session. Never repeat a question.
>
> **5. Expressive avatar.** Rive or Three.js animated interviewer with lip-sync to TTS, idle breathing/blinking, and expression states (neutral, encouraging, curious, impressed, probing) driven by the candidate model. Do NOT claim mind reading: infer engagement and stress from speech signals only. Optional, clearly opt-in webcam affect detection may soften the avatar's tone but MUST NOT affect the score.
>
> **6. Chat panel.** Speaker-labeled timestamped live transcript beside the avatar. Pinned current question. "Repeat", "Hint", and "Show as text" controls. Candidate may type instead of speak at any time.
>
> **7. Scoring & report.** Score each answer 0–5 on Correctness, Depth, Structure, Relevance, Communication, Ownership, grounded in the retrieved rubric. Generate a report with: overall score, 7-axis radar chart, per-question replay (your answer vs. ideal vs. what was missing), speech analytics (WPM, fillers, longest pause, talk-time ratio), top 5 strengths, top 5 gaps, and a 7-day and 30-day study plan linked to specific knowledge-graph nodes. Export as PDF. Explicitly exclude accent, dialect, name, gender, and appearance from all scoring.
>
> **8. Extra rounds.** Monaco-based coding round with Judge0 execution where the agent verbally questions the candidate's approach mid-solve. Excalidraw system-design canvas read by a vision model that challenges scaling and bottlenecks.
>
> **9. Personas & modes.** Company personas (Google SDE-1, Amazon LP, TCS NQT, startup founder) and interviewer personalities (Friendly Mentor, Neutral Panel, Stress — opt-in with an exit hatch). Group Discussion simulator with 3 AI participants. Spaced-repetition voice drill mode for weak nodes.
>
> **10. Dashboard & portal.** Per-topic mastery heatmap, score trend, streaks, session history, cohort percentile. Separate recruiter/placement-cell portal with bulk invites and exportable readiness analytics.
>
> **Design system.** Warm, calm, confidence-building — users are nervous students. Palette: `#1E1B4B` base, `#A5B4FC` accent, `#6EE7B7` success, `#FBBF24` needs-work (never red), `#FAFAF9` surfaces. Sora for headings, Inter for body, JetBrains Mono for code. 16px rounded cards, soft shadows, 300–500ms organic easing. Interview HUD: avatar center, transcript rail right, pinned question top, mic orb with live waveform bottom, round-progress ring, always-visible Pause and End Early. Micro-copy should be reassuring, e.g. "Take your time — I'm not going anywhere."
>
> **Performance.** Parse the resume and build the interview blueprint during the mic check. Run answer evaluation on an async side channel so it never blocks speech. Pre-generate the 2–3 likeliest follow-ups while the candidate is still answering. Assemble 80% of the report before the interview ends. Route a small fast model for turn-taking and a larger model only for evaluation and report generation.
>
> **Non-negotiables.** Explicit consent before any recording. Full data export and deletion. Audit log for every scoring decision. Text-only fallback for low bandwidth. Full keyboard navigation, captions on all avatar speech, screen-reader labels.
>
> Start with Phase 1 (resume + ATS, text-only), then the knowledge graph, then the voice loop. Produce clean, typed, tested, documented code with a README and Docker Compose setup.

---

## 12. What makes this stand out in a viva or demo

1. **Latency engineering** — show the 1.2s budget and how you hit it. Nobody else will have measured this.
2. **The honest reframe** — explaining *why* you replaced "mind reading" with multimodal signal inference, and citing the fairness reasoning, is the single most impressive thing you can say in a review.
3. **Indian-accent STT robustness** — a real, measurable, locally valuable contribution.
4. **Grounded evaluation** — every score traces back to a retrieved rubric node, not vibes.
5. **The closed loop** — interview gaps feed back into resume suggestions, which change the next interview.
