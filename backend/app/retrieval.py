"""Finding the passages of one document that a topic is about, by meaning.

The keyword half of topic search is pure text work (app/generation/scope.py). This is the other half:
embed the topic, ask the database for the nearest passages, and keep the ones that are close enough.

  topic text --embed--> vector --nearest passages (pgvector)--> keep the top K above a similarity floor

The floor matters. "Nearest" always returns something, even for "quantum chromodynamics" in a cooking
book. Without a floor, every topic would look present and the "nothing in this PDF about that" answer
could never happen. So a hit has to be both among the closest few and genuinely similar.
"""

import logging
from collections import OrderedDict
from uuid import UUID

from app.documents import DocumentStore
from app.providers.base import ProviderError
from app.providers.embeddings import EmbeddingProvider

log = logging.getLogger(__name__)


class TopicSearch:
    """Semantic topic lookup. Never raises: if it can't help, it returns {} and keywords carry on alone."""

    def __init__(
        self,
        store: DocumentStore,
        embedder: EmbeddingProvider | None,
        *,
        top_k: int,
        min_similarity: float,
        cache_size: int = 256,
    ) -> None:
        self._store = store
        self._embedder = embedder
        self._top_k = top_k
        self._min_similarity = min_similarity
        self._cache_size = cache_size
        # The setup page asks for a topic's scope as the reader types, and each ask would cost an
        # embedding call. Remembering the last few topics' vectors makes a repeat (or the quiz request
        # that follows the preview) free. Least-recently-used ones are dropped first.
        self._vectors: OrderedDict[str, list[float]] = OrderedDict()

    @property
    def enabled(self) -> bool:
        return self._embedder is not None

    async def find(self, document_id: UUID, topic: str) -> dict[str, float]:
        """{passage id: similarity} for the passages about `topic`; {} if none, or no embedder."""
        if self._embedder is None:
            return {}
        try:
            vector = await self._vector(topic)
            nearest = await self._store.similar(document_id, vector, self._top_k)
        except ProviderError as e:
            log.warning("semantic topic search unavailable, using keywords only: %s", e)
            return {}
        return {label: similarity for label, similarity in nearest if similarity >= self._min_similarity}

    async def _vector(self, topic: str) -> list[float]:
        assert self._embedder is not None
        key = " ".join(topic.casefold().split())
        if key in self._vectors:
            self._vectors.move_to_end(key)
            return self._vectors[key]
        (vector,) = await self._embedder.embed([topic], kind="query")
        self._vectors[key] = vector
        if len(self._vectors) > self._cache_size:
            self._vectors.popitem(last=False)
        return vector
