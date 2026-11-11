"""Uploaded PDFs: receiving the file, the `documents`/`chunks` tables, and the ingestion job.

The flow (docs/ARCHITECTURE.md 4.1):
  request:     stream the upload to disk (hashing it, stopping at the size limit)
               -> quick checks (is it a PDF, damaged, password, page limit)  -> 4xx at once if not
               -> same file uploaded before? return that book
               -> store the file, create the row (status=queued), answer 202
  background:  extracting (read each page's text) -> chunking (cut into passages, save them) -> ready
               any PdfError on the way -> failed, with the message for the reader
The browser polls GET /documents to watch the status change.
"""

import asyncio
import hashlib
import logging
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol
from uuid import UUID, uuid4

from fastapi import UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.db.models import FILENAME_MAX, TITLE_MAX, ChunkRow, Document
from app.ingestion import sandbox
from app.ingestion.chunk import Chunk, chunk_pages
from app.ingestion.extract import PdfError
from app.quotas import Usage
from app.storage import FileStore

log = logging.getLogger(__name__)

Status = Literal["queued", "extracting", "chunking", "ready", "failed"]
UNFINISHED: tuple[Status, ...] = ("queued", "extracting", "chunking")
READ_SIZE = 1024 * 1024  # stream uploads 1 MB at a time


@dataclass(frozen=True)
class DocumentRecord:
    id: UUID
    user_id: str
    title: str
    filename: str
    page_count: int | None
    content_hash: str
    size_bytes: int
    status: Status
    error: str | None
    created_at: datetime
    updated_at: datetime


# ---------- receiving the upload ----------


class FileTooLarge(PdfError):
    pass


@dataclass(frozen=True)
class Received:
    path: Path  # a temporary file; the caller moves it into storage or deletes it
    sha256: str
    size: int


async def receive_upload(upload: UploadFile, *, max_bytes: int, temp_dir: Path | None = None) -> Received:
    """Copy an upload to a temporary file in pieces, hashing as it goes.

    Reading piece by piece means a 2 GB upload never sits in memory, and we stop (and delete what we
    wrote) as soon as it passes the limit instead of after the whole thing has arrived.
    """
    digest = hashlib.sha256()
    size = 0
    fd, name = tempfile.mkstemp(suffix=".pdf", dir=temp_dir)
    path = Path(name)
    try:
        with open(fd, "wb") as out:
            while piece := await upload.read(READ_SIZE):
                size += len(piece)
                if size > max_bytes:
                    raise FileTooLarge(f"The file is larger than {max_bytes // (1024 * 1024)} MB.")
                digest.update(piece)
                out.write(piece)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    if size == 0:
        path.unlink(missing_ok=True)
        raise PdfError("The file is empty.")
    return Received(path=path, sha256=digest.hexdigest(), size=size)


_SEPARATORS = re.compile(r"[_\s]+")


def clean_filename(raw: str | None) -> str:
    """The uploaded name, safe to store and show: no folders, no control characters, bounded length."""
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]  # some browsers send a full path
    name = "".join(ch for ch in unicodedata.normalize("NFC", name) if unicodedata.category(ch)[0] != "C")
    return name.strip()[:FILENAME_MAX] or "document.pdf"


def title_from_filename(filename: str) -> str:
    """'cell_biology-ch3.pdf' -> 'cell biology-ch3': readable enough until a reader can rename it."""
    stem = re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE)
    return _SEPARATORS.sub(" ", stem).strip()[:TITLE_MAX] or "Untitled PDF"


# ---------- the tables ----------


class DocumentStore(Protocol):
    async def find_by_hash(self, user_id: str, content_hash: str) -> DocumentRecord | None: ...

    async def create(
        self,
        *,
        id: UUID,
        user_id: str,
        title: str,
        filename: str,
        page_count: int,
        content_hash: str,
        size_bytes: int,
    ) -> DocumentRecord:
        """Raises DuplicateDocument if this reader already has a document with this hash."""
        ...

    async def get(self, user_id: str, document_id: UUID) -> DocumentRecord | None: ...
    async def list_for(self, user_id: str) -> list[DocumentRecord]: ...

    async def usage(self, user_id: str) -> Usage:
        """How many documents this reader has and their total size (their quota, app/quotas.py)."""
        ...

    async def set_status(self, document_id: UUID, status: Status, error: str | None = None) -> bool:
        """Returns False if the document no longer exists (deleted while it was being read)."""
        ...

    async def save_chunks(self, document_id: UUID, chunks: list[Chunk]) -> None: ...
    async def delete(self, user_id: str, document_id: UUID) -> bool: ...
    async def fail_unfinished(self, message: str) -> int: ...


class DuplicateDocument(Exception):
    pass


def _record(row: Document) -> DocumentRecord:
    return DocumentRecord(
        id=row.id,
        user_id=str(row.user_id),
        title=row.title,
        filename=row.filename,
        page_count=row.page_count,
        content_hash=row.content_hash,
        size_bytes=row.size_bytes,
        status=row.status,  # type: ignore[arg-type]  # the CHECK constraint keeps it one of Status
        error=row.error,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class SqlDocumentStore:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def find_by_hash(self, user_id: str, content_hash: str) -> DocumentRecord | None:
        async with self._sessions() as session:
            row = await session.scalar(
                select(Document).where(
                    Document.user_id == UUID(user_id), Document.content_hash == content_hash
                )
            )
            return _record(row) if row else None

    async def create(
        self,
        *,
        id: UUID,
        user_id: str,
        title: str,
        filename: str,
        page_count: int,
        content_hash: str,
        size_bytes: int,
    ) -> DocumentRecord:
        row = Document(
            id=id,
            user_id=UUID(user_id),
            title=title,
            filename=filename,
            page_count=page_count,
            content_hash=content_hash,
            size_bytes=size_bytes,
            status="queued",
        )
        try:
            async with self._sessions() as session, session.begin():
                session.add(row)
        except IntegrityError as e:
            # two uploads of the same file at once: the unique (user_id, content_hash) index decides
            raise DuplicateDocument from e
        async with self._sessions() as session:  # read back the timestamps the database filled in
            return _record(await session.get_one(Document, id))

    async def get(self, user_id: str, document_id: UUID) -> DocumentRecord | None:
        async with self._sessions() as session:
            row = await session.get(Document, document_id)
            # someone else's document looks exactly like a missing one: never confirm it exists
            return _record(row) if row and str(row.user_id) == str(UUID(user_id)) else None

    async def list_for(self, user_id: str) -> list[DocumentRecord]:
        async with self._sessions() as session:
            rows = await session.scalars(
                select(Document)
                .where(Document.user_id == UUID(user_id))
                .order_by(Document.created_at.desc(), Document.id)
            )
            return [_record(r) for r in rows]

    async def usage(self, user_id: str) -> Usage:
        async with self._sessions() as session:
            count, total = (
                await session.execute(
                    select(func.count(), func.coalesce(func.sum(Document.size_bytes), 0)).where(
                        Document.user_id == UUID(user_id)
                    )
                )
            ).one()
            return Usage(documents=int(count), bytes=int(total))

    async def set_status(self, document_id: UUID, status: Status, error: str | None = None) -> bool:
        async with self._sessions() as session, session.begin():
            result = await session.execute(
                update(Document)
                .where(Document.id == document_id)
                .values(status=status, error=error)
                .returning(Document.id)
            )
            return result.first() is not None

    async def save_chunks(self, document_id: UUID, chunks: list[Chunk]) -> None:
        async with self._sessions() as session, session.begin():
            # replace, so running the step again never doubles the passages
            await session.execute(delete(ChunkRow).where(ChunkRow.document_id == document_id))
            session.add_all(
                ChunkRow(
                    document_id=document_id,
                    ordinal=i,
                    text=c.text,
                    page_start=c.page_start,
                    page_end=c.page_end,
                    token_count=c.token_count,
                    page_marks=[list(mark) for mark in c.page_marks],
                )
                for i, c in enumerate(chunks, start=1)
            )

    async def delete(self, user_id: str, document_id: UUID) -> bool:
        async with self._sessions() as session, session.begin():
            result = await session.execute(
                delete(Document)
                .where(Document.id == document_id, Document.user_id == UUID(user_id))
                .returning(Document.id)
            )
            return result.first() is not None

    async def fail_unfinished(self, message: str) -> int:
        async with self._sessions() as session, session.begin():
            result = await session.execute(
                update(Document)
                .where(Document.status.in_(UNFINISHED))
                .values(status="failed", error=message)
                .returning(Document.id)
            )
            return len(result.all())


# ---------- the ingestion job ----------

INTERRUPTED = "Reading this PDF was interrupted. Remove it and upload it again."


async def ingest(
    store: DocumentStore, files: FileStore, user_id: str, document_id: UUID, settings: Settings
) -> None:
    """Read a stored PDF and save its passages, recording each step in `status`.

    Runs after the upload response has been sent (a FastAPI background task). The file is fetched from
    storage into a temporary copy, so the job works the same whether storage is a bucket or a folder.
    Reading the PDF happens in a sandboxed child process and the chunker is ordinary blocking Python;
    both are waited on from a worker thread (`asyncio.to_thread`), so while a 300-page book is being
    read the server keeps answering requests.
    """
    temp_dir = settings.storage_path / "tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    pdf = temp_dir / f"ingest-{document_id}.pdf"
    try:
        if not await store.set_status(document_id, "extracting"):
            return  # removed before we started
        await files.download(user_id, document_id, pdf)
        # in a child process with a time (and, on Linux, memory) limit: app/ingestion/sandbox.py.
        # A timeout or crash raises PdfError like any unreadable file, so it is recorded as failed.
        pages = await asyncio.to_thread(
            sandbox.extract_pages,
            pdf,
            max_pages=settings.max_pages,
            max_mb=settings.max_upload_mb,
            limits=settings.pdf_limits(settings.pdf_extract_timeout_seconds),
        )
        if not await store.set_status(document_id, "chunking"):
            return
        chunks = await asyncio.to_thread(
            chunk_pages,
            pages,
            target_tokens=settings.chunk_target_tokens,
            max_tokens=settings.chunk_max_tokens,
            overlap_tokens=settings.chunk_overlap_tokens,
        )
        if not chunks:
            raise PdfError("No text could be read from this PDF.")
        await store.save_chunks(document_id, chunks)
        await store.set_status(document_id, "ready")
    except PdfError as e:
        await store.set_status(document_id, "failed", str(e))
    except Exception:
        # a bug or an outage, not the reader's file: log the details, tell them something useful
        log.exception("ingestion failed for document %s", document_id)
        await store.set_status(document_id, "failed", "Something went wrong reading this PDF. Try again.")
    finally:
        pdf.unlink(missing_ok=True)


def new_document_id() -> UUID:
    return uuid4()
