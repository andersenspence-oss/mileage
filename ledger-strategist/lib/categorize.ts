// Categorization assistant.
// Order of preference for a suggestion:
//   1. A learned vendor rule (from your past approvals) — highest confidence
//   2. Vendor history in this entity's books (most common account)
//   3. Claude, given the entity context and chart of accounts
// Nothing is ever applied without your approval in the review queue.

import { claude, claudeAvailable, CLAUDE_MODEL } from "./claude";

export type TxnForSuggestion = {
  id: string;
  vendor: string | null;
  description: string | null;
  amount: number;
  date: Date;
  entityName: string;
  entityKind: string;
};

export type Suggestion = {
  transactionId: string;
  suggestedAccountName: string;
  confidence: number; // 0..1
  rationale: string;
  source: "rule" | "claude";
};

export type VendorRuleLite = { vendorPattern: string; accountName: string; hits: number };
export type VendorHistory = Map<string, { accountName: string; count: number }>;

export function ruleSuggest(
  txn: TxnForSuggestion,
  rules: VendorRuleLite[],
  history: VendorHistory
): Suggestion | null {
  const vendor = (txn.vendor ?? "").toLowerCase().trim();
  if (!vendor) return null;

  const rule = rules.find((r) => vendor.includes(r.vendorPattern.toLowerCase()));
  if (rule) {
    return {
      transactionId: txn.id,
      suggestedAccountName: rule.accountName,
      confidence: Math.min(0.98, 0.85 + rule.hits * 0.02),
      rationale: `You've categorized "${txn.vendor}" as ${rule.accountName} ${rule.hits} time${rule.hits === 1 ? "" : "s"} before.`,
      source: "rule",
    };
  }

  const h = history.get(vendor);
  if (h && h.count >= 2) {
    return {
      transactionId: txn.id,
      suggestedAccountName: h.accountName,
      confidence: Math.min(0.95, 0.6 + h.count * 0.05),
      rationale: `${h.count} past transactions from "${txn.vendor}" are categorized as ${h.accountName}.`,
      source: "rule",
    };
  }
  return null;
}

/**
 * Ask Claude to categorize a batch of transactions given the entity's chart of
 * accounts. Returns [] if no API key is configured (the app then relies on
 * rules alone).
 */
export async function claudeSuggest(
  txns: TxnForSuggestion[],
  accountNames: string[]
): Promise<Suggestion[]> {
  if (!claudeAvailable() || txns.length === 0) return [];

  const schema = {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transactionId: { type: "string" },
            accountName: { type: "string" },
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["transactionId", "accountName", "confidence", "rationale"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  } as const;

  const lines = txns
    .map(
      (t) =>
        `id=${t.id} | entity=${t.entityName} (${t.entityKind}) | date=${t.date.toISOString().slice(0, 10)} | vendor=${t.vendor ?? "?"} | desc=${t.description ?? ""} | amount=$${t.amount.toFixed(2)}`
    )
    .join("\n");

  const response = await claude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system:
      "You are a bookkeeping assistant for a group of small businesses (chiropractic clinics, a media brand, an events brand, and rental real-estate LLCs) in St. George, Utah. " +
      "Suggest the best expense/income category for each transaction. Choose ONLY from the provided account names. " +
      "confidence is 0..1 — be honest: use below 0.6 when genuinely unsure. rationale is one short sentence a business owner understands. " +
      "If a purchase looks personal rather than business (groceries, golf, cosmetics), pick the closest account anyway but say so in the rationale and cap confidence at 0.4.",
    messages: [
      {
        role: "user",
        content: `Available account names:\n${accountNames.join(", ")}\n\nTransactions to categorize:\n${lines}`,
      },
    ],
    // SDK typings lag the output_config parameter; the API accepts it.
    ...({ output_config: { format: { type: "json_schema", schema } } } as object),
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];
  try {
    const parsed = JSON.parse(text.text) as {
      suggestions: { transactionId: string; accountName: string; confidence: number; rationale: string }[];
    };
    const valid = new Set(accountNames);
    const ids = new Set(txns.map((t) => t.id));
    return parsed.suggestions
      .filter((s) => ids.has(s.transactionId) && valid.has(s.accountName))
      .map((s) => ({
        transactionId: s.transactionId,
        suggestedAccountName: s.accountName,
        confidence: Math.max(0, Math.min(1, s.confidence)),
        rationale: s.rationale,
        source: "claude" as const,
      }));
  } catch {
    return [];
  }
}
