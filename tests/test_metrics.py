from ocr_eval.evaluation.metrics import compare_texts, levenshtein_distance, number_tokens


def test_levenshtein_distance_basic():
    assert levenshtein_distance("kitten", "sitting") == 3


def test_number_tokens_preserve_invoice_critical_punctuation():
    text = "INV-001 amount 1,234.50 qty 05 ref 12/24"
    assert number_tokens(text) == ["001", "1,234.50", "05", "12/24"]


def test_compare_texts_scores_numbers_and_special_chars():
    reference = "Item A-01\nQty 05\nTotal $1,234.50"
    extracted = "Item A-01\nQty 5\nTotal $1234.50"
    metrics = compare_texts(reference, extracted)
    assert metrics["character_accuracy"] < 1.0
    assert metrics["number_accuracy"] < 1.0
    assert metrics["special_character_accuracy"] < 1.0
