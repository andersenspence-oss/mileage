import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, qboConfigured } from "@/lib/qbo";

export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity");
  if (!entity) return NextResponse.redirect(new URL("/entities", req.url));
  if (!qboConfigured()) {
    return NextResponse.redirect(new URL("/entities?error=not_configured", req.url));
  }
  return NextResponse.redirect(buildAuthUrl(entity));
}
