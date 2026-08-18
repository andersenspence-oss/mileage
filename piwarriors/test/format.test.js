import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/format.js';
import { buildDays } from '../js/generate.js';

const post = {
  platform: 'x',
  body: 'Six of eighteen approved.',
  hashtags: ['PIWarriors', 'PersonalInjury'],
  tags: ['crash101'],
  media: { kind: 'image', concept: 'A reduction letter', direction: 'Overhead, one lamp', onScreenText: '6 of 18', altText: 'A letter on a desk' },
};

test('the tag section is comma separated for copying', () => {
  assert.equal(F.tagText(post, ', '), '#PIWarriors, #PersonalInjury, @crash101');
});

test('post-plus-tags uses spaces, because that is what composers parse', () => {
  assert.equal(F.fullText(post, {}), 'Six of eighteen approved.\n\n#PIWarriors #PersonalInjury @crash101');
});

test('the media brief carries every field someone would need to shoot it', () => {
  const text = F.mediaText(post);
  for (const part of ['image', 'A reduction letter', 'Overhead, one lamp', '6 of 18', 'A letter on a desk']) {
    assert.ok(text.includes(part), `media brief missing ${part}`);
  }
});

test('whole-run export contains every post', () => {
  const run = {
    startDate: '2026-08-18',
    weekTheme: 'The record decides the case.',
    days: [{ date: '2026-08-18', dayName: 'Tuesday', theme: 'Frequency', pillar: 'documentation' }],
    chunks: [{ platform: 'x', day: { date: '2026-08-18' }, posts: [post, { ...post, body: 'Second post.' }] }],
  };
  const text = F.runText(run, {});
  assert.ok(text.includes('Six of eighteen approved.'));
  assert.ok(text.includes('Second post.'));
  assert.ok(text.includes('The record decides the case.'));
  assert.equal(F.countPosts(run), 2);
});

test('days are generated in order and roll over a year boundary', () => {
  assert.deepEqual(buildDays('2026-12-30', 4).map((d) => d.date), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(buildDays('2026-08-18', 1)[0].dayName, 'Tuesday');
});
