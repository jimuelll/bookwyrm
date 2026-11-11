import pytest

from app.ingestion.chunk import chunk_pages, clean_text, split_sentences
from app.ingestion.extract import Page


def sentences(n: int, prefix: str = "Fact") -> str:
    # each sentence is 8 words, about 11 estimated tokens
    return " ".join(f"{prefix} number {i} is a short true statement here." for i in range(n))


def test_joins_words_hyphenated_across_a_line_break() -> None:
    assert (
        clean_text("Light drives photo-\nsynthesis   in\nplants.") == "Light drives photosynthesis in plants."
    )


def test_splits_after_sentence_endings() -> None:
    assert split_sentences("Cells divide. Do they grow? Yes! 3 phases exist.") == [
        "Cells divide.",
        "Do they grow?",
        "Yes!",
        "3 phases exist.",
    ]


def test_never_cuts_a_sentence_in_half() -> None:
    chunks = chunk_pages([Page(1, sentences(60))], target_tokens=60, max_tokens=80, overlap_tokens=12)

    assert len(chunks) > 1
    for c in chunks:
        assert c.text.startswith("Fact number")
        assert c.text.endswith("statement here.")


def test_respects_the_maximum_size() -> None:
    chunks = chunk_pages([Page(1, sentences(60))], target_tokens=60, max_tokens=80, overlap_tokens=12)
    assert all(c.token_count <= 80 for c in chunks)


def test_consecutive_chunks_overlap_by_a_sentence() -> None:
    first, second, *_ = chunk_pages(
        [Page(1, sentences(30))], target_tokens=60, max_tokens=80, overlap_tokens=12
    )
    last_sentence_of_first = first.text.rsplit(". ", 1)[-1]
    assert second.text.startswith(last_sentence_of_first.removesuffix("."))


def test_records_the_exact_page_inside_a_chunk_that_spans_pages() -> None:
    pages = [Page(4, "Glycolysis happens in the cytoplasm."), Page(5, "The Krebs cycle runs in the matrix.")]

    (chunk,) = chunk_pages(pages)

    assert (chunk.page_start, chunk.page_end) == (4, 5)
    assert chunk.page_at(chunk.text.index("Glycolysis")) == 4
    assert chunk.page_at(chunk.text.index("Krebs")) == 5


def test_trims_a_chunk_to_a_page_range() -> None:
    pages = [Page(4, "Glycolysis happens in the cytoplasm."), Page(5, "The Krebs cycle runs in the matrix.")]
    (chunk,) = chunk_pages(pages)

    trimmed = chunk.within(5, 9)

    assert trimmed is not None
    assert trimmed.text == "The Krebs cycle runs in the matrix."
    assert trimmed.page_at(0) == 5
    assert chunk.within(6, 9) is None


def test_skips_pages_without_text() -> None:
    chunks = chunk_pages([Page(1, ""), Page(2, "Enzymes lower activation energy.")])
    assert [(c.page_start, c.page_end) for c in chunks] == [(2, 2)]


def test_rejects_overlap_as_large_as_the_target() -> None:
    with pytest.raises(ValueError):
        chunk_pages([Page(1, "Text.")], target_tokens=50, max_tokens=80, overlap_tokens=50)
