"""Where the original PDF files live.

In a private Supabase Storage bucket when the server has the project's secret key (production), else in a
folder on the server's disk (tests, offline development). Either way, files are named by owner and
document id, never by the name the reader gave them: a filename like "../../app/main.py" can't escape,
and two readers' "notes.pdf" never collide.

Ingestion needs a real file to hand to PyMuPDF, so the job downloads a temporary copy (`download`) and
deletes it when done; storage stays the one place the file is kept.
"""

import asyncio
import shutil
from pathlib import Path
from typing import Protocol
from uuid import UUID

import httpx


class StorageError(Exception):
    """Storage refused or couldn't be reached. Not the reader's fault; the message is for the logs."""


def object_key(user_id: str, document_id: UUID) -> str:
    # both parts are UUIDs we generated or verified, so the key can't point anywhere else
    return f"{UUID(user_id)}/{document_id}.pdf"


class FileStore(Protocol):
    async def put(self, user_id: str, document_id: UUID, source: Path) -> None:
        """Copy `source` into storage (the caller still owns `source`)."""
        ...

    async def download(self, user_id: str, document_id: UUID, dest: Path) -> None:
        """Write the stored file to `dest`."""
        ...

    async def delete(self, user_id: str, document_id: UUID) -> None:
        """Remove the file; no error if it's already gone."""
        ...


class LocalFileStore:
    """A folder on this server's disk. Fine for tests and offline work; most hosts wipe it on redeploy."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def path(self, user_id: str, document_id: UUID) -> Path:
        return self.root / object_key(user_id, document_id)

    async def put(self, user_id: str, document_id: UUID, source: Path) -> None:
        target = self.path(user_id, document_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.copyfile, source, target)

    async def download(self, user_id: str, document_id: UUID, dest: Path) -> None:
        source = self.path(user_id, document_id)
        if not source.is_file():
            raise StorageError(f"no stored file for document {document_id}")
        await asyncio.to_thread(shutil.copyfile, source, dest)

    async def delete(self, user_id: str, document_id: UUID) -> None:
        self.path(user_id, document_id).unlink(missing_ok=True)


class SupabaseFileStore:
    """A private Supabase Storage bucket, reached over its REST API with the project's secret key.

    The bucket is private (migration 0003): nothing in it has a public URL, and browsers can't list or
    read it with the publishable key. Only this server can. When readers can open their PDF, the API
    will hand out short-lived signed URLs.
    """

    def __init__(
        self, supabase_url: str, secret_key: str, bucket: str, client: httpx.AsyncClient | None = None
    ) -> None:
        self._base = f"{supabase_url.rstrip('/')}/storage/v1/object"
        self._bucket = bucket
        headers = {"apikey": secret_key}
        # Legacy service_role keys are JWTs and go in Authorization too; the newer sb_secret_... keys
        # are not JWTs and are sent as `apikey` only.
        if secret_key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {secret_key}"
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
        self._headers = headers

    async def aclose(self) -> None:
        await self._client.aclose()

    def _url(self, user_id: str, document_id: UUID) -> str:
        return f"{self._base}/{self._bucket}/{object_key(user_id, document_id)}"

    async def _send(self, request: httpx.Request) -> httpx.Response:
        try:
            response = await self._client.send(request, stream=request.method == "GET")
        except httpx.HTTPError as e:
            raise StorageError(f"storage unreachable: {e!r}") from e
        if response.is_error:
            await response.aread()
            body = response.text[:300]
            await response.aclose()
            raise StorageError(f"storage {request.method} failed: {response.status_code} {body}")
        return response

    async def put(self, user_id: str, document_id: UUID, source: Path) -> None:
        data = await asyncio.to_thread(source.read_bytes)  # at most MAX_UPLOAD_MB
        request = self._client.build_request(
            "POST",
            self._url(user_id, document_id),
            content=data,
            # x-upsert: a retried upload of the same document replaces the file instead of failing
            headers={**self._headers, "Content-Type": "application/pdf", "x-upsert": "true"},
        )
        await self._send(request)

    async def download(self, user_id: str, document_id: UUID, dest: Path) -> None:
        request = self._client.build_request("GET", self._url(user_id, document_id), headers=self._headers)
        response = await self._send(request)
        try:
            with dest.open("wb") as out:
                async for piece in response.aiter_bytes():
                    out.write(piece)
        finally:
            await response.aclose()

    async def delete(self, user_id: str, document_id: UUID) -> None:
        # Storage deletes by a list of keys, and answers 200 even for keys that don't exist
        request = self._client.build_request(
            "DELETE",
            f"{self._base}/{self._bucket}",
            json={"prefixes": [object_key(user_id, document_id)]},
            headers=self._headers,
        )
        await self._send(request)
