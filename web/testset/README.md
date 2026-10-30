# Test set

12 real documents with known correct values, used to measure extraction accuracy.

| id | kind | source |
|---|---|---|
| invoice-1..6 | business invoices | katanaml-org/invoices-donut-data-v1 (MIT) |
| receipt-1..4 | phone photos of retail receipts | naver-clova-ix/cord-v2 (CC BY 4.0) |
| scan-1..2 | scanned shop receipts | Voxel51/scanned_receipts, SROIE (CC BY 4.0); correct values typed by hand |

Run (dev server and `npm run ocr` running): `GAP=8000 node testset/eval.mjs [id ...]`. It sends each image through
`/api/read` then `/api/understand` and checks vendor, invoice number, date, total, item count and every item amount.

## Results (30 Oct 2026)

OCR text recall, engines alone: Tesseract 94%, PaddleOCR via RapidOCR 98% (2.4 s, chosen), OCR.space 98% (4 s), Dots 3 Note 99% (41 s, no positions).

Full pipeline (PaddleOCR + model):

| model | fields correct | notes |
|---|---|---|
| GPT-OSS 120B on Groq | 52/57 (91%), 2 documents failed | long invoices exceed Groq's free tokens-per-minute; one invoice read amounts with VAT |
| Gemini 2.5 Flash, JSON mode | **75/78 (96%)**, every value outlined | misses: a fully discounted cinema ticket (receipt-1) and a drink add-on the dataset nests under its drink (receipt-3) |
