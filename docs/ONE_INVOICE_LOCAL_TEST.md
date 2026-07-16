# One Invoice Local OCR Test

This is the smallest local test:

```text
one invoice PDF/image -> one OCR provider -> raw extracted text file
```

## 1. Add Your API Key

Open `.env` and fill the section for your provider.

For OCR.space:

```text
OCR_SPACE_API_KEY=your_key_here
OCR_SPACE_ENGINE=2
```

For Azure Document Intelligence:

```text
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=your_key_here
```

For Google Vision:

```text
GOOGLE_OAUTH_ACCESS_TOKEN=your_short_lived_token_here
GOOGLE_CLOUD_PROJECT=your_project_id
```

For Gemini Flash:

```text
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
```

For AWS Textract:

```text
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
```

For Mistral OCR:

```text
MISTRAL_API_KEY=your_key_here
```

Local files are uploaded to Mistral Files first. The adapter then gets a signed URL and sends that URL to Mistral OCR.

For ScrapeGraphAI:

```text
SGAI_API_KEY=your_key_here
SGAI_API_URL=https://v2-api.scrapegraphai.com/api
```

Note: ScrapeGraph v2 scrape needs a public or signed URL. It does not upload a private local file directly.

## 2. Add One Invoice

Put your invoice here:

```text
data/invoices/
```

Example:

```text
data/invoices/invoice_01.pdf
```

Images also work for supported providers:

```text
data/invoices/invoice_01.png
data/invoices/invoice_01.jpg
```

## 3. Run OCR

For OCR.space:

```bash
python3 run_one_invoice.py --provider ocr_space --model 2 --file data/invoices/invoice_01.pdf
```

For Azure:

```bash
python3 run_one_invoice.py --provider azure --model prebuilt-read --file data/invoices/invoice_01.pdf
```

For Google Vision image OCR:

```bash
python3 run_one_invoice.py --provider google --model DOCUMENT_TEXT_DETECTION --file data/invoices/invoice_01.png
```

For Gemini Flash image extraction:

```bash
python3 run_one_invoice.py --provider gemini --model gemini-3.5-flash --file "https://example.com/invoice_01.png"
```

If needed, try:

```bash
python3 run_one_invoice.py --provider gemini --model gemini-2.5-flash --file "https://example.com/invoice_01.png"
```

For AWS Textract:

```bash
python3 run_one_invoice.py --provider aws --file data/invoices/invoice_01.png
```

For ScrapeGraphAI with a public/signed invoice URL:

```bash
python3 run_one_invoice.py --provider scrapegraph --file "https://example.com/invoice_01.pdf"
```

For ScrapeGraphAI with a file in `data/invoices/`, first host that file somewhere public or signed, then either pass the URL directly or set:

```text
SCRAPEGRAPH_PUBLIC_BASE_URL=https://your-public-file-host.example.com/invoices
```

Then run:

```bash
python3 run_one_invoice.py --provider scrapegraph --file data/invoices/invoice_01.pdf
```

## 4. See Output

Raw extracted text appears here:

```text
outputs/ocr_text/
```

Full JSON result appears here:

```text
outputs/invoice_01__provider__model.json
```

The JSON includes provider, model, extracted text, processing time, cost estimate, status, and error if any.
