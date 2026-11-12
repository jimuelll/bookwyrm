from app.generation.scope import clean_topic, count_limits, match_topic, measure
from app.ingestion.chunk import Chunk


def passage(n: int, text: str, tokens: int = 600) -> Chunk:
    return Chunk(id=f"c{n}", text=text, page_start=n, page_end=n, token_count=tokens, page_marks=((0, n),))


BOOK = [
    passage(1, "Mitochondria produce most of the ATP that a cell uses. The cell needs a steady supply."),
    passage(
        2, "Chloroplasts capture light. The light reactions happen in the thylakoid membranes of a cell."
    ),
    passage(3, "Osmosis moves water across a membrane. Each cell membrane is selectively permeable."),
    passage(4, "The nucleus stores the genetic material of the cell."),
]


def test_a_topic_finds_the_passages_that_mention_it_in_reading_order() -> None:
    assert [c.id for c in match_topic(BOOK, "membrane")] == ["c2", "c3"]


def test_plurals_and_endings_still_match() -> None:
    assert [c.id for c in match_topic(BOOK, "chloroplast")] == ["c2"]
    assert [c.id for c in match_topic(BOOK, "storing genetic materials")] == ["c4"]


def test_a_word_in_every_passage_does_not_drown_out_the_rare_one() -> None:
    # "cell" is in all four passages; "osmosis" is what tells them apart
    assert [c.id for c in match_topic(BOOK, "osmosis in the cell")] == ["c3"]


def test_a_topic_the_text_never_mentions_matches_nothing() -> None:
    assert match_topic(BOOK, "French Revolution") == []
    assert match_topic(BOOK, "the of and") == []  # nothing but filler words


def test_a_topic_is_tidied_before_it_is_stored_or_shown_to_a_model() -> None:
    assert clean_topic('  light\n\treactions "<b>" ') == "light reactions b"
    assert clean_topic("   ") is None
    assert len(clean_topic("x" * 500) or "") == 80


def test_more_material_suggests_and_allows_more_questions() -> None:
    assert count_limits(0, 20) == (0, 0)  # nothing in scope
    assert count_limits(60, 20) == (3, 3)  # a paragraph: three at most
    assert count_limits(600, 20) == (3, 15)  # one passage
    assert count_limits(1800, 20) == (6, 20)  # about four pages
    assert count_limits(60_000, 20) == (10, 20)  # a whole book: capped by the server's limit


def test_a_topic_narrows_what_is_measured() -> None:
    whole = measure(BOOK, hard_max=20)
    topic = measure(BOOK, topic="osmosis", hard_max=20)

    assert (whole.passages, whole.page_first, whole.page_last, whole.suggested) == (4, 1, 4, 8)
    assert (topic.passages, topic.page_first, topic.page_last, topic.suggested, topic.maximum) == (
        1,
        3,
        3,
        3,
        15,
    )
    assert measure(BOOK, topic="French Revolution", hard_max=20).maximum == 0
