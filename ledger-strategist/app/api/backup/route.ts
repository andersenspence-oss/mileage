import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readFile, rm, mkdir } from "fs/promises";
import path from "path";
import os from "os";

// A consistent snapshot of the whole database (safe while the app is running),
// downloaded as one file. To restore: stop the app, replace prisma/data/ledger.db
// with this file (renamed to ledger.db), start the app.
export async function GET() {
  const dir = path.join(os.tmpdir(), "ledger-backup");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `snapshot-${Date.now()}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const data = await readFile(file);
  await rm(file, { force: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="ledger-backup-${stamp}.db"`,
    },
  });
}
