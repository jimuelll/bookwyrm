"""Per-reader upload limits: how much one account may store, and how fast it may upload.

Without these, one account (a bug in a script, a stolen login, or just someone very keen) could fill
the server's disk or keep the PDF parser busy for everyone. Two kinds of limit:

  quota       a ceiling on what a reader keeps: N documents and M megabytes in total. Exceeding it
              is answered with 413 (Content Too Large), with a message that says what to remove.
  rate limit  a ceiling on how often: at most N upload attempts in any rolling window of W seconds.
              Exceeding it is answered with 429 (Too Many Requests) and a Retry-After header.

The rate limiter keeps its counts in this process's memory. That is correct while the API is one
process (it is today, docs/ARCHITECTURE.md §5). With several processes each would count separately,
so a reader would get N uploads per process; at that point the counts move to a shared store (Redis,
or a Postgres table), or to the proxy in front (Cloudflare rate limiting rules).
"""

import asyncio
import math
import time
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass

MB = 1024 * 1024


class QuotaExceeded(Exception):
    """The reader has no room for this upload. The message is written for them."""


class RateLimited(Exception):
    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class Usage:
    documents: int
    bytes: int


def _mb(n: int) -> str:
    return f"{math.ceil(n / MB)} MB"


def check_quota(usage: Usage, *, adding_bytes: int, max_documents: int, max_bytes: int) -> None:
    """Raise QuotaExceeded if one more document of `adding_bytes` would not fit.

    Call with adding_bytes=0 before reading the upload to refuse early when the reader is already full.
    """
    if usage.documents >= max_documents:
        raise QuotaExceeded(
            f"Your shelf is full: {max_documents} PDFs is the limit. Remove one to make room for another."
        )
    if usage.bytes + adding_bytes > max_bytes or (adding_bytes == 0 and usage.bytes >= max_bytes):
        raise QuotaExceeded(
            f"Your PDFs use {_mb(usage.bytes)} of your {_mb(max_bytes)}"
            + (f", and this one needs {_mb(adding_bytes)} more" if adding_bytes else "")
            + ". Remove a PDF to make room."
        )


def _wait_phrase(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = math.ceil(seconds / 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


class UploadRateLimiter:
    """At most `max_uploads` per reader in any rolling `window_seconds` (a "sliding log").

    For each reader we keep the times of their recent uploads. On a new one, drop the times older than
    the window; if `max_uploads` remain, refuse and say when the oldest leaves the window. Simpler
    schemes (a counter reset every 10 minutes) let a reader send 2N uploads across a reset; this doesn't.
    """

    def __init__(
        self, max_uploads: int, window_seconds: int, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.max_uploads = max_uploads
        self.window = window_seconds
        self._clock = clock
        self._recent: dict[str, deque[float]] = {}

    def hit(self, user_id: str) -> None:
        """Count one upload attempt, or raise RateLimited (without counting it) if over the limit."""
        now = self._clock()
        recent = self._recent.setdefault(user_id, deque())
        while recent and recent[0] <= now - self.window:
            recent.popleft()
        if len(recent) >= self.max_uploads:
            wait = max(1, math.ceil(recent[0] + self.window - now))
            raise RateLimited(
                f"You've uploaded {self.max_uploads} PDFs in the last {_wait_phrase(self.window)}. "
                f"Try again in {_wait_phrase(wait)}.",
                retry_after_seconds=wait,
            )
        recent.append(now)


class UserLocks:
    """One asyncio lock per reader, so two uploads from the same reader at the same moment can't both
    pass the quota check before either is saved. One lock per reader seen since startup: tiny."""

    def __init__(self) -> None:
        self._locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def __call__(self, user_id: str) -> asyncio.Lock:
        return self._locks[user_id]
