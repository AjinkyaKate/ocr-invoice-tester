// Step 2: understand. The chat model sees the image and the OCR text (grouped into rows, every piece
// numbered) and returns the invoice fields, each pointing at the OCR pieces it came from, so the
// review screen can outline every value on the original.
import { Output, streamText } from "ai";
import { describeError } from "@/lib/providers";
import { availableModels } from "@/lib/understand-models";
import { rows } from "@/lib/ocr";
import type { OcrLine } from "@/lib/invoices/types";

export const maxDuration = 120;

const PROMPT = `You are reading a purchase document: a supplier invoice, tax invoice, bill or retail receipt, from any country.
The image is attached. Below it is the OCR text, grouped into visual rows; every piece has an id in square brackets.

Return only JSON, no prose:
{"document_type": "invoice" | "receipt" | "other",
 "currency": ISO 4217 code or null,
 "vendor": {"value": string | null, "ids": [int]},
 "invoice_number": {"value": string | null, "ids": [int]},
 "date": {"value": string | null, "ids": [int]},
 "subtotal": {"value": number | null, "ids": [int]},
 "tax": {"value": number | null, "ids": [int]},
 "total": {"value": number | null, "ids": [int]},
 "items": [{"description": string, "qty": number | null, "unit_price": number | null, "amount": number | null, "ids": [int]}]}

Rules:
- vendor is the business that issued the document (the seller), not the buyer. Use its name only, not the address.
- date as printed. invoice_number is the invoice, bill or receipt number.
- Write numbers as plain JSON numbers, reading the document's own format: "444,60" with a decimal comma is 444.6; "1,080.00" is 1080; on Indonesian or similar receipts "60.000" means 60000.
- amount is the line total as printed (the net amount if both net and gross are shown). Copy what is printed; never fix the arithmetic.
- A discount printed as its own line is an item with a negative amount. Payment lines (cash, card, change), totals and tax lines are not items.
- total is the final amount payable. subtotal is the amount before tax, if printed. tax is the total tax, if printed.
- ids: the bracketed ids of the OCR pieces where that value is printed. For items, list every piece of the item's row(s): description, quantity, prices. Use [] when the value is not printed.
- If the OCR text is garbled, read the value from the image, and still point ids at where it is printed.

OCR text:
`;

type Ref<T> = { value: T | null; ids: number[] };
type Raw = {
  document_type?: string; currency?: string | null;
  vendor?: Ref<string>; invoice_number?: Ref<string>; date?: Ref<string>;
  subtotal?: Ref<number>; tax?: Ref<number>; total?: Ref<number>;
  items?: { description?: string; qty?: number | null; unit_price?: number | null; amount?: number | null; ids?: number[] }[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export async function POST(req: Request) {
  const models = availableModels();
  if (!models.length) return Response.json({ error: "Add a free key to .env.local: OPENROUTER_API_KEY, GROQ_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY." }, { status: 400 });
  const { image, lines } = (await req.json()) as { image: string; lines: OcrLine[] };
  const mt = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(image ?? "");
  if (!mt || !Array.isArray(lines)) return Response.json({ error: "Send the image and its OCR lines" }, { status: 400 });

  const text = rows(lines).map((r) => r.map((i) => `[${i}] ${lines[i].text}`).join("   ")).join("\n");
  // Stream NDJSON: {"type":"partial","data":…} while the model writes, then {"type":"done",…}.
  // Free models are tried in turn; if one fails (even mid-way) the client is told to reset and the next one starts.
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      const tried: string[] = [];
      for (const m of models) {
        const started = Date.now();
        let failure: unknown = null;
        let sent = false;
        try {
          const result = streamText({
            model: m.model(),
            output: Output.json(), // the provider's JSON mode, so the reply always parses
            maxRetries: 0, // a rate-limited model hands over to the next one right away
            messages: [{ role: "user", content: m.vision ? [{ type: "file", mediaType: mt[1], data: mt[2] }, { type: "text", text: PROMPT + text }] : PROMPT + text }],
            abortSignal: req.signal,
            onError: ({ error }) => { failure = error; },
          });
          let last = 0;
          for await (const partial of result.partialOutputStream) {
            if (Date.now() - last < 120) continue; // a few updates a second is plenty for the UI
            last = Date.now();
            if (partial && typeof partial === "object") send({ type: "partial", data: parse(partial as Raw, lines) });
            sent = true;
          }
          const output = await result.output;
          if (failure) throw failure;
          send({ type: "done", data: parse(output as Raw, lines), ms: Date.now() - started, model: m.label });
          controller.close();
          return;
        } catch (err) {
          if (req.signal.aborted) { controller.close(); return; }
          tried.push(`${m.label}: ${describeError(failure ?? err)}`);
          console.warn(`[understand] ${tried.at(-1)}`); // visible in the dev server log
          if (sent) send({ type: "reset" });
        }
      }
      send({ type: "error", message: tried.join(" · ") });
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

/** Clean up the model's JSON: plain numbers, and only ids that exist so an invented id can't point at the wrong place. */
function parse(raw: Raw, lines: OcrLine[]) {
  if (!raw || typeof raw !== "object") throw new Error("The model did not return invoice fields");
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < lines.length) : []);
  const str = (r?: Ref<string>) => ({ value: typeof r?.value === "string" && r.value.trim() ? r.value.trim() : null, lines: ids(r?.ids) });
  const n = (r?: Ref<number>) => ({ value: num(r?.value), lines: ids(r?.ids) });
  return {
    currency: typeof raw.currency === "string" ? raw.currency.toUpperCase().slice(0, 3) : null,
    vendor: str(raw.vendor), number: str(raw.invoice_number), date: str(raw.date),
    subtotal: n(raw.subtotal), tax: n(raw.tax), total: n(raw.total),
    items: (raw.items ?? []).filter((i) => i && (i.description || num(i.amount) !== null)).map((i) => ({
      desc: String(i.description ?? "").trim() || "(no description)",
      qty: num(i.qty), rate: num(i.unit_price), amount: num(i.amount), lines: ids(i.ids),
    })),
  };
}
