from pathlib import Path
from typing import Optional

from ocr_eval.config import env, env_float, env_required
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class OcrSpaceProvider(OCRProvider):
    provider_name = "ocr_space"
    default_model = "ocr_space_engine_2"

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
            return self.failure(invoice_id, model_name, started_at, "Install requests to use OCR.space.")

        path = Path(file_path)
        if not path.exists():
            return self.failure(invoice_id, model_name, started_at, f"File not found: {file_path}")

        try:
            api_key = env_required("OCR_SPACE_API_KEY")
            endpoint = env("OCR_SPACE_ENDPOINT", "https://api.ocr.space/parse/image")
            language = env("OCR_SPACE_LANGUAGE", "eng")
            engine = model_name or env("OCR_SPACE_ENGINE", "2")
            payload = {
                "language": language,
                "isOverlayRequired": "false",
                "OCREngine": str(engine).replace("ocr_space_engine_", ""),
                "scale": "true",
                "detectOrientation": "true",
            }
            with path.open("rb") as handle:
                response = requests.post(
                    endpoint,
                    headers={"apikey": api_key},
                    data=payload,
                    files={"file": (path.name, handle)},
                    timeout=120,
                )
            response.raise_for_status()
            data = response.json()
            if data.get("IsErroredOnProcessing"):
                error = "; ".join(data.get("ErrorMessage") or data.get("ErrorDetails") or ["OCR.space failed"])
                return self.failure(invoice_id, model_name, started_at, error)

            parsed_results = data.get("ParsedResults") or []
            text = "\n".join(item.get("ParsedText", "") for item in parsed_results).strip()
            page_count = max(1, len(parsed_results))
            cost = env_float("OCR_SPACE_COST_PER_PAGE") * page_count
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=f"ocr_space_engine_{payload['OCREngine']}",
                extracted_text=text,
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(cost, 6),
                status="success",
                error=None,
                page_count=page_count,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))
