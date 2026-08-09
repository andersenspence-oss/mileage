import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseMileageCsv } from "@/lib/mileage";

// Imports trips from the Mileage Log app, two ways:
//  - action=saveUrl : store the Google Sheet "publish to web" CSV link
//  - action=sync    : fetch that link and import fresh trips
//  - action=upload  : import an uploaded CSV file (the app's Download CSV)
// Rows are upserted by Entry ID when present, so re-syncing never duplicates.

async function importCsvText(text: string): Promise<{ imported: number; skipped: number }> {
  const { trips, skipped } = parseMileageCsv(text);
  let imported = 0;
  for (const t of trips) {
    const data = {
      date: t.date, category: t.category, entitySlug: t.entitySlug, business: t.business,
      miles: t.miles, ratePerMile: t.ratePerMile, deduction: t.deduction, vehicle: t.vehicle,
      driver: t.driver, businessPurpose: t.businessPurpose, fuelTotal: t.fuelTotal,
      receiptPhoto: t.receiptPhoto, notes: t.notes,
    };
    if (t.entryId) {
      await prisma.mileageTrip.upsert({
        where: { entryId: t.entryId },
        update: data,
        create: { entryId: t.entryId, ...data },
      });
      // fuel receipts captured on the trip flow into the Receipts module too
      if (t.fuelTotal && t.fuelTotal > 0) {
        const receiptData = {
          date: t.date,
          vendor: "Fuel",
          amount: t.fuelTotal,
          source: "mileage_app",
          imageUrl: t.receiptPhoto,
          note: `From mileage log: ${t.category}${t.vehicle ? ` · ${t.vehicle}` : ""}`,
        };
        await prisma.receipt.upsert({
          where: { mileageEntryId: t.entryId },
          update: { date: receiptData.date, amount: receiptData.amount, imageUrl: receiptData.imageUrl },
          create: { mileageEntryId: t.entryId, ...receiptData },
        });
      }
    } else {
      // no Entry ID (older rows): match on date+miles+category to avoid dupes
      const existing = await prisma.mileageTrip.findFirst({
        where: { entryId: null, date: t.date, miles: t.miles, category: t.category },
      });
      if (existing) await prisma.mileageTrip.update({ where: { id: existing.id }, data });
      else await prisma.mileageTrip.create({ data });
    }
    imported++;
  }
  return { imported, skipped };
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const action = String(form.get("action") ?? "");

  try {
    if (action === "saveUrl") {
      const url = String(form.get("url") ?? "").trim();
      if (url && !/^https:\/\/docs\.google\.com\//.test(url)) {
        return NextResponse.redirect(new URL("/mileage?error=bad_url", req.url), 303);
      }
      await prisma.setting.upsert({
        where: { key: "mileageSheetCsvUrl" },
        update: { value: url },
        create: { key: "mileageSheetCsvUrl", value: url },
      });
      return NextResponse.redirect(new URL(url ? "/mileage?saved=1" : "/mileage", req.url), 303);
    }

    if (action === "sync") {
      const setting = await prisma.setting.findUnique({ where: { key: "mileageSheetCsvUrl" } });
      if (!setting?.value) {
        return NextResponse.redirect(new URL("/mileage?error=no_url", req.url), 303);
      }
      const res = await fetch(setting.value, { redirect: "follow" });
      if (!res.ok) throw new Error(`Google returned ${res.status}`);
      const text = await res.text();
      if (/<html/i.test(text.slice(0, 200))) {
        // got a login/permission page, not CSV — the sheet isn't published
        return NextResponse.redirect(new URL("/mileage?error=not_published", req.url), 303);
      }
      const { imported, skipped } = await importCsvText(text);
      return NextResponse.redirect(new URL(`/mileage?synced=${imported}&skipped=${skipped}`, req.url), 303);
    }

    if (action === "upload") {
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.redirect(new URL("/mileage?error=no_file", req.url), 303);
      }
      const text = await file.text();
      const { imported, skipped } = await importCsvText(text);
      return NextResponse.redirect(new URL(`/mileage?synced=${imported}&skipped=${skipped}`, req.url), 303);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import_failed";
    return NextResponse.redirect(new URL(`/mileage?error=${encodeURIComponent(msg)}`, req.url), 303);
  }
  return NextResponse.redirect(new URL("/mileage", req.url), 303);
}
