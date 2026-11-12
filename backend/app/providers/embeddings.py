"""Embedding providers: turn text into a vector of numbers, so "similar meaning" becomes "nearby".

What an embedding is: a model reads a passage and answers with a list of numbers (768 here), a point in
a space where passages about the same thing land close together. "energy production" and "ATP
synthesis" share no words, but their points are near each other, so a search by distance finds both.
That is what the keyword search in app/generation/scope.py cannot do.

Two details worth knowing:
  * Documents and queries are embedded differently. Gemini takes a `task type` (a stored passage vs. a
    short search phrase) and shapes the vector for that job, which finds better matches than embedding
    both the same way. `kind` below is that switch.
  * We ask for fewer dimensions than the model's native 3072 (Matryoshka training makes the first
    numbers the most informative, so a prefix is still good). Smaller vectors are cheaper to store and
    compare. A shortened vector is no longer unit length, so we rescale it ourselves.

Like the text providers, these are deliberately dumb and swappable (docs/ARCHITECTURE.md section 7).
"""

import hashlib
import math
import re
from typing import Any, Literal, Protocol

import httpx

from app.config import Settings
from app.providers.base import ProviderError, post_json

Kind = Literal["document", "query"]
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_BATCH_LIMIT = 100  # the API's cap on texts per batchEmbedContents call


class EmbeddingProvider(Protocol):
    @property
    def model(self) -> str: ...

    @property
    def dim(self) -> int: ...

    async def embed(self, texts: list[str], *, kind: Kind) -> list[list[float]]:
        """One vector per text, in the same order. Raises ProviderError if the model can't answer."""
        ...


def normalize(vector: list[float]) -> list[float]:
    """Scale a vector to length 1, so cosine similarity and a plain dot product agree."""
    length = math.sqrt(sum(x * x for x in vector))
    return [x / length for x in vector] if length else vector


class GeminiEmbedder:
    def __init__(
        self, api_key: str, model: str, dim: int, client: httpx.AsyncClient, *, base_delay: float = 1.0
    ) -> None:
        if not api_key:
            raise ProviderError("GEMINI_API_KEY is not set.")
        self.model = model
        self.dim = dim
        self._key = api_key
        self._client = client
        self._base_delay = base_delay

    async def embed(self, texts: list[str], *, kind: Kind) -> list[list[float]]:
        task = "RETRIEVAL_DOCUMENT" if kind == "document" else "RETRIEVAL_QUERY"
        vectors: list[list[float]] = []
        for start in range(0, len(texts), GEMINI_BATCH_LIMIT):
            batch = texts[start : start + GEMINI_BATCH_LIMIT]
            body: dict[str, Any] = {
                "requests": [
                    {
                        "model": f"models/{self.model}",
                        "content": {"parts": [{"text": text}]},
                        "taskType": task,
                        "outputDimensionality": self.dim,
                    }
                    for text in batch
                ]
            }
            data = await post_json(
                self._client,
                f"{GEMINI_BASE_URL}/models/{self.model}:batchEmbedContents",
                provider=f"gemini/{self.model}",
                headers={"x-goog-api-key": self._key},  # a header, not the URL, so it never lands in logs
                body=body,
                base_delay=self._base_delay,
            )
            try:
                got = [normalize([float(x) for x in e["values"]]) for e in data["embeddings"]]
            except (KeyError, TypeError, ValueError) as e:
                raise ProviderError("gemini returned embeddings in an unexpected shape") from e
            if len(got) != len(batch) or any(len(v) != self.dim for v in got):
                raise ProviderError("gemini returned the wrong number or size of embeddings")
            vectors.extend(got)
        return vectors


_WORD = re.compile(r"[a-z0-9]+")


class FakeEmbedder:
    """No network, no key: words are hashed into buckets (the "hashing trick"), then the counts are scaled.

    Two texts that share words get vectors that point the same way, so tests can check real ranking
    behaviour (the right passage comes first) without a model. It does not know that "car" and
    "automobile" mean the same; only a real embedding model does, which is why tests that depend on
    meaning belong in the evaluation, not here.
    """

    model = "fake-hash"

    def __init__(self, dim: int = 768) -> None:
        self.dim = dim

    async def embed(self, texts: list[str], *, kind: Kind) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            vector = [0.0] * self.dim
            for word in _WORD.findall(text.lower()):
                # hashlib, not hash(): Python salts hash() per process, which would change vectors run to run
                bucket = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=4).digest(), "big")
                vector[bucket % self.dim] += 1.0
            out.append(normalize(vector))
        return out


def build_embedder(settings: Settings, client: httpx.AsyncClient) -> EmbeddingProvider | None:
    """The embedder the settings ask for, or None when there is none (no key): the app then still works,
    finding topics by keywords alone."""
    if settings.embedding_provider == "fake":
        return FakeEmbedder(settings.embedding_dim)
    if settings.gemini_api_key:
        return GeminiEmbedder(
            settings.gemini_api_key, settings.embedding_model, settings.embedding_dim, client
        )
    return None
