import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Download an export batch as an .IIF file for QuickBooks 2016 (File > Utilities > Import > IIF Files).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("batch") ?? "";
  const b = await prisma.exportBatch.findUnique({ where: { id }, include: { entity: true } });
  if (!b) return new NextResponse("Not found", { status: 404 });
  const d = b.createdAt;
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const name = `${b.entity.name.replace(/[^A-Za-z0-9]+/g, "-")}_through-${b.throughDate.toISOString().slice(0, 10)}_made-${stamp}.iif`;
  // QuickBooks 2016 reads IIF as Windows ANSI text; the content is already plain ASCII
  return new NextResponse(b.iif, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
