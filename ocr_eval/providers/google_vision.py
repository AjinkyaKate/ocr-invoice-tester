import base64
from pathlib import Path
from typing import Optional

from ocr_eval.config import env, env_float
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class GoogleVisionProvider(OCRProvider):
    provider_name = "google_vision"
    default_model = "DOCUMENT_TEXT_DETECTION"

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
            return self.failure(invoice_id, model_name, started_at, "Install requests to use Google Vision OCR.")

        path = Path(file_path)
        if not path.exists():
            return self.failure(invoice_id, model_name, started_at, f"File not found: {file_path}")
        if path.suffix.lower() == ".pdf":
            return self.failure(
                invoice_id,
                model_name,
                started_at,
                "This simple Google Vision adapter supports local image files only. Use Google async file OCR or Document AI for PDFs.",
            )

        try:
            token = env("GOOGLE_OAUTH_ACCESS_TOKEN")
            api_key = env("GOOGLE_CLOUD_VISION_API_KEY")
            if not token and not api_key:
                return self.failure(
                    invoice_id,
                    model_name,
                    started_at,
                    "Set GOOGLE_OAUTH_ACCESS_TOKEN or GOOGLE_CLOUD_VISION_API_KEY.",
                )

            model = model_name or self.default_model
            endpoint = "https://vision.googleapis.com/v1/images:annotate"
            headers = {"Content-Type": "application/json; charset=utf-8"}
            params = {}
            if token:
                headers["Authorization"] = f"Bearer {token}"
                project = env("GOOGLE_CLOUD_PROJECT")
                if project:
                    headers["x-goog-user-project"] = project
            else:
                params["key"] = api_key

            image_content = base64.b64encode(path.read_bytes()).decode("ascii")
            body = {
                "requests": [
                    {
                        "image": {"content": image_content},
                        "features": [{"type": model}],
                    }
                ]
            }
            response = requests.post(endpoint, headers=headers, params=params, json=body, timeout=120)
            response.raise_for_status()
            payload = response.json()
            first = (payload.get("responses") or [{}])[0]
            if first.get("error"):
                return self.failure(invoice_id, model, started_at, str(first["error"]))

            text = (
                (first.get("fullTextAnnotation") or {}).get("text")
                or ((first.get("textAnnotations") or [{}])[0]).get("description", "")
            )
            cost = env_float("GOOGLE_VISION_COST_PER_PAGE")
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=model,
                extracted_text=text.strip(),
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(cost, 6),
                status="success",
                error=None,
                page_count=1,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))
