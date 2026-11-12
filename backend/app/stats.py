"""What a reader's quizzes say about one PDF: which topics they know, which they don't, and how they score.

Three rules shape the numbers (docs/PRD.md 7.6, 7.8):

  * Only the first finished attempt at each quiz counts. "Take it again" is practice: counting retakes
    would let anyone raise a weak topic's score by memorising the same questions.
  * A topic needs a few answered questions before it is called weak or strong. One wrong answer out of
    one is 0%, but it is not evidence; so small samples are reported as "not enough yet".
  * Topics are the labels the question writer chose, merged ignoring case and spacing, so "Osmosis" and
    "osmosis" are one topic. (Merging different words for the same idea, "water transport" and
    "osmosis", would take embeddings; that is a later step.)

Everything here is plain functions over plain data, so the rules are easy to test without a database.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.quizzes import AnswerFact, AttemptRecord

# Thresholds in one place: they are judgment calls, meant to be tuned.
MIN_ANSWERS = 3  # fewer answers than this and a topic is "unrated"
WEAK_BELOW = 0.6  # under 60% right
STRONG_AT_LEAST = 0.8  # 80% or more right
PASS_MARK = 0.7  # a sitting passes at 70%

Level = Literal["weak", "learning", "strong", "unrated"]


@dataclass(frozen=True)
class TopicStat:
    topic: str  # as first written, for display
    right: int
    total: int
    pages: list[int]  # every page a question on this topic came from, sorted
    level: Level


def level_of(right: int, total: int) -> Level:
    if total < MIN_ANSWERS:
        return "unrated"
    share = right / total
    if share < WEAK_BELOW:
        return "weak"
    return "strong" if share >= STRONG_AT_LEAST else "learning"


def first_attempts(attempts: list[AttemptRecord]) -> list[AttemptRecord]:
    """The earliest finished attempt at each quiz, oldest first. Later ones are practice."""
    first: dict[UUID, AttemptRecord] = {}
    for attempt in sorted(attempts, key=lambda a: (a.finished_at is None, a.finished_at)):
        if attempt.finished_at is not None:
            first.setdefault(attempt.quiz_id, attempt)
    return sorted(first.values(), key=lambda a: a.finished_at or datetime.min)


@dataclass
class _Tally:
    topic: str
    right: int = 0
    total: int = 0
    pages: set[int] = field(default_factory=set)


def topic_stats(facts: list[AnswerFact]) -> list[TopicStat]:
    """Right and total per topic, weakest first (so "what to work on" reads from the top)."""
    tallies: dict[str, _Tally] = {}
    for fact in facts:
        label = " ".join(fact.topic.split())
        tally = tallies.setdefault(label.casefold(), _Tally(label))
        tally.total += 1
        tally.right += fact.is_correct
        tally.pages.add(fact.page)
    stats = [
        TopicStat(t.topic, t.right, t.total, sorted(t.pages), level_of(t.right, t.total))
        for t in tallies.values()
    ]
    # weakest share first; among equals, the topic with more evidence behind it
    return sorted(stats, key=lambda s: (s.right / s.total, -s.total, s.topic.casefold()))


def passing_rate(attempts: list[AttemptRecord]) -> float | None:
    """The share of counted attempts that reached the pass mark, or None if there are none yet."""
    if not attempts:
        return None
    passed = sum(1 for a in attempts if a.score is not None and a.total and a.score / a.total >= PASS_MARK)
    return passed / len(attempts)


# ---------- what the API sends ----------


class TopicOut(BaseModel):
    topic: str
    right: int
    total: int
    percent: int
    pages: list[int]
    level: Level


class SittingOut(BaseModel):
    quiz_id: UUID
    finished_at: datetime
    score: int
    total: int
    percent: int


class StatsOut(BaseModel):
    document_id: UUID
    document_title: str
    quizzes_taken: int  # first attempts counted
    passing_rate: float | None  # 0-1; null until a quiz has been taken
    weak: list[TopicOut]
    learning: list[TopicOut]
    strong: list[TopicOut]
    unrated: list[TopicOut]  # too few answers to say
    history: list[SittingOut]  # oldest first, for a score-over-time line


def _percent(right: int, total: int) -> int:
    return round(100 * right / total) if total else 0


def build_stats(
    document_id: UUID, document_title: str, attempts: list[AttemptRecord], facts: list[AnswerFact]
) -> StatsOut:
    """Everything the stats page shows, from a reader's finished attempts and the answers in them."""
    counted = first_attempts(attempts)
    counted_ids = {a.id for a in counted}
    topics = [
        TopicOut(
            topic=t.topic,
            right=t.right,
            total=t.total,
            percent=_percent(t.right, t.total),
            pages=t.pages,
            level=t.level,
        )
        for t in topic_stats([f for f in facts if f.attempt_id in counted_ids])
    ]
    return StatsOut(
        document_id=document_id,
        document_title=document_title,
        quizzes_taken=len(counted),
        passing_rate=passing_rate(counted),
        weak=[t for t in topics if t.level == "weak"],
        learning=[t for t in topics if t.level == "learning"],
        strong=[t for t in topics if t.level == "strong"],
        unrated=[t for t in topics if t.level == "unrated"],
        history=[
            SittingOut(
                quiz_id=a.quiz_id,
                finished_at=a.finished_at,
                score=a.score or 0,
                total=a.total,
                percent=_percent(a.score or 0, a.total),
            )
            for a in counted
        ],
    )
