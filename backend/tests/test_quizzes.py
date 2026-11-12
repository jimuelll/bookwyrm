"""Quizzes: asking for one, sitting it and having it marked, through the API with in-memory tables.

The LLM is the fake provider (app/providers/fake.py), which writes questions straight from the passages,
so the real pipeline runs: schema, evidence check, page lookup, de-duplication. FastAPI's TestClient
runs background tasks before `client.post(...)` returns, so a quiz is already written when it answers.
"""

import asyncio
import os
import random
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.auth import TokenVerifier
from app.generation.pipeline import Progress
from app.generation.prompts import VERIFY_SYSTEM
from app.generation.schemas import Question
from app.main import create_app
from app.providers.base import ProviderError
from app.providers.fake import FakeProvider, echo_handler, verify_reply
from app.quizzes import (
    GENERATOR_DOWN,
    NOTHING_PASSED,
    AttemptRecord,
    Graded,
    ProgressBoard,
    QuestionRecord,
    QuizOut,
    QuizRecord,
    grade,
    question_columns,
    shuffled_orders,
    write_quiz,
)
from tests.conftest import MakePdf
from tests.test_documents import BEN, MemoryDocuments, upload
from tests.test_profiles import ANA, ISSUER, KEY, auth, token

PAGE_1 = (
    "Mitochondria produce most of the ATP that a cell uses. "
    "The inner membrane of a mitochondrion is folded into cristae. "
    "Ribosomes assemble proteins from chains of amino acids."
)
PAGE_2 = (
    "Chloroplasts capture light energy during the process of photosynthesis. "
    "Osmosis moves water across a membrane toward more solute. "
    "The nucleus stores the genetic material of the whole cell."
)


class MemoryQuizzes:
    """The quizzes, questions, attempts and answers tables, kept in dicts."""

    def __init__(self) -> None:
        self.quizzes: dict[UUID, QuizRecord] = {}
        self.items: dict[UUID, list[QuestionRecord]] = {}
        self.attempts: dict[UUID, AttemptRecord] = {}
        self.given: dict[UUID, dict[UUID, Graded]] = {}

    async def create(self, *, user_id: str, document_id: UUID, config: dict[str, Any]) -> QuizRecord:
        now = datetime(2026, 11, 12, 9, 0, len(self.quizzes), tzinfo=UTC)
        quiz = QuizRecord(uuid.uuid4(), user_id, document_id, config, "generating", None, 0, now)
        self.quizzes[quiz.id] = quiz
        return quiz

    async def get(self, user_id: str, quiz_id: UUID) -> QuizRecord | None:
        found = self.quizzes.get(quiz_id)
        return found if found and found.user_id == user_id else None

    async def list_for(self, user_id: str) -> list[QuizRecord]:
        mine = [q for q in self.quizzes.values() if q.user_id == user_id]
        return sorted(mine, key=lambda q: q.created_at, reverse=True)

    async def generating_count(self, user_id: str) -> int:
        return sum(q.status == "generating" for q in await self.list_for(user_id))

    async def finish(self, quiz_id: UUID, questions: list[Question]) -> bool:
        if quiz_id not in self.quizzes:
            return False
        self.items[quiz_id] = [
            QuestionRecord(id=uuid.uuid4(), quiz_id=quiz_id, ordinal=i, **question_columns(q))
            for i, q in enumerate(questions, start=1)
        ]
        self.quizzes[quiz_id] = replace(self.quizzes[quiz_id], status="ready", question_count=len(questions))
        return True

    async def fail(self, quiz_id: UUID, error: str) -> bool:
        if quiz_id not in self.quizzes:
            return False
        self.quizzes[quiz_id] = replace(self.quizzes[quiz_id], status="failed", error=error)
        return True

    async def fail_unfinished(self, message: str) -> int:
        unfinished = [q.id for q in self.quizzes.values() if q.status == "generating"]
        for id in unfinished:
            await self.fail(id, message)
        return len(unfinished)

    async def questions(self, quiz_id: UUID) -> list[QuestionRecord]:
        return self.items.get(quiz_id, [])

    async def start_attempt(
        self, *, user_id: str, quiz_id: UUID, question_order: list[str], option_order: dict[str, list[str]]
    ) -> AttemptRecord:
        now = datetime(2026, 11, 12, 10, 0, tzinfo=UTC)
        attempt = AttemptRecord(
            uuid.uuid4(), quiz_id, user_id, question_order, option_order, len(question_order), None, now, None
        )
        self.attempts[attempt.id] = attempt
        return attempt

    async def get_attempt(self, user_id: str, attempt_id: UUID) -> AttemptRecord | None:
        found = self.attempts.get(attempt_id)
        return found if found and found.user_id == user_id else None

    async def submit(self, attempt_id: UUID, graded: list[Graded]) -> AttemptRecord | None:
        attempt = self.attempts[attempt_id]
        if attempt.finished_at is not None:
            return None
        self.attempts[attempt_id] = replace(
            attempt,
            score=sum(g.is_correct for g in graded),
            finished_at=datetime(2026, 11, 12, 10, 5, tzinfo=UTC),
        )
        self.given[attempt_id] = {g.question_id: g for g in graded}
        return self.attempts[attempt_id]

    async def answers(self, attempt_id: UUID) -> dict[UUID, Graded]:
        return self.given.get(attempt_id, {})


@pytest.fixture
def documents() -> MemoryDocuments:
    return MemoryDocuments()


@pytest.fixture
def quizzes() -> MemoryQuizzes:
    return MemoryQuizzes()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, storage_dir=str(tmp_path / "storage"), llm_provider="fake")


def make_client(settings: Settings, documents: MemoryDocuments, quizzes: MemoryQuizzes) -> TestClient:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    return TestClient(create_app(settings, verifier, documents=documents, quizzes=quizzes))


@pytest.fixture
def client(settings: Settings, documents: MemoryDocuments, quizzes: MemoryQuizzes) -> TestClient:
    return make_client(settings, documents, quizzes)


@pytest.fixture
def book(client: TestClient, make_pdf: MakePdf) -> str:
    """A two-page PDF of Ana's, uploaded and read."""
    return str(upload(client, make_pdf([PAGE_1, PAGE_2])).json()["id"])


def ask(client: TestClient, book: str, user: str = ANA, **config: Any) -> Any:
    body = {"count": 3, "types": ["true_false"]} | config
    return client.post(f"/documents/{book}/quizzes", json=body, headers=auth(token(sub=user)))


def start(client: TestClient, quiz_id: str, user: str = ANA) -> Any:
    return client.post(f"/quizzes/{quiz_id}/attempts", headers=auth(token(sub=user)))


def submit(client: TestClient, attempt_id: str, answers: dict[str, str], user: str = ANA) -> Any:
    return client.post(
        f"/attempts/{attempt_id}/submit", json={"answers": answers}, headers=auth(token(sub=user))
    )


# --- asking for a quiz ---


def test_a_quiz_is_written_from_the_books_passages(client: TestClient, book: str) -> None:
    response = ask(client, book)

    assert response.status_code == 202
    assert (response.json()["status"], response.json()["document_title"]) == (
        "generating",
        "Cell Biology ch3",
    )
    quiz = client.get(f"/quizzes/{response.json()['id']}", headers=auth(token())).json()
    assert (quiz["status"], quiz["question_count"], quiz["count"]) == ("ready", 3, 3)


def test_a_book_still_being_read_cannot_be_quizzed(
    client: TestClient, documents: MemoryDocuments, book: str
) -> None:
    asyncio.run(documents.set_status(UUID(book), "chunking"))
    response = ask(client, book)
    assert response.status_code == 409
    assert response.json()["detail"] == "This PDF is still being read. Try again when it's ready."


def test_another_readers_book_cannot_be_quizzed(client: TestClient, book: str) -> None:
    assert ask(client, book, user=BEN).status_code == 404


def test_refuses_more_questions_than_the_material_can_carry(client: TestClient, book: str) -> None:
    response = ask(client, book, count=4)  # two short pages: enough for three
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "There is only enough material here for 3 questions. Ask for fewer, or cover more of the PDF."
    )


def test_a_quiz_can_focus_on_one_topic(client: TestClient, quizzes: MemoryQuizzes, book: str) -> None:
    response = ask(client, book, count=1, topic="  Osmosis ")

    assert (response.status_code, response.json()["topic"]) == (202, "Osmosis")
    written = quizzes.quizzes[UUID(response.json()["id"])]
    assert (written.status, written.config["topic"]) == ("ready", "Osmosis")


def test_a_topic_the_book_never_mentions_is_refused_before_any_model_is_called(
    client: TestClient, quizzes: MemoryQuizzes, book: str
) -> None:
    response = ask(client, book, topic="French Revolution")
    assert response.status_code == 422
    assert response.json()["detail"].startswith("Nothing in this PDF mentions \u201cFrench Revolution\u201d.")
    assert quizzes.quizzes == {}


def test_without_a_count_the_quiz_gets_the_number_that_suits_the_material(
    client: TestClient, book: str
) -> None:
    response = client.post(
        f"/documents/{book}/quizzes", json={"types": ["true_false"]}, headers=auth(token())
    )
    assert (response.status_code, response.json()["count"]) == (202, 3)


def test_the_scope_of_a_quiz_can_be_measured_before_asking(client: TestClient, book: str) -> None:
    whole = client.get(f"/documents/{book}/quiz-scope", headers=auth(token())).json()
    topic = client.get(
        f"/documents/{book}/quiz-scope", params={"topic": "osmosis"}, headers=auth(token())
    ).json()
    nothing = client.get(
        f"/documents/{book}/quiz-scope", params={"topic": "tax law"}, headers=auth(token())
    ).json()

    assert (whole["topic"], whole["page_first"], whole["page_last"], whole["max_count"]) == (None, 1, 2, 3)
    assert (topic["topic"], topic["passages"], topic["suggested_count"]) == ("osmosis", 1, 3)
    assert (nothing["passages"], nothing["max_count"]) == (0, 0)
    assert client.get(f"/documents/{book}/quiz-scope", headers=auth(token(sub=BEN))).status_code == 404


def test_refuses_short_answer_questions_until_they_can_be_marked(client: TestClient, book: str) -> None:
    assert ask(client, book, types=["short_answer"]).status_code == 422


def test_only_one_quiz_is_written_at_a_time_per_reader(
    client: TestClient, quizzes: MemoryQuizzes, book: str
) -> None:
    asyncio.run(quizzes.create(user_id=ANA, document_id=UUID(book), config={}))  # still "generating"
    response = ask(client, book)
    assert response.status_code == 409
    assert "already being written" in response.json()["detail"]


def test_too_many_quizzes_in_a_row_are_refused_with_retry_after(
    settings: Settings, documents: MemoryDocuments, quizzes: MemoryQuizzes, make_pdf: MakePdf
) -> None:
    limited = settings.model_copy(update={"quiz_rate_count": 1, "quiz_rate_window_seconds": 600})
    client = make_client(limited, documents, quizzes)
    book = upload(client, make_pdf([PAGE_1, PAGE_2])).json()["id"]
    assert ask(client, book).status_code == 202

    response = ask(client, book)
    assert response.status_code == 429
    assert 590 <= int(response.headers["Retry-After"]) <= 600
    assert response.json()["detail"].startswith("You've asked for 1 quizzes in the last 10 minutes.")


def test_says_the_question_writer_is_not_set_up(
    settings: Settings, documents: MemoryDocuments, quizzes: MemoryQuizzes, make_pdf: MakePdf
) -> None:
    no_keys = settings.model_copy(update={"llm_provider": "gemini", "gemini_api_key": "", "groq_api_key": ""})
    client = make_client(no_keys, documents, quizzes)
    book = upload(client, make_pdf([PAGE_1])).json()["id"]
    assert ask(client, book).status_code == 503
    assert quizzes.quizzes == {}


def test_lists_only_the_readers_own_quizzes(client: TestClient, book: str, make_pdf: MakePdf) -> None:
    mine = ask(client, book).json()["id"]
    bens_book = upload(client, make_pdf(["Ben's notes. " + PAGE_2]), user=BEN).json()["id"]
    ask(client, bens_book, user=BEN)

    listed = client.get("/quizzes", headers=auth(token())).json()
    assert [q["id"] for q in listed] == [mine]


# --- sitting it ---


def test_an_attempt_shows_the_questions_without_their_answers(client: TestClient, book: str) -> None:
    quiz_id = ask(client, book).json()["id"]

    response = start(client, quiz_id)

    assert response.status_code == 201
    attempt = response.json()
    assert (attempt["total"], attempt["finished"], attempt["score"]) == (3, False, None)
    assert all(q["result"] is None for q in attempt["questions"])
    # nothing that would give an answer away is in the reply: no answer, evidence, explanation or page
    assert all(set(q) == {"id", "type", "prompt", "options", "topic", "result"} for q in attempt["questions"])


def test_an_attempt_is_marked_and_cites_the_page_for_every_answer(
    client: TestClient, quizzes: MemoryQuizzes, book: str
) -> None:
    quiz_id = ask(client, book).json()["id"]
    attempt = start(client, quiz_id).json()
    first, second, third = attempt["questions"]

    # the fake provider only writes true statements: one right, one wrong, one skipped
    response = submit(client, attempt["id"], {first["id"]: "True", second["id"]: "False"})

    assert response.status_code == 200
    marked = response.json()
    assert (marked["score"], marked["total"], marked["finished"]) == (1, 3, True)
    results = {q["id"]: q["result"] for q in marked["questions"]}
    assert [results[q["id"]]["is_correct"] for q in (first, second, third)] == [True, False, False]
    assert (results[third["id"]]["response"], results[third["id"]]["answer"]) == (None, "True")
    for result in results.values():
        page_text = PAGE_1 if result["page"] == 1 else PAGE_2
        assert result["evidence"] in page_text


def test_an_attempt_can_only_be_submitted_once(client: TestClient, book: str) -> None:
    attempt = start(client, ask(client, book).json()["id"]).json()
    assert submit(client, attempt["id"], {}).status_code == 200

    again = submit(client, attempt["id"], {attempt["questions"][0]["id"]: "True"})

    assert again.status_code == 409
    kept = client.get(f"/attempts/{attempt['id']}", headers=auth(token())).json()
    assert kept["score"] == 0  # the first marking stands


def test_the_results_can_be_read_again_later(client: TestClient, book: str) -> None:
    attempt = start(client, ask(client, book).json()["id"]).json()
    marked = submit(client, attempt["id"], {q["id"]: "True" for q in attempt["questions"]}).json()

    again = client.get(f"/attempts/{attempt['id']}", headers=auth(token())).json()

    assert again == marked
    assert again["score"] == 3


def test_answers_for_questions_outside_the_quiz_are_refused(client: TestClient, book: str) -> None:
    attempt = start(client, ask(client, book).json()["id"]).json()
    response = submit(client, attempt["id"], {str(uuid.uuid4()): "True"})
    assert response.status_code == 422


def test_a_quiz_that_is_not_ready_cannot_be_started(
    client: TestClient, quizzes: MemoryQuizzes, book: str
) -> None:
    writing = asyncio.run(quizzes.create(user_id=ANA, document_id=UUID(book), config={}))
    assert start(client, str(writing.id)).status_code == 409


def test_another_readers_quiz_and_attempt_look_like_they_do_not_exist(client: TestClient, book: str) -> None:
    quiz_id = ask(client, book).json()["id"]
    attempt_id = start(client, quiz_id).json()["id"]
    ben = auth(token(sub=BEN))

    assert client.get(f"/quizzes/{quiz_id}", headers=ben).status_code == 404
    assert start(client, quiz_id, user=BEN).status_code == 404
    assert client.get(f"/attempts/{attempt_id}", headers=ben).status_code == 404
    assert submit(client, attempt_id, {}, user=BEN).status_code == 404


def test_needs_a_login(client: TestClient, book: str) -> None:
    assert client.post(f"/documents/{book}/quizzes", json={}).status_code == 401
    assert client.get("/quizzes").status_code == 401


# --- marking and shuffling, on their own ---


def question(**over: Any) -> QuestionRecord:
    base: dict[str, Any] = {
        "id": uuid.uuid4(),
        "quiz_id": uuid.uuid4(),
        "ordinal": 1,
        "type": "mcq",
        "prompt": "Which organelle produces most of a cell's ATP?",
        "options": [
            {"id": "a", "text": "The nucleus"},
            {"id": "b", "text": "Mitochondria"},
            {"id": "c", "text": "Ribosomes"},
            {"id": "d", "text": "Chloroplasts"},
        ],
        "answer": "Mitochondria",
        "explanation": "Stated in the passage.",
        "topic": "Organelles",
        "difficulty": "medium",
        "page": 1,
        "evidence": "Mitochondria produce most of the ATP that a cell uses.",
    }
    return QuestionRecord(**(base | over))


def test_multiple_choice_is_marked_by_option_id() -> None:
    q = question()
    assert grade(q, "b") is True
    assert grade(q, "a") is False
    assert grade(q, "Mitochondria") is False  # the text is not an id: the browser can't guess its way in
    assert grade(q, None) is False


def test_a_typed_answer_ignores_case_spacing_and_end_punctuation() -> None:
    q = question(type="fill_blank", options=None, prompt="____ absorbs red light.", answer="Chlorophyll")
    assert grade(q, "  chlorophyll. ") is True
    assert grade(q, "chloroplast") is False


def test_each_attempt_gets_its_own_order_of_the_same_questions() -> None:
    questions = [question(ordinal=i) for i in range(1, 9)]

    order, options = shuffled_orders(questions, random.Random(7))
    other, _ = shuffled_orders(questions, random.Random(8))

    assert sorted(order) == sorted(str(q.id) for q in questions)  # the same set...
    assert order != other  # ...in a different order
    assert all(sorted(options[str(q.id)]) == ["a", "b", "c", "d"] for q in questions)


# --- the writing job, when it goes wrong ---


CONFIG = {"count": 2, "difficulty": "medium", "types": ["true_false"], "pages": None}


async def test_a_quiz_with_no_question_that_passes_the_checks_fails_with_a_reason(
    quizzes: MemoryQuizzes, documents: MemoryDocuments, settings: Settings, book: str
) -> None:
    def rejects_everything(system: str, prompt: str) -> str:
        if system == VERIFY_SYSTEM:
            return verify_reply(prompt, lambda item: {"answerable_from_source": False})
        return echo_handler(system, prompt)

    quiz = await quizzes.create(user_id=ANA, document_id=UUID(book), config=CONFIG)
    await write_quiz(quizzes, documents, quiz, settings, FakeProvider(rejects_everything))

    assert (quizzes.quizzes[quiz.id].status, quizzes.quizzes[quiz.id].error) == ("failed", NOTHING_PASSED)


async def test_when_the_model_is_unreachable_the_reader_is_told_to_try_again(
    quizzes: MemoryQuizzes, documents: MemoryDocuments, settings: Settings, book: str
) -> None:
    def down(system: str, prompt: str) -> str:
        raise ProviderError("gemini failed after 3 attempts: 503 upstream connect error")

    quiz = await quizzes.create(user_id=ANA, document_id=UUID(book), config=CONFIG)
    await write_quiz(quizzes, documents, quiz, settings, FakeProvider(down))

    failed = quizzes.quizzes[quiz.id]
    assert (failed.status, failed.error) == ("failed", GENERATOR_DOWN)  # no provider details leak out


async def test_a_quiz_being_written_says_how_far_it_has_got(quizzes: MemoryQuizzes) -> None:
    board = ProgressBoard()
    quiz = await quizzes.create(user_id=ANA, document_id=uuid.uuid4(), config=CONFIG)
    assert QuizOut.of(quiz, "Cell Biology", board).progress is None  # nothing reported yet

    board.update(quiz.id, Progress("checking", round=1, wanted=2, kept=0, candidates=4, checked=4))
    board.update(quiz.id, Progress("writing", round=2, wanted=2, kept=1))  # a second round begins

    progress = QuizOut.of(quiz, "Cell Biology", board).progress
    assert progress is not None
    assert (progress.stage, progress.round, progress.kept) == ("writing", 2, 1)
    assert progress.fraction == 0.95  # the furthest point reached, not the new round's lower start


async def test_progress_is_dropped_once_the_quiz_is_written(
    quizzes: MemoryQuizzes, documents: MemoryDocuments, settings: Settings, book: str
) -> None:
    board = ProgressBoard()
    quiz = await quizzes.create(user_id=ANA, document_id=UUID(book), config=CONFIG)

    await write_quiz(quizzes, documents, quiz, settings, FakeProvider(), board)

    assert quizzes.quizzes[quiz.id].status == "ready"
    assert board.get(quiz.id) is None


def test_a_restart_marks_quizzes_being_written_as_failed(
    settings: Settings, documents: MemoryDocuments, quizzes: MemoryQuizzes
) -> None:
    stuck = asyncio.run(quizzes.create(user_id=ANA, document_id=uuid.uuid4(), config={}))
    with make_client(settings, documents, quizzes):  # `with` runs startup
        pass
    assert quizzes.quizzes[stuck.id].status == "failed"
    assert "interrupted" in (quizzes.quizzes[stuck.id].error or "")


# --- the real tables (runs where a test database exists, e.g. CI) ---

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL (a disposable database) to run")
async def test_the_quiz_tables_store_a_quiz_an_attempt_and_its_answers(settings: Settings) -> None:
    from app.db.session import make_engine, make_sessionmaker
    from app.documents import SqlDocumentStore
    from app.ingestion.chunk import chunk_pages
    from app.ingestion.extract import Page
    from app.quizzes import SqlQuizStore

    engine = make_engine(TEST_DATABASE_URL)
    sessions = make_sessionmaker(engine)
    docs, sql = SqlDocumentStore(sessions), SqlQuizStore(sessions)
    user, document_id = str(uuid.uuid4()), uuid.uuid4()
    try:
        await docs.create(
            id=document_id,
            user_id=user,
            title="t",
            filename="t.pdf",
            page_count=2,
            content_hash="b" * 64,
            size_bytes=1,
        )
        await docs.save_chunks(document_id, chunk_pages([Page(1, PAGE_1), Page(2, PAGE_2)]))
        assert [c.id for c in await docs.chunks(document_id)] == ["c1"]

        config = {"count": 3, "difficulty": "medium", "types": ["true_false"], "pages": None}
        quiz = await sql.create(user_id=user, document_id=document_id, config=config)
        assert await sql.generating_count(user) == 1
        await write_quiz(sql, docs, quiz, settings, FakeProvider())

        ready = await sql.get(user, quiz.id)
        assert ready is not None and (ready.status, ready.question_count) == ("ready", 3)
        assert await sql.get(str(uuid.uuid4()), quiz.id) is None  # not someone else's
        assert [q.id for q in await sql.list_for(user)] == [quiz.id]

        questions = await sql.questions(quiz.id)
        order, options = shuffled_orders(questions)
        attempt = await sql.start_attempt(
            user_id=user, quiz_id=quiz.id, question_order=order, option_order=options
        )
        assert (attempt.total, attempt.score, attempt.finished_at) == (3, None, None)

        graded = [Graded(q.id, "True", grade(q, "True")) for q in questions]
        finished = await sql.submit(attempt.id, graded)
        assert finished is not None and finished.score == 3 and finished.finished_at is not None
        assert await sql.submit(attempt.id, graded) is None  # only the first submit counts
        assert set(await sql.answers(attempt.id)) == {q.id for q in questions}

        assert await docs.delete(user, document_id)  # the quiz, questions, attempt and answers cascade
        assert await sql.get(user, quiz.id) is None
        assert await sql.get_attempt(user, attempt.id) is None
    finally:
        await engine.dispose()
