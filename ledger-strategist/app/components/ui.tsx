// Small shared pieces for the bookkeeping screens.
import Link from "next/link";

type SP = Record<string, string | undefined>;

/** Green "done" or red "problem" banner from ?msg= / ?error= after a form post. */
export function Flash({ params }: { params: SP }) {
  return (
    <>
      {params.error && <div className="callout bad">{params.error}</div>}
      {params.msg && <div className="callout">{params.msg}</div>}
    </>
  );
}

export type PickerGroup = { label: string; accounts: { id: string; name: string; fromQb?: boolean }[] };

/** Category picker. Bank and card accounts appear under "Transfer" and make the entry a transfer. */
export function AccountSelect({
  name, groups, value, placeholder = "Choose a category…", required, style,
}: { name: string; groups: PickerGroup[]; value?: string | null; placeholder?: string; required?: boolean; style?: React.CSSProperties }) {
  return (
    <select name={name} defaultValue={value ?? ""} required={required} style={style}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.fromQb === false ? " (not in QuickBooks)" : ""}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function EntityTabs({ entities, current, base }: { entities: { slug: string; name: string }[]; current?: string; base: string }) {
  return (
    <div className="toolbar">
      {entities.map((e) => (
        <Link key={e.slug} href={`${base}${base.includes("?") ? "&" : "?"}entity=${e.slug}`} className={`btn small ${current === e.slug ? "" : "secondary"}`}>
          {e.name}
        </Link>
      ))}
    </div>
  );
}

export function ymd(d: Date | null | undefined): string {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const KIND_LABELS: Record<string, string> = {
  clinic: "Clinic / practice",
  media: "Media / online",
  rental_realestate: "Rental real estate",
  holding: "Holding company",
  operating: "Operating business",
  other: "Other",
};
