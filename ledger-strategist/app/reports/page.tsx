import { prisma } from "@/lib/db";
import { loadBooks, resolveScope, parseDateParam, defaultRange } from "@/lib/reportData";
import { profitAndLoss, balanceSheet, cashFlow, type ReportLine } from "@/lib/reports";
import { usd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function Lines({ lines }: { lines: ReportLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <tr key={l.name}>
          <td style={{ paddingLeft: 28 }}>{l.name}</td>
          <td className="num">{usd(l.amount, { cents: true })}</td>
        </tr>
      ))}
    </>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const type = params.type ?? "pl";
  const range = defaultRange();
  const from = parseDateParam(params.from, range.from);
  const to = parseDateParam(params.to, range.to);
  const scope = await resolveScope(params.entity);
  const entities = await prisma.entity.findMany({ orderBy: { sort: "asc" } });
  const { txns, accounts } = await loadBooks(scope.entityIds);

  const fmtInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const csvHref = `/api/reports/csv?type=${type}&entity=${scope.slug}&from=${fmtInput(from)}&to=${fmtInput(to)}`;

  const pl = type === "pl" ? profitAndLoss(txns, accounts, from, to) : null;
  const bs = type === "bs" ? balanceSheet(txns, accounts, to) : null;
  const cf = type === "cf" ? cashFlow(txns, accounts, from, to) : null;

  const title = type === "pl" ? "Profit & Loss" : type === "bs" ? "Balance Sheet" : "Cash Flow";

  return (
    <div>
      <h1>{title}</h1>
      <p className="subtitle">
        {scope.name} · {type === "bs" ? `as of ${fmtDate(to)}` : `${fmtDate(from)} – ${fmtDate(to)}`}
      </p>

      <form className="toolbar noprint" method="get">
        <select name="type" defaultValue={type}>
          <option value="pl">Profit &amp; Loss</option>
          <option value="bs">Balance Sheet</option>
          <option value="cf">Cash Flow</option>
        </select>
        <select name="entity" defaultValue={scope.slug}>
          <option value="all">Combined — all entities</option>
          {entities.map((e) => (
            <option key={e.slug} value={e.slug}>{e.name}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={fmtInput(from)} />
        <input type="date" name="to" defaultValue={fmtInput(to)} />
        <button className="btn small" type="submit">Run report</button>
        <a className="btn small secondary" href={csvHref}>Download CSV</a>
        <span className="xsmall mut">To save as PDF: press Ctrl/Cmd+P and choose &quot;Save as PDF&quot;.</span>
      </form>

      {pl && (
        <table className="data">
          <thead><tr><th>Profit &amp; Loss</th><th className="num">Amount</th></tr></thead>
          <tbody>
            <tr><td><b>Income</b></td><td /></tr>
            <Lines lines={pl.incomeLines} />
            {pl.uncategorizedIncome > 0 && (
              <tr><td style={{ paddingLeft: 28 }} className="warn">Uncategorized income</td><td className="num warn">{usd(pl.uncategorizedIncome, { cents: true })}</td></tr>
            )}
            <tr className="total"><td>Total income</td><td className="num">{usd(pl.totalIncome, { cents: true })}</td></tr>
            {pl.cogsLines.length > 0 && (<>
              <tr><td><b>Cost of goods sold</b></td><td /></tr>
              <Lines lines={pl.cogsLines} />
              <tr className="total"><td>Gross profit</td><td className="num">{usd(pl.grossProfit, { cents: true })}</td></tr>
            </>)}
            <tr><td><b>Expenses</b></td><td /></tr>
            <Lines lines={pl.expenseLines} />
            {pl.uncategorizedExpense > 0 && (
              <tr><td style={{ paddingLeft: 28 }} className="warn">Uncategorized expenses</td><td className="num warn">{usd(pl.uncategorizedExpense, { cents: true })}</td></tr>
            )}
            <tr className="total"><td>Total expenses</td><td className="num">{usd(pl.totalExpense, { cents: true })}</td></tr>
            <tr className="total"><td>Net income</td><td className={`num ${pl.netIncome >= 0 ? "pos" : "neg"}`}>{usd(pl.netIncome, { cents: true })}</td></tr>
          </tbody>
        </table>
      )}

      {bs && (
        <table className="data">
          <thead><tr><th>Balance Sheet</th><th className="num">Amount</th></tr></thead>
          <tbody>
            <tr><td><b>Assets</b></td><td /></tr>
            <Lines lines={bs.cashLines} />
            <Lines lines={bs.assetLines} />
            <tr className="total"><td>Total assets</td><td className="num">{usd(bs.totalAssets, { cents: true })}</td></tr>
            <tr><td><b>Liabilities</b></td><td /></tr>
            <Lines lines={bs.liabilityLines} />
            <tr className="total"><td>Total liabilities</td><td className="num">{usd(bs.totalLiabilities, { cents: true })}</td></tr>
            <tr><td><b>Equity</b></td><td /></tr>
            <Lines lines={bs.equityLines} />
            <tr><td style={{ paddingLeft: 28 }}>Retained earnings (cumulative net income)</td><td className="num">{usd(bs.retainedEarnings, { cents: true })}</td></tr>
            <tr className="total"><td>Total equity</td><td className="num">{usd(bs.totalEquity, { cents: true })}</td></tr>
            <tr className="total">
              <td>Liabilities + equity {bs.balances ? "✓ balances" : "⚠ does not balance"}</td>
              <td className="num">{usd(bs.totalLiabilities + bs.totalEquity, { cents: true })}</td>
            </tr>
          </tbody>
        </table>
      )}

      {cf && (
        <table className="data">
          <thead><tr><th>Cash Flow (cash basis)</th><th className="num">Amount</th></tr></thead>
          <tbody>
            <tr><td>Opening cash ({fmtDate(cf.from)})</td><td className="num">{usd(cf.openingCash, { cents: true })}</td></tr>
            <tr><td><b>Cash in</b></td><td /></tr>
            <Lines lines={cf.inLines} />
            <tr className="total"><td>Total cash in</td><td className="num pos">{usd(cf.cashIn, { cents: true })}</td></tr>
            <tr><td><b>Cash out</b></td><td /></tr>
            <Lines lines={cf.outLines} />
            <tr className="total"><td>Total cash out</td><td className="num neg">{usd(cf.cashOut, { cents: true })}</td></tr>
            <tr className="total"><td>Net change in cash</td><td className={`num ${cf.netChange >= 0 ? "pos" : "neg"}`}>{usd(cf.netChange, { cents: true })}</td></tr>
            <tr className="total"><td>Closing cash ({fmtDate(cf.to)})</td><td className="num">{usd(cf.closingCash, { cents: true })}</td></tr>
          </tbody>
        </table>
      )}

      <p className="disclaimer">
        Reports are computed on a cash basis from the locally synced books. Estimate only — verify
        with your CPA before relying on these figures for filings.
      </p>
    </div>
  );
}
