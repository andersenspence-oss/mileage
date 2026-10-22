import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, withParams, plural } from "@/lib/http";
import { commitImport, BookError } from "@/lib/bookkeeping";
import type { CsvMapping } from "@/lib/bankImport";

const col = (form: FormData, k: string) => {
  const v = str(form, k);
  return v === "" ? null : Number(v);
};

function mappingFrom(form: FormData): CsvMapping {
  const amountMode = str(form, "amountMode");
  const m: CsvMapping = {
    headerRow: Number(str(form, "headerRow") || 0),
    dateCol: Number(str(form, "dateCol")),
    descCol: Number(str(form, "descCol")),
    amountCol: amountMode === "single" ? col(form, "amountCol") : null,
    debitCol: amountMode === "split" ? col(form, "debitCol") : null,
    creditCol: amountMode === "split" ? col(form, "creditCol") : null,
    checkCol: col(form, "checkCol"),
    memoCol: col(form, "memoCol"),
    flipSign: str(form, "flipSign") === "on",
    dateOrder: (["mdy", "ymd", "dmy"].includes(str(form, "dateOrder")) ? str(form, "dateOrder") : "mdy") as CsvMapping["dateOrder"],
  };
  if (Number.isNaN(m.dateCol) || Number.isNaN(m.descCol)) throw new BookError("Pick the date and description columns.");
  if (m.amountCol === null && (m.debitCol === null || m.creditCol === null)) throw new BookError("Pick the amount column, or both the money-out and money-in columns.");
  return m;
}

export async function POST(req: NextRequest) {
  return act(req, "/import", async (form) => {
    const action = str(form, "action");
    if (action === "upload") {
      const reg = await prisma.account.findUnique({ where: { id: str(form, "registerId") } });
      if (!reg) throw new BookError("Pick which bank or card account this download is from.");
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new BookError("Choose the CSV file you downloaded from the bank.");
      if (file.size > 15 * 1024 * 1024) throw new BookError("That file is too large for a bank download. Download a shorter date range.");
      const buf = new Uint8Array(await file.arrayBuffer());
      let text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
      if (/^\s*!(TRNS|ACCNT|HDR)/.test(text)) throw new BookError("That's a QuickBooks IIF file, not a bank download. Load it on the QuickBooks 2016 page.");
      if (/^(OFXHEADER|<\?xml|<OFX)/i.test(text.trim())) throw new BookError("That's a Quicken/QFX/OFX file. On the bank's download page, choose CSV (comma separated) instead.");
      const b = await prisma.importBatch.create({ data: { registerAccountId: reg.id, fileName: file.name, rawCsv: text } });
      return `/import/${b.id}`;
    }
    const batchId = str(form, "batchId");
    if (action === "remap") {
      const m = mappingFrom(form);
      await prisma.importBatch.update({ where: { id: batchId }, data: { mappingJson: JSON.stringify(m) } });
      return `/import/${batchId}`;
    }
    if (action === "commit") {
      const m = mappingFrom(form);
      const r = await commitImport(batchId, m);
      const b = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      const reg = await prisma.account.findUniqueOrThrow({ where: { id: b.registerAccountId }, include: { entity: true } });
      return withParams(`/review`, {
        entity: reg.entity.slug,
        msg: `${reg.name}: ${plural(r.added, "new transaction")} added` +
          (r.matched ? `, ${plural(r.matched, "line")} matched to entries already in the books` : "") +
          (r.duplicates ? `, ${plural(r.duplicates, "line")} skipped as already imported` : "") +
          ". Categories were suggested where possible; approve them below.",
      });
    }
    if (action === "discard") {
      await prisma.importBatch.update({ where: { id: batchId }, data: { status: "discarded", rawCsv: "" } });
      return withParams("/import", { msg: "Discarded. Nothing was imported." });
    }
    throw new BookError("Unknown action.");
  });
}
