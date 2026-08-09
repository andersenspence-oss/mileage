import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { detectAll } from "@/lib/anomalies";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get("action") ?? "scan");

  if (action === "scan") {
    const txns = await prisma.transaction.findMany({
      select: {
        id: true, entityId: true, accountId: true, date: true, amount: true, flow: true, vendor: true,
        account: { select: { name: true } },
      },
    });
    const detected = detectAll(
      txns.map((t) => ({ ...t, accountName: t.account?.name ?? null }))
    );
    let created = 0;
    for (const f of detected) {
      const exists = await prisma.anomalyFlag.findFirst({
        where: { transactionId: f.transactionId, kind: f.kind },
      });
      if (!exists) {
        await prisma.anomalyFlag.create({ data: f });
        created++;
      }
    }
    return NextResponse.redirect(new URL(`/flags?scanned=1&created=${created}`, req.url), 303);
  }

  const flagId = String(form.get("flagId") ?? "");
  if (flagId && (action === "dismiss" || action === "resolve")) {
    await prisma.anomalyFlag.update({
      where: { id: flagId },
      data: { status: action === "dismiss" ? "dismissed" : "resolved" },
    });
  }
  return NextResponse.redirect(new URL("/flags", req.url), 303);
}
