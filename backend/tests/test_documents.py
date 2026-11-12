"""Uploading PDFs: the API, the ingestion job, and (with TEST_DATABASE_URL) the real tables.

FastAPI's TestClient runs background tasks before `client.post(...)` returns, so right after an upload
the document has already gone queued -> extracting -> chunking -> ready (or failed).
"""

import asyncio
import json
import os
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.auth import TokenVerifier
from app.documents import (
    DocumentRecord,
    DuplicateDocument,
    Status,
    clean_filename,
    ingest,
    title_from_filename,
)
from app.ingestion import sandbox
from app.ingestion.chunk import Chunk
from app.ingestion.sandbox import TIMED_OUT, Limits, run_sandboxed
from app.main import create_app
from app.providers.base import ProviderError
from app.providers.embeddings import EmbeddingProvider, FakeEmbedder
from app.quotas import Usage
from app.storage import LocalFileStore, StorageError, SupabaseFileStore
from tests.conftest import MakePdf
from tests.ingestion.test_sandbox import hang
from tests.test_profiles import ANA, ISSUER, KEY, auth, token

BEN = "22222222-2222-2222-2222-222222222222"
TEXT = "Photosynthesis turns light into chemical energy. Chlorophyll absorbs red and blue light. " * 8


class MemoryDocuments:
    """The documents and chunks tables, kept in dicts. Records every status it was given."""

    def __init__(self) -> None:
        self.rows: dict[UUID, DocumentRecord] = {}
        self.passages: dict[UUID, list[Chunk]] = {}
        self.history: dict[UUID, list[Status]] = {}
        self.vectors: dict[UUID, dict[str, list[float]]] = {}
        self.vector_model: dict[UUID, str] = {}
        self._tick = 0

    def _now(self) -> datetime:
        self._tick += 1  # strictly increasing, so "newest first" is well defined
        return datetime(2026, 11, 12, 9, 0, self._tick, tzinfo=UTC)

    async def find_by_hash(self, user_id: str, content_hash: str) -> DocumentRecord | None:
        return next(
            (d for d in self.rows.values() if d.user_id == user_id and d.content_hash == content_hash), None
        )

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
        if await self.find_by_hash(user_id, content_hash):
            raise DuplicateDocument
        now = self._now()
        self.rows[id] = DocumentRecord(
            id, user_id, title, filename, page_count, content_hash, size_bytes, "queued", None, now, now
        )
        self.history[id] = ["queued"]
        return self.rows[id]

    async def get(self, user_id: str, document_id: UUID) -> DocumentRecord | None:
        found = self.rows.get(document_id)
        return found if found and found.user_id == user_id else None

    async def list_for(self, user_id: str) -> list[DocumentRecord]:
        mine = [d for d in self.rows.values() if d.user_id == user_id]
        return sorted(mine, key=lambda d: d.created_at, reverse=True)

    async def usage(self, user_id: str) -> Usage:
        mine = await self.list_for(user_id)
        return Usage(documents=len(mine), bytes=sum(d.size_bytes for d in mine))

    async def set_status(self, document_id: UUID, status: Status, error: str | None = None) -> bool:
        if document_id not in self.rows:
            return False
        self.rows[document_id] = replace(
            self.rows[document_id], status=status, error=error, updated_at=self._now()
        )
        self.history[document_id].append(status)
        return True

    async def save_chunks(self, document_id: UUID, chunks: list[Chunk]) -> None:
        self.passages[document_id] = chunks

    async def chunks(self, document_id: UUID) -> list[Chunk]:
        return self.passages.get(document_id, [])

    async def save_embeddings(self, document_id: UUID, vectors: dict[str, list[float]], model: str) -> None:
        self.vectors[document_id] = vectors
        self.vector_model[document_id] = model

    async def similar(self, document_id: UUID, vector: list[float], limit: int) -> list[tuple[str, float]]:
        # the vectors are unit length, so a dot product is the cosine similarity pgvector would report
        scored = [
            (label, sum(a * b for a, b in zip(vector, other, strict=True)))
            for label, other in self.vectors.get(document_id, {}).items()
        ]
        return sorted(scored, key=lambda pair: -pair[1])[:limit]

    async def delete(self, user_id: str, document_id: UUID) -> bool:
        if await self.get(user_id, document_id) is None:
            return False
        del self.rows[document_id]
        self.passages.pop(document_id, None)
        self.vectors.pop(document_id, None)
        return True

    async def fail_unfinished(self, message: str) -> int:
        unfinished = [d.id for d in self.rows.values() if d.status not in ("ready", "failed")]
        for id in unfinished:
            await self.set_status(id, "failed", message)
        return len(unfinished)


@pytest.fixture
def store() -> MemoryDocuments:
    return MemoryDocuments()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # pinned, not left to the environment: CI sets EMBEDDING_PROVIDER=fake for the whole job
    return Settings(
        _env_file=None,
        embedding_provider="gemini",
        storage_dir=str(tmp_path / "storage"),
        max_upload_mb=1,
        max_pages=5,
    )


@pytest.fixture
def client(store: MemoryDocuments, settings: Settings) -> TestClient:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    return TestClient(create_app(settings, verifier, documents=store))


def upload(
    client: TestClient, path: Path, name: str = "Cell_Biology  ch3.pdf", user: str = ANA
) -> httpx.Response:
    with path.open("rb") as f:
        return client.post(
            "/documents", files={"file": (name, f, "application/pdf")}, headers=auth(token(sub=user))
        )


# --- uploading ---


def test_a_pdf_is_stored_read_and_cut_into_passages(
    client: TestClient, store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    response = upload(client, make_pdf([TEXT, TEXT]))

    assert response.status_code == 202
    body = response.json()
    assert (body["title"], body["filename"], body["page_count"], body["status"]) == (
        "Cell Biology ch3",
        "Cell_Biology  ch3.pdf",
        2,
        "queued",
    )
    document_id = UUID(body["id"])
    assert store.history[document_id] == ["queued", "extracting", "chunking", "ready"]
    assert store.passages[document_id][0].page_start == 1
    assert store.passages[document_id][-1].page_end == 2
    # kept under a name we chose, not the reader's
    assert LocalFileStore(settings.storage_path).path(ANA, document_id).is_file()
    assert not any((settings.storage_path / "tmp").iterdir())  # no temporary files left behind

    status = client.get(f"/documents/{document_id}", headers=auth(token()))
    assert (status.json()["status"], status.json()["error"]) == ("ready", None)


class DownEmbedder:
    """An embedding service that is out of quota or unreachable."""

    model = "down"
    dim = 768

    async def embed(self, texts: list[str], *, kind: str) -> list[list[float]]:
        raise ProviderError("gemini failed after 4 attempts: HTTP 429")


def client_embedding_with(
    store: MemoryDocuments, settings: Settings, embedder: EmbeddingProvider
) -> TestClient:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    return TestClient(create_app(settings, verifier, documents=store, embedder=embedder))


def test_every_passage_gets_a_vector_before_the_book_is_ready(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    client = client_embedding_with(store, settings, FakeEmbedder())

    document_id = UUID(upload(client, make_pdf([TEXT, TEXT])).json()["id"])

    assert store.history[document_id] == ["queued", "extracting", "chunking", "embedding", "ready"]
    assert set(store.vectors[document_id]) == {c.id for c in store.passages[document_id]}
    assert store.vector_model[document_id] == "fake-hash"  # recorded, so a model change can be detected


def test_a_book_is_still_readable_when_the_embedding_service_is_down(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    client = client_embedding_with(store, settings, DownEmbedder())

    response = upload(client, make_pdf([TEXT]))

    document_id = UUID(response.json()["id"])
    assert store.history[document_id][-1] == "ready"  # quizzes still work; topics fall back to keywords
    assert document_id not in store.vectors
    assert client.get(f"/documents/{document_id}", headers=auth(token())).json()["error"] is None


def test_without_an_embedder_the_embedding_step_is_skipped(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf
) -> None:
    document_id = UUID(upload(client, make_pdf([TEXT])).json()["id"])
    assert "embedding" not in store.history[document_id]


def test_refuses_a_file_that_is_not_a_pdf(client: TestClient, store: MemoryDocuments, tmp_path: Path) -> None:
    fake = tmp_path / "notes.pdf"
    fake.write_bytes(b"PK\x03\x04 this is really a .docx")
    response = upload(client, fake, "notes.pdf")
    assert response.status_code == 422
    assert response.json()["detail"] == "This file is not a PDF."
    assert store.rows == {}


def test_refuses_an_empty_file(client: TestClient, tmp_path: Path) -> None:
    empty = tmp_path / "empty.pdf"
    empty.write_bytes(b"")
    response = upload(client, empty)
    assert (response.status_code, response.json()["detail"]) == (422, "The file is empty.")


def test_refuses_a_file_over_the_size_limit(client: TestClient, tmp_path: Path) -> None:
    big = tmp_path / "big.pdf"
    big.write_bytes(b"%PDF-" + b"0" * (1024 * 1024 + 1))
    response = upload(client, big)
    assert response.status_code == 413
    assert "larger than 1 MB" in response.json()["detail"]


def test_refuses_a_pdf_over_the_page_limit(client: TestClient, make_pdf: MakePdf) -> None:
    response = upload(client, make_pdf([TEXT] * 6))
    assert response.status_code == 422
    assert "the limit is 5" in response.json()["detail"]


def test_a_scanned_pdf_fails_with_a_reason_the_reader_can_act_on(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf
) -> None:
    body = upload(client, make_pdf(["", ""])).json()  # pages with no text layer, like a scan
    document = client.get(f"/documents/{body['id']}", headers=auth(token())).json()
    assert document["status"] == "failed"
    assert "scanned" in document["error"]
    assert store.history[UUID(body["id"])] == ["queued", "extracting", "failed"]


def test_uploading_the_same_file_again_returns_the_book_already_there(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf
) -> None:
    pdf = make_pdf([TEXT])
    first = upload(client, pdf)
    again = upload(client, pdf, "renamed copy.pdf")
    assert (first.status_code, again.status_code) == (202, 200)
    assert again.json()["id"] == first.json()["id"]
    assert len(store.rows) == 1


def test_a_file_that_failed_before_is_read_again(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf
) -> None:
    pdf = make_pdf([TEXT])
    first = UUID(upload(client, pdf).json()["id"])
    asyncio.run(store.set_status(first, "failed", "Reading this PDF was interrupted."))
    again = upload(client, pdf)
    assert again.status_code == 202
    assert UUID(again.json()["id"]) != first
    assert list(store.rows) == [UUID(again.json()["id"])]


def test_needs_a_login(client: TestClient, make_pdf: MakePdf) -> None:
    with make_pdf([TEXT]).open("rb") as f:
        assert client.post("/documents", files={"file": ("a.pdf", f, "application/pdf")}).status_code == 401
    assert client.get("/documents").status_code == 401


# --- per-reader limits (app/quotas.py) ---


def limited_client(store: MemoryDocuments, settings: Settings, **limits: int) -> TestClient:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    return TestClient(create_app(settings.model_copy(update=limits), verifier, documents=store))


def test_a_full_shelf_refuses_another_book_before_reading_it(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    client = limited_client(store, settings, max_documents_per_user=1)
    assert upload(client, make_pdf(["First book. " * 20])).status_code == 202
    response = upload(client, make_pdf(["Second book. " * 20]))
    assert response.status_code == 413
    assert response.json()["detail"] == (
        "Your shelf is full: 1 PDFs is the limit. Remove one to make room for another."
    )
    assert len(store.rows) == 1
    # another reader's shelf is their own
    assert upload(client, make_pdf(["Ben's book. " * 20]), user=BEN).status_code == 202


def test_a_book_that_would_pass_the_storage_limit_is_refused(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    first = make_pdf(["First book. " * 20])
    client = limited_client(store, settings, max_storage_mb_per_user=1)
    # an earlier book that leaves just under this file's size free of the 1 MB
    earlier = asyncio.run(
        store.create(
            id=uuid.uuid4(),
            user_id=ANA,
            title="earlier",
            filename="earlier.pdf",
            page_count=1,
            content_hash="e",
            size_bytes=1024 * 1024 - first.stat().st_size + 1,
        )
    )

    response = upload(client, first)
    assert response.status_code == 413
    assert "Remove a PDF to make room." in response.json()["detail"]
    assert list(store.rows) == [earlier.id]
    assert not any((settings.storage_path / "tmp").iterdir())  # the upload was cleaned up


def test_removing_a_book_makes_room_again(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    client = limited_client(store, settings, max_documents_per_user=1)
    first = upload(client, make_pdf(["First book. " * 20])).json()["id"]
    client.delete(f"/documents/{first}", headers=auth(token()))
    assert upload(client, make_pdf(["Second book. " * 20])).status_code == 202


def test_too_many_uploads_in_a_row_are_refused_with_retry_after(
    store: MemoryDocuments, settings: Settings, tmp_path: Path
) -> None:
    client = limited_client(store, settings, upload_rate_count=2, upload_rate_window_seconds=600)
    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"not a pdf")  # refused attempts count too: they still cost us reading them
    assert [upload(client, junk).status_code for _ in range(2)] == [422, 422]

    response = upload(client, junk)
    assert response.status_code == 429
    assert 590 <= int(response.headers["Retry-After"]) <= 600  # seconds until the oldest leaves the window
    assert response.json()["detail"] == (
        "You've uploaded 2 PDFs in the last 10 minutes. Try again in 10 minutes."
    )
    assert upload(client, junk, user=BEN).status_code == 422  # Ben has his own count


# --- the sandbox's timeout, as the reader sees it ---


def hanging_parse(path: Path, **_: object) -> object:
    return run_sandboxed(hang, limits=Limits(timeout_seconds=1, memory_mb=0))


def test_a_pdf_that_takes_too_long_to_check_is_refused(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sandbox, "inspect_pdf", hanging_parse)
    response = upload(client, make_pdf([TEXT]))
    assert (response.status_code, response.json()["detail"]) == (422, TIMED_OUT)
    assert store.rows == {}


def test_a_pdf_that_takes_too_long_to_read_is_recorded_as_failed(
    client: TestClient, store: MemoryDocuments, make_pdf: MakePdf, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sandbox, "extract_pages", hanging_parse)
    body = upload(client, make_pdf([TEXT])).json()
    document = client.get(f"/documents/{body['id']}", headers=auth(token())).json()
    assert (document["status"], document["error"]) == ("failed", TIMED_OUT)
    assert store.history[UUID(body["id"])] == ["queued", "extracting", "failed"]


# --- listing, status, deleting ---


def test_lists_only_the_readers_own_books_newest_first(client: TestClient, make_pdf: MakePdf) -> None:
    older = upload(client, make_pdf(["Older notes. " * 20]), "older.pdf").json()
    newer = upload(client, make_pdf(["Newer notes. " * 20]), "newer.pdf").json()
    upload(client, make_pdf(["Ben's notes. " * 20]), "ben.pdf", user=BEN)

    listed = client.get("/documents", headers=auth(token())).json()
    assert [d["id"] for d in listed] == [newer["id"], older["id"]]


def test_another_readers_book_looks_like_it_does_not_exist(client: TestClient, make_pdf: MakePdf) -> None:
    bens = upload(client, make_pdf([TEXT]), user=BEN).json()
    response = client.get(f"/documents/{bens['id']}", headers=auth(token()))
    assert response.status_code == 404
    assert client.delete(f"/documents/{bens['id']}", headers=auth(token())).status_code == 404


def test_deleting_removes_the_row_and_the_file(
    client: TestClient, store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    document_id = UUID(upload(client, make_pdf([TEXT])).json()["id"])
    assert client.delete(f"/documents/{document_id}", headers=auth(token())).status_code == 204
    assert store.rows == {}
    assert not LocalFileStore(settings.storage_path).path(ANA, document_id).exists()
    assert client.get("/documents", headers=auth(token())).json() == []


def test_a_restart_marks_unfinished_books_failed(store: MemoryDocuments, settings: Settings) -> None:

    stuck = asyncio.run(
        store.create(
            id=uuid.uuid4(),
            user_id=ANA,
            title="t",
            filename="t.pdf",
            page_count=1,
            content_hash="h",
            size_bytes=1,
        ),
    )
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    with TestClient(create_app(settings, verifier, documents=store)):  # `with` runs startup
        pass
    assert store.rows[stuck.id].status == "failed"
    assert "interrupted" in (store.rows[stuck.id].error or "")


def test_says_the_database_is_not_configured(settings: Settings) -> None:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    # CI exports DATABASE_URL, so blank it explicitly rather than relying on its absence.
    unconfigured = settings.model_copy(update={"database_url": ""})
    client = TestClient(create_app(unconfigured, verifier))
    assert client.get("/documents", headers=auth(token())).status_code == 503


# --- the job and the helpers ---


async def test_a_book_removed_while_being_read_is_left_alone(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    gone = uuid.uuid4()
    files = LocalFileStore(settings.storage_path)
    await files.put(ANA, gone, make_pdf([TEXT]))
    await ingest(store, files, ANA, gone, settings)  # no row: nothing to update, no crash
    assert store.rows == {}


# --- when storage fails ---


class BrokenFiles:
    """Storage that is down."""

    async def put(self, user_id: str, document_id: UUID, source: Path) -> None:
        raise StorageError("storage unreachable")

    async def download(self, user_id: str, document_id: UUID, dest: Path) -> None:
        raise StorageError("storage unreachable")

    async def delete(self, user_id: str, document_id: UUID) -> None:
        raise StorageError("storage unreachable")


def test_if_the_file_cannot_be_stored_no_book_is_left_behind(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    client = TestClient(create_app(settings, verifier, documents=store, files=BrokenFiles()))
    response = upload(client, make_pdf([TEXT]))
    assert response.status_code == 503
    assert response.json()["detail"] == "Your PDF couldn't be stored just now. Try again."
    assert store.rows == {}


def test_if_the_file_cannot_be_removed_the_book_stays(
    store: MemoryDocuments, settings: Settings, make_pdf: MakePdf
) -> None:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    working = TestClient(create_app(settings, verifier, documents=store))
    document_id = upload(working, make_pdf([TEXT])).json()["id"]

    broken = TestClient(create_app(settings, verifier, documents=store, files=BrokenFiles()))
    response = broken.delete(f"/documents/{document_id}", headers=auth(token()))
    assert response.status_code == 503
    assert UUID(document_id) in store.rows  # still there; the reader can try again


async def test_a_book_whose_file_cannot_be_fetched_fails_with_a_retry_message(
    store: MemoryDocuments, settings: Settings
) -> None:
    record = await store.create(
        id=uuid.uuid4(),
        user_id=ANA,
        title="t",
        filename="t.pdf",
        page_count=1,
        content_hash="h",
        size_bytes=1,
    )
    await ingest(store, BrokenFiles(), ANA, record.id, settings)
    assert store.rows[record.id].status == "failed"
    assert store.rows[record.id].error == "Something went wrong reading this PDF. Try again."
    assert not any((settings.storage_path / "tmp").iterdir())  # the temporary copy is gone


# --- the Supabase bucket, against a fake Storage API ---


async def test_the_bucket_store_speaks_supabase_storage(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    objects: dict[str, bytes] = {}

    def storage_api(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        prefix = "/storage/v1/object/documents"
        if request.method == "POST":
            objects[request.url.path.removeprefix(prefix + "/")] = request.content
            return httpx.Response(200, json={"Key": "ok"})
        if request.method == "GET":
            key = request.url.path.removeprefix(prefix + "/")
            return httpx.Response(200, content=objects[key]) if key in objects else httpx.Response(404)
        if request.method == "DELETE":
            for key in json.loads(request.content)["prefixes"]:
                objects.pop(key, None)
            return httpx.Response(200, json=[])
        return httpx.Response(405)

    client = httpx.AsyncClient(transport=httpx.MockTransport(storage_api))
    bucket = SupabaseFileStore("https://demo.supabase.co/", "sb_secret_abc", "documents", client)
    document_id = uuid.uuid4()
    source = tmp_path / "in.pdf"
    source.write_bytes(b"%PDF-1.7 hello")

    await bucket.put(ANA, document_id, source)
    key = f"{ANA}/{document_id}.pdf"
    assert seen[0].url == f"https://demo.supabase.co/storage/v1/object/documents/{key}"
    assert seen[0].headers["apikey"] == "sb_secret_abc"
    assert "authorization" not in seen[0].headers  # an sb_secret_ key is not a JWT
    assert seen[0].headers["x-upsert"] == "true"

    copy = tmp_path / "out.pdf"
    await bucket.download(ANA, document_id, copy)
    assert copy.read_bytes() == b"%PDF-1.7 hello"

    await bucket.delete(ANA, document_id)
    assert objects == {}
    with pytest.raises(StorageError, match="404"):
        await bucket.download(ANA, document_id, copy)
    await bucket.aclose()


def test_a_legacy_service_role_key_is_also_sent_as_a_bearer_token() -> None:
    bucket = SupabaseFileStore("https://demo.supabase.co", "eyJhbGciOi.legacy.jwt", "documents")
    assert bucket._headers["Authorization"] == "Bearer eyJhbGciOi.legacy.jwt"


def test_filenames_are_stripped_of_folders_and_control_characters() -> None:
    assert clean_filename("C:\\Users\\ana\\notes.pdf") == "notes.pdf"
    assert clean_filename("../../etc/passwd") == "passwd"
    assert clean_filename("bad\x00name\u202e.pdf") == "badname.pdf"
    assert clean_filename(None) == "document.pdf"


def test_titles_come_from_the_filename() -> None:
    assert title_from_filename("cell_biology__ch3.PDF") == "cell biology ch3"
    assert title_from_filename(".pdf") == "Untitled PDF"


# --- the real tables (runs where a test database exists, e.g. CI) ---

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL (a disposable database) to run")
async def test_the_documents_tables_store_a_book_and_its_passages(
    settings: Settings, make_pdf: MakePdf
) -> None:
    from app.db.session import make_engine, make_sessionmaker
    from app.documents import SqlDocumentStore

    engine = make_engine(TEST_DATABASE_URL)
    sql = SqlDocumentStore(make_sessionmaker(engine))
    user, document_id = str(uuid.uuid4()), uuid.uuid4()
    try:
        await sql.create(
            id=document_id,
            user_id=user,
            title="t",
            filename="t.pdf",
            page_count=1,
            content_hash="a" * 64,
            size_bytes=1,
        )
        with pytest.raises(DuplicateDocument):
            await sql.create(
                id=uuid.uuid4(),
                user_id=user,
                title="t",
                filename="t.pdf",
                page_count=1,
                content_hash="a" * 64,
                size_bytes=1,
            )
        files = LocalFileStore(settings.storage_path)
        await files.put(user, document_id, make_pdf([TEXT]))
        embedder = FakeEmbedder()
        await ingest(sql, files, user, document_id, settings, embedder)
        found = await sql.get(user, document_id)
        assert found is not None and found.status == "ready"
        # pgvector: the nearest passage to a query made of the same words is that passage
        (query,) = await embedder.embed([TEXT], kind="query")
        hits = await sql.similar(document_id, query, 3)
        assert hits[0][0] == "c1" and hits[0][1] > 0.9
        assert await sql.similar(uuid.uuid4(), query, 3) == []  # only within the one document
        assert await sql.get(str(uuid.uuid4()), document_id) is None  # not someone else's
        assert [d.id for d in await sql.list_for(user)] == [document_id]
        assert await sql.delete(user, document_id)  # chunks go with it (ON DELETE CASCADE)
    finally:
        await engine.dispose()
