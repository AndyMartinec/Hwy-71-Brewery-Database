/**
 * Invoice extraction: reads a supplier invoice (photo or PDF) with a vision
 * model and returns structured line items. Server-only (uses OPENAI_API_KEY).
 */

export interface ExtractedLine {
  raw_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
}

export interface ExtractedInvoice {
  supplier: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  freight: number | null;
  tax: number | null;
  total: number | null;
  lines: ExtractedLine[];
}

const PROMPT = `You are reading a brewery supplier invoice. Extract:
- supplier: the vendor/company name issuing the invoice
- invoice_number, invoice_date (YYYY-MM-DD)
- freight: shipping/freight charge (number, or null)
- tax: tax amount (number, or null)
- total: grand total (number, or null)
- lines: one entry per product line with:
  - raw_name: product name EXACTLY as printed
  - qty: quantity (number)
  - unit: unit as printed (e.g. "lb", "bag", "case", "each", "oz")
  - unit_price: price per unit (number)
  - line_total: line total (number)
Do NOT put freight, tax, discounts, or subtotal rows in lines.
Respond with JSON only:
{"supplier":..., "invoice_number":..., "invoice_date":..., "freight":..., "tax":..., "total":..., "lines":[{"raw_name":..., "qty":..., "unit":..., "unit_price":..., "line_total":...}]}
Use null for anything not present. Numbers must be plain numbers (no $ or commas).`;

export async function extractInvoice(
  fileBytes: Buffer,
  mimeType: string,
  filename: string
): Promise<ExtractedInvoice | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const b64 = fileBytes.toString("base64");
  const isPdf = mimeType === "application/pdf";
  const filePart = isPdf
    ? {
        type: "file",
        file: { filename, file_data: `data:application/pdf;base64,${b64}` },
      }
    : {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${b64}` },
      };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: PROMPT }, filePart],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Invoice reading failed (${res.status}). Try a clearer photo, or enter it manually.`);
  }
  const data = await res.json();
  const text: string | undefined = data.choices?.[0]?.message?.content;
  if (!text) return null;
  const parsed = JSON.parse(text) as ExtractedInvoice;
  parsed.lines = Array.isArray(parsed.lines) ? parsed.lines : [];
  return parsed;
}

export { normalizeName, suggestIngredientId } from "./match";
