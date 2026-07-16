from pathlib import Path
from typing import Optional

from ocr_eval.config import env, env_float
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class AwsTextractProvider(OCRProvider):
    provider_name = "aws_textract"
    default_model = "DetectDocumentText"

    def extract(
        self,
        file_path: str,
        invoice_id: str,
        model_name: Optional[str] = None,
    ) -> OCRResult:
        started_at = self.start_timer()
        try:
            import boto3
        except ImportError:
            return self.failure(invoice_id, model_name, started_at, "Install boto3 to use AWS Textract.")

        path = Path(file_path)
        if not path.exists():
            return self.failure(invoice_id, model_name, started_at, f"File not found: {file_path}")

        try:
            region = env("AWS_REGION", "us-east-1")
            client = boto3.client("textract", region_name=region)
            response = client.detect_document_text(Document={"Bytes": path.read_bytes()})
            line_blocks = [
                block.get("Text", "")
                for block in response.get("Blocks", [])
                if block.get("BlockType") == "LINE" and block.get("Text")
            ]
            page_count = max(1, int((response.get("DocumentMetadata") or {}).get("Pages") or 1))
            cost = env_float("AWS_TEXTRACT_COST_PER_PAGE") * page_count
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=model_name or self.default_model,
                extracted_text="\n".join(line_blocks),
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=round(cost, 6),
                status="success",
                error=None,
                page_count=page_count,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))
