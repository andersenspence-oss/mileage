// Browser-side client for the Anthropic Messages API.
//
// The app is a static page on GitHub Pages with no server, so it talks to the
// API directly from the phone. That needs the direct-browser-access header, and
// it means the key lives in this device's local storage — see the note in
// Settings. Nothing is proxied through any third party.

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export const MODELS = [
  // Rates are US dollars per million tokens, used only for the estimate shown
  // before a run so a weekly job never surprises anyone.
  { id: "claude-opus-5", name: "Opus 5", note: "Best copy", inRate: 5, outRate: 25 },
  { id: "claude-sonnet-5", name: "Sonnet 5", note: "Cheaper, a little blander", inRate: 3, outRate: 15 },
];

export const DEFAULT_MODEL = "claude-opus-5";

export function modelInfo(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

// Roughly what one batch costs, measured against the prompts this app actually
// sends. Output varies most: one long LinkedIn post is cheaper than six short X
// posts once the hashtags and media briefs are counted.
const BATCH_TOKENS = {
  linkedin: { in: 4000, out: 1500 },
  instagram: { in: 4000, out: 2400 },
  facebook: { in: 4000, out: 2400 },
  x: { in: 4000, out: 2000 },
};
const SETUP_TOKENS = { in: 3000, out: 2200 };

// The brand prompt and the week's research briefing are identical on every call,
// so they are cached. Cached reads bill at a tenth of the normal input rate.
const CACHED_PREFIX_TOKENS = 2600;
const CACHE_READ_RATE = 0.1;

function inputCost(rate, inTokens, cached) {
  const fresh = Math.max(0, inTokens - (cached ? CACHED_PREFIX_TOKENS : 0));
  const reused = cached ? CACHED_PREFIX_TOKENS * CACHE_READ_RATE : 0;
  return ((fresh + reused) * rate) / 1e6;
}

/**
 * Estimates a run, taking each platform's own model into account.
 *
 * @param {object} opts
 * @param {object} opts.models    platform id (and "plan") to model id
 * @param {string[]} opts.platforms
 * @param {number} opts.dayCount
 */
export function estimateRun({ models = {}, platforms = [], dayCount = 7 }) {
  const planModel = modelInfo(models.plan || DEFAULT_MODEL);
  let calls = 2;
  // The two setup calls come before any cache exists, so they pay full price.
  let low = inputCost(planModel.inRate, SETUP_TOKENS.in * 2, false) + (SETUP_TOKENS.out * 2 * planModel.outRate) / 1e6;

  for (const platform of platforms) {
    const m = modelInfo(models[platform] || DEFAULT_MODEL);
    const t = BATCH_TOKENS[platform] || BATCH_TOKENS.linkedin;
    for (let day = 0; day < dayCount; day += 1) {
      calls += 1;
      // The first batch on each model writes the cache; the rest read it.
      low += inputCost(m.inRate, t.in, day > 0) + (t.out * m.outRate) / 1e6;
    }
  }

  // Rewrite passes are the main variable, so the top of the range assumes many.
  const high = low * 1.8;
  // Three batches run at once and a batch takes roughly 25 seconds.
  const minutes = Math.max(1, Math.round(((calls / 3) * 25) / 60));
  return { calls, low, high, minutes };
}

export class ApiError extends Error {
  constructor(message, { status, type, retryable } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.retryable = Boolean(retryable);
  }
}

function headers(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    // Required for calls that originate in a browser rather than a server.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readError(response) {
  let detail = "";
  let type = "";
  try {
    const body = await response.json();
    detail = (body && body.error && body.error.message) || "";
    type = (body && body.error && body.error.type) || "";
  } catch {
    detail = await response.text().catch(() => "");
  }
  const friendly = {
    401: "The API key was rejected. Check it in Settings.",
    403: "That API key is not allowed to use this model.",
    429: "Rate limited by the API. The app will wait and retry.",
    529: "The API is overloaded. The app will wait and retry.",
  }[response.status];
  return new ApiError(friendly || detail || `Request failed (${response.status}).`, {
    status: response.status,
    type,
    retryable: RETRY_STATUS.has(response.status),
  });
}

// Parses the SSE stream, handing back accumulated text as it arrives so the UI
// can show real progress instead of a spinner that lies.
async function readStream(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;
  let stopDetails = null;
  const usage = { input_tokens: 0, output_tokens: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; keep any partial frame.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.type === "content_block_delta" && event.delta) {
          if (event.delta.type === "text_delta" && event.delta.text) {
            text += event.delta.text;
            if (onProgress) onProgress(text);
          }
        } else if (event.type === "message_delta") {
          if (event.delta && event.delta.stop_reason) stopReason = event.delta.stop_reason;
          if (event.delta && event.delta.stop_details) stopDetails = event.delta.stop_details;
          if (event.usage && event.usage.output_tokens) usage.output_tokens = event.usage.output_tokens;
        } else if (event.type === "message_start" && event.message && event.message.usage) {
          usage.input_tokens = event.message.usage.input_tokens || 0;
        } else if (event.type === "error") {
          throw new ApiError((event.error && event.error.message) || "The API returned an error mid-stream.", {
            type: event.error && event.error.type,
            retryable: true,
          });
        }
      }
    }
  }

  return { text, stopReason, stopDetails, usage };
}

/**
 * One call to the Messages API.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string|Array} opts.system   cached system prefix
 * @param {Array}  opts.messages
 * @param {object} [opts.schema]       JSON schema for a structured reply
 * @param {Array}  [opts.tools]        server-side tools, e.g. web search
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.effort]       low | medium | high | xhigh | max
 * @param {function} [opts.onProgress] called with accumulated text
 * @param {AbortSignal} [opts.signal]
 */
export async function callClaude(opts) {
  const {
    apiKey,
    model = "claude-opus-5",
    system,
    messages,
    schema,
    tools,
    maxTokens = 32000,
    effort = "high",
    onProgress,
    signal,
    maxRetries = 4,
  } = opts;

  if (!apiKey) throw new ApiError("No API key set. Open Settings and paste one in.", { status: 401 });

  const body = {
    model,
    max_tokens: maxTokens,
    // Streaming keeps long generations from hitting the request timeout.
    stream: true,
    messages,
    output_config: { effort },
  };
  if (system) {
    // The brand prompt is byte-identical on every call of a run, so it is worth
    // caching: repeat reads bill at a tenth of the normal input rate. A plain
    // string is wrapped here so callers do not have to know about block shapes.
    body.system =
      typeof system === "string"
        ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
        : system;
  }
  if (tools && tools.length) body.tools = tools;
  // Structured output and the web search tool are kept on separate calls: search
  // results carry citations, which the JSON output format rejects.
  if (schema) body.output_config.format = { type: "json_schema", schema };

  let attempt = 0;
  for (;;) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const err = await readError(response);
        if (err.retryable && attempt < maxRetries) {
          const wait = Number(response.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt;
          attempt += 1;
          await sleep(wait);
          continue;
        }
        throw err;
      }

      const result = await readStream(response, onProgress);

      if (result.stopReason === "refusal") {
        throw new ApiError(
          "The model declined this request" +
            (result.stopDetails && result.stopDetails.explanation ? `: ${result.stopDetails.explanation}` : "."),
          { type: "refusal" }
        );
      }
      if (result.stopReason === "max_tokens") {
        throw new ApiError("The reply was cut off before it finished. Try fewer posts per batch.", {
          type: "max_tokens",
          retryable: false,
        });
      }
      return result;
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      // Network-level failures are worth another try; API refusals are not.
      const networkish = err instanceof TypeError;
      if (networkish && attempt < maxRetries) {
        attempt += 1;
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (networkish) {
        throw new ApiError(
          "Could not reach the API. Check the phone's connection, then check the key in Settings.",
          { retryable: true }
        );
      }
      throw err;
    }
  }
}

// Structured replies come back as a single JSON text block.
export function parseJson(text, what = "reply") {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Very occasionally a model wraps JSON in a fence despite the schema.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        /* fall through */
      }
    }
    const brace = trimmed.indexOf("{");
    const close = trimmed.lastIndexOf("}");
    if (brace >= 0 && close > brace) {
      try {
        return JSON.parse(trimmed.slice(brace, close + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ApiError(`Could not read the ${what} the model sent back.`);
  }
}

export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search" };

// A cheap round trip that proves the key, the model and the browser CORS path
// all work, so failures surface in Settings instead of mid-run.
export async function testConnection(apiKey, model) {
  const res = await callClaude({
    apiKey,
    model,
    maxTokens: 16,
    effort: "low",
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
  });
  return res.text.trim();
}
