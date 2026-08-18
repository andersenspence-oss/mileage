// Mechanical checks for the tells that make copy read as machine-written.
// The generator is told to avoid these; this catches what slips through and
// feeds it back for a rewrite, so "humanized" is verified rather than assumed.

// Severity "block" triggers an automatic rewrite pass. "warn" is surfaced in
// the UI but never loops, because some of these are judgement calls.
const PATTERNS = [
  // Phrases the brand rules ban outright.
  { re: /\bgame[-\s]?changer\b/i, label: "game-changer", severity: "block" },
  { re: /\brevolutionary\b/i, label: "revolutionary", severity: "block" },
  { re: /\bat the end of the day\b/i, label: "at the end of the day", severity: "block" },
  { re: /\bsynerg(y|ies|istic)\b/i, label: "synergy", severity: "block" },
  { re: /\bcircle back\b/i, label: "circle back", severity: "block" },
  { re: /\bleverag(e|es|ed|ing)\b/i, label: "leverage", severity: "block" },
  { re: /\bpassionate about (helping|serving)\b/i, label: "passionate about helping", severity: "block" },

  // Stock LLM vocabulary.
  { re: /\bdelv(e|es|ed|ing)\b/i, label: "delve", severity: "block" },
  { re: /\btapestry\b/i, label: "tapestry", severity: "block" },
  { re: /\b(a|is a) testament to\b/i, label: "testament to", severity: "block" },
  { re: /\bunderscor(e|es|ed|ing)\b/i, label: "underscore", severity: "block" },
  { re: /\bpivotal\b/i, label: "pivotal", severity: "block" },
  { re: /\bmyriad\b/i, label: "myriad", severity: "block" },
  { re: /\bplethora\b/i, label: "plethora", severity: "block" },
  { re: /\bmeticulous(ly)?\b/i, label: "meticulous", severity: "block" },
  { re: /\bseamless(ly)?\b/i, label: "seamless", severity: "block" },
  { re: /\bcutting[-\s]edge\b/i, label: "cutting-edge", severity: "block" },
  { re: /\bstate[-\s]of[-\s]the[-\s]art\b/i, label: "state-of-the-art", severity: "block" },
  { re: /\bholistic\b/i, label: "holistic", severity: "block" },
  { re: /\bfoster(s|ed|ing)?\b/i, label: "foster", severity: "block" },
  { re: /\bshowcas(e|es|ed|ing)\b/i, label: "showcase", severity: "block" },
  { re: /\bresonat(e|es|ed|ing)\b/i, label: "resonate", severity: "block" },
  { re: /\balign(s|ed|ing)? with\b/i, label: "align with", severity: "block" },
  { re: /\bempower(s|ed|ing)?\b/i, label: "empower", severity: "block" },
  { re: /\bunlock (the|your)\b/i, label: "unlock the/your", severity: "block" },
  { re: /\belevate your\b/i, label: "elevate your", severity: "block" },
  { re: /\bnavigat(e|ing) the (complex|challeng|landscape)/i, label: "navigate the complexities", severity: "block" },
  { re: /\bin the realm of\b/i, label: "in the realm of", severity: "block" },
  { re: /\bever[-\s]evolving\b/i, label: "ever-evolving", severity: "block" },
  { re: /\bfast[-\s]paced\b/i, label: "fast-paced", severity: "block" },
  { re: /\brobust\b/i, label: "robust", severity: "warn" },
  { re: /\bcrucial\b/i, label: "crucial", severity: "warn" },
  { re: /\bvital (role|part)\b/i, label: "vital role", severity: "block" },
  { re: /\bkey takeaway\b/i, label: "key takeaway", severity: "block" },

  // Copula avoidance.
  { re: /\bstands as (a|an|the)\b/i, label: "stands as a", severity: "block" },
  { re: /\bserves as (a|an|the)\b/i, label: "serves as a", severity: "block" },
  { re: /\bboasts (a|an|over|more)\b/i, label: "boasts", severity: "block" },

  // Negative parallelism.
  { re: /\bit['’]?s not (just|merely|only) [^.!?\n]{2,60}?,? it['’]?s\b/i, label: "it's not just X, it's Y", severity: "block" },
  { re: /\bnot only\b[^.!?\n]{2,80}?\bbut also\b/i, label: "not only / but also", severity: "block" },

  // Signposting and chatbot residue.
  { re: /\blet['’]?s (dive|break (this|it) down|explore|unpack)\b/i, label: "let's dive in", severity: "block" },
  { re: /\bbuckle up\b/i, label: "buckle up", severity: "block" },
  { re: /\bhere['’]?s what you need to know\b/i, label: "here's what you need to know", severity: "block" },
  { re: /\b(i hope this helps|great question|certainly!|of course!)\b/i, label: "chatbot residue", severity: "block" },
  // Only the abstract-noun form is a tell. "In today's mail" is how people talk.
  { re: /\bin today['’]?s (world|market|landscape|environment|economy|climate|era|age|society|healthcare|industry)\b/i, label: "in today's <abstraction>", severity: "block" },

  // Sentence-initial connectors that read as essay filler.
  { re: /(^|\n)\s*(Moreover|Furthermore|Additionally)\b/, label: "Moreover/Furthermore/Additionally", severity: "block" },

  // Persuasive authority tropes.
  { re: /\bthe real question is\b/i, label: "the real question is", severity: "block" },
  { re: /\bat its core\b/i, label: "at its core", severity: "block" },
  { re: /\bwhat really matters\b/i, label: "what really matters", severity: "block" },
];

// Counted rather than matched, because one is fine and four is a tell.
const EM_DASH_LIMIT = 1;
const EMOJI_LIMIT = 4;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function scanText(text) {
  const source = String(text || "");
  const found = [];

  for (const p of PATTERNS) {
    const match = source.match(p.re);
    if (match) {
      found.push({ label: p.label, severity: p.severity, sample: match[0].trim() });
    }
  }

  const emDashes = (source.match(/—/g) || []).length;
  if (emDashes > EM_DASH_LIMIT) {
    found.push({
      label: `${emDashes} em dashes`,
      severity: "block",
      sample: "—",
    });
  }

  const emoji = (source.match(EMOJI_RE) || []).length;
  if (emoji > EMOJI_LIMIT) {
    found.push({ label: `${emoji} emoji`, severity: "warn", sample: "emoji" });
  }

  return found;
}

export function scanPost(post) {
  // Hashtags legitimately contain brand words, so only the prose is scanned.
  return scanText(post && post.body);
}

export function blockers(findings) {
  return findings.filter((f) => f.severity === "block");
}

// One line the rewrite prompt can act on.
export function describe(findings) {
  return blockers(findings).map((f) => f.label).join("; ");
}

// Straight-quote and dash normalisation applied to every post before it is
// shown, so the user never pastes a character that breaks a composer.
export function normalizePunctuation(text) {
  return String(text || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}
