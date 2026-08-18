// Platform rules and the counting/repair maths that keep every post inside its
// limit without the user having to trim anything by hand.

// A post is only "safe" if body + the hashtag/tag block fit together, because
// that is how the text actually lands when it is pasted into the composer.

export const PLATFORMS = {
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    mark: "in",
    limit: 3000,
    // Where the composer collapses the post behind "see more".
    fold: 210,
    maxHashtags: 5,
    minHashtags: 3,
    perDay: 1,
    counting: "codepoints",
    mediaKinds: ["image", "carousel", "video", "document"],
    blurb: "One a day. Peer-level authority, long enough to earn the read.",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    mark: "ig",
    limit: 2200,
    fold: 125,
    maxHashtags: 30,
    minHashtags: 12,
    perDay: 3,
    counting: "codepoints",
    mediaKinds: ["carousel", "reel", "image"],
    blurb: "Three a day. Hook first, line breaks, no paragraph dumps.",
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    mark: "f",
    // Facebook's hard ceiling is 63,206, but reach falls off a cliff long
    // before that. The soft target is what the generator actually writes to.
    limit: 63206,
    softLimit: 1500,
    fold: 477,
    maxHashtags: 5,
    minHashtags: 2,
    perDay: 3,
    counting: "codepoints",
    mediaKinds: ["image", "video", "carousel"],
    blurb: "Three a day. Story-driven, community-facing.",
  },
  x: {
    id: "x",
    name: "X",
    mark: "X",
    limit: 280,
    premiumLimit: 25000,
    fold: 280,
    maxHashtags: 2,
    minHashtags: 0,
    perDay: 6,
    perDayMin: 5,
    perDayMax: 7,
    counting: "x-weighted",
    mediaKinds: ["image", "video"],
    blurb: "Five to seven a day. Every character is rented, not owned.",
  },
};

export const PLATFORM_ORDER = ["linkedin", "instagram", "facebook", "x"];

// X bills every link at a flat 23 characters no matter how long the URL is.
const X_URL_LENGTH = 23;
const URL_RE = /https?:\/\/[^\s]+|(?:^|\s)(?:www\.)[^\s]+/gi;

// twitter-text weights everything outside these code-point ranges double, which
// is how emoji and CJK eat two characters each.
const X_SINGLE_WEIGHT_RANGES = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

function xWeight(codePoint) {
  for (const [lo, hi] of X_SINGLE_WEIGHT_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 1;
  }
  return 2;
}

export function xWeightedLength(text) {
  if (!text) return 0;
  // Swap links for a fixed-width stand-in before weighing anything else.
  const flattened = String(text).replace(URL_RE, (match) => {
    const lead = /^\s/.test(match) ? match[0] : "";
    return lead + "u".repeat(X_URL_LENGTH);
  });
  let total = 0;
  for (const ch of flattened) total += xWeight(ch.codePointAt(0));
  return total;
}

// Everything that is not X counts by user-visible characters, so surrogate
// pairs and combining marks must not be double-counted the way .length does.
export function codePointLength(text) {
  return text ? Array.from(String(text)).length : 0;
}

export function countChars(platformId, text) {
  const p = PLATFORMS[platformId];
  if (p && p.counting === "x-weighted") return xWeightedLength(text);
  return codePointLength(text);
}

// The ceiling a given post is actually held to: the soft target where one
// exists, the premium ceiling on X when the account has it.
export function effectiveLimit(platformId, settings = {}) {
  const p = PLATFORMS[platformId];
  if (!p) return Infinity;
  if (platformId === "x" && settings.xPremium) return p.premiumLimit;
  if (p.softLimit && !settings.facebookLongForm) return p.softLimit;
  return p.limit;
}

export function normalizeHashtag(tag) {
  const cleaned = String(tag || "").trim().replace(/^[#\s]+/, "");
  return cleaned ? "#" + cleaned.replace(/\s+/g, "") : "";
}

export function normalizeHandle(handle) {
  const cleaned = String(handle || "").trim().replace(/^[@\s]+/, "");
  return cleaned ? "@" + cleaned.replace(/\s+/g, "") : "";
}

// The tag block the user copies. Comma-separated is the requested default;
// space-separated is what the composers actually want when pasted inline.
export function tagBlock(post, { separator = ", " } = {}) {
  const tags = (post.hashtags || []).map(normalizeHashtag).filter(Boolean);
  const handles = (post.tags || []).map(normalizeHandle).filter(Boolean);
  return [...dedupe(tags), ...dedupe(handles)].join(separator);
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// What lands in the composer: body plus, for platforms that carry them inline,
// the tag block underneath it.
export function composed(platformId, post, settings = {}) {
  const body = (post.body || "").trim();
  if (platformId === "instagram" && settings.igHashtagsInComment) return body;
  const tags = tagBlock(post, { separator: " " });
  return tags ? body + "\n\n" + tags : body;
}

// How many characters the body may use once the tag block has taken its cut.
export function bodyBudget(platformId, post, settings = {}) {
  const limit = effectiveLimit(platformId, settings);
  const body = (post.body || "").trim();
  const whole = composed(platformId, post, settings);
  const overhead = countChars(platformId, whole) - countChars(platformId, body);
  return limit - overhead;
}

export function validatePost(platformId, post, settings = {}) {
  const p = PLATFORMS[platformId];
  const errors = [];
  const limit = effectiveLimit(platformId, settings);
  const body = (post.body || "").trim();
  const whole = composed(platformId, post, settings);
  const used = countChars(platformId, whole);

  if (!body) errors.push({ code: "empty", message: "The post has no body." });
  if (used > limit) {
    errors.push({
      code: "too_long",
      message: `${used} of ${limit} characters once the tags are attached.`,
      over: used - limit,
    });
  }

  const hashtags = dedupe((post.hashtags || []).map(normalizeHashtag).filter(Boolean));
  if (p && hashtags.length > p.maxHashtags) {
    errors.push({
      code: "too_many_hashtags",
      message: `${hashtags.length} hashtags; ${p.name} takes at most ${p.maxHashtags}.`,
      over: hashtags.length - p.maxHashtags,
    });
  }
  if (p && p.minHashtags && hashtags.length < p.minHashtags) {
    errors.push({
      code: "too_few_hashtags",
      message: `${hashtags.length} hashtags; ${p.name} wants at least ${p.minHashtags}.`,
    });
  }
  for (const tag of hashtags) {
    if (!/^#[A-Za-z0-9_]+$/.test(tag)) {
      errors.push({ code: "bad_hashtag", message: `"${tag}" is not a usable hashtag.` });
    }
  }

  if (!post.media || !post.media.concept) {
    errors.push({ code: "no_media", message: "No image or video suggestion attached." });
  }

  return {
    ok: errors.length === 0,
    errors,
    used,
    limit,
    remaining: limit - used,
    hashtagCount: hashtags.length,
  };
}

// Last-resort trim so a post is never handed over above the limit. Preferred
// cut points, in order: end of a sentence, end of a line, end of a word.
export function trimToLimit(platformId, text, limit) {
  const source = String(text || "").trim();
  if (countChars(platformId, source) <= limit) return source;

  // Walk back from the limit by code point rather than by UTF-16 index.
  const chars = Array.from(source);
  let cut = chars.length;
  while (cut > 0 && countChars(platformId, chars.slice(0, cut).join("")) > limit) {
    cut -= 1;
  }
  let candidate = chars.slice(0, cut).join("");

  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
    candidate.lastIndexOf(".\n"),
    candidate.lastIndexOf("!\n"),
    candidate.lastIndexOf("?\n")
  );
  if (sentenceEnd > candidate.length * 0.55) return candidate.slice(0, sentenceEnd + 1).trim();

  const lineEnd = candidate.lastIndexOf("\n");
  if (lineEnd > candidate.length * 0.6) return candidate.slice(0, lineEnd).trim();

  const wordEnd = candidate.lastIndexOf(" ");
  if (wordEnd > 0) candidate = candidate.slice(0, wordEnd);
  return candidate.trim();
}

// Drop hashtags until the count is legal, keeping the earliest ones because the
// generator is told to lead with the most specific.
export function trimHashtags(platformId, hashtags) {
  const p = PLATFORMS[platformId];
  const clean = dedupe((hashtags || []).map(normalizeHashtag).filter((t) => /^#[A-Za-z0-9_]+$/.test(t)));
  return p ? clean.slice(0, p.maxHashtags) : clean;
}

// Force a post inside every hard rule. Returns the repaired post plus a note of
// what had to be cut, so the UI can be honest about it.
export function enforce(platformId, post, settings = {}) {
  const repaired = { ...post };
  const notes = [];

  const legalTags = trimHashtags(platformId, repaired.hashtags);
  if (legalTags.length !== (repaired.hashtags || []).length) {
    notes.push("Trimmed the hashtag list to the platform maximum.");
  }
  repaired.hashtags = legalTags;

  const budget = bodyBudget(platformId, repaired, settings);
  const body = (repaired.body || "").trim();
  if (countChars(platformId, body) > budget) {
    repaired.body = trimToLimit(platformId, body, budget);
    notes.push("Shortened the body to fit the character limit.");
  } else {
    repaired.body = body;
  }

  return { post: repaired, notes };
}

// How many posts a run should produce for one platform on one day.
export function postsPerDay(platformId, settings = {}) {
  const p = PLATFORMS[platformId];
  if (!p) return 0;
  const override = settings.perDay && settings.perDay[platformId];
  const n = Number(override) || p.perDay;
  if (p.perDayMin && p.perDayMax) {
    return Math.min(p.perDayMax, Math.max(p.perDayMin, n));
  }
  return Math.max(1, n);
}
