"""What the quizzes say about a PDF: the rules in app/stats.py, as plain data in and plain data out."""

import uuid
from datetime import UTC, datetime
from uuid import UUID

from app.quizzes import AnswerFact, AttemptRecord
from app.stats import (
    MIN_ANSWERS,
    build_stats,
    first_attempts,
    level_of,
    passing_rate,
    topic_stats,
)

DOC = uuid.uuid4()


def attempt(quiz: UUID, minute: int, score: int | None, total: int = 4) -> AttemptRecord:
    finished = None if score is None else datetime(2026, 11, 12, 10, minute, tzinfo=UTC)
    return AttemptRecord(
        id=uuid.uuid4(),
        quiz_id=quiz,
        user_id="u",
        question_order=[],
        option_order={},
        total=total,
        score=score,
        started_at=datetime(2026, 11, 12, 9, 0, tzinfo=UTC),
        finished_at=finished,
    )


def fact(attempt: AttemptRecord, topic: str, ok: bool, page: int = 1) -> AnswerFact:
    return AnswerFact(attempt.id, topic, page, ok)


# --- levels ---


def test_a_topic_needs_a_few_answers_before_it_is_called_anything() -> None:
    assert level_of(0, MIN_ANSWERS - 1) == "unrated"  # 0 of 2 is not evidence
    assert level_of(0, MIN_ANSWERS) == "weak"


def test_the_thresholds_sit_where_the_rules_say() -> None:
    assert level_of(5, 10) == "weak"  # 50%
    assert level_of(6, 10) == "learning"  # 60%: not below the weak line
    assert level_of(7, 10) == "learning"
    assert level_of(8, 10) == "strong"  # 80%: at the strong line
    assert level_of(10, 10) == "strong"


# --- only the first attempt at a quiz counts ---


def test_a_retake_does_not_count_only_the_first_attempt_at_each_quiz() -> None:
    quiz_a, quiz_b = uuid.uuid4(), uuid.uuid4()
    first_a, retake_a, only_b = attempt(quiz_a, 5, 1), attempt(quiz_a, 30, 4), attempt(quiz_b, 15, 3)

    # given out of order, the earliest per quiz wins, and the result is oldest first
    assert first_attempts([retake_a, only_b, first_a]) == [first_a, only_b]


def test_an_attempt_that_was_never_submitted_counts_for_nothing() -> None:
    quiz = uuid.uuid4()
    unfinished, finished = attempt(quiz, 0, None), attempt(quiz, 20, 2)

    assert first_attempts([unfinished, finished]) == [finished]  # not mistaken for "the first"


def test_the_passing_rate_is_the_share_of_attempts_at_the_pass_mark() -> None:
    assert passing_rate([]) is None
    quiz = uuid.uuid4()
    assert passing_rate([attempt(quiz, 1, 3, 4), attempt(quiz, 2, 2, 4)]) == 0.5  # 75% passes, 50% does not


# --- topics ---


def test_topics_differing_only_in_case_or_spacing_are_one_topic() -> None:
    a = attempt(uuid.uuid4(), 1, 2)
    stats = topic_stats(
        [fact(a, "Osmosis", False, 31), fact(a, "osmosis ", True, 33), fact(a, "  OSMOSIS", True, 31)]
    )

    assert len(stats) == 1
    assert (stats[0].topic, stats[0].right, stats[0].total, stats[0].pages) == ("Osmosis", 2, 3, [31, 33])


def test_the_weakest_topic_comes_first() -> None:
    a = attempt(uuid.uuid4(), 1, 2)
    facts = (
        [fact(a, "ATP", True)] * 3
        + [fact(a, "Osmosis", False)] * 3
        + [fact(a, "DNA", True), fact(a, "DNA", False)]
    )

    assert [t.topic for t in topic_stats(facts)] == ["Osmosis", "DNA", "ATP"]


# --- the whole picture ---


def test_building_the_stats_counts_first_attempts_only_and_sorts_topics_into_levels() -> None:
    quiz = uuid.uuid4()
    first, retake = attempt(quiz, 5, 1), attempt(quiz, 40, 4)
    facts = (
        [fact(first, "Osmosis", False, 31)] * 3  # weak on the first attempt
        + [fact(first, "ATP", True, 12)] * 3  # strong
        + [fact(first, "DNA", False, 40)]  # one answer: too few to say
        + [fact(retake, "Osmosis", True, 31)]
        * 3  # the retake would make osmosis look fixed; it must not count
    )

    stats = build_stats(DOC, "Cell Biology", [retake, first], facts)

    assert (stats.quizzes_taken, stats.passing_rate) == (1, 0.0)  # 1 of 4 on the first attempt
    assert [(t.topic, t.percent, t.pages) for t in stats.weak] == [("Osmosis", 0, [31])]
    assert [t.topic for t in stats.strong] == ["ATP"]
    assert [t.topic for t in stats.unrated] == ["DNA"]
    assert stats.learning == []
    assert [(h.quiz_id, h.score, h.percent) for h in stats.history] == [(quiz, 1, 25)]


def test_a_reader_with_no_quizzes_taken_gets_an_empty_but_valid_picture() -> None:
    stats = build_stats(DOC, "Cell Biology", [], [])

    assert (stats.quizzes_taken, stats.passing_rate, stats.history) == (0, None, [])
    assert stats.weak == stats.strong == stats.learning == stats.unrated == []
