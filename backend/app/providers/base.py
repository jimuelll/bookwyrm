"""The interface every LLM provider implements, plus shared HTTP retry logic.

Providers are deliberately dumb: they send a system prompt and a user prompt, ask for JSON, and
return the raw text. Parsing and validating that JSON is the caller's job (app/generation), so the
same checks apply whichever model answered. See docs/ARCHITECTURE.md §7.
"""

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx

log = logging.getLogger(__name__)

# Rate limits and server hiccups are worth retrying; anything else 4xx is our mistake or a bad key.
RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class ProviderError(Exception):
    """The provider couldn't give an answer (bad key, outage, rate limit after retries, ...)."""


class LLMProvider(Protocol):
    # read-only properties, so both plain attributes and computed ones (FallbackProvider) fit
    @property
    def name(self) -> str: ...

    @property
    def model(self) -> str: ...

    async def generate_json(self, system: str, prompt: str, *, temperature: float = 0.2) -> str:
        """Return the model's reply, which it was asked to make a single JSON object."""
        ...


async def post_json(
    client: httpx.AsyncClient,
    url: str,
    *,
    provider: str,
    headers: dict[str, str],
    body: dict[str, Any],
    attempts: int = 4,
    base_delay: float = 1.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> dict[str, Any]:
    """POST with retries: exponential backoff with jitter on timeouts, 429 and 5xx.

    When the server says how long to wait (a `Retry-After` header, which rate limits send), that is
    honoured instead of guessing: a per-minute token limit needs seconds to clear, not 1s and 2s.
    """
    for attempt in range(1, attempts + 1):
        started = time.perf_counter()
        wait_hint = 0.0
        try:
            response = await client.post(url, headers=headers, json=body)
        except httpx.TransportError as e:  # timeouts, refused connections, DNS
            error: str = f"network error: {e.__class__.__name__}"
        else:
            elapsed = time.perf_counter() - started
            if response.is_success:
                log.info("%s ok in %.1fs (attempt %d)", provider, elapsed, attempt)
                data: dict[str, Any] = response.json()
                return data
            error = f"HTTP {response.status_code}: {response.text[:300]}"
            if response.status_code not in RETRYABLE_STATUS:
                raise ProviderError(f"{provider} {error}")
            wait_hint = retry_after_seconds(response)
        log.warning("%s attempt %d/%d failed: %s", provider, attempt, attempts, error)
        if attempt < attempts:
            # 1s, 2s, 4s ... plus jitter, so parallel requests don't retry in lockstep
            backoff = base_delay * 2 ** (attempt - 1) + random.uniform(0, base_delay / 2)
            await sleep(max(backoff, wait_hint))
    raise ProviderError(f"{provider} failed after {attempts} attempts: {error}")


MAX_RETRY_WAIT = 30.0  # never sleep longer than this on a server's say-so; a quiz is waiting on us


def retry_after_seconds(response: httpx.Response) -> float:
    """Seconds the server asked us to wait (capped), or 0 if it didn't say or said something odd."""
    try:
        seconds = float(response.headers.get("retry-after", ""))
    except ValueError:  # absent, or an HTTP date instead of a number of seconds
        return 0.0
    return min(max(seconds, 0.0), MAX_RETRY_WAIT)
