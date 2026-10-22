import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { act, str, withParams } from "@/lib/http";
import { generateSuggestions } from "@/lib/bookkeeping";

// Suggest categories for everything uncategorized (learned rules first, then
// Claude). Suggestions go to the review queue; nothing is applied automatically.
export async function POST(req: NextRequest) {
  return act(req, "/review", async (form) => {
    const slug = str(form, "entity");
    const e = slug ? await prisma.entity.findUnique({ where: { slug } }) : null;
    const r = await generateSuggestions({ entityIds: e ? [e.id] : undefined });
    return withParams(str(form, "returnTo") || "/review", { generated: r.made, ai: r.claudeUsed ? 1 : 0, entity: slug || undefined });
  });
}
