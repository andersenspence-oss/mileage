import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const f = await req.formData();
  const action = String(f.get("action") ?? "");

  if (action === "add") {
    const description = String(f.get("description") ?? "").trim();
    const destination = String(f.get("destination") ?? "").trim();
    const startDate = String(f.get("startDate") ?? "");
    const endDate = String(f.get("endDate") ?? "");
    const travelers = Math.max(1, parseInt(String(f.get("travelers") ?? "1")) || 1);
    const highCost = f.get("highCost") === "on";
    const entitySlug = String(f.get("entitySlug") ?? "") || null;
    if (description && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      const s = new Date(startDate + "T00:00:00");
      const e = new Date(endDate + "T00:00:00");
      if (e > s) {
        await prisma.perDiemTrip.create({
          data: { description, destination, startDate: s, endDate: e, travelers, highCost, entitySlug },
        });
        return NextResponse.redirect(new URL("/travel?added=1", req.url), 303);
      }
      return NextResponse.redirect(new URL("/travel?error=overnight", req.url), 303);
    }
    return NextResponse.redirect(new URL("/travel?error=missing", req.url), 303);
  }

  if (action === "delete") {
    const id = String(f.get("id") ?? "");
    if (id) await prisma.perDiemTrip.delete({ where: { id } });
  }
  return NextResponse.redirect(new URL("/travel", req.url), 303);
}
