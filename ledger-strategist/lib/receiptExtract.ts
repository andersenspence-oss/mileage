// Claude reads an uploaded receipt photo: vendor, date, total.
// Falls back to nulls when no API key is configured (you then type them in).
import { claude, claudeAvailable, CLAUDE_MODEL } from "./claude";

export type ExtractedReceipt = {
  vendor: string | null;
  date: string | null; // YYYY-MM-DD
  amount: number | null;
};

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
};

export function mediaTypeFor(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[ext] ?? null;
}

export async function extractReceipt(imageBase64: string, mediaType: string): Promise<ExtractedReceipt> {
  if (!claudeAvailable()) return { vendor: null, date: null, amount: null };

  const schema = {
    type: "object",
    properties: {
      vendor: { type: ["string", "null"] },
      date: { type: ["string", "null"], description: "YYYY-MM-DD, null if unreadable" },
      amount: { type: ["number", "null"], description: "final total paid, null if unreadable" },
    },
    required: ["vendor", "date", "amount"],
    additionalProperties: false,
  } as const;

  try {
    const response = await claude().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageBase64 } },
            {
              type: "text",
              text: "Read this receipt. Return the merchant name, the transaction date (YYYY-MM-DD), and the final total paid. Use null for anything you can't read confidently.",
            },
          ],
        },
      ],
      // SDK typings lag the output_config parameter; the API accepts it.
      ...({ output_config: { format: { type: "json_schema", schema } } } as object),
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { vendor: null, date: null, amount: null };
    const parsed = JSON.parse(text.text) as ExtractedReceipt;
    return {
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      amount: typeof parsed.amount === "number" && parsed.amount > 0 ? parsed.amount : null,
    };
  } catch {
    return { vendor: null, date: null, amount: null };
  }
}
