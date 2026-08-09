import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { matchReceipts } from "@/lib/receipts";
import { extractReceipt, mediaTypeFor } from "@/lib/receiptExtract";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";

const RECEIPT_DIR = path.join(process.cwd(), "data", "receipts");

async function loadTxnsForMatching() {
  const txns = await prisma.transaction.findMany({
    where: { flow: "out" },
    select: {
      id: true, date: true, amount: true, flow: true, vendor: true,
      entity: { select: { name: true } }, account: { select: { name: true } },
    },
  });
  return txns.map((t) => ({
    id: t.id, date: t.date, amount: t.amount, flow: t.flow, vendor: t.vendor,
    entityName: t.entity.name, accountName: t.account?.name ?? null,
  }));
}

// Serve a locally stored receipt image (path is server-controlled, by id only)
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("image");
  if (!id) return new NextResponse("missing id", { status: 400 });
  const receipt = await prisma.receipt.findUnique({ where: { id } });
  if (!receipt?.filePath) return new NextResponse("not found", { status: 404 });
  try {
    const data = await readFile(receipt.filePath);
    const type = mediaTypeFor(receipt.filePath) ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": type } });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    if (action === "upload") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.redirect(new URL("/receipts?error=no_file", req.url), 303);
      }
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.redirect(new URL("/receipts?error=too_big", req.url), 303);
      }
      const mediaType = mediaTypeFor(file.name);
      if (!mediaType) {
        return NextResponse.redirect(new URL("/receipts?error=bad_type", req.url), 303);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const extracted = await extractReceipt(bytes.toString("base64"), mediaType);

      const receipt = await prisma.receipt.create({
        data: {
          date: extracted.date ? new Date(extracted.date + "T00:00:00") : new Date(),
          vendor: extracted.vendor,
          amount: extracted.amount ?? 0,
          source: "upload",
          note: extracted.amount == null ? "AI couldn't read this — edit the amount below" : null,
        },
      });
      await mkdir(RECEIPT_DIR, { recursive: true });
      const ext = file.name.split(".").pop()!.toLowerCase();
      const filePath = path.join(RECEIPT_DIR, `${receipt.id}.${ext}`);
      await writeFile(filePath, bytes);
      await prisma.receipt.update({ where: { id: receipt.id }, data: { filePath } });
      return NextResponse.redirect(new URL(`/receipts?uploaded=1&read=${extracted.amount != null ? 1 : 0}`, req.url), 303);
    }

    if (action === "edit") {
      const id = String(form.get("id") ?? "");
      const amount = parseFloat(String(form.get("amount") ?? ""));
      const vendor = String(form.get("vendor") ?? "").trim();
      const dateStr = String(form.get("date") ?? "");
      if (id) {
        await prisma.receipt.update({
          where: { id },
          data: {
            ...(isNaN(amount) ? {} : { amount }),
            ...(vendor ? { vendor } : {}),
            ...(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? { date: new Date(dateStr + "T00:00:00") } : {}),
          },
        });
      }
      return NextResponse.redirect(new URL("/receipts", req.url), 303);
    }

    if (action === "match_scan") {
      const receipts = await prisma.receipt.findMany({ where: { status: { in: ["unmatched", "suggested"] }, amount: { gt: 0 } } });
      const txns = await loadTxnsForMatching();
      const alreadyMatched = new Set(
        (await prisma.receipt.findMany({ where: { matchedTransactionId: { not: null } }, select: { matchedTransactionId: true } }))
          .map((r) => r.matchedTransactionId!)
      );
      const available = txns.filter((t) => !alreadyMatched.has(t.id));
      const results = matchReceipts(receipts, available);
      let auto = 0, suggested = 0;
      for (const r of results) {
        if (!r.candidate) continue;
        if (r.auto) {
          await prisma.receipt.update({
            where: { id: r.receiptId },
            data: { matchedTransactionId: r.candidate.transactionId, status: "matched" },
          });
          auto++;
        } else {
          await prisma.receipt.update({
            where: { id: r.receiptId },
            data: { matchedTransactionId: r.candidate.transactionId, status: "suggested" },
          });
          suggested++;
        }
      }
      return NextResponse.redirect(new URL(`/receipts?scanned=1&auto=${auto}&suggested=${suggested}`, req.url), 303);
    }

    const id = String(form.get("id") ?? "");
    if (action === "confirm" && id) {
      const r = await prisma.receipt.findUnique({ where: { id } });
      if (r?.matchedTransactionId) {
        await prisma.receipt.update({ where: { id }, data: { status: "matched" } });
      }
    } else if (action === "unmatch" && id) {
      await prisma.receipt.update({ where: { id }, data: { status: "unmatched", matchedTransactionId: null } });
    } else if (action === "dismiss" && id) {
      await prisma.receipt.update({ where: { id }, data: { status: "dismissed", matchedTransactionId: null } });
    } else if (action === "delete" && id) {
      await prisma.receipt.delete({ where: { id } });
    }
    return NextResponse.redirect(new URL("/receipts", req.url), 303);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "receipt_action_failed";
    return NextResponse.redirect(new URL(`/receipts?error=${encodeURIComponent(msg)}`, req.url), 303);
  }
}
