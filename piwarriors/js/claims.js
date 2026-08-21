// Sourcing gate for outside facts.
//
// The brand's credibility rests on being right in front of providers and
// attorneys, so a wrong bill number or a misstated effective date costs more
// than a clumsy sentence. These checks find the sentences that assert something
// checkable about the outside world and make sure each one is traceable to the
// week's research briefing or to Dr. Spence's own practice.

// Patterns that mark an assertion about the world rather than an opinion or a
// personal recollection. Tuned to avoid clinical numbers: "45 degrees of
// cervical rotation" and "18 visits" are not outside facts.
const RISKY = [
  { kind: "bill", re: /\b(?:SB|HB|AB|SF|HF|S\.B\.|H\.B\.)\s?\d{2,5}\b/g, label: "a bill number" },
  { kind: "regulation", re: /\bCMS-\d{4}-[A-Z]\b|\b\d{1,2}\s?C\.?F\.?R\.?\s?§?\s?\d+|§\s?\d+/g, label: "a regulation or code citation" },
  { kind: "case", re: /\b[A-Z][A-Za-z]+ v\.\s?[A-Z][A-Za-z]+/g, label: "a court case" },
  { kind: "statute-claim", re: /\b(?:several|many|most|some|a number of|\d+)\s+states\s+(?:have\s+)?(?:passed|enacted|adopted|require|now require|prohibit)/gi, label: "a claim about state law" },
  { kind: "effective-date", re: /\b(?:takes?|took|taking)\s+effect\b|\beffective\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}\/)|\bbeginning in\s+\d{4}\b|\bas of\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)/gi, label: "an effective date" },
  { kind: "big-number", re: /\b\d{1,3}(?:,\d{3})+\b/g, label: "a large figure" },
  { kind: "percentage", re: /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent)\b/gi, label: "a percentage" },
  { kind: "attribution", re: /\baccording to\b|\breported by\b|\ba (?:study|report|investigation|survey)\s+(?:found|showed|shows|revealed)\b|\bresearch shows\b|\bdata shows\b/gi, label: "an attribution to a source" },
  { kind: "ruling", re: /\b(?:a\s+)?(?:federal\s+)?judge\s+(?:ruled|granted|denied|dismissed)\b|\bcourt\s+(?:ruled|held|found)\b|\bjury\s+awarded\b/gi, label: "a court ruling" },
];

// Real organisations. Naming one turns a general point into a checkable claim
// about a specific company or agency, which is where the risk lives. The
// brand's own metaphor, the Insurance Empire, is deliberately not on this list.
const NAMED_ORGS = [
  "Cigna", "Aetna", "UnitedHealth", "United Healthcare", "Anthem", "Humana", "Kaiser",
  "Allstate", "State Farm", "GEICO", "Progressive", "Nationwide", "Travelers", "USAA",
  "Farmers", "Liberty Mutual", "American Family", "Erie Insurance", "MetLife",
  "CMS", "Centers for Medicare", "NAIC", "HHS", "Department of Health and Human Services",
  "ProPublica", "Reuters", "Associated Press", "Bloomberg", "Kaiser Health News",
  "Colossus", "Mitchell", "Xactimate",
];

const ORG_RE = new RegExp(`\\b(${NAMED_ORGS.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");

// Numbers that belong to Dr. Spence and the book rather than to the outside
// world. He is the source for these, so they never need a briefing line.
const OWN_FACTS = [
  /\b23 years\b/i, /\b21 years\b/i, /\b18 years\b/i,
  /\b60\s?%|\b60 percent/i, /\b20\s?%|\b20 percent/i,
];

export const CLAIM_BASES = ["briefing", "own-experience"];

function isOwnFact(fragment) {
  return OWN_FACTS.some((re) => re.test(fragment));
}

/**
 * Every fragment in the text that asserts something checkable.
 * @returns {Array<{kind:string,label:string,text:string}>}
 */
export function scanClaims(text) {
  const source = String(text || "");
  const found = [];
  const seen = new Set();

  const push = (kind, label, fragment) => {
    const key = `${kind}:${fragment.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, label, text: fragment });
  };

  for (const { kind, re, label } of RISKY) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const fragment = m[0].trim();
      // The brand's own figures are his to assert.
      if (isOwnFact(fragment)) continue;
      push(kind, label, fragment);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  ORG_RE.lastIndex = 0;
  let m;
  while ((m = ORG_RE.exec(source)) !== null) {
    push("named-org", "a named company or agency", m[0]);
  }

  return found;
}

// Loose containment: the briefing has to actually mention the thing, but the
// wording will differ between a research bullet and a finished sentence.
function briefingMentions(briefing, fragment) {
  const hay = String(briefing || "").toLowerCase();
  const needle = String(fragment || "").toLowerCase().trim();
  if (!needle) return false;
  if (hay.includes(needle)) return true;

  // Fall back to the distinctive tokens: a bill number, a figure, a proper noun.
  const tokens = needle.match(/[a-z0-9][a-z0-9,.\-]*/g) || [];
  const strong = tokens.filter((t) => t.length > 3 && !STOPWORDS.has(t));
  if (!strong.length) return false;
  return strong.every((t) => hay.includes(t));
}

const STOPWORDS = new Set([
  "have", "that", "this", "with", "from", "they", "them", "their", "there", "been",
  "were", "will", "would", "could", "should", "than", "then", "when", "what", "which",
  "states", "state", "effect", "takes", "took", "taking", "effective", "according",
  "percent", "beginning", "several", "many", "most", "some", "number",
]);

/**
 * Checks a post's outside facts against what it declared and what the briefing
 * actually supports.
 *
 * @param {object} post      the generated post, including its claims array
 * @param {string} briefing  this week's research briefing
 * @returns {{problems: string[], flagged: Array, declared: Array}}
 */
export function auditClaims(post, briefing) {
  const flagged = scanClaims(post && post.body);
  const declared = (post && post.claims) || [];
  const problems = [];

  // Anything declared as coming from the briefing has to be in the briefing.
  for (const claim of declared) {
    if (claim.basis !== "briefing") continue;
    const supported = briefingMentions(briefing, claim.support) || briefingMentions(briefing, claim.statement);
    if (!supported) {
      problems.push(
        `"${truncate(claim.statement)}" is presented as coming from this week's research, but the briefing does not contain it. Either drop the claim and make the point without it, or rewrite it as something you observed in your own practice.`
      );
    }
  }

  // Anything the text asserts has to have been declared.
  for (const hit of flagged) {
    const covered = declared.some(
      (c) => briefingMentions(c.statement, hit.text) || String(c.statement || "").toLowerCase().includes(hit.text.toLowerCase())
    );
    if (covered) continue;
    const inBriefing = briefingMentions(briefing, hit.text);
    problems.push(
      inBriefing
        ? `The post cites ${hit.label} ("${truncate(hit.text)}") without declaring it. List it in "claims" with the briefing line it came from.`
        : `The post cites ${hit.label} ("${truncate(hit.text)}") that appears nowhere in this week's research. Remove it. Make the same point from your own cases instead of from an outside fact you cannot source.`
    );
  }

  return { problems, flagged, declared };
}

function truncate(s, n = 60) {
  const t = String(s || "").trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

// What the reader of a finished post should check before publishing. Only the
// outside facts; his own recollections are his to stand behind.
export function reviewList(post) {
  return ((post && post.claims) || []).filter((c) => c.basis === "briefing");
}
