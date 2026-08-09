import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveConnection } from "@/lib/qbo";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const code = p.get("code");
  const realmId = p.get("realmId");
  const entitySlug = p.get("state");
  if (!code || !realmId || !entitySlug) {
    return NextResponse.redirect(new URL("/entities?error=missing_params", req.url));
  }
  try {
    const tokens = await exchangeCode(code);
    await saveConnection(entitySlug, realmId, tokens);
    return NextResponse.redirect(new URL(`/entities?connected=${entitySlug}`, req.url));
  } catch {
    // never log token payloads
    return NextResponse.redirect(new URL("/entities?error=exchange_failed", req.url));
  }
}
