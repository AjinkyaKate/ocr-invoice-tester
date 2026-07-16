import base64
import time
from pathlib import Path
from typing import Optional

from ocr_eval.config import env, env_float, env_required
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class AzureDocumentIntelligenceProvider(OCRProvider):
    provider_name = "azure_document_intelligence"
    default_model = "prebuilt-read"

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
            return self.failure(invoice_id, model_name, started_at, "Install requests to use Azure OCR.")

        path = Path(file_path)
        if not path.exists():
            return self.failure(invoice_id, model_name, started_at, f"File not found: {file_path}")

        try:
            endpoint = env_required("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT").rstrip("/")
            api_key = env_required("AZURE_DOCUMENT_INTELLIGENCE_KEY")
            api_version = env("AZURE_DOCUMENT_INTELLIGENCE_API_VERSION", "2024-11-30")
            model = model_name or self.default_model
            analyze_url = f"{endpoint}/documentintelligence/documentModels/{model}:analyze"
            query = {"_overload": "analyzeDocument", "api-version": api_version}
            headers = {
                "Ocp-Apim-Subscription-Key": api_key,
                "Content-Type": "application/json",
            }
            base64_source = base64.b64encode(path.read_bytes()).decode("ascii")
            response = requests.post(
                analyze_url,
                params=query,
                headers=headers,
                json={"base64Source": base64_source},
                timeout=120,
            )
            response.raise_for_status()
            operation_url = response.headers.get("Operation-Location")
            if not operation_url:
                return self.failure(invoice_id, model, started_at, "Azure response did not include Operation-Location.")

            result = self._poll_result(requests, operation_url, headers)
            status = result.get("status")
            if status != "succeeded":
                return self.failure(invoice_id, model, started_at, f"Azure analysis status: {status}; {result}")

            analyze_result = result.get("analyzeResult") or {}
            text = analyze_result.get("content", "")
            pages = analyze_result.get("pages") or []
            page_count = max(1, len(pages))
            cost = env_float("AZURE_DOCUMENT_INTELLIGENCE_COST_PER_PAGE") * page_count
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=model,
                extracted_text=text,
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(cost, 6),
                status="success",
                error=None,
                page_count=page_count,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))

    def _poll_result(self, requests_module, operation_url: str, headers: dict) -> dict:
        poll_headers = {"Ocp-Apim-Subscription-Key": headers["Ocp-Apim-Subscription-Key"]}
        for _ in range(60):
            poll_response = requests_module.get(operation_url, headers=poll_headers, timeout=120)
            poll_response.raise_for_status()
            payload = poll_response.json()
            if payload.get("status") in {"succeeded", "failed", "canceled"}:
                return payload
            time.sleep(2)
        raise TimeoutError("Timed out waiting for Azure Document Intelligence result.")
