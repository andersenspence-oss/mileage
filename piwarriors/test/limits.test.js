import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/limits.js';

test('X counts a link as 23 characters however long it is', () => {
  const short = L.countChars('x', 'see https://a.co');
  const long = L.countChars('x', 'see https://crash101.com/a/very/long/path/that/keeps/on/going/forever');
  assert.equal(short, long, 'link length must not change the count');
  assert.equal(short, 4 + 23);
});

test('X weights emoji and CJK double, plain text single', () => {
  assert.equal(L.countChars('x', 'hello world'), 11);
  assert.equal(L.countChars('x', 'ab\u{1F600}'), 4);
  assert.equal(L.countChars('x', '你好'), 4);
});

test('other platforms count visible characters, not UTF-16 units', () => {
  assert.equal(L.countChars('linkedin', 'ab\u{1F600}'), 3);
  assert.equal(L.countChars('instagram', 'ab\u{1F600}'), 3);
});

test('the limit covers body and tags together', () => {
  const post = { body: 'x'.repeat(270), hashtags: ['PIWarriors'], tags: [] };
  const check = L.validatePost('x', post, {});
  assert.ok(!check.ok, 'body plus tags exceeds 280 and must fail');
  assert.ok(check.used > 280);
});

test('Instagram hashtags can be moved to the first comment', () => {
  const post = {
    body: 'x'.repeat(2190),
    hashtags: Array.from({ length: 20 }, (_, i) => 'tag' + i),
    tags: [],
    media: { concept: 'a photo' },
  };
  const inCaption = L.validatePost('instagram', post, {});
  assert.ok(inCaption.errors.some((e) => e.code === 'too_long'), 'in-caption tags push it over');

  const inComment = L.validatePost('instagram', post, { igHashtagsInComment: true });
  assert.ok(inComment.ok, 'first-comment tags leave the caption inside the limit');
});

test('X Premium raises the ceiling', () => {
  assert.equal(L.effectiveLimit('x', {}), 280);
  assert.equal(L.effectiveLimit('x', { xPremium: true }), 25000);
});

test('Facebook uses the soft target unless long form is allowed', () => {
  assert.equal(L.effectiveLimit('facebook', {}), 1500);
  assert.equal(L.effectiveLimit('facebook', { facebookLongForm: true }), 63206);
});

test('trimToLimit prefers a sentence boundary and never exceeds the limit', () => {
  const text = 'One sentence here. Two sentences here. ' + 'z'.repeat(400);
  const out = L.trimToLimit('x', text, 60);
  assert.ok(L.countChars('x', out) <= 60);
  assert.ok(out.endsWith('.'), 'should cut at a sentence end when one is near');
});

test('trimToLimit does not split a surrogate pair', () => {
  const text = 'a'.repeat(20) + '\u{1F600}'.repeat(20);
  const out = L.trimToLimit('linkedin', text, 25);
  assert.ok(L.countChars('linkedin', out) <= 25);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out), 'must not end on a lone high surrogate');
});

test('enforce always produces a post that is inside every hard rule', () => {
  const post = {
    body: 'Documentation is the weapon that decides the case. '.repeat(14),
    hashtags: Array.from({ length: 12 }, (_, i) => 'tag' + i),
    tags: [],
    media: { concept: 'x' },
  };
  for (const platform of Object.keys(L.PLATFORMS)) {
    const { post: safe } = L.enforce(platform, post, {});
    const check = L.validatePost(platform, safe, {});
    assert.ok(check.used <= check.limit, `${platform} still over: ${check.used}/${check.limit}`);
    assert.ok(safe.hashtags.length <= L.PLATFORMS[platform].maxHashtags, `${platform} too many hashtags`);
  }
});

test('hashtags and handles are normalised, and de-duplicated case-insensitively', () => {
  // Hashtags are case-insensitive on every platform, so these are one tag.
  const post = { hashtags: ['#PIWarriors', 'PIWarriors', ' pi warriors '], tags: ['@crash101', 'crash101'] };
  assert.equal(L.tagBlock(post, { separator: ', ' }), '#PIWarriors, @crash101');

  // Genuinely different tags all survive.
  const mixed = { hashtags: ['PIWarriors', 'Documentation'], tags: ['crash101'] };
  assert.equal(L.tagBlock(mixed, { separator: ', ' }), '#PIWarriors, #Documentation, @crash101');
});

test('the tag block honours the requested separator', () => {
  const post = { hashtags: ['a', 'b'], tags: ['c'] };
  assert.equal(L.tagBlock(post, { separator: ', ' }), '#a, #b, @c');
  assert.equal(L.tagBlock(post, { separator: ' ' }), '#a #b @c');
});

test('malformed hashtags are rejected then stripped', () => {
  const post = { body: 'hi', hashtags: ['good', 'bad-one!'], tags: [], media: { concept: 'x' } };
  assert.ok(L.validatePost('linkedin', post, {}).errors.some((e) => e.code === 'bad_hashtag'));
  assert.deepEqual(L.trimHashtags('linkedin', post.hashtags), ['#good']);
});

test('X posts per day stay in the 5 to 7 band', () => {
  assert.equal(L.postsPerDay('x', { perDay: { x: 2 } }), 5);
  assert.equal(L.postsPerDay('x', { perDay: { x: 99 } }), 7);
  assert.equal(L.postsPerDay('x', {}), 6);
  assert.equal(L.postsPerDay('linkedin', {}), 1);
});
