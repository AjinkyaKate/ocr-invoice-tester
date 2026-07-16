import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ocr_eval.config import env
from ocr_eval.schemas import OCRResult

from .base import OCRProvider


class TesseractCliProvider(OCRProvider):
    provider_name = "tesseract_cli"
    default_model = "eng"

    def extract(
        self,
        file_path: str,
        invoice_id: str,
        model_name: Optional[str] = None,
    ) -> OCRResult:
        started_at = self.start_timer()
        path = Path(file_path)
        if not path.exists():
            return self.failure(invoice_id, model_name, started_at, f"File not found: {file_path}")
        if path.suffix.lower() == ".pdf":
            return self.failure(
                invoice_id,
                model_name,
                started_at,
                "Tesseract CLI adapter supports image files only. Convert PDFs to images first or use a cloud PDF adapter.",
            )
        if not shutil.which("tesseract"):
            return self.failure(invoice_id, model_name, started_at, "System binary not found: tesseract")

        try:
            lang = model_name or env("TESSERACT_LANG", self.default_model)
            extra_args = shlex.split(env("TESSERACT_EXTRA_ARGS", "") or "")
            command = ["tesseract", str(path), "stdout", "-l", lang, *extra_args]
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
            if completed.returncode != 0:
                return self.failure(invoice_id, lang, started_at, completed.stderr.strip())
            return OCRResult(
                invoice_id=invoice_id,
                provider=self.provider_name,
                model=lang,
                extracted_text=completed.stdout.strip(),
                processing_time_seconds=self.elapsed(started_at),
                estimated_cost=0.0,
                status="success",
                error=None,
                page_count=1,
            )
        except Exception as exc:
            return self.failure(invoice_id, model_name, started_at, str(exc))
