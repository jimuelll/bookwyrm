"""Database tables, as SQLAlchemy classes. The schema itself is created by Alembic migrations."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
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
# the ingestion status machine (docs/ARCHITECTURE.md 4.1); `embedding` joins it when embeddings do
DOCUMENT_STATUSES = ("queued", "extracting", "chunking", "ready", "failed")


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
