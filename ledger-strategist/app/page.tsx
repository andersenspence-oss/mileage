import Link from "next/link";
import { prisma } from "@/lib/db";
import { usd, monthKey, monthLabel } from "@/lib/format";
import {
  profitAndLoss, balanceSheet, monthlySeries, spendingCallouts,
  type Callout, type TxnLite, type AccountLite,
} from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  const [txnsAll, accountsAll, reviewCount, flagCount] = await Promise.all([
    prisma.transaction.findMany({ select: { entityId: true, date: true, amount: true, flow: true, accountId: true } }),
    prisma.account.findMany({ select: { id: true, entityId: true, name: true, type: true, openingBalance: true } }),
    prisma.transaction.count({ where: { categoryStatus: { in: ["uncategorized", "suggested"] } } }),
    prisma.anomalyFlag.count({ where: { status: "open" } }),
  ]);

  const now = new Date();
  const currKey = monthKey(now);
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = monthKey(prevDate);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(prevDate.getFullYear(), prevDate.getMonth(), 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const byEntityTxns = new Map<string, TxnLite[]>();
  const byEntityAccounts = new Map<string, AccountLite[]>();
  for (const e of entities) { byEntityTxns.set(e.id, []); byEntityAccounts.set(e.id, []); }
  for (const t of txnsAll) byEntityTxns.get(t.entityId)?.push(t);
  for (const a of accountsAll) byEntityAccounts.get(a.entityId)?.push(a);

  const rows = entities.map((e) => {
    const txns = byEntityTxns.get(e.id)!;
    const accounts = byEntityAccounts.get(e.id)!;
    const mtd = profitAndLoss(txns, accounts, monthStart, now);
    const prev = profitAndLoss(txns, accounts, prevStart, prevEnd);
    const bs = balanceSheet(txns, accounts, now);
    const cash = bs.cashLines.reduce((s, l) => s + l.amount, 0);
    return { entity: e, mtd, prev, cash };
  });

  const combined = {
    income: rows.reduce((s, r) => s + r.mtd.totalIncome, 0),
    expense: rows.reduce((s, r) => s + r.mtd.totalExpense + r.mtd.totalCogs, 0),
    net: rows.reduce((s, r) => s + r.mtd.netIncome, 0),
    cash: rows.reduce((s, r) => s + r.cash, 0),
    prevNet: rows.reduce((s, r) => s + r.prev.netIncome, 0),
  };

  // last 6 full-ish months, combined trend
  const trendKeys: string[] = [];
  for (let i = 5; i >= 0; i--) trendKeys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const trend = monthlySeries(txnsAll, trendKeys);
  const maxNet = Math.max(...trend.map((p) => Math.abs(p.net)), 1);

  // plain-language callouts across entities (compare last full month vs the one before)
  const lastFullKey = prevKey;
  const beforeKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 2, 1));
  let callouts: Callout[] = [];
  for (const r of rows) {
    callouts = callouts.concat(
      spendingCallouts(r.entity.name, byEntityTxns.get(r.entity.id)!, byEntityAccounts.get(r.entity.id)!, lastFullKey, beforeKey)
    );
  }
  callouts = callouts.slice(0, 5);

  const momDelta = combined.prevNet !== 0 ? (combined.net - combined.prevNet) / Math.abs(combined.prevNet) : 0;

  return (
    <div>
      <h1>Portfolio Dashboard</h1>
      <p className="subtitle">All eight entities at a glance — {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })} month-to-date.</p>

      <div className="statgrid">
        <div className="stat"><div className="label">Group revenue (MTD)</div><div className="value">{usd(combined.income)}</div></div>
        <div className="stat"><div className="label">Group expenses (MTD)</div><div className="value">{usd(combined.expense)}</div></div>
        <div className="stat">
          <div className="label">Group net (MTD)</div>
          <div className={`value ${combined.net >= 0 ? "pos" : "neg"}`}>{usd(combined.net)}</div>
          <div className={`delta ${momDelta >= 0 ? "pos" : "neg"}`}>
            {momDelta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(momDelta * 100))}% vs {monthLabel(prevKey)} (full month)
          </div>
        </div>
        <div className="stat"><div className="label">Cash on hand (group)</div><div className="value">{usd(combined.cash)}</div></div>
      </div>

      {(reviewCount > 0 || flagCount > 0) && (
        <div className="callout warn">
          Needs your attention:{" "}
          {reviewCount > 0 && <Link href="/review"><b>{reviewCount} transactions to review</b></Link>}
          {reviewCount > 0 && flagCount > 0 && " · "}
          {flagCount > 0 && <Link href="/flags"><b>{flagCount} open anomaly flags</b></Link>}
        </div>
      )}

      {callouts.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>What changed</h3>
          {callouts.map((c, i) => (
            <div key={i} className={`callout ${c.severity === "warn" ? "warn" : ""}`}>{c.text}</div>
          ))}
        </div>
      )}

      <h2>Per-entity (month to date)</h2>
      <table className="data">
        <thead>
          <tr>
            <th>Entity</th><th className="num">Revenue</th><th className="num">Expenses</th>
            <th className="num">Net</th><th className="num">vs last month</th><th className="num">Cash on hand</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entity, mtd, prev, cash }) => {
            const delta = prev.netIncome !== 0 ? (mtd.netIncome - prev.netIncome) / Math.abs(prev.netIncome) : 0;
            return (
              <tr key={entity.id}>
                <td><b>{entity.name}</b></td>
                <td className="num">{usd(mtd.totalIncome)}</td>
                <td className="num">{usd(mtd.totalExpense + mtd.totalCogs)}</td>
                <td className={`num ${mtd.netIncome >= 0 ? "pos" : "neg"}`}>{usd(mtd.netIncome)}</td>
                <td className={`num ${delta >= 0 ? "pos" : "neg"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(Math.round(delta * 100))}%</td>
                <td className="num">{usd(cash)}</td>
                <td><Link className="small" href={`/reports?entity=${entity.slug}`}>reports →</Link></td>
              </tr>
            );
          })}
          <tr className="total">
            <td>Combined</td>
            <td className="num">{usd(combined.income)}</td>
            <td className="num">{usd(combined.expense)}</td>
            <td className={`num ${combined.net >= 0 ? "pos" : "neg"}`}>{usd(combined.net)}</td>
            <td></td>
            <td className="num">{usd(combined.cash)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <h2>Group net income — last 6 months</h2>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {trend.map((p) => (
              <tr key={p.month}>
                <td style={{ width: 90 }} className="small mut">{monthLabel(p.month)}</td>
                <td>
                  <div className="progressbar" style={{ maxWidth: 520 }}>
                    <div style={{ width: `${Math.max(3, Math.round((Math.abs(p.net) / maxNet) * 100))}%`, background: p.net >= 0 ? "var(--brand)" : "var(--bad)" }} />
                  </div>
                </td>
                <td style={{ width: 110 }} className={`num small ${p.net >= 0 ? "pos" : "neg"}`}>{usd(p.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="xsmall mut" style={{ marginTop: 6 }}>Bars show combined net income per month (income minus expenses, cash basis).</div>
      </div>

      <p className="disclaimer">
        Estimate only. This app never files taxes and never gives final tax advice. Verify
        eligibility and current law with your CPA before acting.
      </p>
    </div>
  );
}
