from __future__ import annotations

import cgi
import html
import json
import mimetypes
import os
import re
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from ocr_eval import extract_text


ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "data" / "invoices" / "uploads"
OUTPUT_DIR = ROOT / "outputs"
TEXT_OUTPUT_DIR = OUTPUT_DIR / "ocr_text"

RECOMMENDED_PROVIDERS = [
    {
        "value": "gemini",
        "label": "Gemini 2.5 Flash",
        "model": "gemini-2.5-flash",
        "note": "Good multimodal baseline for images and PDFs.",
    },
    {
        "value": "mistral",
        "label": "Mistral OCR",
        "model": "mistral-ocr-latest",
        "note": "Dedicated OCR. Local uploads are sent through Mistral Files, then OCR runs on the signed URL.",
    },
    {
        "value": "azure",
        "label": "Azure Document Intelligence Read",
        "model": "prebuilt-read",
        "note": "Strong document OCR baseline for PDFs and images.",
    },
    {
        "value": "ocr_space",
        "label": "OCR.space",
        "model": "2",
        "note": "Simple API baseline.",
    },
    {
        "value": "aws",
        "label": "AWS Textract DetectDocumentText",
        "model": "detect_document_text",
        "note": "Document OCR baseline. Sync API works best for images/single pages.",
    },
    {
        "value": "google",
        "label": "Google Vision DOCUMENT_TEXT_DETECTION",
        "model": "DOCUMENT_TEXT_DETECTION",
        "note": "Dense text OCR baseline. This adapter is image-focused.",
    },
    {
        "value": "tesseract",
        "label": "Tesseract Local",
        "model": "eng",
        "note": "Free local baseline. Requires system Tesseract.",
    },
    {
        "value": "scrapegraph",
        "label": "ScrapeGraph",
        "model": "normal",
        "note": "URL-only side baseline. Paste a public invoice image/PDF URL; local uploads cannot be fetched by ScrapeGraph.",
    },
]

MODEL_PRESETS = {item["value"]: item["model"] for item in RECOMMENDED_PROVIDERS}
PROVIDER_NOTES = {item["value"]: item["note"] for item in RECOMMENDED_PROVIDERS}


def safe_filename(name: str) -> str:
    stem = Path(name).stem or "invoice"
    suffix = Path(name).suffix.lower()
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("._") or "invoice"
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"}:
        suffix = ".bin"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{timestamp}_{stem}{suffix}"


def safe_id(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return value or "invoice"


def safe_part(value: str) -> str:
    return safe_id(value.replace("/", "_").replace("\\", "_").replace(" ", "_"))


def is_public_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def invoice_id_from_url(value: str) -> str:
    parsed = urlparse(value)
    name = Path(parsed.path).stem
    return safe_id(name or parsed.netloc or "invoice_url")


def read_result_paths(result: dict) -> tuple[Path, Path]:
    invoice_id = safe_part(result.get("invoice_id") or "invoice")
    provider = safe_part(result.get("provider") or "provider")
    model = safe_part(result.get("model") or "default")
    return (
        TEXT_OUTPUT_DIR / f"{invoice_id}__{provider}__{model}.txt",
        OUTPUT_DIR / f"{invoice_id}__{provider}__{model}.json",
    )


def save_result(result: dict) -> tuple[Path, Path]:
    TEXT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    text_path, json_path = read_result_paths(result)
    raw_text = result.get("extracted_text", "")
    if result.get("status") == "success":
        text_path.write_text(raw_text, encoding="utf-8")
    json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return text_path, json_path


def relative_url(path: Path) -> str:
    return "/" + quote(str(path.relative_to(ROOT)))


def table_placeholder_names(text: str) -> list[str]:
    return sorted(set(re.findall(r"\[(tbl-\d+\.md)\]\(\1\)", text)))


def render_page(
    *,
    provider: str = "gemini",
    model: str = "gemini-2.5-flash",
    invoice_id: str = "",
    uploaded_path: Path | None = None,
    source_url: str = "",
    result: dict | None = None,
    text_path: Path | None = None,
    json_path: Path | None = None,
) -> bytes:
    provider_options = []
    for item in RECOMMENDED_PROVIDERS:
        selected = " selected" if item["value"] == provider else ""
        provider_options.append(
            f'<option value="{html.escape(item["value"])}"{selected}>'
            f'{html.escape(item["label"])}</option>'
        )

    preview_html = '<div class="empty">Upload a PDF or image to preview it here.</div>'
    if source_url:
        escaped_url = html.escape(source_url, quote=True)
        lower_url = source_url.lower().split("?", 1)[0]
        if lower_url.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff")):
            preview_html = f'<img class="preview-image" src="{escaped_url}" alt="Invoice URL preview">'
        elif lower_url.endswith(".pdf"):
            preview_html = f'<iframe class="preview-frame" src="{escaped_url}" title="Invoice PDF URL preview"></iframe>'
        else:
            preview_html = f'<div class="empty">URL selected: {escaped_url}</div>'
    elif uploaded_path:
        mime_type = mimetypes.guess_type(uploaded_path.name)[0] or "application/octet-stream"
        url = relative_url(uploaded_path)
        if mime_type.startswith("image/"):
            preview_html = f'<img class="preview-image" src="{url}" alt="Uploaded invoice preview">'
        elif mime_type == "application/pdf":
            preview_html = f'<iframe class="preview-frame" src="{url}" title="Uploaded PDF preview"></iframe>'
        else:
            preview_html = f'<div class="empty">Preview is not available for {html.escape(uploaded_path.name)}.</div>'

    status_html = ""
    output_text = ""
    raw_char_count = 0
    if result:
        status = result.get("status", "error")
        status_class = "ok" if status == "success" else "bad"
        error = result.get("error")
        raw_text = result.get("extracted_text", "")
        output_text = raw_text
        raw_char_count = len(raw_text)
        table_placeholders = table_placeholder_names(raw_text)
        table_warning = ""
        if table_placeholders:
            names = ", ".join(html.escape(name) for name in table_placeholders)
            table_warning = (
                f'<p class="warn">Table placeholder detected: {names}. '
                "The provider detected a table region but did not inline the table rows in raw text. "
                "Count this as a table-text extraction miss for this run.</p>"
            )
        links = ""
        if text_path and text_path.exists():
            links += f'<a href="{relative_url(text_path)}" target="_blank">Raw text</a>'
        if json_path and json_path.exists():
            links += f'<a href="{relative_url(json_path)}" target="_blank">JSON result</a>'
        status_html = f"""
        <div class="status {status_class}">
          <strong>{html.escape(status.upper())}</strong>
          <span>Provider: {html.escape(result.get("provider", ""))}</span>
          <span>Model: {html.escape(result.get("model", ""))}</span>
          <span>Processing time: {html.escape(str(result.get("processing_time_seconds", "")))}s</span>
          <span>Cost: {html.escape(str(result.get("estimated_cost", "")))}</span>
          <span>Raw chars: {html.escape(str(raw_char_count))}</span>
          {'<p>' + html.escape(error) + '</p>' if error else ''}
          {table_warning}
          <div class="links">{links}</div>
        </div>
        """

    notes = PROVIDER_NOTES.get(provider, "")
    model_json = json.dumps(MODEL_PRESETS)
    notes_json = json.dumps(PROVIDER_NOTES)
    html_text = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OCR Invoice Tester</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --line: #d7dde8;
      --text: #172033;
      --muted: #657084;
      --accent: #1f6feb;
      --good: #067647;
      --bad: #b42318;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: var(--bg); color: var(--text); }}
    header {{
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 14px 20px;
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
    }}
    h1 {{ font-size: 18px; margin: 0; letter-spacing: 0; }}
    .hint {{ color: var(--muted); font-size: 13px; }}
    form {{
      display: grid;
      grid-template-columns: minmax(170px, 1.1fr) minmax(150px, 0.9fr) minmax(170px, 1fr) minmax(210px, 1.2fr) minmax(230px, 1.3fr) auto;
      gap: 10px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
      background: #eef3f9;
      align-items: end;
    }}
    label {{ display: grid; gap: 6px; font-size: 12px; color: var(--muted); font-weight: 700; }}
    input, select {{
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: white;
      color: var(--text);
      font: inherit;
    }}
    button {{
      min-height: 38px;
      border: 0;
      border-radius: 6px;
      padding: 0 16px;
      background: var(--accent);
      color: white;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
      min-width: 138px;
    }}
    button:disabled {{
      cursor: wait;
      background: #6b7280;
    }}
    .provider-note {{
      grid-column: 1 / -1;
      color: var(--muted);
      font-size: 13px;
      min-height: 18px;
    }}
    .workspace {{
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
      gap: 14px;
      padding: 14px;
      min-height: calc(100vh - 150px);
    }}
    section {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      min-height: 520px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }}
    .section-title {{
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      color: var(--muted);
      font-weight: 800;
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }}
    .preview {{
      flex: 1;
      display: flex;
      align-items: stretch;
      justify-content: center;
      background: #f1f4f8;
      overflow: auto;
    }}
    .preview-image {{
      max-width: 100%;
      height: auto;
      object-fit: contain;
      align-self: flex-start;
      padding: 12px;
    }}
    .preview-frame {{
      width: 100%;
      min-height: 720px;
      border: 0;
      background: white;
    }}
    .empty {{
      margin: auto;
      color: var(--muted);
      padding: 20px;
      text-align: center;
    }}
    textarea {{
      flex: 1;
      width: 100%;
      min-height: 440px;
      border: 0;
      padding: 14px;
      resize: none;
      color: #101828;
      background: white;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      white-space: pre;
    }}
    .status {{
      border-bottom: 1px solid var(--line);
      padding: 10px 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      font-size: 13px;
      align-items: center;
    }}
    .status.ok strong {{ color: var(--good); }}
    .status.bad strong {{ color: var(--bad); }}
    .status p {{ flex-basis: 100%; margin: 2px 0 0; color: var(--bad); }}
    .status p.warn {{ color: #b54708; }}
    .links {{ display: flex; gap: 10px; margin-left: auto; }}
    .links a {{ color: var(--accent); font-weight: 700; text-decoration: none; }}
    @media (max-width: 900px) {{
      form {{ grid-template-columns: 1fr; }}
      .workspace {{ grid-template-columns: 1fr; }}
      section {{ min-height: 420px; }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>OCR Invoice Tester</h1>
    <div class="hint">Upload invoice PDF/image → select provider/model → view raw extracted text only</div>
  </header>
  <form id="extract-form" method="post" action="/extract" enctype="multipart/form-data">
    <label>
      OCR provider
      <select name="provider" id="provider">
        {''.join(provider_options)}
      </select>
    </label>
    <label>
      Model
      <input name="model" id="model" value="{html.escape(model)}">
    </label>
    <label>
      Invoice ID
      <input name="invoice_id" value="{html.escape(invoice_id)}" placeholder="optional">
    </label>
    <label>
      Invoice file
      <input id="invoice-file" name="invoice_file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp">
    </label>
    <label>
      Public URL
      <input id="invoice-url" name="invoice_url" value="{html.escape(source_url)}" placeholder="Required for ScrapeGraph">
    </label>
    <button id="extract-button" type="submit">Extract Text</button>
    <div class="provider-note" id="provider-note">{html.escape(notes)}</div>
  </form>
  <main class="workspace">
    <section>
      <div class="section-title">
        <span>Invoice Preview</span>
        <span>{html.escape(uploaded_path.name if uploaded_path else (source_url if source_url else ""))}</span>
      </div>
      <div class="preview" id="preview-panel">{preview_html}</div>
    </section>
    <section>
      <div class="section-title">
        <span>Raw OCR Text</span>
        <span>{html.escape(str(len(output_text)))} chars</span>
      </div>
      {status_html}
      <textarea readonly spellcheck="false">{html.escape(output_text)}</textarea>
    </section>
  </main>
  <script>
    const modelPresets = {model_json};
    const providerNotes = {notes_json};
    const provider = document.getElementById("provider");
    const model = document.getElementById("model");
    const note = document.getElementById("provider-note");
    const form = document.getElementById("extract-form");
    const extractButton = document.getElementById("extract-button");
    const fileInput = document.getElementById("invoice-file");
    const urlInput = document.getElementById("invoice-url");
    const previewPanel = document.getElementById("preview-panel");
    let previewUrl = null;
    let submitting = false;

    provider.addEventListener("change", () => {{
      model.value = modelPresets[provider.value] || "";
      note.textContent = providerNotes[provider.value] || "";
      if (provider.value === "scrapegraph") {{
        urlInput.placeholder = "Paste public image/PDF URL";
      }} else {{
        urlInput.placeholder = "Optional public image/PDF URL";
      }}
    }});

    fileInput.addEventListener("change", () => {{
      const file = fileInput.files && fileInput.files[0];
      if (previewUrl) {{
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }}
      if (!file) {{
        previewPanel.innerHTML = '<div class="empty">Upload a PDF or image to preview it here.</div>';
        return;
      }}
      previewUrl = URL.createObjectURL(file);
      if (file.type.startsWith("image/")) {{
        previewPanel.innerHTML = "";
        const image = document.createElement("img");
        image.className = "preview-image";
        image.alt = "Uploaded invoice preview";
        image.src = previewUrl;
        previewPanel.appendChild(image);
      }} else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {{
        previewPanel.innerHTML = "";
        const frame = document.createElement("iframe");
        frame.className = "preview-frame";
        frame.title = "Uploaded PDF preview";
        frame.src = previewUrl;
        previewPanel.appendChild(frame);
      }} else {{
        previewPanel.innerHTML = '<div class="empty">Preview is available for PDF and image files only.</div>';
      }}
    }});

    form.addEventListener("submit", (event) => {{
      if (submitting) {{
        event.preventDefault();
        return;
      }}
      if (!fileInput.files.length && !urlInput.value.trim()) {{
        event.preventDefault();
        alert("Choose an invoice file or paste a public invoice URL.");
        return;
      }}
      if (provider.value === "scrapegraph" && !urlInput.value.trim()) {{
        event.preventDefault();
        alert("ScrapeGraph is URL-only. Paste a public invoice image/PDF URL to test it.");
        return;
      }}
      submitting = true;
      const startedAt = performance.now();
      extractButton.disabled = true;
      extractButton.setAttribute("aria-busy", "true");
      extractButton.textContent = "Extracting... 0.0s";
      window.setInterval(() => {{
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        extractButton.textContent = `Extracting... ${{seconds}}s`;
      }}, 100);
    }});
  </script>
</body>
</html>
"""
    return html_text.encode("utf-8")


class OCRWebHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def send_html(self, body: bytes, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/extract"}:
            self.send_html(render_page())
            return
        self.serve_workspace_file(parsed.path)

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/", "/extract"}:
            body = render_page()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/extract":
            self.send_error(404)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )

        provider = (form.getfirst("provider") or "gemini").strip()
        model = (form.getfirst("model") or "").strip() or None
        requested_invoice_id = (form.getfirst("invoice_id") or "").strip()
        invoice_url = (form.getfirst("invoice_url") or "").strip()
        upload = form["invoice_file"] if "invoice_file" in form else None

        if invoice_url and not is_public_url(invoice_url):
            self.send_html(
                render_page(
                    provider=provider,
                    model=model or "",
                    source_url=invoice_url,
                    result={"status": "error", "error": "Invoice URL must start with http:// or https://."},
                ),
                400,
            )
            return

        uploaded_path = None
        if invoice_url:
            invoice_input = invoice_url
            invoice_id = safe_id(requested_invoice_id or invoice_id_from_url(invoice_url))
        else:
            if upload is None or not getattr(upload, "filename", ""):
                self.send_html(
                    render_page(
                        provider=provider,
                        model=model or "",
                        result={"status": "error", "error": "Upload a PDF/image file or paste a public invoice URL."},
                    ),
                    400,
                )
                return

            if provider == "scrapegraph":
                self.send_html(
                    render_page(
                        provider=provider,
                        model=model or "",
                        result={"status": "error", "error": "ScrapeGraph is URL-only. Paste a public invoice image/PDF URL."},
                    ),
                    400,
                )
                return

            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            uploaded_path = UPLOAD_DIR / safe_filename(upload.filename)
            with uploaded_path.open("wb") as handle:
                while True:
                    chunk = upload.file.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
            invoice_input = str(uploaded_path)
            invoice_id = safe_id(requested_invoice_id or uploaded_path.stem)

        result = extract_text(
            file_path=invoice_input,
            provider=provider,
            model_name=model,
            invoice_id=invoice_id,
        )
        text_path, json_path = save_result(result)
        self.send_html(
            render_page(
                provider=provider,
                model=model or result.get("model") or "",
                invoice_id=invoice_id,
                uploaded_path=uploaded_path,
                source_url=invoice_url,
                result=result,
                text_path=text_path,
                json_path=json_path,
            )
        )

    def serve_workspace_file(self, request_path: str) -> None:
        relative = Path(unquote(request_path.lstrip("/")))
        target = (ROOT / relative).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return
        mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    host = "127.0.0.1"
    port = int(os.environ.get("OCR_WEB_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), OCRWebHandler)
    print(f"OCR web app running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
