"""Finding a topic's passages by meaning: the similarity floor, the cache, and falling back to keywords."""

from uuid import UUID, uuid4

from app.ingestion.chunk import Chunk
from app.providers.base import ProviderError
from app.providers.embeddings import FakeEmbedder, Kind
from app.retrieval import TopicSearch
from tests.test_documents import MemoryDocuments

PASSAGES = [
    "Mitochondria produce ATP, the energy currency the cell spends.",
    "Chloroplasts capture light and store its energy as sugar.",
    "The nucleus stores the genetic material of the cell.",
]


class CountingEmbedder(FakeEmbedder):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[tuple[list[str], Kind]] = []

    async def embed(self, texts: list[str], *, kind: Kind) -> list[list[float]]:
        self.calls.append((texts, kind))
        return await super().embed(texts, kind=kind)


class DownEmbedder(FakeEmbedder):
    async def embed(self, texts: list[str], *, kind: Kind) -> list[list[float]]:
        raise ProviderError("gemini failed after 4 attempts: HTTP 429")


async def book(embedder: FakeEmbedder) -> tuple[MemoryDocuments, UUID]:
    store, document_id = MemoryDocuments(), uuid4()
    chunks = [
        Chunk(id=f"c{i}", text=t, page_start=i, page_end=i, token_count=20, page_marks=((0, i),))
        for i, t in enumerate(PASSAGES, start=1)
    ]
    await store.save_embeddings(
        document_id,
        {c.id: v for c, v in zip(chunks, await embedder.embed(PASSAGES, kind="document"), strict=True)},
        embedder.model,
    )
    return store, document_id


def search(store: MemoryDocuments, embedder: FakeEmbedder | None, **kw: float) -> TopicSearch:
    return TopicSearch(store, embedder, top_k=int(kw.get("top_k", 12)), min_similarity=kw.get("floor", 0.3))


async def test_a_topic_finds_the_passages_close_to_it() -> None:
    embedder = FakeEmbedder()
    store, document_id = await book(embedder)

    hits = await search(store, embedder).find(document_id, "ATP energy in the cell")

    assert "c1" in hits and hits["c1"] == max(hits.values())  # the mitochondria passage is the closest


async def test_a_topic_the_book_never_covers_finds_nothing_because_of_the_floor() -> None:
    # "nearest" always returns something; only the similarity floor lets us say "nothing about that"
    embedder = FakeEmbedder()
    store, document_id = await book(embedder)

    assert await search(store, embedder).find(document_id, "French Revolution") == {}


async def test_only_the_closest_few_are_kept() -> None:
    embedder = FakeEmbedder()
    store, document_id = await book(embedder)

    hits = await search(store, embedder, top_k=1, floor=0.0).find(document_id, "energy of the cell")

    assert len(hits) == 1


async def test_a_repeated_topic_is_embedded_once() -> None:
    embedder = CountingEmbedder()
    store, document_id = await book(embedder)
    embedder.calls.clear()
    topic_search = search(store, embedder)

    await topic_search.find(document_id, "Cell energy")
    await topic_search.find(document_id, "  cell   ENERGY ")  # same topic, typed differently

    assert embedder.calls == [(["Cell energy"], "query")]  # embedded as a query, and only the first time


async def test_the_cache_forgets_the_oldest_topic_first() -> None:
    embedder = CountingEmbedder()
    store, document_id = await book(embedder)
    embedder.calls.clear()
    topic_search = TopicSearch(store, embedder, top_k=3, min_similarity=0.0, cache_size=2)

    for topic in ["one", "two", "three", "one"]:  # "one" was pushed out by "three"
        await topic_search.find(document_id, topic)

    assert len(embedder.calls) == 4


async def test_when_the_embedding_service_is_down_it_answers_nothing_instead_of_failing() -> None:
    store, document_id = await book(FakeEmbedder())

    assert await search(store, DownEmbedder()).find(document_id, "cell energy") == {}  # keywords carry on


async def test_with_no_embedder_there_is_nothing_to_add() -> None:
    topic_search = search(MemoryDocuments(), None)

    assert not topic_search.enabled
    assert await topic_search.find(uuid4(), "cell energy") == {}
