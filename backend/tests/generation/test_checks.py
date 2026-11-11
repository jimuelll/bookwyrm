from app.generation.checks import find_evidence, is_near_duplicate
from app.ingestion.chunk import Chunk, chunk_pages
from app.ingestion.extract import Page

TEXT = (
    "The inner membrane is folded into cristae. These folds greatly increase the surface area "
    "available for the electron transport chain."
)


def chunk() -> Chunk:
    (c,) = chunk_pages([Page(142, TEXT)])
    return c


def test_finds_an_exact_quote() -> None:
    offset = find_evidence("These folds greatly increase the surface area", chunk())
    assert offset == TEXT.index("These folds")


def test_forgives_case_and_spacing() -> None:
    assert find_evidence("these  folds GREATLY increase the surface area", chunk()) is not None


def test_forgives_a_small_slip_like_a_dropped_word() -> None:
    assert find_evidence("These folds greatly increase surface area available for the", chunk()) is not None


def test_rejects_a_quote_the_passage_does_not_contain() -> None:
    assert find_evidence("Mitochondria are found only in plant cells and fungi.", chunk()) is None


def test_rejects_a_quote_too_short_to_prove_anything() -> None:
    assert find_evidence("the cristae", chunk()) is None


def test_near_duplicate_catches_light_rewording_but_not_a_new_question() -> None:
    accepted = ["What increases the surface area of the inner membrane?"]
    assert is_near_duplicate("What increases the surface area of the inner membrane ?", accepted)
    assert not is_near_duplicate("Where does glycolysis take place?", accepted)
