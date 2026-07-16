# Postman OCR Smoke Tests

Use Postman before writing or debugging a Python adapter. The goal is to confirm credentials, endpoint, file format, and response shape.

Do not paste real keys into shared screenshots, committed collections, or chat. Use Postman environments and variables.

## Shared Setup

Create a Postman environment named `OCR Evaluation` with variables such as:

```text
azure_endpoint
azure_key
azure_operation_location
google_access_token
google_project_id
aws_access_key
aws_secret_key
aws_session_token
aws_region
ocr_space_key
mistral_api_key
invoice_public_url
invoice_base64
```

Save API responses using either:

- Postman's "Save Response" option
- copy response JSON into `outputs/postman_raw/<provider>__invoice_01.json`
- export the response body and later paste the extracted text into an OCR result file if needed

## OCR.space

1. API key: create a free or paid OCR.space API key from the OCR.space site.
2. Postman key location: environment variable `ocr_space_key`.
3. Endpoint: `POST https://api.ocr.space/parse/image`.
4. Headers:

```text
apikey: {{ocr_space_key}}
```

5. Upload: Body -> form-data.
6. Body fields:

```text
file: select File and choose invoice image/PDF
language: eng
isOverlayRequired: false
OCREngine: 2
scale: true
detectOrientation: true
```

7. Inspect response: look at `ParsedResults[0].ParsedText`.
8. Save response: save raw JSON and extracted text.
9. Common errors:

- invalid API key
- file too large
- unsupported file type
- rate limit or free-tier limit
- empty `ParsedText` for low-quality scans

10. Protect keys: keep key in Postman environment, not in the request URL.

## Azure AI Document Intelligence Read

1. API key: create an Azure AI Document Intelligence resource in Azure Portal, then copy key and endpoint.
2. Postman key location: `azure_endpoint` and `azure_key`.
3. Endpoint:

```text
POST {{azure_endpoint}}/documentintelligence/documentModels/prebuilt-read:analyze?_overload=analyzeDocument&api-version=2024-11-30
```

4. Headers:

```text
Ocp-Apim-Subscription-Key: {{azure_key}}
Content-Type: application/json
```

5. Upload: convert the invoice file to base64 first.
6. Body:

```json
{
  "base64Source": "{{invoice_base64}}"
}
```

7. Inspect response:

- the first response is usually `202 Accepted`
- copy the `Operation-Location` response header
- send a GET request to that URL until `status` is `succeeded`
- extracted raw text is in `analyzeResult.content`

8. Save response: save the final GET response JSON.
9. Common errors:

- wrong region endpoint
- missing `Ocp-Apim-Subscription-Key`
- invalid base64
- password-protected PDF
- file too large for tier
- polling too early

10. Protect keys: store `azure_key` only in a Postman environment or secret vault.

Optional Postman test script for the POST request:

```javascript
const location = pm.response.headers.get("Operation-Location");
if (location) {
  pm.environment.set("azure_operation_location", location);
}
```

Then create:

```text
GET {{azure_operation_location}}
```

with header:

```text
Ocp-Apim-Subscription-Key: {{azure_key}}
```

## Google Cloud Vision OCR

1. API key/token: enable Cloud Vision API in Google Cloud. For Postman, get a short-lived OAuth token with `gcloud auth print-access-token`.
2. Postman key location: `google_access_token` and `google_project_id`.
3. Endpoint:

```text
POST https://vision.googleapis.com/v1/images:annotate
```

4. Headers:

```text
Authorization: Bearer {{google_access_token}}
x-goog-user-project: {{google_project_id}}
Content-Type: application/json; charset=utf-8
```

5. Upload: convert an image invoice to base64. This simple request is for images.
6. Body:

```json
{
  "requests": [
    {
      "image": {
        "content": "{{invoice_base64}}"
      },
      "features": [
        {
          "type": "DOCUMENT_TEXT_DETECTION"
        }
      ]
    }
  ]
}
```

7. Inspect response: use `responses[0].fullTextAnnotation.text` when available.
8. Save response: save the full JSON response, because it also contains page/block/word details.
9. Common errors:

- expired OAuth token
- Vision API not enabled
- billing not enabled
- missing `x-goog-user-project`
- trying to send a PDF to the synchronous image endpoint

10. Protect keys: prefer short-lived OAuth tokens in Postman; do not store service account JSON in a shared collection.

## AWS Textract DetectDocumentText

1. API key: create an IAM user or role with Textract permissions. Prefer a restricted test role.
2. Postman key location: use Authorization -> AWS Signature.
3. Endpoint:

```text
POST https://textract.{{aws_region}}.amazonaws.com/
```

4. Headers:

```text
Content-Type: application/x-amz-json-1.1
X-Amz-Target: Textract.DetectDocumentText
```

5. Upload:

- easiest Postman smoke test: convert an image to base64 and paste it into JSON
- for larger PDFs, upload to S3 and use `S3Object`; async APIs may be required for production-scale PDF handling

6. Body:

```json
{
  "Document": {
    "Bytes": "{{invoice_base64}}"
  }
}
```

7. Inspect response: read `Blocks` where `BlockType` is `LINE`; concatenate each `Text`.
8. Save response: save the full JSON because line and word confidence can help error analysis later.
9. Common errors:

- bad AWS signature
- wrong region
- IAM permission denied
- request body too large
- unsupported local PDF path
- S3 object permission denied

10. Protect keys: use temporary credentials where possible and never export a collection with filled AWS secret values.

## Mistral OCR

1. API key: create a Mistral API key in the Mistral console.
2. Postman key location: `mistral_api_key`.
3. Endpoint:

```text
POST https://api.mistral.ai/v1/ocr
```

4. Headers:

```text
Authorization: Bearer {{mistral_api_key}}
Content-Type: application/json
```

5. Upload: provide a public or signed document URL for the first smoke test.
6. Body:

```json
{
  "model": "mistral-ocr-latest",
  "document": {
    "type": "document_url",
    "document_url": "{{invoice_public_url}}"
  },
  "table_format": "markdown"
}
```

7. Inspect response: concatenate `pages[*].markdown` for raw extracted text.
8. Save response: save the full JSON and extracted markdown text.
9. Common errors:

- invalid API key
- inaccessible document URL
- expired signed URL
- unsupported file
- request timeout for large documents

10. Protect keys: store the API key in a Postman environment and use short-lived signed URLs for private invoices.

## Tesseract

Tesseract is local software, so there is no Postman API test unless you wrap it in your own HTTP service. For this POC, test it from Python or the command line after installing the system `tesseract` binary.
