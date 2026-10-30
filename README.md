# OCR Invoice Tester

This repo has two parts:

- **`web/`: Invoices**, a web app. Upload an invoice or receipt image; every value is read, outlined on the original and checked, and you correct only what needs it before approving. PaddleOCR (local) or OCR.space (hosted) reads the text with positions, then a free LLM (Gemini 2.5 Flash, Nemotron, GPT-OSS on Groq, in turn) extracts vendor, number, date, items and totals. 96% field accuracy on 12 real invoices and receipts. See [`web/README.md`](web/README.md).
- **The Python POC below**: compares OCR providers on raw text extraction.

---

# OCR Invoice Text Extraction Evaluation POC

This proof of concept compares OCR providers on one narrow task: raw text extraction from invoice images or PDFs.

It intentionally does not do invoice field extraction, JSON mapping, vendor identification, line-item parsing, database automation, LLM validation, or business-rule validation.

## Verified Facts

These items were checked against provider documentation while building this scaffold:

- Azure AI Document Intelligence v4 has a Read OCR model with model ID `prebuilt-read`; it supports PDF and common image formats and returns document text content, paragraphs, lines, and words. Source: [Microsoft Read model docs](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read?view=doc-intel-4.0.0).
- Google Cloud Vision has `DOCUMENT_TEXT_DETECTION`, which is optimized for dense text and documents, and the REST `images:annotate` endpoint accepts base64 image content. Source: [Google Vision OCR docs](https://docs.cloud.google.com/vision/docs/ocr) and [images.annotate reference](https://docs.cloud.google.com/vision/docs/reference/rest/v1/images/annotate).
- AWS Textract `DetectDocumentText` returns detected lines and words as `Block` objects and is the basic raw OCR API. Source: [AWS Textract DetectDocumentText reference](https://docs.aws.amazon.com/textract/latest/APIReference/API_DetectDocumentText.html).
- OCR.space exposes a simple POST endpoint at `https://api.ocr.space/parse/image`, with file, URL, or base64 upload options. Source: [OCR.space API docs](https://ocr.space/ocrapi).
- Mistral exposes an OCR endpoint at `/v1/ocr` using `mistral-ocr-latest`, with document URL inputs and page markdown output. Source: [Mistral OCR API docs](https://docs.mistral.ai/api/endpoint/ocr).

## Assumptions

- The first dataset has 10 invoices.
- Ground truth is manually verified plain text in one `.txt` file per invoice.
- Invoices are mostly printed text, not handwriting-heavy.
- Ground truth line breaks are useful but not perfect, so CER/WER normalize whitespace while separate line/table metrics check layout preservation.
- API costs change over time, so this POC lets you set per-page estimates in `.env` instead of hard-coding prices.

## Recommended First Evaluation

Start with these providers:

1. `azure_document_intelligence` with `prebuilt-read`
   - Best first cloud benchmark for PDF/image invoices because it is document-oriented and supports PDFs directly.
2. `aws_textract` with `DetectDocumentText`
   - Strong document OCR baseline, especially if your production stack may run on AWS.
3. `google_vision` with `DOCUMENT_TEXT_DETECTION`
   - Good dense-text image OCR baseline. This simple adapter handles images; for PDFs, use Google async file OCR or Document AI later.
4. `ocr_space` with Engine 2 or 3
   - Very useful as a quick Postman and low-cost baseline. Do not assume it will win on dense invoice tables.
5. `tesseract_cli` with `eng`
   - Free local baseline for images. It gives you a privacy/cost reference point even if accuracy is lower.

Optional stretch provider:

- `mistral_ocr` with `mistral-ocr-latest`
  - Useful if you can provide signed/public URLs for the 10 invoices. It outputs markdown-like page text, which may preserve tables better than plain line OCR in some cases.

Recommended first run: compare 3 to 5 providers on the same 10 invoices, then select the top 2 for deeper testing.

## Architecture

```text
Invoice image or PDF
        |
Select OCR provider and model
        |
Provider adapter
        |
Common OCRResult schema
        |
Save raw OCR output
        |
Compare with ground truth text
        |
Calculate accuracy, speed, cost, failures
        |
Generate CSV and markdown report
```

The common Python interface is:

```python
from ocr_eval import extract_text

result = extract_text(
    file_path="data/invoices/invoice_01.pdf",
    provider="azure_document_intelligence",
    model_name="prebuilt-read",
    invoice_id="invoice_01",
)
```

Every adapter returns:

```json
{
  "invoice_id": "invoice_01",
  "provider": "provider_name",
  "model": "model_name",
  "extracted_text": "raw extracted text",
  "processing_time_seconds": 2.4,
  "estimated_cost": 0.01,
  "status": "success",
  "error": null,
  "page_count": 1
}
```

## Folder Structure

```text
.
├── .env.example
├── README.md
├── ocr_web_app.py
├── requirements.txt
├── data/
│   ├── invoices/
│   ├── ground_truth/
│   └── manifest.example.csv
├── docs/
│   ├── METRICS.md
│   ├── POSTMAN.md
│   └── PROVIDERS.md
├── ocr_eval/
│   ├── core.py
│   ├── cli.py
│   ├── schemas.py
│   ├── providers/
│   └── evaluation/
├── postman/
│   └── ocr-evaluation.postman_collection.json
├── tests/
└── outputs/
```

## Project Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
cp data/manifest.example.csv data/manifest.csv
```

Then add:

- invoice files to `data/invoices/`
- manually verified reference text files to `data/ground_truth/`
- the correct file names in `data/manifest.csv`

## Ground Truth Format

Use one plain UTF-8 text file per invoice:

```text
Invoice No: INV-000123
Date: 2026-07-01

Description        Qty     Unit Price     Total
ABC-001             05         12.50       62.50
```

Keep decimal points, hyphens, slashes, commas, currency symbols, leading zeros, and line breaks exactly as you want the OCR to be judged.

## Run OCR

For a simple local upload screen:

```bash
python3 ocr_web_app.py
```

Then open:

```text
http://127.0.0.1:8000
```

The page lets you select an OCR provider/model, upload one invoice PDF or image, preview the invoice on the left, and see raw extracted text on the right. It does not extract fields, map JSON, validate values, or parse line items.

For URL-only providers such as ScrapeGraph, paste a public invoice image/PDF URL in the `Public URL` field instead of using a local upload.

Recommended providers to test first in the UI:

1. `gemini` with `gemini-2.5-flash`
2. `mistral` with `mistral-ocr-latest`
3. `azure` with `prebuilt-read`
4. `ocr_space` with engine `2`
5. `tesseract` with `eng` as a free local baseline

Mistral local uploads are supported by uploading the invoice to Mistral Files, getting a signed URL, and sending that signed URL to Mistral OCR.

List provider names:

```bash
python -m ocr_eval.cli list-providers
```

Run OCR.space:

```bash
python -m ocr_eval.cli extract \
  --manifest data/manifest.csv \
  --provider ocr_space \
  --model 2 \
  --output outputs/ocr_results_ocr_space.jsonl
```

Run Azure:

```bash
python -m ocr_eval.cli extract \
  --manifest data/manifest.csv \
  --provider azure_document_intelligence \
  --model prebuilt-read \
  --output outputs/ocr_results_azure.jsonl
```

Run evaluation across one or more provider result files:

```bash
python -m ocr_eval.cli evaluate \
  --manifest data/manifest.csv \
  --ocr-results outputs/ocr_results_ocr_space.jsonl outputs/ocr_results_azure.jsonl \
  --out-dir outputs/evaluation
```

Generated files:

- `outputs/evaluation/detailed_results.csv`
- `outputs/evaluation/provider_summary.csv`
- `outputs/evaluation/comparison_report.md`
- `outputs/ocr_text/*.txt`

## Metrics

The evaluator calculates:

- Character Error Rate: character edit distance divided by reference character count.
- Character Accuracy: `1 - Character Error Rate`.
- Word Error Rate: word edit distance divided by reference word count.
- Word Accuracy: `1 - Word Error Rate`.
- Exact Text Match Percentage: 100 if normalized full text is exactly the same, otherwise 0.
- Missing Word Count: words in ground truth that are absent from OCR output.
- Extra Word Count: words in OCR output that are absent from ground truth.
- Number Accuracy: exact recall of number-like tokens, including values such as `001`, `12.50`, `1,234.00`, and `12/24`.
- Special-Character Accuracy: exact recall of punctuation/symbol characters such as `.`, `-`, `/`, `,`, `$`, `:`.
- Table-Text Preservation: simple recall of table-like lines. This is a warning signal, not a complete table structure metric.
- Processing Time: wall-clock OCR adapter runtime.
- Estimated Cost: page count multiplied by the provider cost value you set in `.env`.
- API Failure Rate: failed OCR calls divided by attempted OCR calls.

See `docs/METRICS.md` for formulas and examples.

## Result Tables

The detailed CSV uses this shape:

| Invoice | Provider | Model | Character Accuracy | Word Accuracy | Number Accuracy | Special-Character Accuracy | Processing Time | Cost | Status |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |

The summary CSV uses this shape:

| Provider | Average Accuracy | Number Accuracy | Average Time | Average Cost | API Failure Rate | Final Rank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |

## Common Risks

- A provider can look good on CER/WER while still breaking invoice-critical numbers.
- Table layout can be lost even when the raw words are mostly correct.
- PDF handling differs by provider. Some synchronous APIs handle images only.
- Scanned PDFs, rotated pages, low DPI, compression, and shadows can strongly affect results.
- Postman tests often succeed with one page but fail on larger PDFs because of file-size, page-count, or async-processing requirements.
- API pricing and quotas change, so keep costs configurable.
- Multimodal models may produce cleaner-looking text but can sometimes normalize or infer content. For this POC, judge only text that appears in the invoice.

## Selection Recommendation

For only 10 invoices, do not pick the winner from average accuracy alone. Select the best model using this order:

1. Exclude providers with repeated API failures or unsupported input types.
2. Prefer the provider with the highest number accuracy if invoices contain many amounts, quantities, codes, and dates.
3. Use character and word accuracy as the general quality score.
4. Check table-text preservation manually for the worst 2 or 3 invoices.
5. Compare average time and cost only after accuracy is acceptable.
6. Re-test the top 2 providers on a larger invoice set before production.
