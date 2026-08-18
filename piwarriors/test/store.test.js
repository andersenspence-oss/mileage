import { test } from 'node:test';
import assert from 'node:assert/strict';

// Node has no localStorage, so the module gets a minimal stand-in.
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
};
const KEY = 'piw.settings.v1';
const { loadSettings, DEFAULT_SETTINGS, historyFor } = await import('../js/store.js');

test('a fresh install gets the default model mix', () => {
  localStorage.clear();
  assert.deepEqual(loadSettings().models, DEFAULT_SETTINGS.models);
});

test('settings saved before per-platform models keep the model that was chosen', () => {
  localStorage.clear();
  mem[KEY] = JSON.stringify({ apiKey: 'k', model: 'claude-sonnet-5' });
  const models = loadSettings().models;
  for (const key of Object.keys(DEFAULT_SETTINGS.models)) {
    assert.equal(models[key], 'claude-sonnet-5', `${key} should keep the old choice`);
  }
  assert.equal(loadSettings().model, undefined, 'the old single field is dropped');
});

test('a partial override is filled in from the defaults', () => {
  localStorage.clear();
  mem[KEY] = JSON.stringify({ models: { x: 'claude-opus-5' } });
  const models = loadSettings().models;
  assert.equal(models.x, 'claude-opus-5');
  assert.equal(models.linkedin, DEFAULT_SETTINGS.models.linkedin);
  assert.equal(models.plan, DEFAULT_SETTINGS.models.plan);
});

test('corrupt stored settings fall back to the defaults instead of throwing', () => {
  localStorage.clear();
  mem[KEY] = 'not json';
  assert.deepEqual(loadSettings().models, DEFAULT_SETTINGS.models);
});

test('history pulls opening lines and themes out of past runs', () => {
  const runs = [{
    startDate: '2026-08-11',
    weekTheme: 'The record decides the case.',
    chunks: [{ posts: [{ hook: 'Six of eighteen approved.', body: 'Six of eighteen approved.\nMore.' }] }],
  }];
  const h = historyFor(runs);
  assert.ok(h.themes[0].includes('The record decides the case.'));
  assert.equal(h.hooks[0], 'Six of eighteen approved.');
});
