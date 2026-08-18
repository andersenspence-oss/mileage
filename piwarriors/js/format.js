// Turns posts into the exact blocks of text the copy buttons hand over.

import { PLATFORMS, tagBlock, composed } from "./limits.js";
import { formatDate } from "./ui.js";

export function bodyText(post) {
  return (post.body || "").trim();
}

// The requested format: every hashtag and handle on one line, comma separated.
export function tagText(post, separator = ", ") {
  return tagBlock(post, { separator });
}

// Body and tags together, laid out the way it should land in the composer,
// which means the tags are space separated here regardless of the display
// setting, because that is what the platforms parse.
export function fullText(post, settings = {}) {
  return composed(post.platform, post, settings).trim();
}

export function mediaText(post) {
  const m = post.media || {};
  const lines = [];
  if (m.kind) lines.push(`Format: ${m.kind}`);
  if (m.concept) lines.push(`Concept: ${m.concept}`);
  if (m.direction) lines.push(`How to shoot or build it: ${m.direction}`);
  if (m.onScreenText) lines.push(`On-screen text: ${m.onScreenText}`);
  if (m.altText) lines.push(`Alt text: ${m.altText}`);
  return lines.join("\n");
}

function postBlock(post, index, settings) {
  const p = PLATFORMS[post.platform];
  const header = `--- ${p.name} ${index} ${post.slot ? `· ${post.slot}` : ""} ---`.replace(/\s+·\s+---$/, " ---");
  const parts = [header, "", bodyText(post), ""];
  const tags = tagText(post, settings.tagSeparator || ", ");
  if (tags) parts.push("Hashtags and tags:", tags, "");
  const media = mediaText(post);
  if (media) parts.push("Media:", media, "");
  return parts.join("\n");
}

export function dayText(run, day, settings = {}) {
  const posts = postsForDay(run, day.date);
  const lines = [
    `${formatDate(day.date)}`,
    day.theme ? `Theme: ${day.theme}` : "",
    day.pillar ? `Pillar: ${day.pillar}` : "",
    "",
  ].filter(Boolean);

  const byPlatform = groupByPlatform(posts);
  for (const [platformId, list] of byPlatform) {
    lines.push(`=== ${PLATFORMS[platformId].name} ===`, "");
    list.forEach((post, i) => lines.push(postBlock(post, i + 1, settings)));
  }
  return lines.join("\n").trim() + "\n";
}

export function runText(run, settings = {}) {
  const lines = [
    "PI WARRIORS — CONTENT RUN",
    `Week beginning ${formatDate(run.startDate)}`,
    run.weekTheme ? `Week theme: ${run.weekTheme}` : "",
    run.rationale ? `Why this week: ${run.rationale}` : "",
    "",
  ].filter(Boolean);

  for (const day of run.days || []) {
    lines.push(dayText(run, day, settings), "");
  }
  return lines.join("\n").trim() + "\n";
}

export function platformText(run, platformId, settings = {}) {
  const lines = [`PI WARRIORS — ${PLATFORMS[platformId].name}`, `Week beginning ${formatDate(run.startDate)}`, ""];
  for (const day of run.days || []) {
    const posts = postsForDay(run, day.date).filter((p) => p.platform === platformId);
    if (!posts.length) continue;
    lines.push(`=== ${formatDate(day.date)} ===`, "");
    posts.forEach((post, i) => lines.push(postBlock(post, i + 1, settings)));
  }
  return lines.join("\n").trim() + "\n";
}

export function postsForDay(run, date) {
  const out = [];
  for (const chunk of run.chunks || []) {
    if (chunk.day && chunk.day.date === date) out.push(...(chunk.posts || []));
  }
  return out;
}

export function groupByPlatform(posts) {
  const map = new Map();
  for (const post of posts) {
    if (!map.has(post.platform)) map.set(post.platform, []);
    map.get(post.platform).push(post);
  }
  return map;
}

export function countPosts(run) {
  return (run.chunks || []).reduce((n, c) => n + (c.posts || []).length, 0);
}

export function runErrors(run) {
  return (run.chunks || []).filter((c) => c.error);
}
