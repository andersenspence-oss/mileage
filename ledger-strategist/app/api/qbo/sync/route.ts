import { NextRequest, NextResponse } from "next/server";
import { syncEntity } from "@/lib/qbo";

export async function POST(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity");
  if (!entity) return NextResponse.redirect(new URL("/entities", req.url), 303);
  try {
    const result = await syncEntity(entity);
    return NextResponse.redirect(
      new URL(`/entities?synced=${entity}&accounts=${result.accounts}&txns=${result.transactions}`, req.url), 303
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    return NextResponse.redirect(new URL(`/entities?error=${encodeURIComponent(msg)}`, req.url), 303);
  }
}
