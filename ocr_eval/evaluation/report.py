from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from ocr_eval.evaluation.metrics import compare_texts
from ocr_eval.schemas import OCRResult


DETAIL_COLUMNS = [
    "invoice_id",
    "provider",
    "model",
    "character_accuracy",
    "word_accuracy",
    "number_accuracy",
    "special_character_accuracy",
    "table_text_preservation",
    "processing_time_seconds",
    "estimated_cost",
    "status",
    "error",
    "missing_word_count",
    "extra_word_count",
    "missing_number_count",
    "extra_number_count",
    "exact_text_match_percentage",
    "line_match_ratio",
    "line_count_delta",
    "page_count",
]

SUMMARY_COLUMNS = [
    "provider",
    "model",
    "invoice_count",
    "success_count",
    "api_failure_rate",
    "average_accuracy",
    "character_accuracy",
    "word_accuracy",
    "number_accuracy",
    "special_character_accuracy",
    "average_time_seconds",
    "average_cost",
    "final_rank",
]


def detail_row(result: OCRResult, reference_text: str | None) -> dict:
    row = {
        "invoice_id": result.invoice_id,
        "provider": result.provider,
        "model": result.model,
        "processing_time_seconds": result.processing_time_seconds,
        "estimated_cost": result.estimated_cost,
        "status": result.status,
        "error": result.error or "",
        "page_count": result.page_count or "",
    }

    if result.status != "success" or reference_text is None:
        row.update(
            {
                "character_accuracy": 0.0,
                "word_accuracy": 0.0,
                "number_accuracy": 0.0,
                "special_character_accuracy": 0.0,
                "table_text_preservation": 0.0,
                "missing_word_count": "",
                "extra_word_count": "",
                "missing_number_count": "",
                "extra_number_count": "",
                "exact_text_match_percentage": 0.0,
                "line_match_ratio": 0.0,
                "line_count_delta": "",
            }
        )
        return row

    metrics = compare_texts(reference_text, result.extracted_text)
    row.update(metrics)
    return row


def summarize(detail_rows: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for row in detail_rows:
        groups[(row["provider"], row["model"])].append(row)

    summaries = []
    for (provider, model), rows in groups.items():
        success_rows = [row for row in rows if row["status"] == "success"]
        invoice_count = len(rows)
        success_count = len(success_rows)
        failure_rate = 0.0 if invoice_count == 0 else (invoice_count - success_count) / invoice_count

        def avg(name: str) -> float:
            if not success_rows:
                return 0.0
            return sum(float(row.get(name) or 0) for row in success_rows) / len(success_rows)

        char_acc = avg("character_accuracy")
        word_acc = avg("word_accuracy")
        num_acc = avg("number_accuracy")
        special_acc = avg("special_character_accuracy")
        average_accuracy = (0.35 * char_acc) + (0.25 * word_acc) + (0.25 * num_acc) + (0.15 * special_acc)
        summary = {
            "provider": provider,
            "model": model,
            "invoice_count": invoice_count,
            "success_count": success_count,
            "api_failure_rate": failure_rate,
            "average_accuracy": average_accuracy,
            "character_accuracy": char_acc,
            "word_accuracy": word_acc,
            "number_accuracy": num_acc,
            "special_character_accuracy": special_acc,
            "average_time_seconds": avg("processing_time_seconds"),
            "average_cost": avg("estimated_cost"),
            "final_rank": "",
        }
        summaries.append(summary)

    summaries.sort(
        key=lambda row: (
            row["average_accuracy"],
            -row["api_failure_rate"],
            -row["average_time_seconds"],
        ),
        reverse=True,
    )
    for rank, summary in enumerate(summaries, start=1):
        summary["final_rank"] = rank
    return summaries


def write_csv(path: Path, rows: list[dict], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(_format_row(row))


def write_markdown_report(path: Path, detail_rows: list[dict], summary_rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = [
        "# OCR Model Comparison Report",
        "",
        "Scope: raw text extraction only. No invoice field extraction, JSON mapping, vendor identification, line-item parsing, LLM validation, or business-rule validation.",
        "",
        "## Overall Summary",
        "",
        _markdown_table(
            summary_rows,
            [
                "provider",
                "model",
                "average_accuracy",
                "number_accuracy",
                "average_time_seconds",
                "average_cost",
                "api_failure_rate",
                "final_rank",
            ],
        ),
        "",
        "## Invoice-Level Results",
        "",
        _markdown_table(
            detail_rows,
            [
                "invoice_id",
                "provider",
                "model",
                "character_accuracy",
                "word_accuracy",
                "number_accuracy",
                "special_character_accuracy",
                "processing_time_seconds",
                "estimated_cost",
                "status",
            ],
        ),
        "",
        "## How to Read This Report",
        "",
        "- Character and word accuracy are derived from edit distance against the manually verified ground truth.",
        "- Number accuracy is exact-token recall for number-like values, so decimal points, commas, slashes, hyphens, and leading zeros matter.",
        "- Special-character accuracy checks punctuation and symbols as a multiset, which helps catch invoice-critical errors like missing decimal points or hyphens.",
        "- Table-text preservation is a simple line-level recall for table-like rows. Treat it as a warning signal, not as a full table-structure score.",
        "- Final rank uses a starter weighting: 35% character accuracy, 25% word accuracy, 25% number accuracy, and 15% special-character accuracy. Review failures, cost, and speed before making a production decision.",
        "",
    ]
    path.write_text("\n".join(content), encoding="utf-8")


def _format_row(row: dict) -> dict:
    formatted = {}
    for key, value in row.items():
        if isinstance(value, float):
            formatted[key] = round(value, 6)
        else:
            formatted[key] = value
    return formatted


def _markdown_table(rows: list[dict], columns: list[str]) -> str:
    if not rows:
        return "_No rows yet._"
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join(["---"] * len(columns)) + " |"
    body = []
    for row in rows:
        values = []
        for column in columns:
            value = row.get(column, "")
            if isinstance(value, float):
                value = f"{value:.4f}"
            values.append(str(value).replace("\n", " "))
        body.append("| " + " | ".join(values) + " |")
    return "\n".join([header, separator, *body])
