// Anomaly detection. Pure functions over the books; results become
// AnomalyFlag rows the owner can resolve or dismiss.

export type TxnForAnomaly = {
  id: string;
  entityId: string;
  accountId: string | null;
  accountName?: string | null;
  date: Date;
  amount: number;
  flow: string;
  vendor: string | null;
};

export type DetectedFlag = { transactionId: string; kind: string; detail: string };

const PERSONAL_HINTS = [
  "costco", "golf", "grocery", "groceries", "smith's", "walmart", "target",
  "sephora", "ulta", "disney", "netflix", "spotify personal", "liquor",
  "amazon marketplace", "nordstrom", "steam games",
];

/** Same vendor, same amount, within `windowDays` — likely a double charge. */
export function detectDuplicates(txns: TxnForAnomaly[], windowDays = 3): DetectedFlag[] {
  const flags: DetectedFlag[] = [];
  const seen = new Set<string>();
  const sorted = [...txns].filter((t) => t.flow === "out" && t.vendor).sort((a, b) => a.date.getTime() - b.date.getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      const dayGap = (b.date.getTime() - a.date.getTime()) / 86400000;
      if (dayGap > windowDays) break;
      if (a.entityId === b.entityId && a.vendor === b.vendor && Math.abs(a.amount - b.amount) < 0.01 && a.amount > 50) {
        if (!seen.has(b.id)) {
          seen.add(b.id);
          flags.push({
            transactionId: b.id,
            kind: "duplicate",
            detail: `Possible duplicate: same vendor (${b.vendor}) and amount ($${b.amount.toFixed(2)}) as a charge ${Math.round(dayGap) || "0"} day(s) earlier.`,
          });
        }
      }
    }
  }
  return flags;
}

/** Charge far above this vendor+account's normal range (mean + 3σ, min 2.5x). */
export function detectUnusualAmounts(txns: TxnForAnomaly[]): DetectedFlag[] {
  const flags: DetectedFlag[] = [];
  const groups = new Map<string, TxnForAnomaly[]>();
  for (const t of txns) {
    if (t.flow !== "out" || !t.accountId) continue;
    const key = `${t.entityId}|${t.accountId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  for (const group of groups.values()) {
    if (group.length < 8) continue;
    const amounts = group.map((t) => t.amount);
    const mean = amounts.reduce((s, n) => s + n, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((s, n) => s + (n - mean) ** 2, 0) / amounts.length);
    const threshold = Math.max(mean + 3 * sd, mean * 2.5);
    for (const t of group) {
      if (t.amount > threshold && t.amount > 250) {
        flags.push({
          transactionId: t.id,
          kind: "unusual_amount",
          detail: `$${t.amount.toFixed(2)} to ${t.vendor ?? "unknown"} is far above the typical ${t.accountName ?? "category"} charge (average $${mean.toFixed(0)}).`,
        });
      }
    }
  }
  return flags;
}

/** Vendors that commonly indicate personal spending in business books. */
export function detectPossiblePersonal(txns: TxnForAnomaly[]): DetectedFlag[] {
  const flags: DetectedFlag[] = [];
  for (const t of txns) {
    if (t.flow !== "out" || !t.vendor) continue;
    const v = t.vendor.toLowerCase();
    if (PERSONAL_HINTS.some((h) => v.includes(h))) {
      flags.push({
        transactionId: t.id,
        kind: "possible_personal",
        detail: `"${t.vendor}" often indicates personal spending. If it was personal, it should be an owner draw, not a business expense; if business, keep a note of the purpose.`,
      });
    }
  }
  return flags;
}

/** A vendor that had a steady monthly cadence but changed sharply (new charge >2x its usual). */
export function detectPatternBreaks(txns: TxnForAnomaly[]): DetectedFlag[] {
  const flags: DetectedFlag[] = [];
  const byVendor = new Map<string, TxnForAnomaly[]>();
  for (const t of txns) {
    if (t.flow !== "out" || !t.vendor) continue;
    const key = `${t.entityId}|${t.vendor.toLowerCase()}`;
    (byVendor.get(key) ?? byVendor.set(key, []).get(key)!).push(t);
  }
  for (const group of byVendor.values()) {
    if (group.length < 6) continue;
    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime());
    const prior = sorted.slice(0, -1);
    const last = sorted[sorted.length - 1];
    const priorAvg = prior.reduce((s, t) => s + t.amount, 0) / prior.length;
    if (priorAvg > 40 && last.amount > priorAvg * 2 && last.amount > 200) {
      flags.push({
        transactionId: last.id,
        kind: "pattern_break",
        detail: `${last.vendor} normally runs ~$${priorAvg.toFixed(0)}; the latest charge is $${last.amount.toFixed(2)} (${(last.amount / priorAvg).toFixed(1)}x normal).`,
      });
    }
  }
  return flags;
}

export function detectAll(txns: TxnForAnomaly[]): DetectedFlag[] {
  const all = [
    ...detectDuplicates(txns),
    ...detectUnusualAmounts(txns),
    ...detectPossiblePersonal(txns),
    ...detectPatternBreaks(txns),
  ];
  // one flag per (txn, kind)
  const seen = new Set<string>();
  return all.filter((f) => {
    const k = `${f.transactionId}|${f.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
