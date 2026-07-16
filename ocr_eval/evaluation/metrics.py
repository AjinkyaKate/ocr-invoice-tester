from collections import Counter
import re
from typing import Iterable, Sequence


WORD_RE = re.compile(r"[A-Za-z0-9]+(?:[./-][A-Za-z0-9]+)*")
NUMBER_RE = re.compile(r"(?<![A-Za-z0-9])[-+]?\d[\d,]*(?:\.\d+)?(?:[/.-]\d+)*(?![A-Za-z0-9])")
SPECIAL_RE = re.compile(r"[^\w\s]", re.UNICODE)


def normalize_line_endings(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def normalize_for_distance(text: str) -> str:
    text = normalize_line_endings(text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_for_exact_match(text: str) -> str:
    text = normalize_line_endings(text)
    lines = [line.rstrip() for line in text.strip().split("\n")]
    return "\n".join(lines)


def levenshtein_distance(a: Sequence, b: Sequence) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    previous = list(range(len(b) + 1))
    for i, item_a in enumerate(a, start=1):
        current = [i]
        for j, item_b in enumerate(b, start=1):
            insert_cost = current[j - 1] + 1
            delete_cost = previous[j] + 1
            replace_cost = previous[j - 1] + (item_a != item_b)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]


def error_rate(reference: Sequence, candidate: Sequence) -> float:
    if not reference:
        return 0.0 if not candidate else 1.0
    return levenshtein_distance(reference, candidate) / len(reference)


def accuracy_from_error_rate(rate: float) -> float:
    return max(0.0, 1.0 - rate)


def word_tokens(text: str) -> list[str]:
    return [token.casefold() for token in WORD_RE.findall(text)]


def distance_word_tokens(text: str) -> list[str]:
    return normalize_for_distance(text).split()


def number_tokens(text: str) -> list[str]:
    return NUMBER_RE.findall(text)


def special_tokens(text: str) -> list[str]:
    return SPECIAL_RE.findall(text)


def multiset_recall(reference_tokens: Iterable[str], candidate_tokens: Iterable[str]) -> float:
    reference_counter = Counter(reference_tokens)
    if not reference_counter:
        return 1.0
    candidate_counter = Counter(candidate_tokens)
    matched = sum((reference_counter & candidate_counter).values())
    return matched / sum(reference_counter.values())


def missing_extra_counts(reference_tokens: Iterable[str], candidate_tokens: Iterable[str]) -> tuple[int, int]:
    reference_counter = Counter(reference_tokens)
    candidate_counter = Counter(candidate_tokens)
    missing = sum((reference_counter - candidate_counter).values())
    extra = sum((candidate_counter - reference_counter).values())
    return missing, extra


def normalized_lines(text: str) -> list[str]:
    lines = []
    for line in normalize_line_endings(text).split("\n"):
        normalized = re.sub(r"\s+", " ", line).strip()
        if normalized:
            lines.append(normalized)
    return lines


def table_like_lines(text: str) -> list[str]:
    candidates = []
    for raw_line in normalize_line_endings(text).split("\n"):
        line = raw_line.rstrip()
        normalized = re.sub(r"\s+", " ", line).strip()
        if not normalized:
            continue
        has_columns = "\t" in line or "|" in line or bool(re.search(r"\S+\s{2,}\S+", line))
        has_many_numbers = len(number_tokens(line)) >= 3
        if has_columns or has_many_numbers:
            candidates.append(normalized)
    return candidates


def compare_texts(reference_text: str, extracted_text: str) -> dict:
    reference_distance_text = normalize_for_distance(reference_text)
    extracted_distance_text = normalize_for_distance(extracted_text)

    reference_words = distance_word_tokens(reference_text)
    extracted_words = distance_word_tokens(extracted_text)
    reference_word_bag = word_tokens(reference_text)
    extracted_word_bag = word_tokens(extracted_text)
    missing_words, extra_words = missing_extra_counts(reference_word_bag, extracted_word_bag)

    reference_numbers = number_tokens(reference_text)
    extracted_numbers = number_tokens(extracted_text)
    missing_numbers, extra_numbers = missing_extra_counts(reference_numbers, extracted_numbers)

    reference_specials = special_tokens(reference_text)
    extracted_specials = special_tokens(extracted_text)

    ref_lines = normalized_lines(reference_text)
    out_lines = normalized_lines(extracted_text)
    matching_lines = sum(1 for line in ref_lines if line in set(out_lines))
    ref_table_lines = table_like_lines(reference_text)
    out_table_lines = set(table_like_lines(extracted_text))
    matching_table_lines = sum(1 for line in ref_table_lines if line in out_table_lines)

    character_error_rate = error_rate(reference_distance_text, extracted_distance_text)
    word_error_rate = error_rate(reference_words, extracted_words)

    exact_match = normalize_for_exact_match(reference_text) == normalize_for_exact_match(extracted_text)
    number_accuracy = multiset_recall(reference_numbers, extracted_numbers)
    special_character_accuracy = multiset_recall(reference_specials, extracted_specials)
    line_match_ratio = 1.0 if not ref_lines else matching_lines / len(ref_lines)
    table_text_preservation = 1.0 if not ref_table_lines else matching_table_lines / len(ref_table_lines)

    return {
        "character_error_rate": character_error_rate,
        "character_accuracy": accuracy_from_error_rate(character_error_rate),
        "word_error_rate": word_error_rate,
        "word_accuracy": accuracy_from_error_rate(word_error_rate),
        "exact_text_match_percentage": 100.0 if exact_match else 0.0,
        "missing_word_count": missing_words,
        "extra_word_count": extra_words,
        "number_accuracy": number_accuracy,
        "missing_number_count": missing_numbers,
        "extra_number_count": extra_numbers,
        "special_character_accuracy": special_character_accuracy,
        "line_match_ratio": line_match_ratio,
        "reference_line_count": len(ref_lines),
        "extracted_line_count": len(out_lines),
        "line_count_delta": len(out_lines) - len(ref_lines),
        "table_text_preservation": table_text_preservation,
        "reference_table_like_line_count": len(ref_table_lines),
    }
