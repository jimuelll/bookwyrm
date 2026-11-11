"""The HTTP API. Run with:  uv run uvicorn app.main:app --reload

Routes so far: health, who-am-I, the reader's profile (display name), and their documents (upload,
list, status, delete). Every write to the database goes through here; browsers never write tables
directly. Quiz and stats routes come next (docs/ARCHITECTURE.md §6).
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.core.auth import AuthUser, InvalidToken, TokenVerifier, supabase_verifier
from app.db.session import make_engine, make_sessionmaker
from app.documents import (
    INTERRUPTED,
    DocumentRecord,
    DocumentStore,
    DuplicateDocument,
    FileTooLarge,
    SqlDocumentStore,
    Status,
    clean_filename,
    ingest,
    new_document_id,
    receive_upload,
    title_from_filename,
)
from app.ingestion import sandbox
from app.ingestion.extract import PdfError
from app.profiles import (
    InvalidDisplayName,
    ProfileStore,
    SqlProfileStore,
    clean_display_name,
    default_display_name,
)
from app.quotas import MB, QuotaExceeded, RateLimited, UploadRateLimiter, Usage, UserLocks, check_quota
from app.storage import FileStore, LocalFileStore, StorageError, SupabaseFileStore

log = logging.getLogger(__name__)


class Me(BaseModel):
    id: str
    email: str | None


class ProfileOut(BaseModel):
    display_name: str
    email: str | None
    # False until they save a name, so the UI can say the shown name is only a suggestion
    chosen: bool


class ProfileIn(BaseModel):
    display_name: str


class DocumentOut(BaseModel):
    id: UUID
    title: str
    filename: str
    page_count: int | None
    status: Status
    error: str | None  # set when status is "failed", written for the reader
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, d: DocumentRecord) -> "DocumentOut":
        return cls(
            id=d.id,
            title=d.title,
            filename=d.filename,
            page_count=d.page_count,
            status=d.status,
            error=d.error,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )


def create_app(
    settings: Settings | None = None,
    verifier: TokenVerifier | None = None,
    profiles: ProfileStore | None = None,
    documents: DocumentStore | None = None,
    files: FileStore | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if verifier is None and settings.supabase_url:
        verifier = supabase_verifier(settings.supabase_url, settings.supabase_jwt_secret)
    if settings.database_url and (profiles is None or documents is None):
        sessions = make_sessionmaker(make_engine(settings.database_url))
        profiles = profiles or SqlProfileStore(sessions)
        documents = documents or SqlDocumentStore(sessions)
    if files is not None:
        file_store: FileStore = files
    elif settings.supabase_url and settings.supabase_secret_key:
        file_store = SupabaseFileStore(
            settings.supabase_url, settings.supabase_secret_key, settings.storage_bucket
        )
    else:  # no secret key: tests and offline development keep files on this disk
        file_store = LocalFileStore(settings.storage_path)
    upload_limiter = UploadRateLimiter(settings.upload_rate_count, settings.upload_rate_window_seconds)
    upload_locks = UserLocks()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        sandbox.warm_up()  # start the first PDF worker now, not when the first reader uploads
        # Ingestion runs inside this process, so a restart (or a --reload) kills any job in progress
        # and its document would say "reading..." forever. Mark those failed so the reader can retry.
        # This assumes one API process; a jobs table that workers claim replaces it when we run several
        # (docs/ARCHITECTURE.md 5, `jobs`).
        if documents is not None:
            try:
                if count := await documents.fail_unfinished(INTERRUPTED):
                    log.warning("marked %d interrupted document(s) as failed", count)
            except Exception:
                log.exception("could not check for interrupted documents")
        yield
        if isinstance(file_store, SupabaseFileStore):
            await file_store.aclose()  # close its pooled HTTP connections cleanly on shutdown

    app = FastAPI(title="Bookwyrm API", version="0.1.0", lifespan=lifespan)
    # Browsers block a page on one origin (localhost:5173) from reading another (localhost:8000) unless
    # the API says it's allowed. Only our own frontend is listed; never "*" with credentials.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    bearer = HTTPBearer(auto_error=False)

    # A plain `def` dependency: FastAPI runs it in a worker thread, so fetching signing keys
    # (a network call, cached afterwards) doesn't block other requests.
    def current_user(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> AuthUser:
        if verifier is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Auth is not configured (set SUPABASE_URL)."
            )
        if credentials is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Log in first.", headers={"WWW-Authenticate": "Bearer"}
            )
        try:
            return verifier.verify(credentials.credentials)
        except InvalidToken:
            # don't echo why: telling an attacker "expired" vs "bad signature" only helps them
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Your session is invalid or expired. Log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from None

    def profile_store() -> ProfileStore:
        if profiles is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "The database is not configured (set DATABASE_URL)."
            )
        return profiles

    def document_store() -> DocumentStore:
        if documents is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "The database is not configured (set DATABASE_URL)."
            )
        return documents

    User = Annotated[AuthUser, Depends(current_user)]
    Profiles = Annotated[ProfileStore, Depends(profile_store)]
    Documents = Annotated[DocumentStore, Depends(document_store)]

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/auth/me")
    def me(user: User) -> Me:
        return Me(id=user.id, email=user.email)

    @app.get("/profile")
    async def get_profile(user: User, store: Profiles) -> ProfileOut:
        saved = await store.get_display_name(user.id)
        return ProfileOut(
            display_name=saved or default_display_name(user), email=user.email, chosen=saved is not None
        )

    @app.put("/profile")
    async def update_profile(body: ProfileIn, user: User, store: Profiles) -> ProfileOut:
        # The user id comes from the verified token, never from the request body, so nobody can
        # change someone else's name by sending a different id.
        try:
            name = clean_display_name(body.display_name)
        except InvalidDisplayName as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
        await store.set_display_name(user.id, name)
        return ProfileOut(display_name=name, email=user.email, chosen=True)

    @app.post("/documents", status_code=status.HTTP_202_ACCEPTED)
    async def upload_document(
        file: UploadFile, user: User, store: Documents, background: BackgroundTasks, response: Response
    ) -> DocumentOut:
        """Upload a PDF. 202: stored and queued for reading (poll GET /documents/{id}).
        200: this reader already has this exact file; that document is returned instead.
        413: too large, or no room left in the reader's quota. 429: too many uploads; see Retry-After."""
        # The cheap refusals first, before a single byte of the file is read.
        try:
            upload_limiter.hit(user.id)
        except RateLimited as e:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                str(e),
                headers={"Retry-After": str(e.retry_after_seconds)},
            ) from None

        def quota(current: Usage, adding_bytes: int) -> None:
            try:
                check_quota(
                    current,
                    adding_bytes=adding_bytes,
                    max_documents=settings.max_documents_per_user,
                    max_bytes=settings.max_storage_mb_per_user * MB,
                )
            except QuotaExceeded as e:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(e)) from None

        quota(await store.usage(user.id), 0)  # already full: say so now, instead of after a 25 MB upload

        temp_dir = settings.storage_path / "tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            received = await receive_upload(file, max_bytes=settings.max_upload_mb * MB, temp_dir=temp_dir)
        except FileTooLarge as e:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(e)) from None
        except PdfError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None

        try:
            # the quick checks, in a sandboxed child process (app/ingestion/sandbox.py), waited on from
            # a thread so the event loop stays free
            page_count = await asyncio.to_thread(
                sandbox.inspect_pdf,
                received.path,
                max_pages=settings.max_pages,
                max_mb=settings.max_upload_mb,
                limits=settings.pdf_limits(settings.pdf_inspect_timeout_seconds),
            )
            # One upload at a time per reader from here to "stored": otherwise two uploads sent together
            # could both see room for one more and both be saved.
            async with upload_locks(user.id):
                existing = await store.find_by_hash(user.id, received.sha256)
                if existing and existing.status != "failed":
                    response.status_code = status.HTTP_200_OK
                    return DocumentOut.of(existing)
                if existing:  # it failed last time (maybe a restart); start it over
                    await store.delete(user.id, existing.id)
                    await remove_file_quietly(user.id, existing.id)

                quota(await store.usage(user.id), received.size)

                filename = clean_filename(file.filename)
                document_id = new_document_id()
                try:
                    record = await store.create(
                        id=document_id,
                        user_id=user.id,
                        title=title_from_filename(filename),
                        filename=filename,
                        page_count=page_count,
                        content_hash=received.sha256,
                        size_bytes=received.size,
                    )
                except DuplicateDocument:  # the same file, uploaded twice at the same moment
                    raced = await store.find_by_hash(user.id, received.sha256)
                    if raced is None:
                        raise
                    response.status_code = status.HTTP_200_OK
                    return DocumentOut.of(raced)
                try:
                    await file_store.put(user.id, document_id, received.path)
                except StorageError:
                    # never leave a book on the shelf with no file behind it
                    log.exception("storing document %s failed", document_id)
                    await store.delete(user.id, document_id)
                    raise HTTPException(
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                        "Your PDF couldn't be stored just now. Try again.",
                    ) from None
        except PdfError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
        finally:
            received.path.unlink(missing_ok=True)  # copied into storage, or not needed

        # runs after this response is sent; the reader watches the status change by polling
        background.add_task(ingest, store, file_store, user.id, document_id, settings)
        return DocumentOut.of(record)

    @app.get("/documents")
    async def list_documents(user: User, store: Documents) -> list[DocumentOut]:
        """The reader's own documents, newest first."""
        return [DocumentOut.of(d) for d in await store.list_for(user.id)]

    @app.get("/documents/{document_id}")
    async def get_document(document_id: UUID, user: User, store: Documents) -> DocumentOut:
        found = await store.get(user.id, document_id)
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That PDF isn't in your library.")
        return DocumentOut.of(found)

    @app.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_document(document_id: UUID, user: User, store: Documents) -> None:
        """Remove a document's file, then the document and its passages (the database cascades).

        File first: if storage is down, the book stays on the shelf and the reader can try again,
        instead of leaving a file behind that nothing points to any more."""
        if await store.get(user.id, document_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That PDF isn't in your library.")
        try:
            await file_store.delete(user.id, document_id)
        except StorageError:
            log.exception("deleting the file of document %s failed", document_id)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "That PDF couldn't be removed just now. Try again."
            ) from None
        await store.delete(user.id, document_id)

    async def remove_file_quietly(user_id: str, document_id: UUID) -> None:
        """For clean-up on the way to something else: a leftover file is logged, not fatal."""
        try:
            await file_store.delete(user_id, document_id)
        except StorageError:
            log.exception("could not remove the old file of document %s", document_id)

    return app


app = create_app()
