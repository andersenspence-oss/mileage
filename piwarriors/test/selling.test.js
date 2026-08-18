import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/voice.js';
import { allocateOffers, buildDays } from '../js/generate.js';

test('a conversation post with no ask is clean', () => {
  const post = { intent: 'conversation', body: 'What did your last reduction letter actually say? I want the exact wording.' };
  assert.deepEqual(V.sellingFindings(post), []);
});

test('an ask hidden in a non-selling post is caught', () => {
  const post = { intent: 'insight', body: 'Documentation decides the case. Sign up at crash101.com to fix yours.' };
  const labels = V.sellingFindings(post).map((f) => f.label);
  assert.ok(labels.some((l) => l.includes('sign up')));
  assert.ok(labels.some((l) => l.includes('crash101.com')));
});

test('the same ask is fine in the post that was allowed to sell', () => {
  const post = { intent: 'offer', body: 'The template I use for this lives in the Crash101 system if you want it. crash101.com' };
  assert.deepEqual(V.sellingFindings(post), []);
});

test('manufactured urgency is banned even in a selling post', () => {
  const post = { intent: 'offer', body: 'Limited time. Only 3 spots left, so act now before the discount ends.' };
  const labels = V.sellingFindings(post).map((f) => f.label);
  for (const expected of ['limited time', 'act now', 'only N left', 'discount']) {
    assert.ok(labels.includes(expected), `missed ${expected}`);
  }
});

test('a bare link never belongs in a post that is not selling', () => {
  assert.ok(V.sellingFindings({ intent: 'story', body: 'Read it here https://example.com/x' }).length > 0);
});

test('brand language that merely names the product is not treated as an ask', () => {
  const post = { intent: 'insight', body: 'Automation removes variability. It does not replace judgment, and no tool builds the system for you.' };
  assert.deepEqual(V.sellingFindings(post), []);
});

test('one selling post a week lands mid-run, not on day one', () => {
  const days = buildDays('2026-08-18', 7);
  const picks = allocateOffers(['linkedin'], days, 1);
  const chosen = days.findIndex((d) => picks[`linkedin|${d.date}`]);
  assert.equal(Object.keys(picks).length, 1);
  assert.ok(chosen > 0 && chosen < days.length - 1, `landed on index ${chosen}`);
});

test('selling posts are spread, never on consecutive days', () => {
  const days = buildDays('2026-08-18', 7);
  const picks = allocateOffers(['x'], days, 3);
  const idx = days.map((d, i) => (picks[`x|${d.date}`] ? i : -1)).filter((i) => i >= 0);
  assert.equal(idx.length, 3);
  for (let i = 1; i < idx.length; i += 1) {
    assert.ok(idx[i] - idx[i - 1] > 1, `days ${idx[i - 1]} and ${idx[i]} are adjacent`);
  }
});

test('a default week is a dusting, not a campaign', () => {
  const days = buildDays('2026-08-18', 7);
  const picks = allocateOffers(['linkedin', 'instagram', 'facebook', 'x'], days, 1);
  // 1 LinkedIn + 3 Instagram + 3 Facebook + 6 X a day over seven days.
  const totalPosts = (1 + 3 + 3 + 6) * 7;
  assert.equal(Object.keys(picks).length, 4);
  assert.ok(Object.keys(picks).length / totalPosts < 0.05, 'under one in twenty');
});

test('zero means a week that sells nothing', () => {
  const days = buildDays('2026-08-18', 7);
  assert.deepEqual(allocateOffers(['linkedin', 'x'], days, 0), {});
});

test('a short run does not get a full week of selling', () => {
  assert.deepEqual(allocateOffers(['x'], buildDays('2026-08-18', 1), 1), {});
  assert.equal(Object.keys(allocateOffers(['x'], buildDays('2026-08-18', 14), 1)).length, 2);
});
