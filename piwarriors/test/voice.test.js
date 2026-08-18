import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../js/voice.js';

// Copy written the way the brand actually sounds must pass untouched, or every
// good post would burn rewrite rounds and come back worse.
const GOOD = [
  'Six of eighteen visits approved. The adjuster never read my notes. An algorithm did.',
  'Technique is assumed, not proven. Documentation is analyzed, not assumed.',
  'You are not the problem. Your system is.',
  'A loaf of bread does not pay the bills.',
  'The Insurance Empire is a real, funded, ruthless adversary.',
  'Stop writing narratives at 9pm. Start building records that hold.',
  'Legal defensibility is not applied to a record. It is built into the process that creates it.',
  'Billing tells a story. That story either supports the case or destroys it.',
  'Case quality, not case volume, determines outcomes.',
  'Automation removes variability. It does not replace judgment.',
  "In today's mail: another reduction letter.",
  'I lost eighteen visits to a sentence I never wrote.',
];

for (const line of GOOD) {
  test(`brand voice passes: "${line.slice(0, 42)}..."`, () => {
    assert.deepEqual(V.blockers(V.scanText(line)), [], 'should not be flagged');
  });
}

test('stock LLM phrasing is caught', () => {
  const slop =
    "In today's healthcare landscape, documentation stands as a testament to your commitment. " +
    "It's not just paperwork, it's a game-changer that will empower you to unlock your potential.";
  const labels = V.blockers(V.scanText(slop)).map((f) => f.label);
  for (const expected of ['game-changer', 'testament to', 'empower', 'stands as a']) {
    assert.ok(labels.includes(expected), `missed ${expected}`);
  }
});

test('tells are caught through curly apostrophes', () => {
  const text = V.normalizePunctuation('It’s not just a note, it’s evidence. Let’s dive in.');
  const labels = V.blockers(V.scanText(text)).map((f) => f.label);
  assert.ok(labels.includes("it's not just X, it's Y"));
  assert.ok(labels.includes("let's dive in"));
});

test('one em dash is allowed, several are not', () => {
  assert.deepEqual(V.blockers(V.scanText('A sentence — with one dash.')), []);
  assert.ok(V.blockers(V.scanText('A — b — c — d')).length > 0);
});

test('punctuation is normalised so nothing breaks on paste', () => {
  assert.equal(V.normalizePunctuation('“a” ‘b’ c…'), '"a" \'b\' c...');
});

test('"in today\'s" only trips on the abstract form', () => {
  assert.deepEqual(V.blockers(V.scanText("In today's clinic I saw three crash patients.")), []);
  assert.ok(V.blockers(V.scanText("In today's world, records matter.")).length > 0);
});
