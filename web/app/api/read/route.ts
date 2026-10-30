// Step 1: OCR. Returns every piece of text with its position (fractions of the image) and confidence.
import { readImage } from "@/lib/ocr";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { image } = (await req.json()) as { image: string };
  if (!/^data:image\/[\w+.-]+;base64,/.test(image ?? "")) return Response.json({ error: "Send one image as a data URL" }, { status: 400 });
  try {
    return Response.json(await readImage(image));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
