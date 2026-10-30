// Server-only: text + positions from an image.
// Default: the local PaddleOCR server (ocr-server/server.py, `npm run ocr`).
// Hosted / fallback: OCR.space's free API (OCR_PROVIDER=ocrspace, or when the local server is down and OCR_SPACE_API_KEY is set);
// 25k requests/month, images up to 1 MB.
import type { OcrLine } from "./invoices/types";

export type OcrResult = { lines: OcrLine[]; width: number; height: number; ms: number; engine: string };

const OCR_URL = process.env.OCR_URL ?? "http://127.0.0.1:8765";

async function local(image: string): Promise<OcrResult> {
  const res = await fetch(`${OCR_URL}/ocr`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error ?? `OCR server error ${res.status}`);
  return { ...d, engine: "PaddleOCR (RapidOCR, local)" };
}

async function ocrSpace(image: string, key: string): Promise<OcrResult> {
  const started = Date.now();
  const body = new URLSearchParams({ apikey: key, base64Image: image, OCREngine: "2", isOverlayRequired: "true", scale: "true" });
  const d = await (await fetch("https://api.ocr.space/parse/image", { method: "POST", body })).json();
  if (d.IsErroredOnProcessing) throw new Error(String(d.ErrorMessage ?? "OCR.space failed"));
  const raw: { LineText: string; Words: { Left: number; Top: number; Width: number; Height: number }[] }[] = d.ParsedResults[0].TextOverlay.Lines;
  // OCR.space reports pixels; find the image size from the furthest word so boxes become fractions
  const words = raw.flatMap((l) => l.Words);
  const W = Math.max(...words.map((w) => w.Left + w.Width), 1), H = Math.max(...words.map((w) => w.Top + w.Height), 1);
  const lines = raw.map((l) => {
    const x0 = Math.min(...l.Words.map((w) => w.Left)), y0 = Math.min(...l.Words.map((w) => w.Top));
    const x1 = Math.max(...l.Words.map((w) => w.Left + w.Width)), y1 = Math.max(...l.Words.map((w) => w.Top + w.Height));
    return { text: l.LineText, box: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H] as OcrLine["box"], score: 1 };
  });
  return { lines, width: W, height: H, ms: Date.now() - started, engine: "OCR.space" };
}

export async function readImage(image: string): Promise<OcrResult> {
  // on the hosted site (OCR_PROVIDER=ocrspace) skip the local server entirely
  if (process.env.OCR_PROVIDER === "ocrspace") return ocrSpace(image, process.env.OCR_SPACE_API_KEY ?? "helloworld");
  try {
    return await local(image);
  } catch (err) {
    const key = process.env.OCR_SPACE_API_KEY;
    if (key) return ocrSpace(image, key);
    throw new Error(`The local OCR server isn't running. Start it with "npm run ocr". (${err instanceof Error ? err.message : err})`);
  }
}

/** Group OCR pieces into visual rows (pieces whose vertical centres line up), each row left to right. */
export function rows(lines: OcrLine[]): number[][] {
  const order = lines.map((_, i) => i).sort((a, b) => lines[a].box[1] + lines[a].box[3] / 2 - (lines[b].box[1] + lines[b].box[3] / 2));
  const out: { ids: number[]; mid: number; h: number }[] = [];
  for (const i of order) {
    const [, y, , h] = lines[i].box;
    const mid = y + h / 2;
    const row = out.at(-1);
    if (row && Math.abs(mid - row.mid) < Math.max(row.h, h) * 0.6) {
      row.ids.push(i);
      row.mid = (row.mid * (row.ids.length - 1) + mid) / row.ids.length;
    } else out.push({ ids: [i], mid, h });
  }
  return out.map((r) => r.ids.sort((a, b) => lines[a].box[0] - lines[b].box[0]));
}
