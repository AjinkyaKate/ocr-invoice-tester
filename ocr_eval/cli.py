import argparse
import csv
import json
from pathlib import Path

from ocr_eval import extract_text
from ocr_eval.evaluation.report import (
    DETAIL_COLUMNS,
    SUMMARY_COLUMNS,
    detail_row,
    summarize,
    write_csv,
    write_markdown_report,
)
from ocr_eval.providers.registry import available_providers
from ocr_eval.schemas import OCRResult


def read_manifest(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def run_extract(args: argparse.Namespace) -> None:
    manifest_rows = read_manifest(Path(args.manifest))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    text_dir = Path(args.text_output_dir)
    text_dir.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as jsonl:
        for row in manifest_rows:
            invoice_id = row["invoice_id"]
            input_path = row["file_path"]
            if args.provider in {"mistral", "mistral_ocr"} and row.get("source_url"):
                input_path = row["source_url"]

            result = extract_text(
                file_path=input_path,
                provider=args.provider,
                model_name=args.model,
                invoice_id=invoice_id,
            )
            jsonl.write(json.dumps(result, ensure_ascii=False) + "\n")
            if result.get("status") == "success":
                safe_model = result["model"].replace("/", "_").replace(" ", "_")
                text_path = text_dir / f"{invoice_id}__{result['provider']}__{safe_model}.txt"
                text_path.write_text(result["extracted_text"], encoding="utf-8")
            print(f"{invoice_id}: {result['provider']} {result['model']} {result['status']}")

    print(f"Wrote OCR results to {output_path}")


def run_evaluate(args: argparse.Namespace) -> None:
    manifest_rows = read_manifest(Path(args.manifest))
    references = {}
    for row in manifest_rows:
        truth_path = Path(row["ground_truth_path"])
        references[row["invoice_id"]] = truth_path.read_text(encoding="utf-8") if truth_path.exists() else None

    results = []
    for path_text in args.ocr_results:
        with Path(path_text).open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    results.append(OCRResult.from_dict(json.loads(line)))

    detail_rows = [detail_row(result, references.get(result.invoice_id)) for result in results]
    summary_rows = summarize(detail_rows)
    out_dir = Path(args.out_dir)
    write_csv(out_dir / "detailed_results.csv", detail_rows, DETAIL_COLUMNS)
    write_csv(out_dir / "provider_summary.csv", summary_rows, SUMMARY_COLUMNS)
    write_markdown_report(out_dir / "comparison_report.md", detail_rows, summary_rows)

    print(f"Wrote detailed CSV to {out_dir / 'detailed_results.csv'}")
    print(f"Wrote summary CSV to {out_dir / 'provider_summary.csv'}")
    print(f"Wrote report to {out_dir / 'comparison_report.md'}")


def run_list_providers(_: argparse.Namespace) -> None:
    for provider in available_providers():
        print(provider)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OCR provider comparison POC")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list-providers", help="Show available provider adapter names")
    list_parser.set_defaults(func=run_list_providers)

    extract_parser = subparsers.add_parser("extract", help="Run one OCR provider over the invoice manifest")
    extract_parser.add_argument("--manifest", default="data/manifest.csv")
    extract_parser.add_argument("--provider", required=True)
    extract_parser.add_argument("--model", default=None)
    extract_parser.add_argument("--output", default="outputs/ocr_results.jsonl")
    extract_parser.add_argument("--text-output-dir", default="outputs/ocr_text")
    extract_parser.set_defaults(func=run_extract)

    evaluate_parser = subparsers.add_parser("evaluate", help="Compare OCR JSONL output against ground truth")
    evaluate_parser.add_argument("--manifest", default="data/manifest.csv")
    evaluate_parser.add_argument("--ocr-results", nargs="+", required=True)
    evaluate_parser.add_argument("--out-dir", default="outputs/evaluation")
    evaluate_parser.set_defaults(func=run_evaluate)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
