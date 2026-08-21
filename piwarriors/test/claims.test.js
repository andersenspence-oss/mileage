import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanClaims, auditClaims, reviewList, verdictProblems } from '../js/claims.js';

// These three describe the permissive mode, which has to be asked for.
const OPEN = { mode: 'verified-facts' };

// The post that went out and did not survive a fact check.
const REAL_POST = `A carrier is alleged to have run 300,000 claims through an algorithm averaging 1.2 seconds per review.
Several states have passed laws saying AI cannot be the sole basis for denying care. Most take effect in 2026.
Under CMS-0057-F, denial notices have to cite specific, current clinical criteria.`;

test('the claims that failed the fact check are all caught', () => {
  const kinds = scanClaims(REAL_POST).map((f) => f.kind);
  for (const expected of ['big-number', 'statute-claim', 'effective-date', 'regulation', 'named-org']) {
    assert.ok(kinds.includes(expected), `missed ${expected}`);
  }
});

test('clinical numbers are not treated as outside facts', () => {
  const clinical = 'Cervical rotation limited to 45 degrees. Six of eighteen visits approved. Three times a week for six weeks.';
  assert.deepEqual(scanClaims(clinical), []);
});

test("the brand's own figures need no briefing line", () => {
  assert.deepEqual(scanClaims('Documentation is 60% of the outcome. Technique is 20%.'), []);
  assert.deepEqual(scanClaims('23 years in practice, 21 of them in PI.'), []);
});

test('the brand metaphor is not mistaken for a real company', () => {
  assert.deepEqual(scanClaims('The Insurance Empire is a funded, ruthless adversary.'), []);
});

test('an outside fact with no briefing behind it is a problem', () => {
  const post = { body: 'Under CMS-0057-F, denial notices must cite criteria.', claims: [] };
  const { problems } = auditClaims(post, '## What changed this week\n- Nothing solid found.', OPEN);
  assert.equal(problems.length > 0, true);
  assert.match(problems[0], /appears nowhere in this week's research/);
});

test('a claim declared as briefing-sourced must actually be in the briefing', () => {
  const post = {
    body: 'Several states have passed laws on this.',
    claims: [{ statement: 'Several states have passed laws', basis: 'briefing', support: 'Utah SB 319 takes effect 2027' }],
  };
  const { problems } = auditClaims(post, 'The briefing says nothing of the kind.', OPEN);
  assert.equal(problems.length > 0, true);
  assert.match(problems.join(' '), /the briefing does not contain it/);
});

test('a properly sourced claim passes', () => {
  const briefing = '## What changed this week\n- California SB 1120 took effect January 1, 2025 (state law, health insurance only).';
  const post = {
    body: 'California SB 1120 took effect January 1, 2025, and it governs health plans rather than auto carriers.',
    claims: [{ statement: 'California SB 1120 took effect January 1, 2025', basis: 'briefing', support: 'California SB 1120 took effect January 1, 2025' }],
  };
  assert.deepEqual(auditClaims(post, briefing, OPEN).problems, []);
});

test('a post built only on his own cases raises nothing', () => {
  const post = {
    body: 'I lost eighteen visits to a sentence I never wrote. The plan of care never said why this patient needed that frequency.',
    claims: [],
  };
  assert.deepEqual(auditClaims(post, '', OPEN).problems, []);
});

test('only briefing-sourced claims go on the check-before-posting list', () => {
  const post = {
    claims: [
      { statement: 'A carrier reviewed claims in seconds', basis: 'briefing', support: 'ProPublica, March 2023' },
      { statement: 'I lost eighteen visits', basis: 'own-experience', support: 'his own case' },
    ],
  };
  assert.equal(reviewList(post).length, 1);
  assert.equal(reviewList(post)[0].basis, 'briefing');
});


// --- the default mode: no outside facts at all ---

test('by default an outside fact is refused even when the briefing supports it', () => {
  const briefing = 'California SB 1120 took effect January 1, 2025.';
  const post = {
    body: 'California SB 1120 took effect January 1, 2025.',
    claims: [{ statement: 'California SB 1120 took effect January 1, 2025', basis: 'briefing', support: briefing }],
  };
  const { problems } = auditClaims(post, briefing);
  assert.ok(problems.length > 0, 'the default must refuse it');
  assert.match(problems.join(' '), /own practice only/);
});

test('by default a post from his own cases passes', () => {
  const post = {
    body: 'I lost eighteen visits to a sentence I never wrote. What did your last reduction letter actually say?',
    claims: [{ statement: 'I lost eighteen visits', basis: 'own-experience', support: 'his own case' }],
  };
  assert.deepEqual(auditClaims(post, '').problems, []);
});

test('the exact CMS sentence is refused by default', () => {
  const post = { body: 'Under CMS-0057-F, denial notices have to cite specific, current clinical criteria.', claims: [] };
  assert.ok(auditClaims(post, '').problems.length > 0);
});

// --- verification verdicts ---

test('only a supported verdict passes', () => {
  const base = { statement: 'A rule requires X', basis: 'briefing', support: 's' };
  assert.deepEqual(verdictProblems([{ ...base, verification: { verdict: 'supported' } }]), []);
  for (const verdict of ['overstated', 'unsupported', 'contradicted']) {
    assert.equal(verdictProblems([{ ...base, verification: { verdict } }]).length, 1, `${verdict} must fail`);
  }
});

test('an overstated claim reports what the source actually says', () => {
  const problems = verdictProblems([{
    statement: 'CMS-0057-F requires a licensed human to sign every denial',
    basis: 'briefing',
    verification: {
      verdict: 'overstated',
      correction: 'The rule requires a specific reason for denial and says nothing about who makes the decision.',
    },
  }]);
  assert.match(problems[0], /overstated/);
  assert.match(problems[0], /says nothing about who makes the decision/);
});

test('a claim that was never checked is treated as failed, not as passed', () => {
  const problems = verdictProblems([{ statement: 'Something', basis: 'briefing', support: 's' }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /never checked/);
});
