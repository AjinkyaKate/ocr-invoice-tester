import time
from abc import ABC, abstractmethod
from typing import Optional

from ocr_eval.schemas import OCRResult


class OCRProvider(ABC):
    provider_name: str
    default_model: str

    @abstractmethod
    def extract(
        self,
        file_path: str,
        invoice_id: str,
        model_name: Optional[str] = None,
    ) -> OCRResult:
        raise NotImplementedError

    def start_timer(self) -> float:
        return time.perf_counter()

    def elapsed(self, started_at: float) -> float:
        return round(time.perf_counter() - started_at, 4)

    def failure(
        self,
        invoice_id: str,
        model_name: Optional[str],
        started_at: float,
        error: str,
    ) -> OCRResult:
        return OCRResult(
            invoice_id=invoice_id,
            provider=self.provider_name,
            model=model_name or self.default_model,
            extracted_text="",
            processing_time_seconds=self.elapsed(started_at),
            estimated_cost=0.0,
            status="error",
            error=error,
        )
