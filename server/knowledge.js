"use strict";
/* Interview knowledge.
   The topic graph lives in preppilot.html and is read from there at boot, so
   the browser engine and the server never drift apart. Everything else here —
   the skill lexicon, the follow-up hooks, the misconception library — is what
   lets the interviewer react to what a candidate actually said. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadGraph() {
  const src = fs.readFileSync(path.join(__dirname, "..", "preppilot.html"), "utf8");
  const start = src.indexOf("const N = (id, c, s, d, keys, q, rubric, probes) =>");
  const endMark = src.indexOf("   2 · app state");
  if (start < 0 || endMark < 0) throw new Error("knowledge graph markers not found in preppilot.html");
  const code = src.slice(start, src.lastIndexOf("/*", endMark)) + ";({ KG, HR_Q })";
  const { KG, HR_Q } = vm.runInContext(code, vm.createContext({}), { timeout: 1000 });
  return { KG, HR_Q };
}
const { KG, HR_Q } = loadGraph();
const NODE = Object.fromEntries(KG.map(n => [n.id, n]));

/* Canonical skills with aliases — the vocabulary for resume/JD matching. */
const SKILLS = {
  "Python": ["python", "pandas", "numpy", "django", "flask", "fastapi"],
  "Java": ["java", "spring", "spring boot", "jvm"],
  "C++": ["c++", "cpp", "stl"],
  "JavaScript": ["javascript", "js", "es6", "node", "node.js", "typescript", "react"],
  "TypeScript": ["typescript", "ts"],
  "Go": ["golang", "go lang"],
  "SQL": ["sql", "mysql", "postgres", "postgresql", "sqlite", "joins", "query optimization"],
  "NoSQL": ["mongodb", "cassandra", "dynamodb", "nosql", "couchdb"],
  "Data Structures & Algorithms": ["data structures", "algorithms", "dsa", "leetcode", "dynamic programming"],
  "OOP": ["oop", "object oriented", "object-oriented", "design patterns", "solid"],
  "System Design": ["system design", "scalability", "distributed", "load balancer", "sharding", "high availability", "microservices"],
  "REST APIs": ["rest", "restful", "api", "apis", "endpoint", "openapi"],
  "GraphQL": ["graphql"],
  "React": ["react", "react.js", "next.js", "redux"],
  "Node.js": ["node", "node.js", "express"],
  "Machine Learning": ["machine learning", "ml", "scikit-learn", "sklearn", "xgboost", "random forest", "regression", "classification"],
  "Deep Learning": ["deep learning", "neural network", "pytorch", "tensorflow", "keras", "cnn", "lstm", "rnn"],
  "NLP": ["nlp", "natural language", "bert", "tokenization", "text classification"],
  "Computer Vision": ["computer vision", "opencv", "cnn", "image classification", "object detection", "yolo"],
  "LLMs": ["llm", "large language model", "gpt", "prompt engineering", "fine-tuning", "hugging face", "transformers"],
  "RAG": ["rag", "retrieval augmented", "langchain", "llamaindex", "vector database", "embeddings", "faiss", "pinecone", "chroma"],
  "MLOps": ["mlops", "model serving", "mlflow", "model monitoring", "kubeflow"],
  "Statistics": ["statistics", "hypothesis testing", "a/b testing", "probability", "regression analysis"],
  "Data Visualization": ["tableau", "power bi", "matplotlib", "seaborn", "plotly", "dashboard"],
  "Spark": ["spark", "pyspark", "databricks"],
  "Hadoop": ["hadoop", "hdfs", "hive", "mapreduce"],
  "Kafka": ["kafka", "event streaming"],
  "Redis": ["redis", "caching", "cache"],
  "AWS": ["aws", "amazon web services", "ec2", "s3", "lambda", "sagemaker", "cloudwatch"],
  "Azure": ["azure"],
  "GCP": ["gcp", "google cloud", "bigquery"],
  "Docker": ["docker", "container", "containerized", "dockerfile"],
  "Kubernetes": ["kubernetes", "k8s", "helm"],
  "CI/CD": ["ci/cd", "cicd", "jenkins", "github actions", "gitlab ci", "continuous integration"],
  "Linux": ["linux", "bash", "shell scripting", "unix"],
  "Git": ["git", "github", "gitlab", "version control"],
  "Testing": ["unit test", "testing", "pytest", "junit", "jest", "selenium", "cypress", "tdd"],
  "Security": ["security", "owasp", "authentication", "authorization", "encryption", "jwt", "oauth"],
  "Networking": ["tcp", "udp", "http", "dns", "networking", "osi"],
  "Operating Systems": ["operating system", "process", "thread", "scheduling", "memory management", "concurrency"],
  "Excel": ["excel", "vlookup", "pivot table"],
  "Communication": ["stakeholder", "presentation", "communication", "cross-functional"],
};
const skillPattern = {};
for (const [k, al] of Object.entries(SKILLS)) skillPattern[k] = al;

/* Graph topics that evidence each skill — how interview performance feeds the JD matrix. */
const SKILL_TOPICS = {
  "Python": ["lang-py"], "Java": ["lang-java"], "SQL": ["db-sql", "db-index", "db-norm", "db-txn"], "NoSQL": ["db-nosql"],
  "Data Structures & Algorithms": ["dsa-complexity", "dsa-hash", "dsa-trees", "dsa-graph", "dsa-dp", "dsa-sorting", "dsa-heap", "dsa-string"],
  "OOP": ["oop-core", "oop-solid"], "System Design": ["sd-scale", "sd-cache", "sd-api", "sd-queue"], "REST APIs": ["sd-api", "cn-http", "web-back"],
  "React": ["web-front"], "Node.js": ["web-back"], "JavaScript": ["web-front", "web-back"],
  "Machine Learning": ["ml-basics", "ml-overfit", "ml-feature", "ml-eval"], "Deep Learning": ["dl-nn", "dl-cnn", "dl-nlp"],
  "NLP": ["dl-nlp"], "Computer Vision": ["dl-cnn"], "LLMs": ["llm-core"], "RAG": ["rag-core"], "MLOps": ["ml-deploy"],
  "Statistics": ["ds-stats"], "Spark": ["de-pipe"], "Kafka": ["sd-queue"], "Redis": ["sd-cache"],
  "AWS": ["cloud-core"], "Azure": ["cloud-core"], "GCP": ["cloud-core"], "Docker": ["cloud-core", "ml-deploy"], "Kubernetes": ["cloud-core"],
  "CI/CD": ["se-sdlc"], "Testing": ["se-test", "qa-core"], "Security": ["sec-core"], "Networking": ["cn-tcp", "cn-http", "cn-osi"],
  "Operating Systems": ["os-process", "os-sync", "os-memory", "os-sched"],
};

/* Mention hooks: when a candidate says X, a thoughtful interviewer asks Y.
   `unless` suppresses the hook when the answer already addressed it. */
const HOOKS = [
  { id: "rf-why", re: /\brandom forests?\b/i, unless: /xgboost|gradient boost|logistic regression|compared|instead of/i, topic: "ml-basics", level: 5,
    q: "What made you choose Random Forest over something like XGBoost or logistic regression?" },
  { id: "xgb-why", re: /\bxgboost|gradient boost(ing|ed)?\b/i, unless: /random forest|overfit|learning rate|depth/i, topic: "ml-overfit", level: 6,
    q: "Boosted trees overfit easily. What did you tune to keep XGBoost from overfitting?" },
  { id: "acc-imbalance", re: /\baccuracy\b/i, unless: /precision|recall|f1|auc|imbalanc|stratif/i, topic: "ml-eval", level: 5,
    when: s => /churn|fraud|default|disease|anomal|rare|spam|classif|model|predict/i.test(s.context),
    q: ctx => `For a ${ctx.problem || "classification"} problem, accuracy can be misleading if the classes are imbalanced. Did you check precision, recall, or F1-score?` },
  { id: "validate-how", re: /\b(good|great|high|decent) (accuracy|results?|performance)\b|\bit worked\b|\bworked well\b/i, unless: /cross.?valid|test set|held.?out|validation set|metric/i, topic: "ml-eval", level: 4,
    q: "That makes sense from a practical perspective. How did you actually validate that performance, and what metric did you use?" },
  { id: "lstm-why", re: /\blstm\b/i, unless: /transformer|attention|compared/i, topic: "dl-nlp", level: 6,
    q: "Why did you choose an LSTM instead of a Transformer-based time-series model?" },
  { id: "lstm-prep", re: /\blstm|time.?series|sequence\b/i, unless: /window|normaliz|scal|lag/i, topic: "dl-nn", level: 5,
    q: "How did you prepare the time-series data before feeding it into the model — windowing, scaling, handling gaps?" },
  { id: "rag-chunk", re: /\brag\b|retrieval|langchain|llamaindex|vector (db|database|store)/i, unless: /chunk/i, topic: "rag-core", level: 6,
    q: "How did you chunk the documents, and how did you pick the chunk size?" },
  { id: "rag-eval", re: /\brag\b|retrieval|vector (db|database|store)/i, unless: /recall@|evaluat|precision@|mrr|ragas/i, topic: "rag-core", level: 7,
    q: "How did you evaluate the retrieval step on its own, separately from the final answers?" },
  { id: "embed-model", re: /\bembeddings?\b/i, unless: /ada|minilm|bge|e5|sentence.?transformer|openai|cohere/i, topic: "rag-core", level: 6,
    q: "Which embedding model did you use, and why that one?" },
  { id: "halluc", re: /\b(llm|gpt|chatbot|generat(ive|ed) answers?)\b/i, unless: /hallucinat|ground|cite|citation/i, topic: "llm-core", level: 7,
    q: "How did you detect or reduce hallucinations in the generated answers?" },
  { id: "cache-invalid", re: /\b(redis|cach(e|ing|ed))\b/i, unless: /invalidat|ttl|evict|stale|consisten/i, topic: "sd-cache", level: 6,
    q: "How did you handle cache invalidation — what stops users from seeing stale data?" },
  { id: "mongo-why", re: /\bmongo(db)?\b/i, unless: /relational|schema|sql|join|why/i, topic: "db-nosql", level: 5,
    q: "What made a document database the right fit there, rather than a relational one?" },
  { id: "sql-index", re: /\b(postgres(ql)?|mysql|sql server|slow quer(y|ies))\b/i, unless: /index|explain|query plan/i, topic: "db-index", level: 5,
    q: "When a query got slow, how did you find out why — did you look at the query plan or the indexes?" },
  { id: "micro-why", re: /\bmicroservices?\b/i, unless: /monolith|why|tradeoff|trade-off/i, topic: "sd-scale", level: 6,
    q: "Why microservices rather than a well-structured monolith at that scale? What did it cost you?" },
  { id: "kafka-sem", re: /\bkafka|message queue|rabbitmq|pub.?sub\b/i, unless: /exactly.once|at.least.once|idempot|ordering/i, topic: "sd-queue", level: 7,
    q: "What delivery guarantee did you rely on — at-least-once? How did consumers handle duplicates?" },
  { id: "docker-k8s", re: /\b(docker|kubernetes|k8s)\b/i, unless: /health.?check|probe|image size|replica/i, topic: "cloud-core", level: 5,
    q: "How did you know a container was actually healthy in production — what checks were in place?" },
  { id: "ws-scale", re: /\bwebsockets?|socket\.io|real.?time chat\b/i, unless: /sticky|pub.?sub|redis adapter|horizontal/i, topic: "sd-scale", level: 6,
    q: "What happens to your WebSocket connections when you scale to more than one server?" },
  { id: "measure-claim", re: /\b\d[\d,.]*\s?(%|x\b|rps|qps|ms|requests per second|users)\b/i, unless: /measur|benchmark|load test|k6|jmeter|profil/i, topic: null, level: 5,
    q: ctx => `You mentioned ${ctx.number}. How did you actually measure that?` },
  { id: "ownership", re: /\bwe\b/i, unless: /\bI (built|wrote|designed|implemented|led|owned|did|was responsible)\b/i, topic: null, level: 4,
    when: s => (s.text.match(/\bwe\b/gi) || []).length >= 3 && !(s.text.match(/\bI\b/g) || []).length,
    q: "You've said \"we\" a lot — which part of that did you personally build?" },
];

/* Statements that are simply wrong. Used to classify INCORRECT and to ask a
   diagnostic question instead of moving on. */
const MISCONCEPTIONS = [
  { re: /hash ?(map|table)s?[^.]{0,60}\bo\s?\(\s?log\s?n\s?\)/i, topic: "dsa-hash", fix: "Average-case hash table lookup is O(1); O(log n) is a balanced tree.",
    probe: "Walk me through what actually happens when you look up a key in a hash table — where does the time go?" },
  { re: /binary search[^.]{0,60}(unsorted|any (array|list))/i, topic: "dsa-sorting", fix: "Binary search requires sorted input.",
    probe: "What property of the input does binary search depend on, and what breaks without it?" },
  { re: /\btcp\b[^.]{0,40}\b(faster than udp|connectionless)/i, topic: "cn-tcp", fix: "TCP is connection-oriented and generally slower than UDP due to handshakes, acknowledgements and retransmission.",
    probe: "What does TCP do on every connection that UDP skips, and what does that cost?" },
  { re: /\budp\b[^.]{0,40}\b(reliable|guarantees? (delivery|order))/i, topic: "cn-tcp", fix: "UDP guarantees neither delivery nor ordering.",
    probe: "If a UDP packet is lost, who notices, and who fixes it?" },
  { re: /index(es|ing)?[^.]{0,40}(speeds? up|faster|improves?)[^.]{0,20}(writes?|inserts?|updates?)/i, topic: "db-index", fix: "Indexes speed up reads but slow writes, because every write must maintain the index.",
    probe: "What does the database have to do to an index every time you insert a row?" },
  { re: /accuracy[^.]{0,40}(is (enough|the best|all you need|a good metric)|is fine)[^.]{0,40}(imbalanc|churn|fraud|rare)?/i, topic: "ml-eval", fix: "Accuracy is misleading under class imbalance; use precision/recall/F1 or PR-AUC.",
    probe: "If only 3% of customers churn, what accuracy does a model that predicts 'no churn' for everyone get?" },
  { re: /more (training )?data[^.]{0,30}(causes?|increases?|leads? to) overfit/i, topic: "ml-overfit", fix: "More data generally reduces overfitting.",
    probe: "Think about what overfitting is memorising — does giving the model more examples make memorising easier or harder?" },
  { re: /(add|more|increase)[^.]{0,20}(layers|parameters|epochs)[^.]{0,30}(fix|reduce|prevent|solve)s? overfit/i, topic: "ml-overfit", fix: "More capacity or epochs usually makes overfitting worse, not better.",
    probe: "What happens to training loss and validation loss as you add epochs past the best point?" },
  { re: /processes[^.]{0,30}share[^.]{0,20}(the same )?(memory|address space)/i, topic: "os-process", fix: "Threads share an address space; processes have separate ones by default.",
    probe: "If two processes need to share data, what mechanism do they actually have to use?" },
  { re: /(https|ssl|tls|encrypt(ion|ing)?)[^.]{0,40}(prevents?|stops?|fix(es)?)[^.]{0,20}sql injection/i, topic: "sec-core", fix: "SQL injection is prevented by parameterised queries; transport encryption doesn't touch it.",
    probe: "Where exactly does SQL injection happen — in transit, or when the query is built?" },
  { re: /docker[^.]{0,30}(is a|is like a|basically a) (virtual machine|vm)/i, topic: "cloud-core", fix: "Containers share the host kernel; VMs virtualise hardware and run their own kernel.",
    probe: "What does a container share with its host that a virtual machine doesn't?" },
  { re: /rest[^.]{0,20}(is|are) (a protocol|stateful)/i, topic: "sd-api", fix: "REST is an architectural style and is stateless between requests.",
    probe: "Where does the session state live in a REST API, if not on the server?" },
  { re: /\bstacks?\b[^.]{0,20}\b(fifo|first.in.first.out)\b|\bqueues?\b[^.]{0,20}\b(lifo|last.in.first.out)\b/i, topic: "dsa-complexity", fix: "A stack is LIFO and a queue is FIFO.",
    probe: "Which one would you use to implement undo, and why?" },
  { re: /dropout[^.]{0,50}(during|at|in) (inference|test(ing)?|prediction)/i, topic: "dl-nn", fix: "Dropout is applied during training and disabled at inference.",
    probe: "What would happen to your predictions if dropout stayed on at inference time?" },
  { re: /primary keys?[^.]{0,30}(can be|may be|allowed to be) null/i, topic: "db-norm", fix: "Primary keys cannot be NULL and must be unique.",
    probe: "What two guarantees does a primary key give you?" },
];

/* A production scenario per subject, for pushing a strong candidate further. */
const SCENARIOS = {
  DSA: "Now suppose the input no longer fits in memory — say 500GB on disk. How does your approach change?",
  DBMS: "Let's consider a production scenario: this table now takes 20,000 writes a second. What breaks first, and what do you change?",
  OS: "In production, a service is stuck at 100% CPU but doing no useful work. How do you find out what's going on?",
  CN: "Users in one region report the site is slow but it's fine for you. How do you narrow that down?",
  OOPS: "Six months later a new requirement doesn't fit your class hierarchy. What do you do?",
  SysDesign: "Let's consider a production scenario: traffic grows tenfold overnight. Which component fails first, and how would you know?",
  AIML: "Let's consider a production scenario: your model's live accuracy quietly drops over three months. How do you detect it, and what do you do?",
  DL: "In production, inference is too slow for your latency budget. What are your options, in order?",
  CV: "Your vision model works in the lab and fails on real phone photos. Why, and what do you do?",
  NLP: "Your text model is deployed to a new user group who write very differently. What goes wrong and how do you catch it?",
  GenAI: "Let's consider a production scenario: users report confident but wrong answers. How do you find where they come from?",
  Cloud: "Your cloud bill doubled this month with no traffic change. Where do you look?",
  Web: "The page is fast on your laptop and slow on a mid-range phone. How do you approach that?",
  Security: "You discover an API key was committed to a public repo an hour ago. Walk me through your next thirty minutes.",
  SE: "A release broke a feature that had tests. How did that happen, and what do you change?",
  default: "Let's consider a production scenario: this is now serving real users and something fails at 2 a.m. What's your first move?",
};

module.exports = { KG, HR_Q, NODE, SKILLS: skillPattern, SKILL_TOPICS, HOOKS, MISCONCEPTIONS, SCENARIOS };
