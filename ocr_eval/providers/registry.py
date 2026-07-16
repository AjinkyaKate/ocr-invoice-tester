from typing import Dict

from .aws_textract import AwsTextractProvider
from .azure_document_intelligence import AzureDocumentIntelligenceProvider
from .gemini_flash import GeminiFlashProvider
from .google_vision import GoogleVisionProvider
from .mistral_ocr import MistralOcrProvider
from .ocr_space import OcrSpaceProvider
from .scrapegraph import ScrapeGraphProvider
from .tesseract_cli import TesseractCliProvider


def _providers() -> Dict[str, object]:
    providers = [
        OcrSpaceProvider(),
        AzureDocumentIntelligenceProvider(),
        GeminiFlashProvider(),
        GoogleVisionProvider(),
        AwsTextractProvider(),
        MistralOcrProvider(),
        ScrapeGraphProvider(),
        TesseractCliProvider(),
    ]
    aliases = {}
    for provider in providers:
        aliases[provider.provider_name] = provider
    aliases["azure"] = aliases["azure_document_intelligence"]
    aliases["gemini"] = aliases["gemini_flash"]
    aliases["gemini_flash_ocr"] = aliases["gemini_flash"]
    aliases["google"] = aliases["google_vision"]
    aliases["aws"] = aliases["aws_textract"]
    aliases["mistral"] = aliases["mistral_ocr"]
    aliases["sgai"] = aliases["scrapegraph"]
    aliases["tesseract"] = aliases["tesseract_cli"]
    return aliases


def available_providers() -> list[str]:
    return sorted(_providers().keys())


def get_provider(name: str):
    normalized = name.strip().lower()
    providers = _providers()
    if normalized not in providers:
        valid = ", ".join(available_providers())
        raise ValueError(f"Unknown OCR provider '{name}'. Valid providers: {valid}")
    return providers[normalized]
