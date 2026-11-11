import json

import httpx
import pytest

from app.config import Settings
from app.providers.base import ProviderError
from app.providers.factory import build_provider
from app.providers.fake import FakeProvider
from app.providers.fallback import FallbackProvider
from app.providers.gemini import GeminiProvider
from app.providers.groq import GroqProvider


def client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


def gemini_reply(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


async def test_gemini_sends_the_key_in_a_header_and_returns_the_text() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return gemini_reply('{"ok": true}')

    async with client(httpx.MockTransport(handle)) as c:
        text = await GeminiProvider("k-123", "gemini-test", c).generate_json("sys", "hi")

    assert text == '{"ok": true}'
    assert seen[0].headers["x-goog-api-key"] == "k-123"
    assert "k-123" not in str(seen[0].url)
    assert json.loads(seen[0].content)["generationConfig"]["responseMimeType"] == "application/json"


async def test_retries_a_rate_limit_then_succeeds() -> None:
    responses = iter([httpx.Response(429, text="slow down"), gemini_reply("{}")])
    async with client(httpx.MockTransport(lambda _: next(responses))) as c:
        text = await GeminiProvider("k", "m", c, base_delay=0).generate_json("sys", "hi")
    assert text == "{}"


async def test_does_not_retry_a_bad_key() -> None:
    calls = 0

    def handle(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(401, text="invalid key")

    async with client(httpx.MockTransport(handle)) as c:
        with pytest.raises(ProviderError, match="401"):
            await GeminiProvider("k", "m", c, base_delay=0).generate_json("sys", "hi")
    assert calls == 1


async def test_groq_reads_the_chat_message() -> None:
    reply = {"choices": [{"message": {"content": '{"a": 1}'}}]}
    async with client(httpx.MockTransport(lambda _: httpx.Response(200, json=reply))) as c:
        assert await GroqProvider("k", "llama", c).generate_json("sys", "hi") == '{"a": 1}'


async def test_falls_back_to_the_next_provider_and_stays_there() -> None:
    def broken(_: str, __: str) -> str:
        raise ProviderError("gemini down")

    primary, backup = FakeProvider(broken), FakeProvider(lambda *_: "{}")
    provider = FallbackProvider([primary, backup])

    await provider.generate_json("sys", "one")
    await provider.generate_json("sys", "two")

    assert len(primary.calls) == 1  # not retried on the second call
    assert len(backup.calls) == 2


def test_needs_at_least_one_key() -> None:
    settings = Settings(_env_file=None, llm_provider="gemini", gemini_api_key="", groq_api_key="")
    with pytest.raises(ProviderError, match="No API key"):
        build_provider(settings, httpx.AsyncClient())


def test_gemini_first_with_groq_as_fallback() -> None:
    settings = Settings(_env_file=None, llm_provider="gemini", gemini_api_key="g", groq_api_key="q")
    provider = build_provider(settings, httpx.AsyncClient())
    assert provider.name == "gemini"
