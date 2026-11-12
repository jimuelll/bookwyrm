"""Quizzes: writing one from a stored document, sitting it, and grading it.

The flow (docs/ARCHITECTURE.md 4.3, 4.4):
  POST /documents/{id}/quizzes   create the quiz row (status=generating), answer 202
  background                     the document's passages -> generate_quiz() -> save the questions -> ready
                                 (or failed, with a message for the reader). The browser polls the quiz.
  POST /quizzes/{id}/attempts    start a sitting: the questions and each one's options are shuffled, and
                                 that order is stored on the attempt
  POST /attempts/{id}/submit     grade every answer, store them with the score, return the results

Two rules shape most of this file:
  * The set of questions is fixed once written; only the order changes between sittings.
  * The correct answer never leaves the server before the attempt is submitted. Until then the API sends
    prompts and options only, so nothing in the browser (or its network tab) can give it away.
"""

import logging
import random
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol, TypedDict
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import AnswerRow, Attempt, ChunkRow, QuestionRow, Quiz
from app.documents import DocumentStore, chunk_label
from app.generation.pipeline import GenerationError, Progress, QuizConfig, generate_quiz
from app.generation.schemas import Difficulty, Question
from app.generation.scope import Scope, clean_topic
from app.providers.base import LLMProvider, ProviderError
from app.providers.factory import build_provider

log = logging.getLogger(__name__)

QuizStatus = Literal["generating", "ready", "failed"]
# The types a program can mark by itself. Short answers need a model to judge them (4.3, "Short-answer
# grading"), so they wait until that grading call exists.
ObjectiveType = Literal["mcq", "true_false", "fill_blank"]
OPTION_IDS = "abcd"
RESPONSE_MAX = 500


class Option(TypedDict):
    id: str
    text: str


@dataclass(frozen=True)
class QuizRecord:
    id: UUID
    user_id: str
    document_id: UUID
    config: dict[str, Any]  # as asked for: count, difficulty, types, pages
    status: QuizStatus
    error: str | None
    question_count: int  # how many passed the checks; can be fewer than asked for
    created_at: datetime


@dataclass(frozen=True)
class QuestionRecord:
    id: UUID
    quiz_id: UUID
    ordinal: int
    type: str
    prompt: str
    options: list[Option] | None
    answer: str
    explanation: str
    topic: str
    difficulty: str
    page: int
    evidence: str


@dataclass(frozen=True)
class AttemptRecord:
    id: UUID
    quiz_id: UUID
    user_id: str
    question_order: list[str]
    option_order: dict[str, list[str]]
    total: int
    score: int | None
    started_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True)
class Graded:
    question_id: UUID
    response: str | None
    is_correct: bool


# ---------- pure rules: no database, no network ----------


def stored_config(config: QuizConfig) -> dict[str, Any]:
    return {
        "count": config.count,
        "difficulty": config.difficulty,
        "types": list(config.types),
        "pages": list(config.pages) if config.pages else None,
        "topic": config.topic,
    }


def quiz_config(stored: dict[str, Any]) -> QuizConfig:
    pages = stored.get("pages")
    return QuizConfig(
        count=int(stored["count"]),
        difficulty=stored["difficulty"],
        types=tuple(stored["types"]),
        pages=(int(pages[0]), int(pages[1])) if pages else None,
        topic=stored.get("topic"),  # .get: quizzes written before topics existed have no such key
    )


def question_columns(q: Question) -> dict[str, Any]:
    """A checked question as the `questions` table keeps it. Options get ids here, once, for good."""
    options: list[Option] | None = None
    if q.type == "mcq" and q.options:
        options = [Option(id=OPTION_IDS[i], text=text) for i, text in enumerate(q.options)]
    return {
        "type": q.type,
        "prompt": q.prompt,
        "options": options,
        "answer": q.answer,
        "explanation": q.explanation,
        "topic": q.topic,
        "difficulty": q.difficulty,
        "page": q.page,
        "evidence": q.evidence,
    }


def shuffled_orders(
    questions: list[QuestionRecord], rng: random.Random | None = None
) -> tuple[list[str], dict[str, list[str]]]:
    """A fresh order for one sitting: the questions, and each multiple-choice question's options.

    Models tend to put the right answer in the same slot (often first), and a retake in the same order
    tests memory of positions rather than of the material. Shuffling per attempt removes both.
    """
    rng = rng or random.Random()
    question_order = [str(q.id) for q in questions]
    rng.shuffle(question_order)
    option_order: dict[str, list[str]] = {}
    for q in questions:
        if q.options:
            ids = [o["id"] for o in q.options]
            rng.shuffle(ids)
            option_order[str(q.id)] = ids
    return question_order, option_order


def _plain(text: str) -> str:
    """For comparing typed answers: 'Chlorophyll.' and ' chlorophyll' are the same answer."""
    folded = unicodedata.normalize("NFKC", text).casefold()
    return " ".join(folded.split()).strip(" .,;:!?\"'")


def correct_option_id(question: QuestionRecord) -> str | None:
    return next((o["id"] for o in question.options or [] if o["text"] == question.answer), None)


def grade(question: QuestionRecord, response: str | None) -> bool:
    """Is this response right? Deterministic: the same answer always gets the same mark.

    Multiple choice is compared by option id, never by position or by the text the browser showed, so
    the shuffle can't affect the mark and the browser can't send a "right-looking" string.
    """
    if response is None:
        return False
    if question.type == "mcq":
        return response == correct_option_id(question)
    return _plain(response) == _plain(question.answer)


# ---------- the tables ----------


class QuizStore(Protocol):
    async def create(self, *, user_id: str, document_id: UUID, config: dict[str, Any]) -> QuizRecord: ...
    async def get(self, user_id: str, quiz_id: UUID) -> QuizRecord | None: ...
    async def list_for(self, user_id: str) -> list[QuizRecord]: ...
    async def generating_count(self, user_id: str) -> int: ...

    async def finish(self, quiz_id: UUID, questions: list[Question]) -> bool:
        """Save the questions and mark the quiz ready. False if the quiz is gone (its PDF was removed)."""
        ...

    async def fail(self, quiz_id: UUID, error: str) -> bool: ...
    async def fail_unfinished(self, message: str) -> int: ...
    async def questions(self, quiz_id: UUID) -> list[QuestionRecord]: ...

    async def start_attempt(
        self,
        *,
        user_id: str,
        quiz_id: UUID,
        question_order: list[str],
        option_order: dict[str, list[str]],
    ) -> AttemptRecord: ...

    async def get_attempt(self, user_id: str, attempt_id: UUID) -> AttemptRecord | None: ...

    async def submit(self, attempt_id: UUID, graded: list[Graded]) -> AttemptRecord | None:
        """Store the answers and the score. None if this attempt was already submitted."""
        ...

    async def answers(self, attempt_id: UUID) -> dict[UUID, Graded]: ...


def _quiz(row: Quiz, question_count: int) -> QuizRecord:
    return QuizRecord(
        id=row.id,
        user_id=str(row.user_id),
        document_id=row.document_id,
        config=row.config,
        status=row.status,  # type: ignore[arg-type]  # the CHECK constraint keeps it one of QuizStatus
        error=row.error,
        question_count=question_count,
        created_at=row.created_at,
    )


def _question(row: QuestionRow) -> QuestionRecord:
    return QuestionRecord(
        id=row.id,
        quiz_id=row.quiz_id,
        ordinal=row.ordinal,
        type=row.type,
        prompt=row.prompt,
        options=row.options,
        answer=row.answer,
        explanation=row.explanation,
        topic=row.topic,
        difficulty=row.difficulty,
        page=row.page,
        evidence=row.evidence,
    )


def _attempt(row: Attempt) -> AttemptRecord:
    return AttemptRecord(
        id=row.id,
        quiz_id=row.quiz_id,
        user_id=str(row.user_id),
        question_order=list(row.question_order),
        option_order=dict(row.option_order),
        total=row.total,
        score=row.score,
        started_at=row.started_at,
        finished_at=row.finished_at,
    )


class SqlQuizStore:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def create(self, *, user_id: str, document_id: UUID, config: dict[str, Any]) -> QuizRecord:
        row = Quiz(id=uuid4(), user_id=UUID(user_id), document_id=document_id, config=config)
        async with self._sessions() as session, session.begin():
            session.add(row)
            await session.flush()  # send the INSERT now...
            await session.refresh(row)  # ...and read back what the database filled in (created_at)
        return _quiz(row, 0)

    # A quiz with how many questions it has, in one query: LEFT JOIN so a quiz with none still appears.
    _with_count = (
        select(Quiz, func.count(QuestionRow.id))
        .outerjoin(QuestionRow, QuestionRow.quiz_id == Quiz.id)
        .group_by(Quiz.id)
    )

    async def get(self, user_id: str, quiz_id: UUID) -> QuizRecord | None:
        async with self._sessions() as session:
            # filtering by owner in the query itself: someone else's quiz is simply not found
            found = (
                await session.execute(
                    self._with_count.where(Quiz.id == quiz_id, Quiz.user_id == UUID(user_id))
                )
            ).first()
            return _quiz(found[0], found[1]) if found else None

    async def list_for(self, user_id: str) -> list[QuizRecord]:
        async with self._sessions() as session:
            rows = await session.execute(
                self._with_count.where(Quiz.user_id == UUID(user_id)).order_by(
                    Quiz.created_at.desc(), Quiz.id
                )
            )
            return [_quiz(quiz, count) for quiz, count in rows]

    async def generating_count(self, user_id: str) -> int:
        async with self._sessions() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(Quiz)
                .where(Quiz.user_id == UUID(user_id), Quiz.status == "generating")
            )
            return int(count or 0)

    async def finish(self, quiz_id: UUID, questions: list[Question]) -> bool:
        # One transaction: either every question is saved and the quiz is ready, or nothing changed.
        async with self._sessions() as session, session.begin():
            quiz = await session.get(Quiz, quiz_id)
            if quiz is None:
                return False
            # the pipeline knows passages as "c1", "c2"...; the table links to the passage's row
            rows = await session.execute(
                select(ChunkRow.ordinal, ChunkRow.id).where(ChunkRow.document_id == quiz.document_id)
            )
            chunk_ids = {chunk_label(ordinal): id for ordinal, id in rows}
            session.add_all(
                QuestionRow(
                    quiz_id=quiz_id,
                    ordinal=i,
                    source_chunk_id=chunk_ids.get(q.source_chunk_id),
                    verifier_notes=q.verifier_notes,
                    **question_columns(q),
                )
                for i, q in enumerate(questions, start=1)
            )
            quiz.status = "ready"
            return True

    async def fail(self, quiz_id: UUID, error: str) -> bool:
        async with self._sessions() as session, session.begin():
            result = await session.execute(
                update(Quiz).where(Quiz.id == quiz_id).values(status="failed", error=error).returning(Quiz.id)
            )
            return result.first() is not None

    async def fail_unfinished(self, message: str) -> int:
        async with self._sessions() as session, session.begin():
            result = await session.execute(
                update(Quiz)
                .where(Quiz.status == "generating")
                .values(status="failed", error=message)
                .returning(Quiz.id)
            )
            return len(result.all())

    async def questions(self, quiz_id: UUID) -> list[QuestionRecord]:
        async with self._sessions() as session:
            rows = await session.scalars(
                select(QuestionRow).where(QuestionRow.quiz_id == quiz_id).order_by(QuestionRow.ordinal)
            )
            return [_question(r) for r in rows]

    async def start_attempt(
        self,
        *,
        user_id: str,
        quiz_id: UUID,
        question_order: list[str],
        option_order: dict[str, list[str]],
    ) -> AttemptRecord:
        row = Attempt(
            id=uuid4(),
            quiz_id=quiz_id,
            user_id=UUID(user_id),
            question_order=question_order,
            option_order=option_order,
            total=len(question_order),
        )
        async with self._sessions() as session, session.begin():
            session.add(row)
            await session.flush()
            await session.refresh(row)
        return _attempt(row)

    async def get_attempt(self, user_id: str, attempt_id: UUID) -> AttemptRecord | None:
        async with self._sessions() as session:
            row = await session.scalar(
                select(Attempt).where(Attempt.id == attempt_id, Attempt.user_id == UUID(user_id))
            )
            return _attempt(row) if row else None

    async def submit(self, attempt_id: UUID, graded: list[Graded]) -> AttemptRecord | None:
        async with self._sessions() as session, session.begin():
            # "Mark it finished, but only if it isn't yet", as ONE statement. Checking first and updating
            # second would let two submits sent together both pass the check (a race); here the database
            # lets exactly one of them match the row, and the other gets nothing back.
            row = await session.scalar(
                update(Attempt)
                .where(Attempt.id == attempt_id, Attempt.finished_at.is_(None))
                .values(score=sum(g.is_correct for g in graded), finished_at=func.now())
                .returning(Attempt)
            )
            if row is None:
                return None
            session.add_all(
                AnswerRow(
                    attempt_id=attempt_id,
                    question_id=g.question_id,
                    response=g.response,
                    is_correct=g.is_correct,
                )
                for g in graded
            )
            return _attempt(row)

    async def answers(self, attempt_id: UUID) -> dict[UUID, Graded]:
        async with self._sessions() as session:
            rows = await session.scalars(select(AnswerRow).where(AnswerRow.attempt_id == attempt_id))
            return {r.question_id: Graded(r.question_id, r.response, r.is_correct) for r in rows}


# ---------- the generation job ----------

INTERRUPTED = "Writing this quiz was interrupted. Ask for it again."
NOTHING_PASSED = (
    "None of the questions written from this PDF passed the checks, so there is no quiz to show. "
    "Try again, or try different pages."
)
GENERATOR_DOWN = "The question writer is busy or can't be reached just now. Try again in a few minutes."


class ProgressBoard:
    """How far each quiz being written has got, kept in this process's memory.

    Progress changes several times a second and is worthless once the quiz is done, so it is not worth
    a database write each time. Memory is right while the API is one process (the quiz is written in
    the same process that answers the polls). With several, the board moves to a shared store, the
    same step the rate limiter would take (app/quotas.py).
    """

    def __init__(self) -> None:
        self._latest: dict[UUID, tuple[Progress, float]] = {}

    def update(self, quiz_id: UUID, progress: Progress) -> None:
        # A later round starts by "writing" again, which on its own would read as less far along
        # than the checks before it. Readers should never see a bar go backwards, so keep the furthest.
        furthest = max(progress.fraction, self._latest.get(quiz_id, (progress, 0.0))[1])
        self._latest[quiz_id] = (progress, furthest)

    def get(self, quiz_id: UUID) -> tuple[Progress, float] | None:
        return self._latest.get(quiz_id)

    def clear(self, quiz_id: UUID) -> None:
        self._latest.pop(quiz_id, None)


def can_generate(settings: Settings) -> bool:
    return settings.llm_provider == "fake" or bool(settings.gemini_api_key or settings.groq_api_key)


async def write_quiz(
    quizzes: QuizStore,
    documents: DocumentStore,
    quiz: QuizRecord,
    settings: Settings,
    provider: LLMProvider | None = None,
    board: ProgressBoard | None = None,
) -> None:
    """Write a quiz's questions from its document's stored passages, then mark it ready or failed.

    Runs after the 202 response has been sent (a FastAPI background task), like ingestion. The work is
    almost all waiting on the model over the network, which `await` does without blocking the server.
    `provider` is for tests; normally it is built from the settings (Groq, with Gemini as fallback).
    """
    try:
        chunks = await documents.chunks(quiz.document_id)
        config = quiz_config(quiz.config)

        def note(progress: Progress) -> None:
            if board:
                board.update(quiz.id, progress)

        if provider is not None:
            result = await generate_quiz(chunks, config, provider, note)
        else:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                result = await generate_quiz(chunks, config, build_provider(settings, client), note)
        if not result.questions:
            log.warning("quiz %s: nothing passed the checks (%s)", quiz.id, dict(result.rejected))
            await quizzes.fail(quiz.id, NOTHING_PASSED)
            return
        # Fewer than asked for is still a quiz: every question in it was checked, and padding it with
        # unchecked ones would break the one promise the product makes.
        await quizzes.finish(quiz.id, result.questions)
    except GenerationError as e:
        if isinstance(e.__cause__, ProviderError):  # an outage: the details are for our log, not the reader
            log.warning("quiz %s: provider failed: %s", quiz.id, e)
            await quizzes.fail(quiz.id, GENERATOR_DOWN)
        else:
            await quizzes.fail(quiz.id, str(e))
    except ProviderError as e:  # no API key configured
        log.warning("quiz %s: %s", quiz.id, e)
        await quizzes.fail(quiz.id, GENERATOR_DOWN)
    except Exception:
        log.exception("writing quiz %s failed", quiz.id)
        await quizzes.fail(quiz.id, "Something went wrong writing this quiz. Try again.")
    finally:
        if board:
            board.clear(quiz.id)  # ready or failed: the status says the rest


# ---------- what the API accepts and sends ----------


class QuizIn(BaseModel):
    # how many questions; left out, the server picks the number that suits the material in scope
    count: int | None = Field(default=None, ge=1)
    difficulty: Difficulty = "medium"
    types: list[ObjectiveType] = Field(default=["mcq"], min_length=1)
    pages: tuple[int, int] | None = None  # inclusive, e.g. [40, 60]
    topic: str | None = None  # focus on one topic; left out, the quiz covers everything in the pages

    @field_validator("topic")
    @classmethod
    def _tidy_topic(cls, value: str | None) -> str | None:
        return clean_topic(value)

    @model_validator(mode="after")
    def _page_range(self) -> "QuizIn":
        if self.pages and not 1 <= self.pages[0] <= self.pages[1]:
            raise ValueError("pages must be [first, last] with 1 <= first <= last")
        return self

    def config(self, count: int) -> QuizConfig:
        # dict.fromkeys drops a type listed twice and keeps the order
        types = tuple(dict.fromkeys(self.types))
        return QuizConfig(
            count=count, difficulty=self.difficulty, types=types, pages=self.pages, topic=self.topic
        )


class ScopeOut(BaseModel):
    """How much of a document a quiz would be written from, and how many questions suit that much."""

    topic: str | None  # as the server understood it (tidied); null for the whole document
    passages: int  # 0: nothing in the document is about the topic
    page_first: int | None
    page_last: int | None
    suggested_count: int
    max_count: int

    @classmethod
    def of(cls, scope: Scope, topic: str | None) -> "ScopeOut":
        return cls(
            topic=topic,
            passages=scope.passages,
            page_first=scope.page_first,
            page_last=scope.page_last,
            suggested_count=scope.suggested,
            max_count=scope.maximum,
        )


class ProgressOut(BaseModel):
    """While a quiz is being written: where it has got to. For the waiting page, not for decisions."""

    stage: Literal["writing", "checking"]
    fraction: float  # 0-1, never goes down, never reaches 1 (status "ready" is the finish line)
    round: int
    wanted: int
    kept: int
    candidates: int
    checked: int


class QuizOut(BaseModel):
    id: UUID
    document_id: UUID
    document_title: str
    status: QuizStatus
    error: str | None  # set when status is "failed", written for the reader
    count: int  # how many questions were asked for
    topic: str | None  # the one topic it is about; null when it covers everything
    question_count: int  # how many it has (0 until ready)
    difficulty: str
    types: list[str]
    created_at: datetime
    progress: ProgressOut | None = None  # only while status is "generating", and only once it has begun

    @classmethod
    def of(cls, q: QuizRecord, document_title: str, board: ProgressBoard | None = None) -> "QuizOut":
        seen = board.get(q.id) if board and q.status == "generating" else None
        progress = None
        if seen:
            p, furthest = seen
            progress = ProgressOut(
                stage=p.stage,
                fraction=round(furthest, 3),
                round=p.round,
                wanted=p.wanted,
                kept=p.kept,
                candidates=p.candidates,
                checked=p.checked,
            )
        return cls(
            progress=progress,
            id=q.id,
            document_id=q.document_id,
            document_title=document_title,
            status=q.status,
            error=q.error,
            count=int(q.config["count"]),
            topic=q.config.get("topic"),
            question_count=q.question_count,
            difficulty=q.config["difficulty"],
            types=list(q.config["types"]),
            created_at=q.created_at,
        )


class OptionOut(BaseModel):
    id: str
    text: str


class ResultOut(BaseModel):
    """The part of a question that is only sent once the attempt has been submitted."""

    response: str | None  # what the reader answered: an option id, or the text they typed
    is_correct: bool
    answer: str
    correct_option_id: str | None  # multiple choice only
    explanation: str
    page: int
    evidence: str


class QuestionOut(BaseModel):
    id: UUID
    type: str
    prompt: str
    options: list[OptionOut] | None  # in this attempt's order
    topic: str
    result: ResultOut | None  # null until the attempt is submitted


class AttemptOut(BaseModel):
    id: UUID
    quiz_id: UUID
    document_id: UUID
    document_title: str
    total: int
    score: int | None  # null until submitted
    finished: bool
    questions: list[QuestionOut]  # in this attempt's order


class SubmitIn(BaseModel):
    # {question id: the chosen option's id, "True"/"False", or the typed answer}; leave a question out
    # to skip it
    answers: dict[UUID, str]

    @model_validator(mode="after")
    def _bounded(self) -> "SubmitIn":
        if any(len(response) > RESPONSE_MAX for response in self.answers.values()):
            raise ValueError(f"an answer can be at most {RESPONSE_MAX} characters")
        return self


def attempt_out(
    attempt: AttemptRecord,
    quiz: QuizRecord,
    document_title: str,
    questions: list[QuestionRecord],
    answers: dict[UUID, Graded],
) -> AttemptOut:
    """An attempt as the reader sees it: their shuffle, and the answers only if it has been submitted."""
    by_id = {str(q.id): q for q in questions}
    finished = attempt.finished_at is not None
    shown: list[QuestionOut] = []
    for question_id in attempt.question_order:
        q = by_id[question_id]
        options: list[OptionOut] | None = None
        if q.options:
            texts = {o["id"]: o["text"] for o in q.options}
            options = [OptionOut(id=i, text=texts[i]) for i in attempt.option_order.get(question_id, texts)]
        result: ResultOut | None = None
        if finished:
            given = answers.get(q.id)
            result = ResultOut(
                response=given.response if given else None,
                is_correct=given.is_correct if given else False,
                answer=q.answer,
                correct_option_id=correct_option_id(q),
                explanation=q.explanation,
                page=q.page,
                evidence=q.evidence,
            )
        shown.append(
            QuestionOut(id=q.id, type=q.type, prompt=q.prompt, options=options, topic=q.topic, result=result)
        )
    return AttemptOut(
        id=attempt.id,
        quiz_id=attempt.quiz_id,
        document_id=quiz.document_id,
        document_title=document_title,
        total=attempt.total,
        score=attempt.score,
        finished=finished,
        questions=shown,
    )
