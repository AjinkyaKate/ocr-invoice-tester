import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from ocr_eval import extract_text


DEFAULT_INVOICE_DIR = Path("data/invoices")
DEFAULT_OUTPUT_DIR = Path("outputs/ocr_text")


def find_first_invoice() -> Path:
    supported = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    files = sorted(path for path in DEFAULT_INVOICE_DIR.iterdir() if path.suffix.lower() in supported)
    if not files:
        raise FileNotFoundError(
            "No invoice file found. Put one PDF or image in data/invoices/ "
            "or pass --file path/to/invoice.pdf"
        )
    return files[0]


def safe_name(value: str) -> str:
    return value.replace("/", "_").replace("\\", "_").replace(" ", "_")


def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def invoice_id_from_input(value: str) -> str:
    if is_url(value):
        path_name = Path(urlparse(value).path).stem
        return path_name or "invoice_01"
    return Path(value).stem


def main() -> None:
    parser = argparse.ArgumentParser(description="Run OCR/text extraction on one invoice file or URL.")
    parser.add_argument("--file", default=None, help="Invoice PDF/image path or public URL. Defaults to first file in data/invoices/.")
    parser.add_argument("--provider", default="ocr_space", help="Provider name, for example: gemini, mistral, scrapegraph, ocr_space, azure, google, aws.")
    parser.add_argument("--model", default=None, help="Optional provider model name.")
    parser.add_argument("--invoice-id", default=None, help="Optional invoice ID. Defaults to the file name.")
    args = parser.parse_args()

    try:
        invoice_input = args.file if args.file else str(find_first_invoice())
    except FileNotFoundError as exc:
        raise SystemExit(str(exc)) from exc
    invoice_id = args.invoice_id or invoice_id_from_input(invoice_input)

    result = extract_text(
        file_path=invoice_input,
        provider=args.provider,
        model_name=args.model,
        invoice_id=invoice_id,
    )

    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model = safe_name(result.get("model") or args.model or "default")
    provider = safe_name(result.get("provider") or args.provider)
    text_path = DEFAULT_OUTPUT_DIR / f"{invoice_id}__{provider}__{model}.txt"
    json_path = Path("outputs") / f"{invoice_id}__{provider}__{model}.json"

    if result.get("status") == "success":
        text_path.write_text(result.get("extracted_text", ""), encoding="utf-8")
    json_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Status: {result.get('status')}")
    print(f"Provider: {result.get('provider')}")
    print(f"Model: {result.get('model')}")
    print(f"JSON result: {json_path}")
    if result.get("status") == "success":
        print(f"Extracted text: {text_path}")
    else:
        print(f"Error: {result.get('error')}")


if __name__ == "__main__":
    main()
