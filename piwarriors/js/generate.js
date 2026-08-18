// The run pipeline: gather what the market is actually talking about, turn that
// into a staggered week, write each platform's posts, then check and repair them
// until every one fits its platform without the user editing anything.

import { callClaude, parseJson, WEB_SEARCH_TOOL } from "./api.js";
import { SYSTEM_PROMPT, PLATFORM_BRIEFS, PILLARS } from "./brand.js";
import {
  PLATFORMS,
  effectiveLimit,
  countChars,
  validatePost,
  enforce,
  postsPerDay,
  bodyBudget,
} from "./limits.js";
import { scanPost, blockers, normalizePunctuation, sellingFindings, INTENTS } from "./voice.js";

const MAX_REPAIR_ROUNDS = 3;
const CONCURRENCY = 3;

// ---------------------------------------------------------------- signals

// Public conversation is what a static page can actually reach. The API's web
// search runs server-side, so this works from a phone with no scraper and no
// platform credentials. Anything private the user has seen goes in the notes box.
export async function gatherSignals({ apiKey, model, platforms, notes, onProgress, signal }) {
  const platformNames = platforms.map((p) => PLATFORMS[p].name).join(", ");
  const prompt = `Search the web for what is being discussed right now, this week, in the personal injury provider world. You are looking for raw material for social copy aimed at PI providers.

Search across these angles and report only what you actually find:
- Insurance industry news that changes how PI providers get paid or documented against
- AI and algorithmic claim review or claim adjudication being used by insurers
- State-level personal injury or auto insurance law changes
- What providers are complaining about publicly right now: reduction letters, IMEs, denied causation, records requests
- What plaintiff attorneys are publicly saying about provider documentation quality
- Recent settlement or case law news that touches medical records and causation
- Discussion happening on ${platformNames} in this space, including specific posts or threads that got traction

${notes ? `The user has also seen these conversations first-hand. Treat these as primary and weight them heavily:\n${notes}\n` : ""}
Write the result as a briefing for the copywriter. Use this shape:

## What changed this week
Short bullets. Each bullet states the fact and, in parentheses, the source name and date. If you could not verify something, leave it out entirely rather than guessing.

## What providers are saying
Bullets capturing the actual complaint or argument in the words being used, not a paraphrase into corporate language.

## What attorneys are saying
Same.

## Angles worth writing this week
Five to eight bullets. Each one is a specific, concrete idea for a post, tied to one of the Five Pillars (Documentation, Case Management, Legal, Billing, Marketing). Say which pillar.

## Sources
Bare list of the URLs you actually used.

Be concrete. Do not pad. If a section has nothing real behind it, write "Nothing solid found this week" under it rather than inventing material.`;

  const res = await callClaude({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 16000,
    effort: "high",
    onProgress,
    signal,
  });
  return res.text.trim();
}

// ------------------------------------------------------------------ plan

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    weekTheme: { type: "string" },
    rationale: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          dayName: { type: "string" },
          theme: { type: "string" },
          pillar: { type: "string", enum: PILLARS.map((p) => p.id) },
          angles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                platform: { type: "string", enum: Object.keys(PLATFORMS) },
                angle: { type: "string" },
              },
              required: ["platform", "angle"],
              additionalProperties: false,
            },
          },
        },
        required: ["date", "dayName", "theme", "pillar", "angles"],
        additionalProperties: false,
      },
    },
  },
  required: ["weekTheme", "rationale", "days"],
  additionalProperties: false,
};

export async function buildPlan({ apiKey, model, platforms, days, startDate, signals, history, onProgress, signal }) {
  const dayList = days
    .map((d) => `- ${d.date} (${d.dayName})`)
    .join("\n");

  const recent = history && history.length
    ? `\nThese themes ran in recent weeks. Do not repeat them, and do not reuse their hooks:\n${history.map((h) => `- ${h}`).join("\n")}\n`
    : "";

  const prompt = `Plan one week of content for PI Warriors.

Here is this week's research briefing:
---
${signals}
---
${recent}
Days to plan:
${dayList}

Platforms in this run: ${platforms.map((p) => PLATFORMS[p].name).join(", ")}.

Rules for the plan:
- Give the week a single spine: one core argument that the whole week circles, stated in the weekTheme.
- Each day gets its own theme that advances the spine. Days must not restate each other.
- Rotate the Five Pillars across the week. Do not use the same pillar two days running.
- Each platform gets its own angle on that day's theme, written from a different entry point. The same idea told the same way on four platforms is the failure mode to avoid.
- Ground the week in the briefing above. If the briefing found something real and current, the week should visibly respond to it.
- The rationale explains, in three or four sentences, why this week's spine is the right thing to say right now.

Give an angle for every platform listed above, for every day listed above.`;

  const res = await callClaude({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    schema: PLAN_SCHEMA,
    maxTokens: 16000,
    effort: "high",
    onProgress,
    signal,
  });
  return parseJson(res.text, "week plan");
}

// ------------------------------------------------------------- generation

function postsSchema() {
  return {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            hook: { type: "string" },
            body: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            pillar: { type: "string", enum: PILLARS.map((p) => p.id) },
            intent: { type: "string", enum: INTENTS },
            slot: { type: "string" },
            media: {
              type: "object",
              properties: {
                kind: {
                  type: "string",
                  enum: ["image", "video", "carousel", "reel", "document", "graphic"],
                },
                concept: { type: "string" },
                direction: { type: "string" },
                onScreenText: { type: "string" },
                altText: { type: "string" },
              },
              required: ["kind", "concept", "direction", "onScreenText", "altText"],
              additionalProperties: false,
            },
          },
          required: ["hook", "body", "hashtags", "tags", "pillar", "slot", "media"],
          additionalProperties: false,
        },
      },
    },
    required: ["posts"],
    additionalProperties: false,
  };
}

// The exact character arithmetic the model has to write inside, spelled out
// rather than implied, because "keep it short" does not survive contact.
function budgetBrief(platformId, settings) {
  const p = PLATFORMS[platformId];
  const limit = effectiveLimit(platformId, settings);
  if (platformId === "x") {
    return `HARD LIMIT: the body plus every hashtag, counted together, must be at most ${limit} characters. A link counts as 23 characters no matter its length, and emoji count as two. Write the body to about ${Math.round(limit * 0.85)} characters so the hashtags fit. Posts over the limit are rejected and rewritten, so count as you go.`;
  }
  if (platformId === "instagram") {
    return `HARD LIMIT: caption plus hashtags must be at most ${limit} characters. Aim for 600 to 1200 characters of caption. The first ${p.fold} characters are all that show before the caption truncates, so the hook has to land inside that.`;
  }
  if (platformId === "facebook") {
    return `TARGET LENGTH: at most ${limit} characters including hashtags. Aim for 700 to 1300. The first ${p.fold} characters show before "see more".`;
  }
  return `HARD LIMIT: at most ${limit} characters including hashtags. Aim for 1200 to 2200. The first ${p.fold} characters show before "see more", so the opening has to carry the claim.`;
}

// Selling is rationed per batch. Spelling out the exact number, including zero,
// is what keeps a week of conversation from drifting into a week of pitching.
function sellingBrief(count, total) {
  if (!count) {
    return `SELLING: none. Not one of these ${total} post${total === 1 ? "" : "s"} sells anything. No link, no product pitch, no invitation to sign up, book, subscribe or download, no pointing at the bio, and nothing softened onto the end. Each post ends on its idea or on a real question. Mark every one of them as conversation, insight or story.`;
  }
  return `SELLING: exactly ${count} of these ${total} posts may carry a call to action, and it belongs to whichever post has earned it. Mark that post as intent "offer". Its ask is one quiet line at the very end, after a post that stands up on its own. No urgency, no scarcity, no discount, and only one ask. Every other post in this batch sells nothing at all and is marked conversation, insight or story.`;
}

function historyBrief(history) {
  if (!history || !history.length) return "";
  return `\nHooks already used in recent weeks. Do not reuse or lightly reword any of these:\n${history
    .slice(0, 40)
    .map((h) => `- ${h}`)
    .join("\n")}\n`;
}

export async function generateChunk({
  apiKey,
  model,
  platform,
  day,
  weekTheme,
  angle,
  count,
  offersAllowed = 0,
  signals,
  history,
  settings,
  onProgress,
  signal,
}) {
  const p = PLATFORMS[platform];
  const prompt = `Write ${count} ${p.name} post${count === 1 ? "" : "s"} for ${day.dayName} ${day.date}.

Week spine: ${weekTheme}
This day's theme: ${day.theme}
Pillar in focus: ${day.pillar}
This platform's angle: ${angle}

${PLATFORM_BRIEFS[platform]}

${budgetBrief(platform, settings)}

${sellingBrief(offersAllowed, count)}
${historyBrief(history)}
Research briefing behind this week:
---
${signals}
---

For each post:
- "hook" is the opening line exactly as it appears at the start of the body. It is not a separate headline.
- "body" is the complete post, ready to paste. No surrounding quotes, no markdown, no labels, no "Post 1:" prefix. Line breaks are real line breaks.
- "hashtags" are without the # symbol, one tag per array entry, letters and numbers only. ${p.minHashtags ? `Between ${p.minHashtags} and ${p.maxHashtags}.` : `At most ${p.maxHashtags}, and zero is a valid answer.`} Lead with the most specific and finish with the broader reach tags. Do not put hashtags inside the body; they belong only in this field.
- "tags" are accounts worth @-mentioning, without the @ symbol. Only include an account when mentioning it genuinely makes sense and the account plausibly exists in this space. An empty list is the right answer most of the time. Never invent a specific person's handle.
- "pillar" is the Five Pillars id this post actually serves.
- "intent" is what the post is for. "conversation" asks something real and leaves room for an answer. "insight" reframes or teaches. "story" is a specific thing that happened. "offer" is the rationed selling post, and only when this batch was allowed one.
- "slot" is a suggested posting time for this platform on this day, like "7:15am" or "12:30pm".
- "media" describes what should run with the post:
  - "kind" is the format. ${p.name} takes: ${p.mediaKinds.join(", ")}.
  - "concept" is one sentence on what the image or video is.
  - "direction" is how to actually get it: what to shoot or build, framing, setting, and for a carousel or reel the slide-by-slide or beat-by-beat breakdown. Be specific enough to hand to someone else.
  - "onScreenText" is the text that appears on the image or in the first frame. Keep it short enough to read at a glance.
  - "altText" describes the visual for a screen reader.

${count > 1 ? `All ${count} posts run on the same day, so they must not sound like variations of one another. Different openings, different structures, different entry points into the theme. At least one should be a concrete story or a specific admission of something that went wrong.` : ""}

Write them the way Dr. Spence types, not the way a marketing tool writes.`;

  const res = await callClaude({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    schema: postsSchema(),
    maxTokens: 24000,
    effort: "high",
    onProgress,
    signal,
  });
  const parsed = parseJson(res.text, `${p.name} posts`);
  return (parsed.posts || []).map(cleanPost);
}

function cleanPost(post) {
  const cleaned = { ...post };
  cleaned.body = normalizePunctuation(cleaned.body || "").trim();
  cleaned.hook = normalizePunctuation(cleaned.hook || "").trim();
  cleaned.hashtags = (cleaned.hashtags || []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean);
  cleaned.tags = (cleaned.tags || []).map((t) => String(t).replace(/^@/, "").trim()).filter(Boolean);
  if (cleaned.media) {
    for (const k of ["concept", "direction", "onScreenText", "altText"]) {
      if (cleaned.media[k]) cleaned.media[k] = normalizePunctuation(cleaned.media[k]).trim();
    }
  }
  return cleaned;
}

// --------------------------------------------------------------- repair

// Everything the post got wrong, in the plainest terms the model can act on.
function problemReport(platform, post, settings, offerAllowed = false) {
  const check = validatePost(platform, post, settings);
  const tells = blockers(scanPost(post));
  const lines = [];

  // A post that sells when the batch had no sell to give is a rewrite, not a
  // warning: the whole point of the cadence is that most posts never pitch.
  const selling = sellingFindings(offerAllowed ? { ...post, intent: "offer" } : { ...post, intent: "conversation" });
  if (selling.length) {
    lines.push(
      offerAllowed
        ? `Remove the manufactured urgency: ${selling.map((f) => f.label).join("; ")}. The ask stays quiet and earns its place.`
        : `This post is not one of the ones allowed to sell, but it does: ${selling
            .map((f) => f.label)
            .join("; ")}. Cut the ask entirely and end the post on its idea or on a real question. Do not soften it, remove it.`
    );
  }
  if (post.intent === "offer" && !offerAllowed) {
    lines.push(
      "This batch was not allowed a selling post. Rewrite this one as a conversation, insight or story piece with no call to action, and set intent accordingly."
    );
  }

  for (const e of check.errors) {
    if (e.code === "too_long") {
      const budget = bodyBudget(platform, post, settings);
      lines.push(
        `Too long: ${check.used} characters against a ${check.limit} limit. Cut at least ${e.over}. The body alone must come in under ${budget} characters once the hashtags are attached. Cut whole sentences, do not compress the writing into shorthand.`
      );
    } else if (e.code === "too_many_hashtags") {
      lines.push(`Too many hashtags: ${check.hashtagCount}, and the maximum is ${PLATFORMS[platform].maxHashtags}.`);
    } else if (e.code === "too_few_hashtags") {
      lines.push(`Too few hashtags: ${check.hashtagCount}, and the minimum is ${PLATFORMS[platform].minHashtags}.`);
    } else {
      lines.push(e.message);
    }
  }
  if (tells.length) {
    lines.push(
      `Reads as machine-written. Remove these and rewrite the surrounding sentences so the seam does not show: ${tells
        .map((t) => t.label)
        .join("; ")}.`
    );
  }
  return lines;
}

async function repairPosts({ apiKey, model, platform, broken, settings, offersAllowed = 0, signal }) {
  const p = PLATFORMS[platform];
  const listing = broken
    .map((item, i) => {
      return `### Post ${i + 1}
Problems to fix:
${item.problems.map((l) => `- ${l}`).join("\n")}

Current body:
"""
${item.post.body}
"""
Current hashtags: ${item.post.hashtags.join(", ") || "(none)"}`;
    })
    .join("\n\n");

  const prompt = `These ${p.name} posts did not pass the checks. Rewrite each one so it passes, and return them in the same order.

${budgetBrief(platform, settings)}

${sellingBrief(offersAllowed, broken.length)}

${listing}

Keep each post's argument, its specifics and its voice. Fix only what is listed. Do not replace a concrete detail with a vague one to save characters. Return the full corrected post in "body", not a diff. Keep the same media suggestion intent, but you must still return every field.`;

  const res = await callClaude({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    schema: postsSchema(),
    maxTokens: 24000,
    effort: "high",
    signal,
  });
  const parsed = parseJson(res.text, `${p.name} rewrites`);
  return (parsed.posts || []).map(cleanPost);
}

// Generate, then check and rewrite until clean or out of rounds, then force the
// hard limits so nothing is ever handed over above its ceiling.
// Which posts in this batch are permitted to sell: the first ones the model
// marked as an offer, up to the batch's allowance. Everything after that is
// over budget and gets rewritten.
function offerAllowance(posts, allowed) {
  const permitted = new Set();
  let used = 0;
  posts.forEach((post, i) => {
    if (post.intent === "offer" && used < allowed) {
      permitted.add(i);
      used += 1;
    }
  });
  return permitted;
}

async function finishChunk(ctx, posts) {
  const { apiKey, model, platform, settings, signal, onNote, offersAllowed = 0 } = ctx;
  let current = posts;

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
    const permitted = offerAllowance(current, offersAllowed);
    const broken = [];
    current.forEach((post, index) => {
      const problems = problemReport(platform, post, settings, permitted.has(index));
      if (problems.length) broken.push({ index, post, problems });
    });
    if (!broken.length) break;

    if (onNote) {
      onNote(`Rewriting ${broken.length} ${PLATFORMS[platform].name} post${broken.length === 1 ? "" : "s"} (pass ${round + 1})`);
    }

    let fixed;
    try {
      fixed = await repairPosts({ apiKey, model, platform, broken, settings, offersAllowed, signal });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      break; // Fall through to the deterministic trim below.
    }

    const next = current.slice();
    broken.forEach((item, i) => {
      if (fixed[i] && fixed[i].body) {
        // Keep the original media suggestion if the rewrite returned a thinner one.
        next[item.index] = { ...item.post, ...fixed[i] };
      }
    });
    current = next;
  }

  // Deterministic backstop. After this, a post is inside its limits regardless
  // of what the model did.
  const finalPermitted = offerAllowance(current, offersAllowed);

  return current.map((post, index) => {
    const { post: safe, notes } = enforce(platform, post, settings);
    const check = validatePost(platform, safe, settings);
    const tells = scanPost(safe);
    const offerAllowed = finalPermitted.has(index);

    const warnings = tells.map((t) => t.label);

    // Prose cannot be de-sold deterministically, so anything still selling is
    // named on the card rather than shipped quietly.
    const stillSelling = sellingFindings(
      offerAllowed ? { ...safe, intent: "offer" } : { ...safe, intent: "conversation" }
    );

    // Anything the rewrites never resolved is reported rather than buried,
    // because enforce() can cut but it cannot invent a missing hashtag.
    const residual = check.errors
      .filter((e) => e.code !== "too_long")
      .map((e) => e.message);
    for (const f of stillSelling) {
      residual.push(offerAllowed ? `Hype to cut: ${f.label}.` : `This one sells, and it was not meant to: ${f.label}.`);
    }

    // The opening has to survive the fold or the hook is never read.
    const firstLine = (safe.body || "").split("\n")[0];
    const fold = PLATFORMS[platform].fold;
    if (fold && countChars(platform, firstLine) > fold) {
      warnings.push(`The opening line runs past the ${fold}-character "see more" cut`);
    }

    return {
      ...safe,
      platform,
      intent: offerAllowed ? "offer" : safe.intent === "offer" ? "insight" : safe.intent || "insight",
      _check: {
        offer: offerAllowed,
        used: check.used,
        limit: check.limit,
        remaining: check.remaining,
        hashtagCount: check.hashtagCount,
        trimmed: notes,
        residual,
        warnings,
        clean: check.ok && blockers(tells).length === 0 && notes.length === 0,
      },
    };
  });
}

// ------------------------------------------------------------- orchestrator

async function pooled(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export function buildDays(startDate, count) {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const out = [];
  const [y, m, d] = startDate.split("-").map(Number);
  for (let i = 0; i < count; i += 1) {
    // Constructed in UTC so the dates do not slide across a timezone boundary.
    const date = new Date(Date.UTC(y, m - 1, d + i));
    out.push({
      date: date.toISOString().slice(0, 10),
      dayName: names[date.getUTCDay()],
    });
  }
  return out;
}

/**
 * Decides which platform-days get the week's rare selling post.
 *
 * The setting is per platform per seven days, so a shorter run gets
 * proportionally fewer, and a one-day run normally gets none. Picks are spread
 * across the run rather than clustered, so the sell never lands twice in a row.
 */
export function allocateOffers(platforms, days, perWeek) {
  const map = {};
  const total = days.length;
  if (!total || !perWeek) return map;

  for (const platform of platforms) {
    const count = Math.min(total, Math.round((perWeek * total) / 7));
    if (!count) continue;
    const picks = new Set();
    for (let i = 0; i < count; i += 1) {
      // Evenly spaced positions, e.g. one offer lands mid-run rather than day one.
      let idx = Math.floor(((i + 0.5) * total) / count);
      idx = Math.min(total - 1, Math.max(0, idx));
      while (picks.has(idx) && idx < total - 1) idx += 1;
      while (picks.has(idx) && idx > 0) idx -= 1;
      picks.add(idx);
    }
    for (const i of picks) map[`${platform}|${days[i].date}`] = 1;
  }
  return map;
}

/**
 * Runs a whole week. Progress is reported as it happens so the phone shows
 * something real rather than an indeterminate spinner.
 */
export async function runWeek({
  apiKey,
  model,
  platforms,
  dayCount,
  startDate,
  notes,
  history,
  settings,
  onStage,
  onNote,
  onPartial,
  signal,
}) {
  const days = buildDays(startDate, dayCount);
  const report = (stage, detail) => onStage && onStage(stage, detail);

  report("signals", "Searching for what the market is talking about");
  const signals = await gatherSignals({
    apiKey,
    model,
    platforms,
    notes,
    signal,
    onProgress: onPartial ? (t) => onPartial("signals", t) : undefined,
  });

  report("plan", "Laying out the week");
  const plan = await buildPlan({
    apiKey,
    model,
    platforms,
    days,
    startDate,
    signals,
    history: history && history.themes,
    signal,
  });

  // Fill in any day the planner skipped, so the run never silently produces less
  // than was asked for.
  const planDays = days.map((d, i) => {
    const found = (plan.days || []).find((pd) => pd.date === d.date) || (plan.days || [])[i] || {};
    return {
      date: d.date,
      dayName: d.dayName,
      theme: found.theme || plan.weekTheme || "",
      pillar: found.pillar || PILLARS[i % PILLARS.length].id,
      angles: found.angles || [],
    };
  });

  const offers = allocateOffers(platforms, planDays, settings.offersPerWeek ?? 1);

  const chunks = [];
  for (const day of planDays) {
    for (const platform of platforms) {
      const angleEntry = (day.angles || []).find((a) => a.platform === platform);
      chunks.push({
        platform,
        day,
        angle: (angleEntry && angleEntry.angle) || day.theme,
        count: postsPerDay(platform, settings),
        offersAllowed: offers[`${platform}|${day.date}`] || 0,
      });
    }
  }

  report("write", `Writing ${chunks.reduce((n, c) => n + c.count, 0)} posts`);

  let done = 0;
  const results = await pooled(chunks, CONCURRENCY, async (chunk) => {
    const ctx = { apiKey, model, platform: chunk.platform, settings, signal, onNote, offersAllowed: chunk.offersAllowed };
    let posts = [];
    try {
      posts = await generateChunk({
        apiKey,
        model,
        platform: chunk.platform,
        day: chunk.day,
        weekTheme: plan.weekTheme,
        angle: chunk.angle,
        count: chunk.count,
        offersAllowed: chunk.offersAllowed,
        signals,
        history: history && history.hooks,
        settings,
        signal,
      });
      posts = await finishChunk(ctx, posts);
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      done += 1;
      report("write", `${done} of ${chunks.length} batches`);
      return { ...chunk, posts: [], error: err.message || String(err) };
    }
    done += 1;
    report("write", `${done} of ${chunks.length} batches`);
    if (onNote) onNote(`${PLATFORMS[chunk.platform].name} — ${chunk.day.dayName} ready`);
    return { ...chunk, posts };
  });

  return {
    id: `run-${startDate}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    startDate,
    dayCount,
    platforms,
    model,
    weekTheme: plan.weekTheme,
    rationale: plan.rationale,
    offersPerWeek: settings.offersPerWeek ?? 1,
    signals,
    days: planDays,
    chunks: results,
  };
}
