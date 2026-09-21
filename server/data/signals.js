"use strict";
/* Reaction signals: the things a candidate says that a good interviewer does
   not let pass.

   HOOKS fire on a claim that invites an obvious follow-up ("I used Random
   Forest" → "why not XGBoost?"). `unless` suppresses the hook when the answer
   already covered it, which is what stops the interviewer asking something the
   candidate just answered.

   MISCONCEPTIONS fire on statements that are simply wrong. They carry both the
   correction (for the report) and a diagnostic probe — we ask the candidate to
   reason it out rather than telling them they're wrong, because the probe is
   what reveals whether it was a slip or a genuine gap.

   Both lists extend the ones in knowledge.js rather than replacing them. */

const HOOKS = [
  /* --- backend & systems --- */
  { id: "idempotent-retry", re: /\bretr(y|ies|ied)\b|\btimeout\b/i, unless: /idempoten|duplicate|dedup|exactly.once/i, topic: "sd-idempotency", level: 6,
    q: "If that request is retried after a timeout, what stops the work happening twice?" },
  { id: "queue-fail", re: /\b(queue|worker|background job|celery|sidekiq|bull)\b/i, unless: /retry|dead.letter|dlq|failure|poison/i, topic: "sd-queue", level: 6,
    q: "What happens to a job that fails halfway through — does it retry, and where does it go if it keeps failing?" },
  { id: "tx-boundary", re: /\btransaction(s|al)?\b/i, unless: /isolation|rollback|commit|deadlock|level/i, topic: "db-isolation", level: 6,
    q: "What isolation level were you running at, and did that matter for what you were doing?" },
  { id: "n-plus-one", re: /\b(orm|sqlalchemy|hibernate|active ?record|prisma|django models)\b/i, unless: /n\+1|eager|join|select_related|prefetch/i, topic: "db-locking", level: 5,
    q: "ORMs make N+1 queries easy to write by accident. Did you hit that, and how would you spot it?" },
  { id: "scale-bottleneck", re: /\bscal(e|ed|ing|able)\b/i, unless: /bottleneck|saturat|profil|measur|first/i, topic: "sd-scale", level: 6,
    q: "When you say it scaled — what was the bottleneck you were actually removing?" },
  { id: "lb-health", re: /\b(load balanc|nginx|haproxy|ingress)\w*\b/i, unless: /health|probe|drain|failover/i, topic: "sd-loadbalance", level: 5,
    q: "How did the load balancer know an instance had gone bad?" },
  { id: "ratelimit-how", re: /\brate limit\w*\b|\bthrottl\w*\b/i, unless: /token bucket|leaky|window|redis|distributed/i, topic: "sd-ratelimit", level: 6,
    q: "How was that rate limit enforced across more than one server?" },

  /* --- data & ML --- */
  { id: "split-how", re: /\b(train|training)\b.{0,30}\b(test|validation|split)\b|\btrain.test split\b/i, unless: /temporal|time.based|group|stratif|leakage/i, topic: "ml-leakage", level: 6,
    q: "How did you split the data, and could anything from the future have leaked into training?" },
  { id: "scaler-leak", re: /\b(standard ?scaler|normali[sz]|min.?max|scaling)\b/i, unless: /fit.?transform.{0,20}train|after (the )?split|pipeline|inside the fold/i, topic: "ml-leakage", level: 6,
    q: "Did you fit the scaler before or after splitting the data?" },
  { id: "smote-when", re: /\bsmote|oversampl|undersampl|resampl\w*\b/i, unless: /inside|within|fold|after split|pipeline/i, topic: "ml-imbalance", level: 7,
    q: "Where in the pipeline did the resampling happen — before the split, or inside each fold?" },
  { id: "threshold", re: /\b(classif\w+|predict\w*)\b/i, unless: /threshold|cut.?off|0\.5|decision boundary/i, topic: "ml-imbalance", level: 6,
    when: s => /imbalanc|churn|fraud|rare|precision|recall/i.test(s.context + " " + s.text),
    q: "What decision threshold did you use, and how did you choose it?" },
  { id: "feature-why", re: /\bfeature (engineering|selection)\b|\bfeatures? I (created|built|made)\b/i, unless: /importance|shap|ablation|dropped|correlat/i, topic: "ml-feature", level: 6,
    q: "Which features actually carried the signal, and how did you find that out?" },
  { id: "drift-monitor", re: /\b(deploy|production|live|serving)\w*\b/i, unless: /monitor|drift|retrain|alert|degrad/i, topic: "ml-drift", level: 7,
    when: s => /model|ml|predict|inference/i.test(s.context + " " + s.text),
    q: "Once it was live, how would you know if the model started getting worse?" },
  { id: "baseline", re: /\b(model|accuracy|f1|auc)\b/i, unless: /baseline|compared|naive|majority class|random/i, topic: "ml-eval", level: 5,
    when: s => /\d/.test(s.text) && /model|accuracy|f1|auc/i.test(s.text),
    q: "What was your baseline — what would a trivial model have scored?" },

  /* --- GenAI --- */
  { id: "rag-hybrid", re: /\b(vector search|semantic search|embeddings? search)\b/i, unless: /bm25|hybrid|keyword|lexical|rerank/i, topic: "rag-advanced", level: 7,
    q: "Pure vector search tends to miss exact identifiers and rare terms. Did you combine it with keyword search?" },
  { id: "rag-rerank", re: /\btop.?k\b|\bretriev\w+\b/i, unless: /rerank|cross.encoder|cohere rerank/i, topic: "rag-advanced", level: 7,
    q: "Did you rerank the retrieved chunks before putting them in the prompt?" },
  { id: "llm-eval-how", re: /\b(prompt|llm|gpt|claude|chatbot)\b/i, unless: /eval|test set|regression|measur|graded/i, topic: "llm-eval", level: 7,
    q: "When you changed a prompt, how did you know the change actually made it better?" },
  { id: "agent-bound", re: /\bagent(ic|s)?\b|\btool.call\w*\b/i, unless: /budget|limit|loop|guardrail|approval|max steps/i, topic: "llm-agents", level: 7,
    q: "What stopped the agent looping forever or running up unbounded cost?" },

  /* --- frontend & general --- */
  { id: "perf-measure", re: /\b(faster|optimi[sz]ed|improved performance|sped up)\b/i, unless: /profil|measur|benchmark|lighthouse|devtools|before and after/i, topic: "web-perf", level: 5,
    q: "How did you measure that it was actually faster?" },
  { id: "auth-store", re: /\bjwt\b|\btoken.based auth\w*\b/i, unless: /httponly|localstorage|cookie|refresh|revoke|expir/i, topic: "web-auth", level: 6,
    q: "Where did you store the token in the browser, and what were the tradeoffs?" },
  { id: "test-what", re: /\btests?\b|\btesting\b/i, unless: /unit|integration|e2e|mock|coverage|pyramid|pytest|jest|junit/i, topic: "qa-strategy", level: 4,
    q: "What kind of tests — unit, integration, end-to-end? Where did you draw the line?" },
  { id: "deploy-rollback", re: /\b(deploy|release|ship)\w*\b/i, unless: /rollback|revert|canary|blue.green|feature flag/i, topic: "cloud-iac", level: 5,
    q: "If a deploy went wrong, how quickly could you get back to the previous version?" },
  { id: "secret-handling", re: /\b(api key|secret|credential|password|token)s?\b/i, unless: /vault|env|environment variable|secret manager|rotat/i, topic: "sec-secrets", level: 6,
    q: "How did those credentials reach the running service?" },
  { id: "conflict-outcome", re: /\b(disagree|conflict|argument|pushed back)\w*\b/i, unless: /outcome|resolved|decided|we went with|in the end/i, topic: null, level: 4,
    q: "How did it actually get resolved, and what was the outcome?" },
  { id: "solo-scale", re: /\b(I built|I made|I created|I wrote)\b/i, unless: /team|we|colleague|mentor|reviewer/i, topic: null, level: 3,
    when: s => /project|system|app|platform/i.test(s.text) && s.text.length > 220,
    q: "Was anyone else involved in that, or was it entirely yours?" },
];

const MISCONCEPTIONS = [
  /* --- complexity & data structures --- */
  { re: /\barrays?\b[^.]{0,50}\bo\s?\(\s?1\s?\)[^.]{0,30}\b(insert|delet)/i, topic: "dsa-complexity",
    fix: "Inserting or deleting in the middle of an array is O(n); only indexed access is O(1).",
    probe: "If you insert at the front of an array, what has to happen to every other element?" },
  { re: /\blinked list\b[^.]{0,50}\b(random access|index\w*)[^.]{0,20}o\s?\(\s?1\s?\)/i, topic: "dsa-complexity",
    fix: "Linked lists have O(n) access by index; O(1) applies to insert/delete given a node reference.",
    probe: "To reach the 500th element of a linked list, what do you have to do?" },
  { re: /\bquick ?sort\b[^.]{0,40}\bo\s?\(\s?n\s?log\s?n\s?\)[^.]{0,30}\bworst\b/i, topic: "dsa-sorting",
    fix: "Quicksort's worst case is O(n²); O(n log n) is its average case.",
    probe: "What input makes quicksort degrade, and what does the partition look like then?" },
  { re: /\bbfs\b[^.]{0,50}\bshortest path\b[^.]{0,40}\bweighted\b/i, topic: "dsa-graph",
    fix: "BFS finds shortest paths only in unweighted graphs; weighted graphs need Dijkstra.",
    probe: "What assumption about edge cost is BFS making when it returns the first path it finds?" },

  /* --- databases --- */
  { re: /\bnosql\b[^.]{0,50}\b(always |inherently )?(faster|better|more scalable)\b/i, topic: "db-nosql",
    fix: "NoSQL trades relational guarantees for a specific access pattern; it isn't categorically faster.",
    probe: "What does a document store give up that a relational database gives you for free?" },
  { re: /\bdenormali[sz]\w*\b[^.]{0,40}\b(no (downside|cost)|always better|free)\b/i, topic: "db-norm",
    fix: "Denormalisation costs write amplification and consistency risk — the same fact now lives in several places.",
    probe: "If a denormalised value changes, how many rows have to be updated, and what if one fails?" },
  { re: /\b(more|adding) indexes\b[^.]{0,40}\b(always|strictly) (better|faster|helps)\b/i, topic: "db-index",
    fix: "Every index must be maintained on write and consumes storage; unused indexes are pure cost.",
    probe: "What does the database have to do to each index when you insert a row?" },
  { re: /\bacid\b[^.]{0,50}\b(nosql|mongodb)\b[^.]{0,30}\b(never|can'?t|cannot|doesn'?t)\b/i, topic: "db-txn",
    fix: "Several NoSQL stores (including MongoDB) support ACID transactions; the older blanket claim is out of date.",
    probe: "What's the actual scope of a transaction in a document store — one document, or many?" },

  /* --- networking & security --- */
  { re: /\bjwt\b[^.]{0,60}\b(encrypted|secure because|can'?t be read)\b/i, topic: "web-auth",
    fix: "A standard JWT is signed, not encrypted — anyone holding it can read the payload.",
    probe: "If you base64-decode a JWT payload, what can you see?" },
  { re: /\b(hashing|hashed?)\b[^.]{0,40}\b(encrypt\w*|reversible|decrypt)\b/i, topic: "sec-core",
    fix: "Hashing is one-way; encryption is reversible with a key. They solve different problems.",
    probe: "If a password is hashed, how does the server check a login without ever reversing it?" },
  { re: /\bcors\b[^.]{0,60}\b(secur\w+|protects?|prevents? attack)/i, topic: "sec-injection",
    fix: "CORS relaxes the browser's same-origin policy for your own callers; it isn't a server-side security control.",
    probe: "Does CORS stop a request from reaching your server, or just stop the browser reading the response?" },
  { re: /\b(http[s]?\/2|websockets?)\b[^.]{0,40}\breplaces? (tcp|http)\b/i, topic: "cn-http",
    fix: "HTTP/2 and WebSockets still run over TCP; they change the framing and connection model, not the transport.",
    probe: "What layer does a WebSocket connection actually sit on top of?" },

  /* --- ML --- */
  { re: /\bcross.?validat\w+\b[^.]{0,50}\b(prevents?|stops?|removes?) overfit/i, topic: "ml-overfit",
    fix: "Cross-validation measures overfitting; it doesn't prevent it. Regularisation and more data do.",
    probe: "If CV tells you the model is overfitting, what do you actually change?" },
  { re: /\bnormali[sz]\w+\b[^.]{0,40}\b(improves?|increases?) accuracy\b/i, topic: "ml-feature",
    fix: "Feature scaling matters for distance- and gradient-based models; it does nothing for tree ensembles.",
    probe: "Would scaling change anything for a random forest? Why or why not?" },
  { re: /\bp.?value\b[^.]{0,60}\bprobability (that|the hypothesis)\b/i, topic: "ds-experiment",
    fix: "A p-value is the probability of data this extreme if the null were true — not the probability the hypothesis is true.",
    probe: "What exactly is the p-value the probability of?" },
  { re: /\bcorrelation\b[^.]{0,40}\b(means?|implies|proves?) caus/i, topic: "ds-stats",
    fix: "Correlation does not establish causation; you need an experiment or a causal design.",
    probe: "What would you need to run to actually establish cause here?" },
  { re: /\b(llm|gpt|model)\b[^.]{0,50}\b(knows?|has) (the )?(latest|real.?time|current) (data|information)\b/i, topic: "llm-core",
    fix: "A base LLM only knows its training data; current information requires retrieval or tools.",
    probe: "Where would up-to-date information have to come from for the model to use it?" },
  { re: /\brag\b[^.]{0,50}\b(eliminates?|prevents?|stops?) hallucinat/i, topic: "rag-core",
    fix: "RAG reduces hallucination by grounding, but the model can still misread or ignore retrieved context.",
    probe: "If the retrieved chunk doesn't contain the answer, what does the model tend to do?" },
  { re: /\bfine.?tun\w+\b[^.]{0,50}\b(add|teach|give)\w*\b[^.]{0,20}\b(new|fresh) (knowledge|facts|data)\b/i, topic: "llm-core",
    fix: "Fine-tuning is far better at teaching format and style than at reliably installing new facts — retrieval is the tool for knowledge.",
    probe: "If you need the model to cite a document it has never seen, is fine-tuning or retrieval the right lever?" },

  /* --- infra --- */
  { re: /\bkubernetes\b[^.]{0,50}\b(automatically )?(makes it|makes you) scal\w+\b[^.]{0,20}\b(no|without) (work|config)/i, topic: "cloud-containers",
    fix: "Kubernetes schedules and restarts containers; it doesn't make a stateful or bottlenecked application scale by itself.",
    probe: "If your app holds session state in memory, what does adding replicas do?" },
  { re: /\bserverless\b[^.]{0,50}\b(no servers?|always cheaper)\b/i, topic: "cloud-scaling",
    fix: "Serverless still runs on servers; it can be more expensive at sustained high volume than reserved capacity.",
    probe: "At what traffic level does per-invocation pricing stop being the cheap option?" },
  { re: /\bmicroservices?\b[^.]{0,50}\b(always |inherently )?(better|faster|more scalable)\b/i, topic: "sd-scale",
    fix: "Microservices trade in-process calls for network calls; they buy independent deploys at the cost of distributed-systems problems.",
    probe: "What becomes harder the moment a function call turns into a network call?" },
  { re: /\bcaching\b[^.]{0,50}\b(no downside|always helps|free)\b/i, topic: "sd-cache",
    fix: "A cache introduces staleness and an invalidation problem, and can make a cold start worse.",
    probe: "What does a user see when the cached value is out of date?" },
];

module.exports = { HOOKS, MISCONCEPTIONS };
