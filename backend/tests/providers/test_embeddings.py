import json
import math
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.providers.base import ProviderError
from app.providers.embeddings import FakeEmbedder, GeminiEmbedder, build_embedder, normalize


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))  # unit vectors: the dot product is the cosine


def client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=handler)


def reply(count: int, dim: int) -> httpx.Response:
    # a vector that is not unit length, as a shortened Gemini embedding is
    return httpx.Response(200, json={"embeddings": [{"values": [3.0] + [0.0] * (dim - 1)}] * count})


def test_normalizing_scales_to_length_one_and_leaves_zero_alone() -> None:
    assert normalize([3.0, 4.0]) == pytest.approx([0.6, 0.8])
    assert normalize([0.0, 0.0]) == [0.0, 0.0]


async def test_the_fake_embedder_is_deterministic_and_unit_length() -> None:
    first = await FakeEmbedder(32).embed(["The cell membrane"], kind="document")
    again = await FakeEmbedder(32).embed(["The cell membrane"], kind="document")

    assert first == again  # same text, same vector, in any process
    assert math.sqrt(sum(x * x for x in first[0])) == pytest.approx(1.0)


async def test_texts_that_share_words_are_closer_than_texts_that_do_not() -> None:
    query, near, far = await FakeEmbedder().embed(
        ["ATP production in the mitochondria", "Mitochondria make ATP for the cell", "French Revolution"],
        kind="document",
    )

    assert cosine(query, near) > 0.4
    assert cosine(query, far) < 0.1  # no word in common (only a shared filler word would add overlap)


async def test_gemini_asks_for_the_right_task_and_size_and_rescales_the_answer() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return reply(2, 8)

    async with client(httpx.MockTransport(handle)) as c:
        vectors = await GeminiEmbedder("k-123", "embed-test", 8, c).embed(["a", "b"], kind="query")

    body = json.loads(seen[0].content)
    assert seen[0].headers["x-goog-api-key"] == "k-123" and "k-123" not in str(seen[0].url)
    assert seen[0].url.path.endswith("/models/embed-test:batchEmbedContents")
    assert {r["taskType"] for r in body["requests"]} == {"RETRIEVAL_QUERY"}
    assert {r["outputDimensionality"] for r in body["requests"]} == {8}
    assert vectors[0][0] == pytest.approx(1.0)  # [3, 0, ...] rescaled to unit length


async def test_stored_passages_are_embedded_as_documents() -> None:
    kinds: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests = json.loads(request.content)["requests"]
        kinds.extend(r["taskType"] for r in requests)
        return reply(len(requests), 8)

    async with client(httpx.MockTransport(handle)) as c:
        await GeminiEmbedder("k", "m", 8, c).embed(["a"], kind="document")

    assert kinds == ["RETRIEVAL_DOCUMENT"]


async def test_more_texts_than_one_call_allows_are_sent_in_batches() -> None:
    sizes: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        count = len(json.loads(request.content)["requests"])
        sizes.append(count)
        return reply(count, 8)

    async with client(httpx.MockTransport(handle)) as c:
        vectors = await GeminiEmbedder("k", "m", 8, c).embed([str(i) for i in range(230)], kind="document")

    assert sizes == [100, 100, 30]
    assert len(vectors) == 230  # in order, none lost


async def test_an_answer_of_the_wrong_size_is_refused_rather_than_stored() -> None:
    async with client(httpx.MockTransport(lambda _: reply(2, 4))) as c:  # asked for 8 numbers each
        with pytest.raises(ProviderError, match="wrong number or size"):
            await GeminiEmbedder("k", "m", 8, c).embed(["a", "b"], kind="document")


async def test_an_answer_in_an_unexpected_shape_is_a_provider_error() -> None:
    async with client(httpx.MockTransport(lambda _: httpx.Response(200, json={"oops": 1}))) as c:
        with pytest.raises(ProviderError, match="unexpected shape"):
            await GeminiEmbedder("k", "m", 8, c).embed(["a"], kind="document")


def test_gemini_needs_a_key() -> None:
    with pytest.raises(ProviderError, match="GEMINI_API_KEY"):
        GeminiEmbedder("", "m", 8, httpx.AsyncClient())


def test_the_settings_pick_the_embedder() -> None:
    http = httpx.AsyncClient()
    # pinned, not left to the environment: CI sets EMBEDDING_PROVIDER=fake for the whole job
    base: dict[str, Any] = {"_env_file": None, "embedding_provider": "gemini"}

    assert build_embedder(Settings(**base, gemini_api_key=""), http) is None  # no key: keywords only
    assert isinstance(build_embedder(Settings(**base, gemini_api_key="k"), http), GeminiEmbedder)
    fake = build_embedder(Settings(**{**base, "embedding_provider": "fake"}), http)
    assert isinstance(fake, FakeEmbedder) and fake.dim == 768
