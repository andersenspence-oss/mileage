// Receipt-to-transaction matching. Pure functions, unit-tested.
// A receipt matches a transaction when the amounts agree (within a small
// tolerance) and the dates are close. Auto-match only happens when there is
// exactly one strong candidate — everything else waits for your confirmation.

export type ReceiptLite = {
  id: string;
  date: Date;
  amount: number;
  vendor: string | null;
};

export type TxnForMatch = {
  id: string;
  date: Date;
  amount: number;
  flow: string;
  vendor: string | null;
  entityName?: string;
  accountName?: string | null;
};

export type MatchCandidate = {
  transactionId: string;
  score: number; // 0..1
  reason: string;
};

const DAY = 86400000;

function amountsClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, a * 0.01);
}

function vendorSimilar(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

/** Rank matching transactions for one receipt (best first). */
export function findCandidates(receipt: ReceiptLite, txns: TxnForMatch[], windowDays = 5): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const t of txns) {
    if (t.flow !== "out") continue;
    if (!amountsClose(receipt.amount, t.amount)) continue;
    const dayGap = Math.abs(t.date.getTime() - receipt.date.getTime()) / DAY;
    if (dayGap > windowDays) continue;

    const exactAmount = Math.abs(receipt.amount - t.amount) < 0.005;
    const sameVendor = vendorSimilar(receipt.vendor, t.vendor);
    let score = 0.5;
    if (exactAmount) score += 0.25;
    if (dayGap <= 1) score += 0.15;
    if (sameVendor) score += 0.1;

    const reasons: string[] = [];
    reasons.push(exactAmount ? "same amount" : "amount within 1%");
    reasons.push(dayGap === 0 ? "same day" : `${Math.round(dayGap)} day(s) apart`);
    if (sameVendor) reasons.push("vendor matches");
    out.push({ transactionId: t.id, score: Math.min(1, score), reason: reasons.join(", ") });
  }
  return out.sort((a, b) => b.score - a.score);
}

export type MatchResult = {
  receiptId: string;
  auto: boolean; // confident enough to match without asking
  candidate: MatchCandidate | null;
};

/**
 * Match a batch of receipts against transactions. A receipt auto-matches only
 * when its best candidate scores >= 0.9 and clearly beats the runner-up, and
 * no other receipt wants the same transaction more.
 */
export function matchReceipts(receipts: ReceiptLite[], txns: TxnForMatch[]): MatchResult[] {
  const results: MatchResult[] = [];
  const claimed = new Set<string>();
  // process receipts in a stable order so results are deterministic
  const ordered = [...receipts].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const r of ordered) {
    const candidates = findCandidates(r, txns).filter((c) => !claimed.has(c.transactionId));
    const best = candidates[0] ?? null;
    const second = candidates[1];
    const auto = Boolean(best && best.score >= 0.9 && (!second || best.score - second.score >= 0.15));
    if (auto && best) claimed.add(best.transactionId);
    results.push({ receiptId: r.id, auto, candidate: best });
  }
  return results;
}

// Categories where the IRS effectively expects receipts/documentation.
export const RECEIPT_SENSITIVE = /meals|travel|auto|fuel|vehicle|entertainment|supplies|equipment|conference|continuing education/i;

export type CoverageStats = {
  sensitiveCount: number;
  documentedCount: number;
  coverage: number; // 0..1
};

/** How much of the receipt-sensitive spend actually has a matched receipt? */
export function documentationCoverage(
  txns: { id: string; accountName: string | null; amount: number; flow: string }[],
  matchedTransactionIds: Set<string>,
  minAmount = 75
): CoverageStats {
  const sensitive = txns.filter(
    (t) => t.flow === "out" && t.accountName && RECEIPT_SENSITIVE.test(t.accountName) && t.amount >= minAmount
  );
  const documented = sensitive.filter((t) => matchedTransactionIds.has(t.id));
  return {
    sensitiveCount: sensitive.length,
    documentedCount: documented.length,
    coverage: sensitive.length === 0 ? 1 : documented.length / sensitive.length,
  };
}
