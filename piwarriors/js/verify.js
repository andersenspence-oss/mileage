// Independent checking of outside facts.
//
// The sourcing gate proves a claim came from the week's research. It cannot
// prove the research was right. This does that second job: each claim is looked
// up again, on its own, and has to be confirmed against a source before the post
// carrying it is allowed out.
//
// The check is deliberately adversarial. A claim that is real but described
// wrongly is the dangerous case, because it reads as authoritative and survives
// a casual read. The CMS rule that started this was exactly that shape: the rule
// exists, and what the post said about it was not in it.

import { callClaude, parseJson, WEB_SEARCH_TOOL } from "./api.js";

const SYSTEM = `You check factual claims before they are published under a real doctor's name to an audience of healthcare providers and plaintiff attorneys who will look things up.

Your job is to find out what the primary source actually says and compare it, word by word, against the claim as written. You are not helping the claim survive. Assume it is wrong until a source shows otherwise.

Search for the primary source: the regulation text, the statute, the agency's own fact sheet, the court's docket, the original reporting. Secondary summaries of a rule are frequently wrong about its scope, and a blog restating a rule is not the rule.

Return one of four verdicts:
- "supported": the source says what the claim says, including its scope and its certainty.
- "overstated": the underlying thing is real, but the claim says more than the source does. A rule that requires one thing described as requiring something broader is overstated. So is a single instance described as a trend, an allegation described as a finding, or a proposed rule described as being in force. This is the most common and most damaging failure, so look for it hardest.
- "unsupported": you could not find a source that establishes the claim.
- "contradicted": a source says something different from the claim.

Anything other than "supported" stops the claim from being published, so do not stretch to reach it. If the claim is only roughly right, it is not supported.

Fill every field:
- "whatTheSourceSays": what the source actually establishes, in plain words.
- "correction": if the verdict is not "supported", the accurate version of the claim. Empty string if it is supported.
- "sourceUrl" and "sourceName": the primary source you relied on. If you found none, say so in sourceName and leave the URL empty.
- "scope": which line of insurance or which entities this actually governs. Health plans, Medicare Advantage, Medicaid, auto and PIP, workers compensation, or all lines. This matters because content aimed at personal injury providers regularly cites health insurance rules that do not bind an auto carrier at all.`;

// The verdict is asked for as JSON in the text, because the web search tool
// returns citations and the structured-output format rejects those.
export const VERDICT_INSTRUCTION = `\n\nReturn only a JSON object, nothing else, with exactly these keys: verdict, whatTheSourceSays, correction, sourceUrl, sourceName, scope. "verdict" is one of "supported", "overstated", "unsupported", "contradicted".`;

/**
 * Checks one claim against primary sources.
 * @returns {object} the verdict object
 */
export async function verifyClaim({ apiKey, model, claim, context, signal, onNote }) {
  const prompt = `Check this claim.

The claim, exactly as the post states it:
"${claim.statement}"

${claim.support ? `What the writer says it rests on:\n"${claim.support}"\n` : ""}${context ? `The sentence around it in the post:\n"${context}"\n` : ""}
Find the primary source. Compare the claim against what that source actually says, including its scope and how certain it is. Then return your verdict.${VERDICT_INSTRUCTION}`;

  if (onNote) onNote(`Checking: ${claim.statement.slice(0, 48)}`);

  const res = await callClaude({
    apiKey,
    model,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 8000,
    effort: "high",
    signal,
  });

  // Search results carry citations, which the JSON output format rejects, so the
  // verdict is asked for as JSON in the text rather than through the schema.
  return parseJson(res.text, "verdict");
}

/**
 * Checks every outside fact a post asserts. Verdicts are attached to the claims
 * in place so the UI can show what was checked and what the source said.
 */
export async function verifyPost({ apiKey, model, post, signal, onNote }) {
  const claims = (post.claims || []).filter((c) => c.basis === "briefing");
  if (!claims.length) return [];

  const checked = [];
  for (const claim of claims) {
    try {
      const verification = await verifyClaim({
        apiKey,
        model,
        claim,
        context: sentenceAround(post.body, claim.statement),
        signal,
        onNote,
      });
      checked.push({ ...claim, verification });
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      // A check that could not run is treated as a failed check, never as a pass.
      checked.push({
        ...claim,
        verification: {
          verdict: "unsupported",
          whatTheSourceSays: "",
          correction: "",
          sourceUrl: "",
          sourceName: `The check could not be completed: ${err.message || err}`,
          scope: "",
        },
      });
    }
  }
  return checked;
}

// The sentence the claim sits in, so the checker sees how it is characterised
// rather than just the bare assertion.
function sentenceAround(body, statement) {
  const text = String(body || "");
  const words = String(statement || "").split(/\s+/).filter((w) => w.length > 4);
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (words.some((w) => lower.includes(w.toLowerCase()))) return sentence.trim();
  }
  return "";
}
