# Provider Notes

## Initial Provider Ranking

Recommended first batch:

1. Azure AI Document Intelligence Read, `prebuilt-read`
2. AWS Textract, `DetectDocumentText`
3. Google Cloud Vision, `DOCUMENT_TEXT_DETECTION`
4. OCR.space, Engine 2 or 3
5. Tesseract CLI, `eng`

Optional:

- Mistral OCR, `mistral-ocr-latest`
- ScrapeGraphAI Scrape, `markdown`
- Gemini Flash, `gemini-3.5-flash`

## Azure AI Document Intelligence

Use when:

- you need PDFs and images in the same workflow
- invoices may have multiple pages
- you want a document-focused OCR service

Adapter:

```text
provider=azure_document_intelligence
model=prebuilt-read
```

Environment variables:

```text
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30
AZURE_DOCUMENT_INTELLIGENCE_COST_PER_PAGE=0
```

## AWS Textract

Use when:

- you are already on AWS
- you want a common document OCR baseline
- you may later add forms/tables analysis, even though this POC uses only raw text

Adapter:

```text
provider=aws_textract
model=DetectDocumentText
```

Environment variables:

```text
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
AWS_TEXTRACT_COST_PER_PAGE=0
```

## Google Vision OCR

Use when:

- you have image invoices
- you want dense-document text OCR
- you may later compare against Google Document AI

Adapter:

```text
provider=google_vision
model=DOCUMENT_TEXT_DETECTION
```

This simple adapter is image-only. For PDFs, use Google async file OCR or Google Document AI in a later adapter.

Environment variables:

```text
GOOGLE_OAUTH_ACCESS_TOKEN=
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_VISION_API_KEY=
GOOGLE_VISION_COST_PER_PAGE=0
```

## Gemini Flash

Use when:

- you want to compare a Gemini multimodal Flash model against OCR-specific engines
- your invoices are images or image URLs
- you understand this is prompted text extraction, not a dedicated OCR endpoint

Adapter:

```text
provider=gemini
model=gemini-3.5-flash
```

Environment variables:

```text
GEMINI_API_KEY=
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/interactions
GEMINI_MODEL=gemini-3.5-flash
GEMINI_TIMEOUT=120
GEMINI_COST_PER_REQUEST=0
```

If your account or region only supports Gemini 2.5 Flash, use:

```bash
python3 run_one_invoice.py --provider gemini --model gemini-2.5-flash --file "IMAGE_URL"
```

## OCR.space

Use when:

- you want the fastest Postman smoke test
- you want a low-friction API baseline
- your first test files are not huge

Adapter:

```text
provider=ocr_space
model=2
```

Environment variables:

```text
OCR_SPACE_API_KEY=
OCR_SPACE_ENDPOINT=https://api.ocr.space/parse/image
OCR_SPACE_LANGUAGE=eng
OCR_SPACE_ENGINE=2
OCR_SPACE_COST_PER_PAGE=0
```

## Tesseract CLI

Use when:

- you want a local no-API-cost baseline
- you have images or can convert PDFs to page images
- privacy matters

Adapter:

```text
provider=tesseract_cli
model=eng
```

Requirements:

- install the system `tesseract` binary
- pass images, not PDFs, to the simple adapter

Environment variables:

```text
TESSERACT_LANG=eng
TESSERACT_EXTRA_ARGS=
```

## Mistral OCR

Use when:

- you want a modern OCR endpoint with page markdown output
- you want to test local uploads or public/signed URLs
- table-like markdown text preservation is important to compare

Adapter:

```text
provider=mistral_ocr
model=mistral-ocr-latest
```

Environment variables:

```text
MISTRAL_API_KEY=
MISTRAL_OCR_ENDPOINT=https://api.mistral.ai/v1/ocr
MISTRAL_FILES_ENDPOINT=https://api.mistral.ai/v1/files
MISTRAL_FILE_PURPOSE=ocr
MISTRAL_SIGNED_URL_EXPIRY=24
MISTRAL_PUBLIC_BASE_URL=
MISTRAL_OCR_COST_PER_PAGE=0
```

For local files, the adapter uploads the file to Mistral Files, requests a signed URL, then passes that URL to Mistral OCR.

## ScrapeGraphAI

Use when:

- your invoice is available at a public or signed URL
- you want ScrapeGraph's markdown conversion as the raw text output
- you are testing PDF-to-markdown behavior before deciding whether it belongs in the OCR comparison

Adapter:

```text
provider=scrapegraph
model=normal
```

Environment variables:

```text
SGAI_API_KEY=
SGAI_API_URL=https://v2-api.scrapegraphai.com/api
SCRAPEGRAPH_PUBLIC_BASE_URL=
SCRAPEGRAPH_MARKDOWN_MODE=normal
SCRAPEGRAPH_CONTENT_TYPE=
SCRAPEGRAPH_TIMEOUT=120
SCRAPEGRAPH_COST_PER_REQUEST=0
```

Important: ScrapeGraph v2 scrape fetches public URLs. It does not receive private local file uploads in this adapter.
