import { prisma } from "@/lib/db";
import { calcTrip, summarizePerDiem } from "@/lib/perdiem";
import { ASSUMPTIONS } from "@/lib/assumptions";
import { usd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TravelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [trips, entities] = await Promise.all([
    prisma.perDiemTrip.findMany({ orderBy: { startDate: "desc" } }),
    prisma.entity.findMany({ orderBy: { sort: "asc" } }),
  ]);
  const rates = {
    standard: ASSUMPTIONS.perdiem_mie_standard.value,
    highCost: ASSUMPTIONS.perdiem_mie_high.value,
  };
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const summary = summarizePerDiem(trips, rates, from, now);
  const entityName = new Map(entities.map((e) => [e.slug, e.name]));

  return (
    <div>
      <h1>Travel &amp; Per Diem</h1>
      <p className="subtitle">
        Log overnight business trips and the app computes the meals &amp; incidentals (M&amp;IE) per-diem
        deduction — no meal receipts needed for those days, just proof of the trip itself.
      </p>

      {params.added && <div className="callout">Trip added. Re-run the analysis on the <a href="/plan">Action Plan</a> to include it.</div>}
      {params.error === "overnight" && <div className="callout bad">The return date must be after the start date — per diem only applies to overnight travel.</div>}
      {params.error === "missing" && <div className="callout bad">Give the trip a description and both dates.</div>}

      <div className="statgrid">
        <div className="stat"><div className="label">Overnight trips (last 12 mo)</div><div className="value">{summary.tripCount}</div></div>
        <div className="stat"><div className="label">Nights away</div><div className="value">{summary.nights}</div></div>
        <div className="stat"><div className="label">M&amp;IE per diem</div><div className="value">{usd(summary.totalMie)}</div></div>
        <div className="stat"><div className="label">Deductible (after 50% meals limit)</div><div className="value pos">{usd(summary.totalDeductible)}</div></div>
      </div>
      <p className="xsmall mut">
        Rates used: {usd(rates.standard)}/day standard, {usd(rates.highCost)}/day high-cost localities
        (IRS high-low method — updated every October, VERIFY with your CPA). Lodging is not included:
        self-employed owners may only use per diem for meals &amp; incidentals; keep hotel receipts.
      </p>

      <h2>Add a trip</h2>
      <div className="card">
        <form action="/api/perdiem" method="post" className="toolbar" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="action" value="add" />
          <label className="field" style={{ margin: 0 }}><span className="fieldname">What was the trip for?</span>
            <input type="text" name="description" placeholder="e.g. Parker Seminars conference" required style={{ minWidth: 220 }} />
          </label>
          <label className="field" style={{ margin: 0 }}><span className="fieldname">Destination</span>
            <input type="text" name="destination" placeholder="Las Vegas, NV" style={{ width: 150 }} />
          </label>
          <label className="field" style={{ margin: 0 }}><span className="fieldname">Left</span>
            <input type="date" name="startDate" required />
          </label>
          <label className="field" style={{ margin: 0 }}><span className="fieldname">Returned</span>
            <input type="date" name="endDate" required />
          </label>
          <label className="field" style={{ margin: 0 }}><span className="fieldname">Travelers (on business)</span>
            <input type="number" name="travelers" min={1} max={10} defaultValue={1} style={{ width: 70 }} />
          </label>
          <label className="field" style={{ margin: 0 }}><span className="fieldname">Entity</span>
            <select name="entitySlug" defaultValue="">
              <option value="">— pick one —</option>
              {entities.map((e) => (<option key={e.slug} value={e.slug}>{e.name}</option>))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="fieldname">High-cost city?</span>
            <input type="checkbox" name="highCost" title="NYC, SF, Boston, resort towns in season — check the IRS high-cost list" />
          </label>
          <button className="btn" type="submit">Add trip</button>
        </form>
        <p className="xsmall mut">
          High-cost = cities on the IRS high-cost locality list (e.g. New York, San Francisco, many
          resort areas in season). When in doubt leave it unchecked — your CPA can upgrade it.
        </p>
      </div>

      {trips.length > 0 && (
        <>
          <h2>Logged trips</h2>
          <table className="data">
            <thead><tr><th>Trip</th><th>Dates</th><th className="num">Nights</th><th className="num">Rate/day</th><th className="num">M&amp;IE</th><th className="num">Deductible (50%)</th><th></th></tr></thead>
            <tbody>
              {trips.map((t) => {
                const c = calcTrip(t, rates);
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.description}</b>
                      <div className="xsmall mut">
                        {t.destination}{t.highCost ? " · high-cost" : ""}{t.travelers > 1 ? ` · ${t.travelers} travelers` : ""}
                        {t.entitySlug ? ` · ${entityName.get(t.entitySlug) ?? t.entitySlug}` : ""}
                      </div>
                    </td>
                    <td className="small">{fmtDate(t.startDate)} → {fmtDate(t.endDate)}</td>
                    <td className="num">{c.nights}</td>
                    <td className="num">{usd(c.dailyRate)}</td>
                    <td className="num">{usd(c.mie, { cents: true })}</td>
                    <td className="num pos">{usd(c.deductible, { cents: true })}</td>
                    <td>
                      <form className="inline" action="/api/perdiem" method="post">
                        <input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value={t.id} />
                        <button className="btn small danger" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <p className="disclaimer">
        Estimate only. Per-diem rates and locality lists change every year — verify with your CPA.
        Keep proof of each trip&apos;s business purpose (agenda, registration, calendar) and lodging
        receipts; the per diem covers meals &amp; incidentals only.
      </p>
    </div>
  );
}
