// Small helpers for the form-post API routes: read fields, redirect back with
// a plain-language message, and turn bookkeeping rule violations into a
// friendly error banner instead of a crash page.
import { NextRequest, NextResponse } from "next/server";
import { BookError } from "./bookkeeping";
import { parseAmount, parseDate } from "./bankImport";

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optStr(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v ? v : null;
}

/** Accepts "1,234.56", "$1,234.56", "1234.5". Returns null when blank. */
export function money(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (!v) return null;
  const n = parseAmount(v);
  if (n === null) throw new BookError(`"${v}" isn't a dollar amount.`);
  return n;
}

export function moneyOr0(form: FormData, key: string): number {
  return money(form, key) ?? 0;
}

/** <input type="date"> gives yyyy-mm-dd; typed dates like 10/5/2026 work too. */
export function date(form: FormData, key: string): Date | null {
  const v = str(form, key);
  if (!v) return null;
  const d = parseDate(v, "mdy");
  if (!d) throw new BookError(`"${v}" isn't a date.`);
  return d;
}

export function requireDate(form: FormData, key: string, label: string): Date {
  const d = date(form, key);
  if (!d) throw new BookError(`Enter the ${label}.`);
  return d;
}

export function go(req: NextRequest, path: string, params: Record<string, string | number | undefined | null> = {}) {
  const url = new URL(path, req.url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  return NextResponse.redirect(url, 303);
}

/**
 * Run a form action. `fn` returns where to go next. A BookError (a rule like
 * "reconciled items can't be changed") sends the person back to `back` with
 * the message shown in a banner.
 */
export async function act(
  req: NextRequest,
  back: string,
  fn: (form: FormData) => Promise<NextResponse | string>
): Promise<NextResponse> {
  const form = await req.formData();
  const returnTo = str(form, "returnTo") || back;
  try {
    const r = await fn(form);
    return typeof r === "string" ? go(req, r) : r;
  } catch (e) {
    if (e instanceof BookError) return go(req, returnTo, { error: e.message });
    console.error(e);
    return go(req, returnTo, { error: "Something unexpected went wrong. Nothing was saved. Details are in the terminal window." });
  }
}

/** Append ?key=value to a local path. */
export function withParams(path: string, params: Record<string, string | number | undefined | null>) {
  const [base, q] = path.split("?");
  const sp = new URLSearchParams(q ?? "");
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** plural(1, "transaction") -> "1 transaction"; plural(3, "transaction") -> "3 transactions" */
export function plural(n: number, word: string, many?: string) {
  return `${n.toLocaleString()} ${n === 1 ? word : many ?? word + "s"}`;
}
