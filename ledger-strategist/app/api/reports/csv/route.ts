import { NextRequest, NextResponse } from "next/server";
import { loadBooks, resolveScope, parseDateParam, defaultRange } from "@/lib/reportData";
import { profitAndLoss, balanceSheet, cashFlow } from "@/lib/reports";

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const type = p.get("type") ?? "pl";
  const range = defaultRange();
  const from = parseDateParam(p.get("from") ?? undefined, range.from);
  const to = parseDateParam(p.get("to") ?? undefined, range.to);
  const scope = await resolveScope(p.get("entity") ?? undefined);
  const { txns, accounts } = await loadBooks(scope.entityIds);

  const rows: (string | number)[][] = [];
  if (type === "pl") {
    const r = profitAndLoss(txns, accounts, from, to);
    rows.push(["Profit & Loss", scope.name], ["Period", `${from.toDateString()} - ${to.toDateString()}`], []);
    rows.push(["Section", "Line", "Amount"]);
    r.incomeLines.forEach((l) => rows.push(["Income", l.name, l.amount]));
    if (r.uncategorizedIncome) rows.push(["Income", "Uncategorized income", r.uncategorizedIncome]);
    rows.push(["Total", "Total income", r.totalIncome]);
    r.cogsLines.forEach((l) => rows.push(["COGS", l.name, l.amount]));
    r.expenseLines.forEach((l) => rows.push(["Expenses", l.name, l.amount]));
    if (r.uncategorizedExpense) rows.push(["Expenses", "Uncategorized expenses", r.uncategorizedExpense]);
    rows.push(["Total", "Total expenses", r.totalExpense], ["Total", "Net income", r.netIncome]);
  } else if (type === "bs") {
    const r = balanceSheet(txns, accounts, to);
    rows.push(["Balance Sheet", scope.name], ["As of", to.toDateString()], []);
    rows.push(["Section", "Line", "Amount"]);
    [...r.cashLines, ...r.assetLines].forEach((l) => rows.push(["Assets", l.name, l.amount]));
    rows.push(["Total", "Total assets", r.totalAssets]);
    r.liabilityLines.forEach((l) => rows.push(["Liabilities", l.name, l.amount]));
    rows.push(["Total", "Total liabilities", r.totalLiabilities]);
    r.equityLines.forEach((l) => rows.push(["Equity", l.name, l.amount]));
    rows.push(["Equity", "Retained earnings", r.retainedEarnings], ["Total", "Total equity", r.totalEquity]);
  } else {
    const r = cashFlow(txns, accounts, from, to);
    rows.push(["Cash Flow", scope.name], ["Period", `${from.toDateString()} - ${to.toDateString()}`], []);
    rows.push(["Section", "Line", "Amount"]);
    rows.push(["Opening", "Opening cash", r.openingCash]);
    r.inLines.forEach((l) => rows.push(["Cash in", l.name, l.amount]));
    rows.push(["Total", "Total cash in", r.cashIn]);
    r.outLines.forEach((l) => rows.push(["Cash out", l.name, l.amount]));
    rows.push(["Total", "Total cash out", r.cashOut], ["Total", "Net change", r.netChange], ["Closing", "Closing cash", r.closingCash]);
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${scope.slug}.csv"`,
    },
  });
}
