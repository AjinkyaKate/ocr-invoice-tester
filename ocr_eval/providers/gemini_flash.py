import base64
import json
import mimetypes
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

from ocr_eval.config import env, env_float, env_required
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


@dataclass
class GeminiCurlResponse:
    status_code: int
    text: str
    reason: str = ""

    def json(self) -> dict:
        return json.loads(self.text)


class GeminiFlashProvider(OCRProvider):
    provider_name = "gemini_flash"
    default_model = "gemini-2.5-flash"

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
            return self.failure(invoice_id, model_name, started_at, "Install requests to use Gemini Flash.")

        try:
            api_key = env_required("GEMINI_API_KEY")
            model = model_name or env("GEMINI_MODEL", self.default_model)
            file_input = self._file_input(file_path)
            if not file_input:
                return self.failure(
                    invoice_id,
                    model,
                    started_at,
                    "Gemini Flash adapter supports image/PDF URLs or local image/PDF files.",
                )
            mime_type, data = file_input
            endpoint = self._endpoint(model)
            timeout = int(env("GEMINI_TIMEOUT", "120") or "120")
            request_payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": (
                                    "Extract all visible text from this invoice or receipt. "
                                    "Return only the raw text in reading order. Do not summarize, "
                                    "correct, infer, translate, or map fields. Preserve line breaks, "
                                    "numbers, decimal points, slashes, hyphens, currency symbols, "
                                    "and leading zeros as closely as possible."
                                )
                            },
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": data,
                                }
                            },
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0,
                },
            }

            response = self._post_json(endpoint, api_key, request_payload, timeout)
            if response.status_code >= 400:
                return self.failure(invoice_id, model, started_at, self._http_error_message(response))

            payload = response.json()
            text = self._extract_text(payload)
            if not text:
                return self.failure(invoice_id, model, started_at, f"No text found in Gemini response: {payload}")

            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=model,
                extracted_text=text,
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(env_float("GEMINI_COST_PER_REQUEST"), 6),
                status="success",
                error=None,
                page_count=1,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))

    def _endpoint(self, model: str) -> str:
        endpoint = env("GEMINI_API_URL")
        if endpoint and "{model}" in endpoint:
            return endpoint.format(model=model)
        if endpoint and "/interactions" not in endpoint:
            return endpoint
        return f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def _post_json(self, endpoint: str, api_key: str, payload: dict, timeout: int):
        import requests

        try:
            return requests.post(
                endpoint,
                headers={
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout,
            )
        except requests.RequestException as original_error:
            return self._post_json_with_curl(endpoint, api_key, payload, timeout, original_error)

    def _post_json_with_curl(
        self,
        endpoint: str,
        api_key: str,
        payload: dict,
        timeout: int,
        original_error: Exception,
    ) -> GeminiCurlResponse:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as request_file:
            json.dump(payload, request_file)
            request_path = request_file.name
        try:
            curl_config = "\n".join(
                [
                    f'url = "{endpoint}"',
                    'request = "POST"',
                    'header = "Content-Type: application/json"',
                    f'header = "x-goog-api-key: {api_key}"',
                    f'data-binary = "@{request_path}"',
                    'write-out = "\\n__HTTP_STATUS__:%{http_code}"',
                    "silent",
                    "show-error",
                    f"max-time = {timeout}",
                ]
            )
            result = subprocess.run(
                ["curl", "-K", "-"],
                input=curl_config,
                text=True,
                capture_output=True,
                timeout=timeout + 5,
                check=False,
            )
        finally:
            Path(request_path).unlink(missing_ok=True)

        if result.returncode != 0:
            raise RuntimeError(
                f"Gemini request failed with Python networking ({original_error}) "
                f"and curl fallback failed ({result.stderr.strip() or result.returncode})."
            )
        if "\n__HTTP_STATUS__:" not in result.stdout:
            raise RuntimeError("Gemini curl fallback did not return an HTTP status marker.")

        body, status = result.stdout.rsplit("\n__HTTP_STATUS__:", 1)
        return GeminiCurlResponse(status_code=int(status.strip()), text=body)

    def _file_input(self, file_path: str) -> Optional[tuple[str, str]]:
        try:
            import requests
        except ImportError:
            return None

        if file_path.startswith("http://") or file_path.startswith("https://"):
            response = requests.get(file_path, timeout=int(env("GEMINI_TIMEOUT", "120") or "120"))
            response.raise_for_status()
            mime_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip()
            if not mime_type or mime_type == "application/octet-stream":
                mime_type = self._mime_type_from_url(file_path)
            return mime_type, base64.b64encode(response.content).decode("utf-8")

        path = Path(file_path)
        if not path.exists():
            return None
        mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
        return mime_type, base64.b64encode(path.read_bytes()).decode("utf-8")

    def _mime_type_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        suffix = Path(parsed.path).suffix.lower()
        if not suffix:
            nested_url = parse_qs(parsed.query).get("url", [""])[0]
            suffix = Path(unquote(nested_url)).suffix.lower()
        return {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }.get(suffix, "image/png")

    def _extract_text(self, payload: dict) -> str:
        for key in ("output_text", "outputText", "text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        output = payload.get("output")
        if isinstance(output, list):
            parts = []
            for item in output:
                if isinstance(item, dict):
                    value = item.get("text") or item.get("content")
                    if isinstance(value, str):
                        parts.append(value)
            if parts:
                return "\n".join(parts).strip()

        candidates = payload.get("candidates") or []
        parts = []
        for candidate in candidates:
            content = candidate.get("content") or {}
            for part in content.get("parts") or []:
                text = part.get("text")
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()

    def _http_error_message(self, response) -> str:
        detail = response.text.strip()
        if len(detail) > 1000:
            detail = detail[:1000] + "..."
        if detail:
            return f"Gemini Flash HTTP {response.status_code}: {detail}"
        return f"Gemini Flash HTTP {response.status_code}: {response.reason}"
