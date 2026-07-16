# OCR Evaluation Metrics

This project compares raw OCR text against manually verified ground truth.

## Character Error Rate

Plain meaning: how many character edits are needed to turn OCR text into the correct text.

Formula:

```text
CER = levenshtein_distance(reference_characters, extracted_characters) / reference_character_count
Character Accuracy = 1 - CER
```

Example:

```python
from ocr_eval.evaluation.metrics import compare_texts

metrics = compare_texts("Total 12.50", "Total 1250")
print(metrics["character_accuracy"])
```

## Word Error Rate

Plain meaning: how many word-level insertions, deletions, or replacements are needed.

Formula:

```text
WER = levenshtein_distance(reference_words, extracted_words) / reference_word_count
Word Accuracy = 1 - WER
```

CER is better for tiny OCR mistakes. WER is better for missing or extra words.

## Exact Text-Match Percentage

Plain meaning: did the full extracted text match the verified text exactly after basic line-ending cleanup?

Formula:

```text
Exact Match = 100 if normalized_reference == normalized_extracted else 0
```

This is intentionally strict. Most real OCR outputs will not get 100.

## Missing and Extra Words

Plain meaning:

- Missing words are words present in ground truth but absent from OCR output.
- Extra words are words present in OCR output but absent from ground truth.

These are useful for spotting skipped invoice lines, repeated headers, or OCR noise.

## Number Accuracy

Plain meaning: of all number-like tokens in the ground truth, how many were reproduced exactly?

Examples of number-like tokens:

```text
001
05
12.50
1,234.00
12/24
2026-07-01
```

Formula:

```text
Number Accuracy = exact_matched_reference_number_tokens / reference_number_token_count
```

This metric is strict because invoices are sensitive to:

- decimal points
- commas
- leading zeros
- slashes
- hyphens
- quantities
- unit prices
- invoice numbers
- product codes

## Special-Character Accuracy

Plain meaning: how many punctuation and symbol characters from the ground truth appear in the OCR output?

Examples:

```text
. - / , $ : # %
```

Formula:

```text
Special-Character Accuracy = matched_reference_special_characters / reference_special_character_count
```

This catches mistakes like `12.50` becoming `1250` or `INV-001` becoming `INV001`.

## Table-Text Preservation

Plain meaning: did table-like rows survive as recognizable lines?

The POC marks a line as table-like if it has obvious column spacing, a pipe character, a tab, or several numbers.

Formula:

```text
Table-Text Preservation = matched_reference_table_like_lines / reference_table_like_line_count
```

This is a simple heuristic. It does not prove that table structure is correct, but it quickly flags providers that flatten or scramble line items.

## Processing Time

Wall-clock seconds spent inside the OCR adapter. It includes upload, provider processing, polling, and response parsing.

## Estimated Cost

Formula:

```text
Estimated Cost = page_count * provider_cost_per_page_from_env
```

Set the values in `.env`, for example:

```text
AZURE_DOCUMENT_INTELLIGENCE_COST_PER_PAGE=0.0015
AWS_TEXTRACT_COST_PER_PAGE=0.0015
```

Use current provider pricing when you run the test.

## API Failure Rate

Formula:

```text
API Failure Rate = failed_provider_calls / attempted_provider_calls
```

Track this separately from accuracy. A model that is accurate but fails on PDFs or multi-page files may still be a poor fit.
