"use strict";
/* The Claude layer.

   Everything in this directory is strictly additive. The deterministic engine
   produces a complete interview and a complete report on its own; these calls
   only ever *enrich* that result. Three rules keep that promise honest:

     1. No API key, no problem. `available()` is false and every helper returns
        null without throwing, so callers take their existing path.
     2. Failures are not exceptions. Timeouts, rate limits, refusals and
        malformed output all resolve to null. A flaky network must never turn
        into a failed interview turn.
     3. Every call is bounded. A hard timeout races each request, because a
        candidate waiting mid-interview is a worse outcome than ungraded nuance.

   Credentials come from the environment (ANTHROPIC_API_KEY) or an `ant auth
   login` profile — the SDK resolves both. Nothing here reads or logs the key. */

const MODEL = "claude-opus-5";
const DEFAULT_TIMEOUT_MS = Number(process.env.PREPPILOT_LLM_TIMEOUT_MS || 20000);

let Anthropic = null;
let client = null;
let initError = null;

/* The SDK is a real dependency, but the app must survive it being absent. */
try {
  Anthropic = require("@anthropic-ai/sdk");
} catch (err) {
  initError = "the @anthropic-ai/sdk package is not installed";
}

function enabled() {
  if (process.env.PREPPILOT_LLM === "off") return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  if (client) return client;
  if (!Anthropic || !enabled()) return null;
  try {
    // Zero-arg constructor: resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
    // or a stored CLI profile, in that order.
    client = new Anthropic({ maxRetries: 1, timeout: DEFAULT_TIMEOUT_MS });
    return client;
  } catch (err) {
    initError = err.message;
    return null;
  }
}

const available = () => !!getClient();

function status() {
  return {
    available: available(),
    model: available() ? MODEL : null,
    reason: available() ? null : (initError || (process.env.PREPPILOT_LLM === "off"
      ? "disabled via PREPPILOT_LLM=off"
      : "no ANTHROPIC_API_KEY in the environment")),
  };
}

/* Simple usage accounting so /api/health can show what the LLM layer cost. */
const usage = { calls: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, ms: 0 };

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One structured call to Claude. Returns the parsed object, or null on any
 * failure — callers must treat null as "the deterministic answer stands".
 *
 * `system` is placed first and cached: it is the stable half of every prompt
 * (role, rubric conventions, the grading contract), so repeated turns in one
 * interview reuse it instead of paying for it again.
 */
async function callJSON({ system, user, schema, effort = "medium", thinking = true, maxTokens = 4000, timeoutMs = DEFAULT_TIMEOUT_MS, label = "llm" }) {
  const c = getClient();
  if (!c) return null;

  const started = Date.now();
  usage.calls++;
  try {
    const req = {
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: {
        effort,
        format: { type: "json_schema", schema },
      },
    };
    // Adaptive thinking is on by default for Opus 5; only opt out for the
    // cheap mechanical calls where reasoning buys nothing.
    if (!thinking) req.thinking = { type: "disabled" };

    const res = await withTimeout(c.messages.create(req), timeoutMs, label);

    if (res.stop_reason === "refusal") {
      usage.failed++;
      console.warn(`llm(${label}): declined (${res.stop_details?.category || "unspecified"})`);
      return null;
    }
    if (res.usage) {
      usage.inputTokens += res.usage.input_tokens || 0;
      usage.outputTokens += res.usage.output_tokens || 0;
      usage.cachedTokens += res.usage.cache_read_input_tokens || 0;
    }
    const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
    if (!text.trim()) { usage.failed++; return null; }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Structured outputs should make this unreachable, but a truncated
      // response (max_tokens) can still produce invalid JSON.
      usage.failed++;
      console.warn(`llm(${label}): unparseable output (stop_reason=${res.stop_reason})`);
      return null;
    }
    usage.ok++;
    usage.ms += Date.now() - started;
    return parsed;
  } catch (err) {
    usage.failed++;
    usage.ms += Date.now() - started;
    // Most specific first — the distinction matters for whether a retry helps.
    if (Anthropic && err instanceof Anthropic.AuthenticationError) {
      console.warn(`llm(${label}): credentials rejected — disabling the LLM layer for this process`);
      client = null;
      initError = "the configured credentials were rejected";
      process.env.PREPPILOT_LLM = "off";
    } else if (Anthropic && err instanceof Anthropic.RateLimitError) {
      console.warn(`llm(${label}): rate limited`);
    } else if (Anthropic && err instanceof Anthropic.APIError) {
      console.warn(`llm(${label}): API error ${err.status}: ${err.message}`);
    } else {
      console.warn(`llm(${label}): ${err.message}`);
    }
    return null;
  }
}

module.exports = { MODEL, available, enabled, status, callJSON, usage };
