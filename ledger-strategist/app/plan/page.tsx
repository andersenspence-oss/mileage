import { prisma } from "@/lib/db";
import { usd } from "@/lib/format";
import type { TraceStep } from "@/lib/strategies/analyzer";

export const dynamic = "force-dynamic";

function TraceTable({ trace }: { trace: TraceStep[] }) {
  return (
    <table className="data" style={{ marginTop: 8 }}>
      <thead><tr><th>Step</th><th className="num">Value</th></tr></thead>
      <tbody>
        {trace.map((s, i) => (
          <tr key={i}>
            <td className="small">
              {s.label}
              {s.note && <div className={`xsmall ${/VERIFY|CRITICAL/i.test(s.note) ? "warn" : "mut"}`}>{s.note}</div>}
            </td>
            <td className="num small">
              {s.value === undefined ? "" : s.value < 1 && s.value > 0 ? `${(s.value * 100).toFixed(2)}%` : usd(s.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [results, strategies, toggles, lastRun] = await Promise.all([
    prisma.strategyResult.findMany({ orderBy: [{ relevant: "desc" }, { estimatedSavings: "desc" }] }),
    prisma.strategy.findMany(),
    prisma.scenarioToggle.findMany(),
    prisma.setting.findUnique({ where: { key: "lastAnalysisRun" } }),
  ]);
  const stratById = new Map(strategies.map((s) => [s.id, s]));
  const included = new Map(toggles.map((t) => [t.strategyId, t.included]));

  const relevant = results.filter((r) => r.relevant);
  const notRelevant = results.filter((r) => !r.relevant);
  const scenarioTotal = relevant
    .filter((r) => included.get(r.strategyId) !== false)
    .reduce((s, r) => s + r.estimatedSavings, 0);
  const fullTotal = relevant.reduce((s, r) => s + r.estimatedSavings, 0);
  const runInfo = lastRun ? (JSON.parse(lastRun.value) as { at: string }) : null;

  return (
    <div>
      <h1>Action Plan</h1>
      <p className="subtitle">
        Your top tax opportunities this year, ranked by estimated dollar impact, with the math and
        the exact questions to take to your CPA.
      </p>

      {params.analyzed && <div className="callout">Analysis complete — ranked from your current books and intake.</div>}

      <form className="toolbar" action="/api/analyze" method="post">
        <button className="btn" type="submit">{results.length ? "Re-run analysis" : "Run the analysis"}</button>
        {runInfo && <span className="small mut">Last run {new Date(runInfo.at).toLocaleString()}</span>}
        {results.length > 0 && <a className="btn secondary" href="/plan/briefing">Open CPA briefing (print/PDF)</a>}
      </form>

      {results.length === 0 ? (
        <div className="card">
          No analysis yet. Make sure the <a href="/intake">intake</a> reflects your situation, then
          click <b>Run the analysis</b>.
        </div>
      ) : (
        <>
          <div className="statgrid">
            <div className="stat">
              <div className="label">Estimated annual opportunity (all relevant)</div>
              <div className="value pos">{usd(fullTotal)}</div>
            </div>
            <div className="stat">
              <div className="label">Your what-if scenario (checked items only)</div>
              <div className="value">{usd(scenarioTotal)}</div>
            </div>
            <div className="stat">
              <div className="label">Opportunities found</div>
              <div className="value">{relevant.length}</div>
            </div>
          </div>
          <p className="xsmall mut">
            Totals are rough annual estimates before CPA verification; some are one-time timing
            benefits or deferrals rather than permanent savings — each item says which.
          </p>

          {relevant.map((r, idx) => {
            const s = stratById.get(r.strategyId);
            const isIncluded = included.get(r.strategyId) !== false;
            const trace = JSON.parse(r.mathTraceJson) as TraceStep[];
            const checklist = JSON.parse(r.cpaChecklistJson) as string[];
            return (
              <div className="card" key={r.id} style={{ opacity: isIncluded ? 1 : 0.55 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <b>#{idx + 1} — {s?.name ?? r.strategyId}</b>{" "}
                    <span className={`badge ${s?.complexity === "advanced" ? "red" : s?.complexity === "high" ? "amber" : "green"}`}>{s?.complexity}</span>{" "}
                    <span className="badge">effort {s?.effort}/5</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="value pos" style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                      {r.estimatedSavings > 0 ? `~${usd(r.estimatedSavings)}/yr` : "no $ estimate"}
                    </div>
                    <form className="inline noprint" action="/api/scenario" method="post">
                      <input type="hidden" name="strategyId" value={r.strategyId} />
                      <input type="hidden" name="included" value={isIncluded ? "0" : "1"} />
                      <button className="btn small secondary" type="submit">
                        {isIncluded ? "Exclude from scenario" : "Include in scenario"}
                      </button>
                    </form>
                  </div>
                </div>
                <p className="small" style={{ margin: "8px 0" }}>{r.summary}</p>
                <details className="expand">
                  <summary>Show the math</summary>
                  <div className="inner">
                    <TraceTable trace={trace} />
                    <div className="xsmall mut" style={{ marginTop: 6 }}>
                      Rests on: {s?.provision}
                    </div>
                  </div>
                </details>
                {checklist.length > 0 && (
                  <details className="expand">
                    <summary>What to ask your CPA ({checklist.length})</summary>
                    <div className="inner">
                      <ul className="small">{checklist.map((c, i) => (<li key={i}>{c}</li>))}</ul>
                    </div>
                  </details>
                )}
                <div className="xsmall mut" style={{ marginTop: 8, fontStyle: "italic" }}>
                  Estimate only. Verify eligibility and current law with your CPA before acting.
                </div>
              </div>
            );
          })}

          {notRelevant.length > 0 && (
            <>
              <h2>Not relevant right now (and why)</h2>
              {notRelevant.map((r) => {
                const s = stratById.get(r.strategyId);
                return (
                  <div className="card" key={r.id} style={{ opacity: 0.75 }}>
                    <b>{s?.name ?? r.strategyId}</b>
                    <p className="small mut" style={{ margin: "6px 0 0" }}>{r.summary}</p>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      <p className="disclaimer">
        Estimate only. This app never files taxes and never gives final tax advice. Every figure
        above is an estimate built from your books and your intake answers, using assumptions that
        must be verified for the current tax year. Your CPA signs the return.
      </p>
    </div>
  );
}
