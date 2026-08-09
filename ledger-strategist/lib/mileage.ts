// Import bridge for the Mileage Log app (the phone app you and Carey use).
// Reads its Google Sheet (published-CSV link) or its "Download CSV" export.
// Columns are matched by header name, exactly like the mileage app itself,
// so column order doesn't matter and extra columns are ignored.

export type ParsedTrip = {
  entryId: string | null;
  date: Date;
  category: string;
  entitySlug: string | null;
  business: boolean;
  miles: number;
  ratePerMile: number | null;
  deduction: number | null;
  vehicle: string | null;
  driver: string | null;
  businessPurpose: string | null;
  fuelTotal: number | null;
  receiptPhoto: string | null;
  notes: string | null;
};

// Trip categories in the mileage app -> entities here.
export const CATEGORY_TO_ENTITY: Record<string, string | null> = {
  "whiplash center of utah": "whiplash",
  "family health and rehab": "family-health",
  "running wild utah": "running-wild",
  "pi warriors": "pi-warriors",
  "misc. business": null, // business, but not tied to one entity
  personal: null,
};

export const NON_BUSINESS_CATEGORIES = new Set(["personal"]);

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function toNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

function toDate(v: string | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  // ISO (2026-08-09) or US (8/9/2026 or 08/09/26)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[1] - 1, +m[2]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the mileage app's sheet/CSV into trips. Rows without a date or with
 * zero/blank miles are skipped (in-progress or malformed entries).
 */
export function parseMileageCsv(text: string): { trips: ParsedTrip[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { trips: [], skipped: 0 };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name.toLowerCase());
  const get = (row: string[], name: string): string | undefined => {
    const i = col(name);
    return i >= 0 ? row[i]?.trim() : undefined;
  };

  const trips: ParsedTrip[] = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const date = toDate(get(row, "Date"));
    const miles = toNumber(get(row, "Trip miles")) ?? toNumber(get(row, "total mileage"));
    const flags = (get(row, "Flags") ?? "").toLowerCase();
    if (!date || !miles || miles <= 0 || flags.includes("void")) { skipped++; continue; }
    const category = get(row, "Category") ?? "Misc. Business";
    const catKey = category.toLowerCase().trim();
    trips.push({
      entryId: get(row, "Entry ID") || null,
      date,
      category,
      entitySlug: CATEGORY_TO_ENTITY[catKey] ?? null,
      business: !NON_BUSINESS_CATEGORIES.has(catKey),
      miles,
      ratePerMile: toNumber(get(row, "Rate per Mile")),
      deduction: toNumber(get(row, "Deduction $")),
      vehicle: get(row, "Vehicle") || null,
      driver: get(row, "Who's Phone / Driver") || null,
      businessPurpose: get(row, "Business Purpose") || null,
      fuelTotal: toNumber(get(row, "Fuel Total $")),
      receiptPhoto: get(row, "Receipt Photo") || null,
      notes: get(row, "Notes") || null,
    });
  }
  return { trips, skipped };
}

// ---- summary the strategy analyzer consumes --------------------------------

export type MileageSummary = {
  tripCount12: number;
  businessMiles12: number;
  loggedDeduction12: number; // sum of per-trip Deduction $ at each trip's dated IRS rate
  fuelTotal12: number;
  byEntity: Record<string, number>; // business miles per entity slug ("misc" for unassigned)
  byVehicle: Record<string, number>;
  personalMiles12: number;
  lastTripDate: Date | null;
};

export function summarizeTrips(
  trips: {
    date: Date; business: boolean; miles: number; deduction: number | null;
    ratePerMile: number | null; fuelTotal: number | null; entitySlug: string | null; vehicle: string | null;
  }[],
  now: Date,
  fallbackRate: number
): MileageSummary {
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const window = trips.filter((t) => t.date >= from && t.date <= now);
  const business = window.filter((t) => t.business);

  const byEntity: Record<string, number> = {};
  const byVehicle: Record<string, number> = {};
  let loggedDeduction = 0;
  for (const t of business) {
    const key = t.entitySlug ?? "misc";
    byEntity[key] = (byEntity[key] ?? 0) + t.miles;
    if (t.vehicle) byVehicle[t.vehicle] = (byVehicle[t.vehicle] ?? 0) + t.miles;
    loggedDeduction += t.deduction ?? t.miles * (t.ratePerMile ?? fallbackRate);
  }

  let lastTripDate: Date | null = null;
  for (const t of window) if (!lastTripDate || t.date > lastTripDate) lastTripDate = t.date;

  return {
    tripCount12: business.length,
    businessMiles12: Math.round(business.reduce((s, t) => s + t.miles, 0)),
    loggedDeduction12: Math.round(loggedDeduction),
    fuelTotal12: Math.round(business.reduce((s, t) => s + (t.fuelTotal ?? 0), 0)),
    byEntity: Object.fromEntries(Object.entries(byEntity).map(([k, v]) => [k, Math.round(v)])),
    byVehicle: Object.fromEntries(Object.entries(byVehicle).map(([k, v]) => [k, Math.round(v)])),
    personalMiles12: Math.round(window.filter((t) => !t.business).reduce((s, t) => s + t.miles, 0)),
    lastTripDate,
  };
}
