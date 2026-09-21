# PrepPilot — AI Interview Coach & ATS Analyzer

> A voice-first AI interview coaching platform that reads your resume, scores it against ATS algorithms, conducts an adaptive spoken interview with an animated agent, and delivers a scored performance report with an actionable study plan.

---

## 🌟 Key Features

### 1. Resume Intake & ATS Scoring
* **Multi-format parsing**: Upload PDF, DOCX, or paste raw text.
* **0–100 ATS Score Breakdown**:
  * Parseability & layout hygiene
  * Contact details & professional link validation
  * Section completeness (Education, Experience, Projects, Skills)
  * Quantified impact density (metrics, numbers, scale)
  * Action verbs & language quality (removes passive filler & fluff)
  * Target role & Job Description keyword matching
* **Interactive Resume Lab**: Red/amber/green highlight mode and text export.

### 2. Spoken Voice & Text Interview Simulator
* **Multimodal Spoken Agent**: Full voice interview with animated SVG avatar featuring dynamic facial expressions (*neutral, thinking, curious, encouraging, impressed, probing*).
* **Adaptive Questioning**: Real-time evaluation dynamically pivots question difficulty, probes claims from projects, or scaffolds when you struggle.
* **Dual Interaction Modes**: Full voice with Web Speech API recognition & speech synthesis, with instant typed fallback.
* **Interviewer Personas**: Friendly Mentor, Neutral Panel, Big-Tech Bar, or Startup Founder.

### 3. Speech Signal & Substance Analysis
* Real-time estimation of **Speaking Pace (WPM)**, **Filler-word frequency**, **Hedging patterns**, and **Confidence metrics**.
* Objective evaluation based solely on substance and rubrics (never penalizing accent, dialect, or background).

### 4. Comprehensive Performance Report
* Overall score out of 100 with an interactive **7-axis radar chart** (Technical, Problem Solving, Communication, Confidence, Structure, Domain Fit, Resume Fit).
* Question-by-question replay with rubric gaps, what was missed, and model answers.
* Automated **7-Day & 30-Day Personalized Study Plans**.
* Persistent history tracking across multiple interview sessions.

---

## 🚀 Quick Start (Local)

### Prerequisites
* [Node.js](https://nodejs.org/) (v16+) or modern web browser.

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/tarush5/PrepPilot.git
   cd PrepPilot
   ```

2. **Start the local server**:
   ```bash
   npm start
   # or
   node server.js
   ```

3. **Open in browser**:
   Navigate to [http://localhost:3000](http://localhost:3000).

*(Note: Running over `http://localhost` provides a secure context required by browsers for microphone and speech recognition features.)*

---

## ☁️ Deployment

### Option 1: GitHub Pages (Free & Instant)
1. Push code to GitHub repository.
2. In GitHub, go to **Settings** > **Pages**.
3. Under **Branch**, select `main` and `/ (root)`, then click **Save**.
4. Your site will be live at `https://tarush5.github.io/PrepPilot/`.

### Option 2: Vercel / Netlify
1. Connect your GitHub repository to [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
2. The root `index.html` and `preppilot.html` are automatically recognized and deployed with zero configuration.

---

## 🛠️ Tech Stack
* **Frontend**: HTML5, Vanilla JavaScript (ES2022+), CSS3 Variables & Design Tokens.
* **Speech & Media**: Web Speech API (`SpeechRecognition`, `speechSynthesis`), Web Audio API (`AudioContext`, `AnalyserNode`).
* **Parsers**: `pdf.js` for PDF documents, `mammoth.js` for DOCX extraction.
* **Backend**: Lightweight Node.js server.

---

## 📄 License
MIT License.
