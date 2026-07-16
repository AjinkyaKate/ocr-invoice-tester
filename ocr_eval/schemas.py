from dataclasses import asdict, dataclass
from typing import Optional


@dataclass
class OCRResult:
    invoice_id: str
    provider: str
    model: str
    extracted_text: str
    processing_time_seconds: float
    estimated_cost: float
    status: str
    error: Optional[str] = None
    page_count: Optional[int] = None
    metadata: Optional[dict] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "OCRResult":
        return cls(
            invoice_id=str(data.get("invoice_id", "")),
            provider=str(data.get("provider", "")),
            model=str(data.get("model", "")),
            extracted_text=str(data.get("extracted_text", "")),
            processing_time_seconds=float(data.get("processing_time_seconds") or 0),
            estimated_cost=float(data.get("estimated_cost") or 0),
            status=str(data.get("status", "error")),
            error=data.get("error"),
            page_count=data.get("page_count"),
            metadata=data.get("metadata"),
        )
