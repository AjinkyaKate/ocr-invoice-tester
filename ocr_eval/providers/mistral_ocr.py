import json
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from ocr_eval.config import env, env_float, env_required
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class MistralOcrProvider(OCRProvider):
    provider_name = "mistral_ocr"
    default_model = "mistral-ocr-latest"

    def extract(
        self,
        file_path: str,
        invoice_id: str,
        model_name: Optional[str] = None,
    ) -> OCRResult:
        started_at = self.start_timer()
        try:
            import requests
        except ImportError:
            return self.failure(invoice_id, model_name, started_at, "Install requests to use Mistral OCR.")

        try:
            api_key = env_required("MISTRAL_API_KEY")
            endpoint = env("MISTRAL_OCR_ENDPOINT", "https://api.mistral.ai/v1/ocr")
            model = model_name or self.default_model
            document_url = self._document_url(requests, api_key, file_path)
            document = self._document_payload(document_url, file_path)
            response = requests.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "document": document,
                    "table_format": "markdown",
                },
                timeout=180,
            )
            if response.status_code >= 400:
                return self.failure(invoice_id, model, started_at, self._http_error_message(response))
            payload = response.json()
            pages = payload.get("pages") or []
            page_texts = []
            inlined_table_ids = []
            for page in pages:
                markdown = page.get("markdown", "")
                inlined_markdown, table_ids = self._inline_table_references(markdown, page.get("tables") or [])
                page_texts.append(inlined_markdown)
                inlined_table_ids.extend(table_ids)
            text = "\n\n".join(page_texts).strip()
            raw_response_path = self._save_raw_response(invoice_id, model, payload)
            table_placeholders = self._table_placeholder_names(text)
            page_count = max(1, len(pages))
            cost = env_float("MISTRAL_OCR_COST_PER_PAGE") * page_count
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=payload.get("model") or model,
                extracted_text=text,
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(cost, 6),
                status="success",
                error=None,
                page_count=page_count,
                metadata={
                    "table_placeholders": table_placeholders,
                    "table_placeholder_count": len(table_placeholders),
                    "inlined_table_ids": sorted(set(inlined_table_ids)),
                    "inlined_table_count": len(set(inlined_table_ids)),
                    "raw_response_path": raw_response_path,
                    "page_keys": [sorted(page.keys()) for page in pages],
                },
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))

    def _document_url(self, requests_module, api_key: str, file_path: str) -> str:
        if file_path.startswith("http://") or file_path.startswith("https://"):
            return file_path

        public_base = env("MISTRAL_PUBLIC_BASE_URL")
        if public_base:
            return public_base.rstrip("/") + "/" + Path(file_path).name

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        uploaded = self._upload_file(requests_module, api_key, path)
        file_id = uploaded.get("id")
        if not file_id:
            raise RuntimeError(f"Mistral file upload did not return a file id: {uploaded}")

        signed = self._get_signed_url(requests_module, api_key, file_id)
        signed_url = signed.get("url")
        if not signed_url:
            raise RuntimeError(f"Mistral signed URL response did not include url: {signed}")
        return signed_url

    def _upload_file(self, requests_module, api_key: str, path: Path) -> dict:
        endpoint = env("MISTRAL_FILES_ENDPOINT", "https://api.mistral.ai/v1/files")
        headers = {"Authorization": f"Bearer {api_key}"}
        with path.open("rb") as handle:
            response = requests_module.post(
                endpoint,
                headers=headers,
                data={"purpose": env("MISTRAL_FILE_PURPOSE", "ocr")},
                files={"file": (path.name, handle)},
                timeout=180,
            )
        if response.status_code >= 400:
            raise RuntimeError(self._http_error_message(response, prefix="Mistral file upload"))
        return response.json()

    def _get_signed_url(self, requests_module, api_key: str, file_id: str) -> dict:
        files_endpoint = env("MISTRAL_FILES_ENDPOINT", "https://api.mistral.ai/v1/files").rstrip("/")
        expiry = env("MISTRAL_SIGNED_URL_EXPIRY", "24")
        endpoint = f"{files_endpoint}/{file_id}/url"
        response = requests_module.get(
            endpoint,
            headers={"Authorization": f"Bearer {api_key}"},
            params={"expiry": expiry},
            timeout=120,
        )
        if response.status_code >= 400:
            raise RuntimeError(self._http_error_message(response, prefix="Mistral signed URL"))
        return response.json()

    def _document_payload(self, document_url: str, original_file_path: str) -> dict:
        suffix = Path(urlparse(original_file_path).path).suffix.lower() if original_file_path.startswith(("http://", "https://")) else Path(original_file_path).suffix.lower()
        if not suffix:
            suffix = Path(urlparse(document_url).path).suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
            return {"type": "image_url", "image_url": document_url}
        return {"type": "document_url", "document_url": document_url}

    def _http_error_message(self, response, prefix: str = "Mistral OCR") -> str:
        detail = response.text.strip()
        if len(detail) > 1000:
            detail = detail[:1000] + "..."
        if detail:
            return f"{prefix} HTTP {response.status_code}: {detail}"
        return f"{prefix} HTTP {response.status_code}: {response.reason}"

    def _table_placeholder_names(self, text: str) -> list[str]:
        return sorted(set(re.findall(r"\[(tbl-\d+\.md)\]\(\1\)", text)))

    def _inline_table_references(self, markdown: str, tables: list[dict]) -> tuple[str, list[str]]:
        inlined_ids = []
        output = markdown
        for table in tables:
            table_id = str(table.get("id") or "").strip()
            content = table.get("content")
            if not table_id or not isinstance(content, str) or not content.strip():
                continue
            link = f"[{table_id}]({table_id})"
            if link in output:
                output = output.replace(link, content.strip())
                inlined_ids.append(table_id)
        return output, inlined_ids

    def _save_raw_response(self, invoice_id: str, model: str, payload: dict) -> Optional[str]:
        if env("OCR_SAVE_RAW_PROVIDER_RESPONSES", "0") not in {"1", "true", "TRUE", "yes", "YES"}:
            return None
        safe_invoice_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", invoice_id).strip("._") or "invoice"
        safe_model = re.sub(r"[^A-Za-z0-9_.-]+", "_", model).strip("._") or "model"
        path = Path("outputs") / "debug" / f"{safe_invoice_id}__mistral_ocr__{safe_model}__raw_response.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        return str(path)
