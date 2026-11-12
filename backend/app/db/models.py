"""Database tables, as SQLAlchemy classes. The schema itself is created by Alembic migrations."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DISPLAY_NAME_MAX = 40
TITLE_MAX = 200
FILENAME_MAX = 255
# the ingestion status machine (docs/ARCHITECTURE.md 4.1)
DOCUMENT_STATUSES = ("queued", "extracting", "chunking", "embedding", "ready", "failed")
EMBEDDING_DIM = 768  # chunks.embedding is vector(768); Settings.embedding_dim must agree
QUIZ_STATUSES = ("generating", "ready", "failed")
TOPIC_MAX = 80  # the same limit the generation schema puts on a topic (app/generation/schemas.py)


class Base(DeclarativeBase):
    pass


class Profile(Base):
    """Our own per-user data. `id` is the Supabase Auth user id (auth.users.id)."""

    __tablename__ = "profiles"
    __table_args__ = (
        # the database enforces the rule too, so no code path can store an empty or huge name
        CheckConstraint(
            f"char_length(display_name) between 1 and {DISPLAY_NAME_MAX}", name="display_name_length"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(DISPLAY_NAME_MAX))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Document(Base):
    """One uploaded PDF. The file itself lives in storage (app/storage.py); this row describes it."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(f"status in {DOCUMENT_STATUSES}", name="documents_status_valid"),
        # a reader uploading the same file twice gets their existing book back, not a second copy
        UniqueConstraint("user_id", "content_hash", name="documents_user_hash_key"),
        Index("documents_user_created_idx", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID]  # the Supabase Auth user id of the owner
    title: Mapped[str] = mapped_column(String(TITLE_MAX))
    filename: Mapped[str] = mapped_column(String(FILENAME_MAX))  # as uploaded, for display only
    page_count: Mapped[int | None]
    content_hash: Mapped[str] = mapped_column(String(64))  # SHA-256 of the file, hex
    # the file's size, so a reader's storage quota is one SUM() (app/quotas.py), wherever the file lives
    size_bytes: Mapped[int] = mapped_column(BigInteger, server_default="0")
    status: Mapped[str] = mapped_column(String(16), default="queued")
    error: Mapped[str | None] = mapped_column(Text)  # why it failed, written for the reader
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChunkRow(Base):
    """A passage of a document, with the pages it spans. Quiz questions will cite these."""

    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "ordinal", name="chunks_document_ordinal_key"),
        Index("chunks_document_page_idx", "document_id", "page_start"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    ordinal: Mapped[int]  # 1, 2, 3... in reading order
    text: Mapped[str] = mapped_column(Text)
    page_start: Mapped[int]
    page_end: Mapped[int]
    token_count: Mapped[int]
    # [[offset in text, page number], ...]: where each page's text starts, so a quote maps to one page
    page_marks: Mapped[list[Any]] = mapped_column(JSONB)
    # The passage as a point in "meaning space" (app/providers/embeddings.py). NULL until embedded, and
    # for good if no embedder was configured; keyword search covers those passages.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str | None] = mapped_column(String(64))  # which model wrote it


class Quiz(Base):
    """One generated quiz: a fixed set of questions written from one document."""

    __tablename__ = "quizzes"
    __table_args__ = (
        CheckConstraint(f"status in {QUIZ_STATUSES}", name="quizzes_status_valid"),
        Index("quizzes_user_created_idx", "user_id", "created_at"),
        Index("quizzes_document_idx", "document_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID]  # who asked for it (the Supabase Auth user id)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    # what was asked for: {"count": 5, "difficulty": "medium", "types": [...], "pages": [40, 60] | null}
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="generating")
    error: Mapped[str | None] = mapped_column(Text)  # why it failed, written for the reader
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestionRow(Base):
    """One question of a quiz, exactly as it passed the checks. Never edited afterwards."""

    __tablename__ = "questions"
    __table_args__ = (
        UniqueConstraint("quiz_id", "ordinal", name="questions_quiz_ordinal_key"),
        Index("questions_source_chunk_idx", "source_chunk_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"))
    ordinal: Mapped[int]  # the order they were written in; each attempt shows its own shuffle
    type: Mapped[str] = mapped_column(String(16))
    prompt: Mapped[str] = mapped_column(Text)
    # multiple choice only: [{"id": "a", "text": "..."}, ...]. Answers are matched by id, not position.
    options: Mapped[list[Any] | None] = mapped_column(JSONB)
    answer: Mapped[str] = mapped_column(Text)  # the correct answer's text
    explanation: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(TOPIC_MAX))
    difficulty: Mapped[str] = mapped_column(String(8))
    # the passage it was written from, kept for "show me the source" (NULL if that passage is replaced)
    source_chunk_id: Mapped[UUID | None] = mapped_column(ForeignKey("chunks.id", ondelete="SET NULL"))
    page: Mapped[int]  # the page the evidence is on
    evidence: Mapped[str] = mapped_column(Text)  # the sentence(s) quoted from that page
    verifier_notes: Mapped[str] = mapped_column(Text, server_default="")


class Attempt(Base):
    """One sitting of a quiz by one reader, with the order the questions and options were shown in."""

    __tablename__ = "attempts"
    __table_args__ = (
        CheckConstraint("(score is null) = (finished_at is null)", name="attempts_score_when_finished"),
        CheckConstraint("score is null or (score >= 0 and score <= total)", name="attempts_score_range"),
        Index("attempts_quiz_user_idx", "quiz_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    quiz_id: Mapped[UUID] = mapped_column(ForeignKey("quizzes.id", ondelete="CASCADE"))
    user_id: Mapped[UUID]
    question_order: Mapped[list[Any]] = mapped_column(JSONB)  # question ids, as shown
    option_order: Mapped[dict[str, Any]] = mapped_column(JSONB)  # {question id: [option ids, as shown]}
    total: Mapped[int]  # how many questions; fixed when the attempt starts
    score: Mapped[int | None]  # how many were right; NULL until it is submitted
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AnswerRow(Base):
    """What the reader answered to one question in one attempt, and whether it was right."""

    __tablename__ = "answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="answers_attempt_question_key"),
        Index("answers_question_idx", "question_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    attempt_id: Mapped[UUID] = mapped_column(ForeignKey("attempts.id", ondelete="CASCADE"))
    question_id: Mapped[UUID] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"))
    response: Mapped[str | None] = mapped_column(Text)  # an option id, or what they typed; NULL if skipped
    is_correct: Mapped[bool] = mapped_column(Boolean)
    answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
