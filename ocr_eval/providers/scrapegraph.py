from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from ocr_eval.config import env, env_float, env_required
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class ScrapeGraphProvider(OCRProvider):
    provider_name = "scrapegraph"
    default_model = "scrape_markdown"

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
            return self.failure(invoice_id, model_name, started_at, "Install requests to use ScrapeGraph.")

        try:
            document_url = self._document_url(file_path)
            if not document_url:
                return self.failure(
                    invoice_id,
                    model_name,
                    started_at,
                    "ScrapeGraph v2 scrape requires a public URL. Use --file https://... or set SCRAPEGRAPH_PUBLIC_BASE_URL for files in data/invoices/.",
                )
            if self._looks_like_placeholder(document_url):
                return self.failure(
                    invoice_id,
                    model_name,
                    started_at,
                    "Replace the example URL with a real public/signed invoice URL. Current URL looks like a placeholder.",
                )

            api_key = env_required("SGAI_API_KEY")
            endpoint = env("SGAI_API_URL", "https://v2-api.scrapegraphai.com/api").rstrip("/")
            content_type = env("SCRAPEGRAPH_CONTENT_TYPE") or self._content_type(document_url)
            mode = self._normalize_mode(model_name or env("SCRAPEGRAPH_MARKDOWN_MODE", "normal"))

            body = {
                "url": document_url,
                "formats": [{"type": "markdown", "mode": mode}],
            }
            if content_type:
                body["contentType"] = content_type

            response = requests.post(
                f"{endpoint}/scrape",
                headers={
                    "SGAI-APIKEY": api_key,
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=int(env("SCRAPEGRAPH_TIMEOUT", "120") or "120"),
            )
            if response.status_code >= 400:
                return self.failure(invoice_id, mode, started_at, self._http_error_message(response))
            payload = response.json()
            text = self._extract_markdown(payload)
            if not text:
                return self.failure(invoice_id, mode, started_at, f"No markdown text found in ScrapeGraph response: {payload}")

            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=f"markdown_{mode}",
                extracted_text=text,
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(env_float("SCRAPEGRAPH_COST_PER_REQUEST"), 6),
                status="success",
                error=None,
                page_count=None,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))

    def _normalize_mode(self, value: Optional[str]) -> str:
        raw = (value or "normal").strip().lower()
        aliases = {
            "scrape_markdown": "normal",
            "markdown": "normal",
            "markdown_normal": "normal",
            "markdown_reader": "reader",
            "markdown_prune": "prune",
        }
        mode = aliases.get(raw, raw)
        if mode not in {"normal", "reader", "prune"}:
            return "normal"
        return mode

    def _document_url(self, file_path: str) -> Optional[str]:
        if file_path.startswith("http://") or file_path.startswith("https://"):
            return file_path
        public_base = env("SCRAPEGRAPH_PUBLIC_BASE_URL")
        if public_base:
            return public_base.rstrip("/") + "/" + Path(file_path).name
        return None

    def _looks_like_placeholder(self, document_url: str) -> bool:
        host = urlparse(document_url).netloc.lower()
        return host in {"your-public-url.com", "example.com", "your-public-file-host.example.com"}

    def _http_error_message(self, response) -> str:
        detail = response.text.strip()
        if len(detail) > 1000:
            detail = detail[:1000] + "..."
        if detail:
            return f"ScrapeGraph HTTP {response.status_code}: {detail}"
        return f"ScrapeGraph HTTP {response.status_code}: {response.reason}"

    def _content_type(self, document_url: str) -> Optional[str]:
        suffix = Path(document_url.split("?", 1)[0]).suffix.lower()
        return {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
            ".bmp": "image/bmp",
        }.get(suffix)

    def _extract_markdown(self, payload: dict) -> str:
        markdown = ((payload.get("results") or {}).get("markdown") or {}).get("data")
        if isinstance(markdown, list):
            return "\n\n".join(str(item) for item in markdown if item).strip()
        if isinstance(markdown, str):
            return markdown.strip()
        legacy_result = payload.get("result")
        if isinstance(legacy_result, str):
            return legacy_result.strip()
        return ""
