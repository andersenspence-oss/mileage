import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateRun, modelInfo, MODELS } from '../js/api.js';

const ALL = ['linkedin', 'instagram', 'facebook', 'x'];
const map = (fn) => Object.fromEntries(['plan', ...ALL].map((k) => [k, fn(k)]));
const allOpus = map(() => 'claude-opus-5');
const allSonnet = map(() => 'claude-sonnet-5');
const mixed = { ...allOpus, x: 'claude-sonnet-5' };

test('an unknown model id falls back to the default rather than throwing', () => {
  assert.equal(modelInfo('nope').id, MODELS[0].id);
  assert.equal(modelInfo(undefined).id, MODELS[0].id);
});

test('cost rises with the number of days, but less than linearly', () => {
  const one = estimateRun({ models: allOpus, platforms: ALL, dayCount: 1 });
  const seven = estimateRun({ models: allOpus, platforms: ALL, dayCount: 7 });
  assert.ok(seven.low > one.low, 'more days must cost more');
  assert.equal(seven.calls, 4 * 7 + 2);

  // Seven times the days costs about four and a half times as much: the two
  // setup calls are paid once, and every batch after the first on a given model
  // reads the cached brand prompt instead of re-sending it.
  const ratio = seven.low / one.low;
  assert.ok(ratio > 3 && ratio < 7, `expected a sublinear ratio, got ${ratio.toFixed(2)}`);
});

test('a longer run costs less per day than a short one', () => {
  const one = estimateRun({ models: allOpus, platforms: ALL, dayCount: 1 }).low;
  const fourteen = estimateRun({ models: allOpus, platforms: ALL, dayCount: 14 }).low / 14;
  assert.ok(fourteen < one, 'caching should make each extra day cheaper');
});

test('a cheaper model on any platform lowers the estimate', () => {
  const opus = estimateRun({ models: allOpus, platforms: ALL, dayCount: 7 }).low;
  const mix = estimateRun({ models: mixed, platforms: ALL, dayCount: 7 }).low;
  const sonnet = estimateRun({ models: allSonnet, platforms: ALL, dayCount: 7 }).low;
  assert.ok(mix < opus, 'moving X to Sonnet should cost less than all Opus');
  assert.ok(sonnet < mix, 'all Sonnet should cost less than the mix');
});

test('moving only X is a small saving, because X posts are short', () => {
  const opus = estimateRun({ models: allOpus, platforms: ALL, dayCount: 7 }).low;
  const mix = estimateRun({ models: mixed, platforms: ALL, dayCount: 7 }).low;
  const saving = (opus - mix) / opus;
  // Guards the honest framing in the UI: this is a nudge, not a halving.
  assert.ok(saving > 0.02 && saving < 0.2, `expected a small saving, got ${(saving * 100).toFixed(0)}%`);
});

test('all Sonnet is a substantial saving', () => {
  const opus = estimateRun({ models: allOpus, platforms: ALL, dayCount: 7 }).low;
  const sonnet = estimateRun({ models: allSonnet, platforms: ALL, dayCount: 7 }).low;
  assert.ok((opus - sonnet) / opus > 0.3, 'should be well over a third cheaper');
});

test('dropping a platform drops its cost and its calls', () => {
  const four = estimateRun({ models: allOpus, platforms: ALL, dayCount: 7 });
  const one = estimateRun({ models: allOpus, platforms: ['linkedin'], dayCount: 7 });
  assert.ok(one.low < four.low);
  assert.equal(one.calls, 7 + 2);
});

test('an empty run still accounts for the research and planning calls', () => {
  const none = estimateRun({ models: allOpus, platforms: [], dayCount: 7 });
  assert.equal(none.calls, 2);
  assert.ok(none.low > 0);
});
