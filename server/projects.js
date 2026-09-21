"use strict";
/* Project depth trees.
   Each archetype is a small graph of questions a senior interviewer would use
   to find out whether a candidate really built what their resume says. The
   interviewer never walks a tree top to bottom: a node is only eligible once
   its prerequisites have been asked, nodes the candidate already covered in
   passing are skipped, and nodes whose triggers appear in the last answer
   jump the queue. */
const { contentTokens, coverage } = require("./text");

const ARCHETYPES = [
  { id: "rag", label: "RAG system", re: /\b(rag|retrieval.augmented|langchain|llamaindex|vector (db|database|store)|pinecone|faiss|chroma)\b/i, nodes: [
    { id: "what", level: 3, q: p => `You mentioned ${p}. In your own words, what problem does RAG solve that a plain LLM call doesn't?`, keys: "grounding hallucination knowledge up-to-date context" },
    { id: "why", level: 4, needs: ["what"], q: () => "Why did you choose RAG for this, rather than fine-tuning or a simpler search?", keys: "fine-tuning cost data changes search" },
    { id: "chunk", level: 5, needs: ["what"], q: () => "How did you chunk the documents, and how did you pick the chunk size?", keys: "chunk size overlap tokens paragraph", triggers: /chunk|split|document/i },
    { id: "embed", level: 5, needs: ["chunk"], q: () => "Which embedding model did you use, and why that one?", keys: "embedding model dimension sentence-transformer", triggers: /embed/i },
    { id: "store", level: 5, needs: ["embed"], q: () => "Which vector database did you use, and how does it find nearest neighbours quickly?", keys: "vector database index hnsw ann cosine", triggers: /vector|pinecone|faiss|chroma|weaviate|qdrant/i },
    { id: "eval", level: 7, needs: ["chunk"], q: () => "How did you evaluate retrieval on its own — separately from the final answers?", keys: "recall@k precision mrr evaluation ground truth", triggers: /evaluat|accura|quality/i },
    { id: "irrelevant", level: 7, needs: ["store"], q: () => "What happens when retrieval returns irrelevant chunks? How does the system behave?", keys: "rerank threshold fallback refuse", triggers: /irrelevant|wrong|bad result/i },
    { id: "halluc", level: 7, needs: ["irrelevant"], q: () => "How did you reduce hallucinations in the final answers?", keys: "citation grounding prompt refuse verify", triggers: /hallucinat|made up|wrong answer/i },
    { id: "scale", level: 8, needs: ["store"], q: () => "How would this scale to millions of documents — what changes?", keys: "sharding approximate index latency cost batch" },
  ] },
  { id: "timeseries", label: "time-series model", re: /\b(lstm|gru|rnn|time.?series|forecast|rul|remaining useful life|sequence model)\b/i, nodes: [
    { id: "prep", level: 4, q: p => `You mentioned ${p}. Can you walk me through how you prepared the time-series data before feeding it to the model?`, keys: "window scaling normalization missing values lag" },
    { id: "why", level: 6, needs: ["prep"], q: () => "Why did you choose an LSTM instead of a Transformer-based time-series model?", keys: "transformer attention data size sequence length compute", triggers: /lstm|rnn/i },
    { id: "leak", level: 6, needs: ["prep"], q: () => "How did you split train and test without leaking the future into training?", keys: "chronological split walk-forward leakage" },
    { id: "eval", level: 5, needs: ["prep"], q: () => "How did you evaluate the predictions, and what metric did you use?", keys: "rmse mae mape error metric baseline", triggers: /evaluat|accura|error|result/i },
    { id: "baseline", level: 6, needs: ["eval"], q: () => "What simple baseline did you compare against, and by how much did you beat it?", keys: "baseline naive linear regression persistence" },
    { id: "deploy", level: 7, needs: ["eval"], q: () => "How would this run in production — how often does it retrain, and what tells you it's drifting?", keys: "retrain drift monitoring schedule" },
  ] },
  { id: "classic_ml", label: "machine learning model", re: /\b(random forest|xgboost|logistic regression|decision tree|svm|classifier|regression model|churn|fraud|scikit|sklearn|prediction model)\b/i, nodes: [
    { id: "problem", level: 3, q: p => `Tell me about ${p}. What were you predicting, and what did the data look like?`, keys: "target features rows label dataset" },
    { id: "model_why", level: 5, needs: ["problem"], q: () => "What made you choose that model over the alternatives you considered?", keys: "compared baseline interpretability performance xgboost logistic", triggers: /random forest|xgboost|model/i },
    { id: "validate", level: 5, needs: ["problem"], q: () => "How did you validate its performance, and what metric did you use?", keys: "cross-validation test set metric f1 auc", triggers: /accura|perform|result|good/i },
    { id: "imbalance", level: 6, needs: ["validate"], q: () => "Were the classes balanced? If not, how did that affect your metric and your training?", keys: "imbalance smote class weight precision recall", triggers: /accuracy/i },
    { id: "features", level: 6, needs: ["problem"], q: () => "Which features mattered most, and how do you know?", keys: "feature importance shap correlation engineering" },
    { id: "overfit", level: 6, needs: ["model_why"], q: () => "How did you check it wasn't overfitting?", keys: "train validation gap regularization depth" },
    { id: "deploy", level: 7, needs: ["validate"], q: () => "If this went to production tomorrow, what would you monitor?", keys: "drift monitoring retrain latency" },
  ] },
  { id: "vision", label: "computer-vision model", re: /\b(cnn|image|vision|opencv|yolo|resnet|classification of images|object detection|segmentation)\b/i, nodes: [
    { id: "data", level: 4, q: p => `You mentioned ${p}. Tell me about the dataset — how many images, how many classes, and how clean was it?`, keys: "images classes labels balance" },
    { id: "arch", level: 5, needs: ["data"], q: () => "Which architecture did you use, and did you train from scratch or fine-tune a pretrained model?", keys: "pretrained transfer learning resnet fine-tune" },
    { id: "aug", level: 5, needs: ["data"], q: () => "What augmentation did you use, and why those?", keys: "augmentation rotation flip color jitter" },
    { id: "eval", level: 6, needs: ["arch"], q: () => "How did you evaluate it beyond overall accuracy?", keys: "confusion matrix per-class precision recall", triggers: /accura/i },
    { id: "real", level: 7, needs: ["eval"], q: () => "How does it do on real-world images that look different from your training set?", keys: "domain shift generalization lighting background" },
  ] },
  { id: "backend", label: "backend system", re: /\b(api|backend|server|microservice|url shortener|node\.?js|express|django|flask|spring|redis|postgres|database|requests per second|rps|latency)\b/i, nodes: [
    { id: "arch", level: 4, q: p => `Let's talk about ${p}. Walk me through the architecture — what are the main pieces and how does a request flow through them?`, keys: "client api database cache service flow" },
    { id: "role", level: 3, needs: ["arch"], q: () => "Which parts did you personally build?", keys: "i built i wrote i designed my part" },
    { id: "tech_why", level: 5, needs: ["arch"], q: () => "Why that database and stack, rather than the obvious alternatives?", keys: "tradeoff chose because alternative" },
    { id: "bottleneck", level: 6, needs: ["arch"], q: () => "What was the biggest bottleneck you hit, and how did you find it?", keys: "profil bottleneck slow latency measure", triggers: /slow|latency|bottleneck|performance/i },
    { id: "measure", level: 5, needs: ["arch"], q: () => "You quote performance numbers — how did you measure them?", keys: "load test k6 jmeter benchmark", triggers: /\d+\s?(rps|qps|ms|%|requests)/i },
    { id: "scale", level: 7, needs: ["bottleneck"], q: () => "What breaks first at ten times the load?", keys: "scale shard replica horizontal" },
    { id: "failure", level: 7, needs: ["arch"], q: () => "What happens when the database goes down? How does the system behave?", keys: "failover retry timeout degrade" },
    { id: "security", level: 6, needs: ["arch"], q: () => "How did you handle authentication and abuse — rate limiting, input validation?", keys: "auth jwt rate limit validation" },
    { id: "testing", level: 5, needs: ["role"], q: () => "How did you test it before it went live?", keys: "unit integration load test" },
  ] },
  { id: "realtime", label: "real-time system", re: /\b(websockets?|socket\.io|real.?time|chat app|live updates|streaming)\b/i, nodes: [
    { id: "arch", level: 4, q: p => `Tell me about ${p}. How do messages get from one user to another?`, keys: "websocket server broadcast room" },
    { id: "scale", level: 6, needs: ["arch"], q: () => "What happens to connections when you run more than one server?", keys: "pub/sub redis sticky sessions", triggers: /server|scale|users/i },
    { id: "order", level: 6, needs: ["arch"], q: () => "How do you guarantee message ordering and handle a user who disconnects and comes back?", keys: "ordering sequence reconnect history" },
    { id: "persist", level: 5, needs: ["arch"], q: () => "Where are messages stored, and why there?", keys: "database persist history" },
  ] },
  { id: "pipeline", label: "data pipeline", re: /\b(etl|pipeline|airflow|spark|kafka|ingest|data warehouse|bigquery|dbt)\b/i, nodes: [
    { id: "flow", level: 4, q: p => `Walk me through ${p} — where does data come from and where does it land?`, keys: "source transform load schedule" },
    { id: "volume", level: 5, needs: ["flow"], q: () => "How much data per run, and how long does a run take?", keys: "gb rows minutes volume" },
    { id: "fail", level: 6, needs: ["flow"], q: () => "What happens if a run fails halfway? Can you safely re-run it?", keys: "idempotent retry checkpoint" },
    { id: "quality", level: 6, needs: ["flow"], q: () => "How do you catch bad data before it reaches downstream users?", keys: "validation schema checks alerts" },
  ] },
  { id: "generic", label: "project", re: /./, nodes: [
    { id: "overview", level: 3, q: p => `Tell me about ${p}. What problem was it solving, and what did you personally build?`, keys: "problem built my role" },
    { id: "decision", level: 5, needs: ["overview"], q: () => "What was the hardest technical decision you made on it, and what did you trade off?", keys: "decision tradeoff chose because" },
    { id: "challenge", level: 5, needs: ["overview"], q: () => "What went wrong along the way, and how did you fix it?", keys: "bug problem fixed debug" },
    { id: "measure", level: 5, needs: ["overview"], q: () => "How did you know it worked — what did you measure?", keys: "metric measure test result" },
    { id: "improve", level: 6, needs: ["decision"], q: () => "If you rebuilt it today, what would you do differently?", keys: "differently improve refactor" },
  ] },
];

function archetypeOf(text) {
  return (ARCHETYPES.find(a => a.id !== "generic" && a.re.test(text)) || ARCHETYPES.at(-1)).id;
}
const ARCH = Object.fromEntries(ARCHETYPES.map(a => [a.id, a]));

/**
 * Pick the next question in a project's tree.
 * `thread` = { archetype, asked: [ids], covered: [ids] }; `lastAnswer` steers it.
 */
function nextProjectQuestion(thread, lastAnswer, difficulty) {
  const arch = ARCH[thread.archetype] || ARCH.generic;
  const done = new Set([...(thread.asked || []), ...(thread.covered || [])]);
  const eligible = arch.nodes.filter(n => !done.has(n.id) && (n.needs || []).every(x => (thread.asked || []).includes(x) || (thread.covered || []).includes(x)));
  if (!eligible.length) return null;
  const ans = String(lastAnswer || "");
  const target = difficulty;
  eligible.sort((a, b) => {
    const trig = n => (n.triggers && n.triggers.test(ans) ? -3 : 0);
    return (trig(a) + Math.abs(a.level - target) * .5) - (trig(b) + Math.abs(b.level - target) * .5);
  });
  return eligible[0];
}

/** Which tree nodes did an answer already cover in passing? */
function coveredBy(thread, answer) {
  const arch = ARCH[thread.archetype] || ARCH.generic;
  const tok = contentTokens(answer);
  return arch.nodes.filter(n => coverage(contentTokens(n.keys), tok) >= .5).map(n => n.id);
}

module.exports = { ARCHETYPES, ARCH, archetypeOf, nextProjectQuestion, coveredBy };
