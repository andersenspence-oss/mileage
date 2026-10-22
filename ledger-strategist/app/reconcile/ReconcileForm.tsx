"use client";
// The reconcile worksheet: check items off and watch the difference reach $0.00.
import { useMemo, useState } from "react";

type Item = { key: string; date: string; amount: number; cleared: boolean; label: string; checkNum: string | null; fromBank: boolean };

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

export default function ReconcileForm({
  reconId, items, beginning, ending, isCard,
}: { reconId: string; items: Item[]; beginning: number; ending: number; isCard: boolean }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(items.filter((i) => i.cleared).map((i) => i.key)));
  const [endText, setEndText] = useState(ending.toFixed(2));
  const end = Number(endText.replace(/[$,\s]/g, ""));

  const m = useMemo(() => {
    let inc = 0, dec = 0;
    for (const i of items) if (checked.has(i.key)) { if (i.amount > 0) inc += i.amount; else dec -= i.amount; }
    const cleared = r2(beginning + inc - dec);
    const diff = Number.isFinite(end) ? r2(end - cleared) : NaN;
    return { inc: r2(inc), dec: r2(dec), cleared, diff, balanced: Number.isFinite(diff) && Math.abs(diff) < 0.005 };
  }, [checked, items, beginning, end]);

  const toggle = (k: string) => setChecked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const setMany = (keys: string[], on: boolean) => setChecked((s) => { const n = new Set(s); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });

  // Balance goes UP: deposits (bank) or charges (card). Goes DOWN: payments (bank) or payments/refunds (card).
  const ups = items.filter((i) => i.amount > 0);
  const downs = items.filter((i) => i.amount < 0);
  const upLabel = isCard ? "Charges" : "Deposits and other credits";
  const downLabel = isCard ? "Payments and refunds" : "Checks and payments";

  const Table = ({ title, rows }: { title: string; rows: Item[] }) => (
    <div style={{ flex: 1, minWidth: 320 }}>
      <h3>{title} <span className="xsmall mut">({rows.filter((r) => checked.has(r.key)).length} of {rows.length} checked)</span></h3>
      <div className="toolbar" style={{ margin: "4px 0" }}>
        <button type="button" className="btn small secondary" onClick={() => setMany(rows.map((r) => r.key), true)}>Check all</button>
        <button type="button" className="btn small secondary" onClick={() => setMany(rows.map((r) => r.key), false)}>Uncheck all</button>
      </div>
      <table className="data">
        <tbody>
          {rows.map((i) => (
            <tr key={i.key} onClick={() => toggle(i.key)} style={{ cursor: "pointer", background: checked.has(i.key) ? "#e8f3ec" : undefined }}>
              <td style={{ width: 28 }}><input type="checkbox" name="cleared" value={i.key} checked={checked.has(i.key)} onChange={() => toggle(i.key)} onClick={(e) => e.stopPropagation()} /></td>
              <td className="small">{i.date}</td>
              <td className="small">{i.label}{i.checkNum ? <span className="mut"> #{i.checkNum}</span> : null}{!i.fromBank && <span className="badge amber" title="Entered by hand; hasn't shown up in a bank download yet">not from bank</span>}</td>
              <td className="num">{fmt(Math.abs(i.amount))}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="small mut">None</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <form action="/api/reconcile" method="post">
      <input type="hidden" name="reconId" value={reconId} />
      <input type="hidden" name="returnTo" value={`/reconcile/${reconId}`} />
      <div className="statgrid" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--bg)", paddingTop: 6 }}>
        <div className="stat"><div className="label">Beginning balance</div><div className="value">{fmt(beginning)}</div></div>
        <div className="stat"><div className="label">Statement ending balance</div>
          <input type="text" name="ending" value={endText} onChange={(e) => setEndText(e.target.value)} style={{ width: "100%", fontSize: "1.1rem", fontWeight: "bold" }} /></div>
        <div className="stat"><div className="label">Cleared balance</div><div className="value">{fmt(m.cleared)}</div><div className="delta mut">+{fmt(m.inc)} / −{fmt(m.dec)}</div></div>
        <div className="stat" style={{ borderColor: m.balanced ? "var(--good)" : "var(--bad)" }}>
          <div className="label">Difference</div>
          <div className={`value ${m.balanced ? "pos" : "neg"}`}>{Number.isFinite(m.diff) ? fmt(m.diff) : "?"}</div>
          <div className="delta">{m.balanced ? "Balanced" : "Must be $0.00 to finish"}</div>
        </div>
      </div>
      <div className="toolbar">
        <button className="btn" type="submit" name="action" value="finish" disabled={!m.balanced}>Finish reconciling</button>
        <button className="btn secondary" type="submit" name="action" value="save">Save and finish later</button>
        <button className="btn danger" type="submit" name="action" value="discard" formNoValidate>Discard</button>
      </div>
      {m.balanced && checked.size === 0 && items.length > 0 && (
        <p className="small warn">Nothing is checked. That&apos;s only right if this statement truly shows no activity.</p>
      )}
      {!m.balanced && Number.isFinite(m.diff) && (
        <p className="small mut">
          Not balancing? Look for an item on the statement that isn&apos;t listed here (import the latest download, or add it by hand in the register),
          an amount typed differently, or an item checked here that isn&apos;t on this statement. A difference of exactly one item&apos;s amount usually means that item.
          {items.some((i) => Math.abs(Math.abs(i.amount) - Math.abs(m.diff)) < 0.005) && <b> One item listed here is exactly {fmt(Math.abs(m.diff))}.</b>}
        </p>
      )}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Table title={downLabel} rows={downs} />
        <Table title={upLabel} rows={ups} />
      </div>
    </form>
  );
}
