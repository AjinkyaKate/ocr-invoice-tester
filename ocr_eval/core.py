from pathlib import Path
from typing import Optional, Union

from .providers.registry import get_provider


def extract_text(
    file_path: Union[str, Path],
    provider: str,
    model_name: Optional[str] = None,
    invoice_id: Optional[str] = None,
) -> dict:
    """Provider-independent OCR entrypoint.

    The returned dictionary follows the common OCR result schema used by the
    evaluator and report generator.
    """
    file_value = str(file_path)
    inferred_invoice_id = invoice_id or Path(file_value).stem
    adapter = get_provider(provider)
    result = adapter.extract(
        file_path=file_value,
        invoice_id=inferred_invoice_id,
        model_name=model_name,
    )
    return result.to_dict()
