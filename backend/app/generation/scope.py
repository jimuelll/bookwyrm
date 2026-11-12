"""What a quiz covers, and how many questions that much material can carry.

A quiz is written from a *scope*: the whole document, a page range, one topic, or a topic within a page
range. Two questions are answered here, before any model is called:

  which passages are in scope?   `in_scope`  (for a topic: `match_topic`, a keyword search)
  how many questions fit?        `measure`   (a suggestion and a ceiling, from the amount of text)

Topic matching uses two kinds of retrieval, and keeps a passage that either one finds:

  lexical   finds passages that contain the topic's words, weighted so a rare word counts for more than
            a common one (the idea behind BM25, the classic search-engine formula). Cheap, needs no
            model, and exact: it is what finds a name, a number or a formula. But it only finds the
            words themselves: ask for "energy production" and a passage that only says "ATP synthesis"
            is missed.
  semantic  finds passages whose *meaning* is close to the topic's, by comparing embeddings
            (app/providers/embeddings.py). It finds the ATP passage, but can blur exact terms.

Each covers the other's blind spot, which is why search engines combine them ("hybrid search"). The
semantic half is looked up by the caller (it needs the database and a model, and this module stays pure)
and handed in as `semantic`: {passage id: similarity}. We take the union rather than a ranked fusion
(RRF) because a quiz scope is a *set* of passages, kept in reading order, not a top-N list.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass

from app.ingestion.chunk import Chunk

TOPIC_MAX = 80
# A passage counts as "about" the topic if it scores at least this share of the best passage's score.
# Lower lets in passing mentions; higher keeps only the passages that dwell on it.
RELATIVE_CUTOFF = 0.35
# Sizing, in estimated tokens (a page of prose is very roughly 400-500):
TOKENS_PER_QUESTION_AT_MOST = 40  # tighter than this and questions start asking the same sentence twice
TOKENS_PER_SUGGESTED_QUESTION = 300  # a comfortable density: about one question per half page
SUGGESTED_RANGE = (3, 10)
SMALLEST_MAXIMUM = 3  # even a single paragraph may be asked for three; fewer may pass the checks

_WORD = re.compile(r"[a-z0-9]+")  # an apostrophe ends a word, so "cell's" counts as "cell"
_CONTROL = re.compile(r"[\x00-\x1f\x7f<>\"]")
# words too common to say anything about a topic
_STOPWORDS = frozenset(
    {"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it", "of", "on"}
    | {"or", "that", "the", "this", "to", "was", "what", "when", "where", "which", "who", "why", "with"}
    | {"about", "into", "its", "their", "there", "these", "those"}
)
_ENDINGS = (("ies", "y"), ("sses", "ss"), ("ing", ""), ("ed", ""), ("s", ""))


def clean_topic(raw: str | None) -> str | None:
    """A topic as typed, made safe to store and to put in a prompt: one line, no markup, bounded."""
    text = " ".join(_CONTROL.sub(" ", raw or "").split())[:TOPIC_MAX].strip()
    return text or None


def _stem(word: str) -> str:
    """Fold a few English endings, so "membranes" finds "membrane" and "folding" finds "folded".

    Deliberately crude (a real stemmer has hundreds of rules). Both the topic and the text go through
    the same folding, so it only has to be consistent, not linguistically right.
    """
    if word.endswith("ss"):  # "class", "process": that final s is not a plural
        return word
    for ending, replacement in _ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) + len(replacement) >= 3:
            return word[: len(word) - len(ending)] + replacement
    return word


def topic_terms(topic: str) -> list[str]:
    """The words of a topic that carry meaning, stemmed, each once."""
    words = [w for w in _WORD.findall(topic.lower()) if w not in _STOPWORDS and len(w) > 1]
    return list(dict.fromkeys(_stem(w) for w in words))


def match_topic(chunks: list[Chunk], topic: str, semantic: dict[str, float] | None = None) -> list[Chunk]:
    """The passages that are about `topic`, in reading order: those that use its words, plus those the
    embedding search found (`semantic`). Empty if neither finds any."""
    wanted = {c.id for c in keyword_matches(chunks, topic)} | set(semantic or ())
    return [c for c in chunks if c.id in wanted]


def keyword_matches(chunks: list[Chunk], topic: str) -> list[Chunk]:
    """The lexical half of `match_topic`: passages that contain the topic's words."""
    terms = topic_terms(topic)
    if not terms or not chunks:
        return []
    counts = [Counter(_stem(w) for w in _WORD.findall(c.text.lower())) for c in chunks]
    total = len(chunks)
    # idf, "inverse document frequency": a term found in few passages tells them apart, so it weighs
    # more; a term found in nearly all of them ("cell" in a cell-biology chapter) weighs almost nothing.
    weight = {}
    for term in terms:
        containing = sum(1 for words in counts if words[term])
        weight[term] = math.log(1 + (total - containing + 0.5) / (containing + 0.5))
    # tf / (tf + k): the first mention matters most, and the tenth barely adds (saturation), so a
    # long passage can't win just by repeating a word
    scores = [sum(weight[t] * words[t] / (words[t] + 1.2) for t in terms if words[t]) for words in counts]
    best = max(scores)
    if best <= 0:
        return []
    return [c for c, s in zip(chunks, scores, strict=True) if s >= RELATIVE_CUTOFF * best]


def in_scope(
    chunks: list[Chunk],
    *,
    pages: tuple[int, int] | None = None,
    topic: str | None = None,
    semantic: dict[str, float] | None = None,
) -> list[Chunk]:
    """The passages a quiz may be written from: within the pages, then about the topic (each if given)."""
    if pages:
        first, last = pages
        # trim passages that straddle the edge, so the model never sees text outside the range
        chunks = [trimmed for c in chunks if (trimmed := c.within(first, last))]
    if topic:
        chunks = match_topic(chunks, topic, semantic)
    return chunks


@dataclass(frozen=True)
class Scope:
    passages: int
    tokens: int
    page_first: int | None  # None when nothing is in scope
    page_last: int | None
    suggested: int  # a sensible number of questions for this much material
    maximum: int  # the most it can carry (never above the server's own limit); 0 when nothing is in scope


def count_limits(tokens: int, hard_max: int) -> tuple[int, int]:
    """(suggested, maximum) questions for `tokens` of material."""
    if tokens <= 0:
        return 0, 0
    maximum = min(hard_max, max(SMALLEST_MAXIMUM, tokens // TOKENS_PER_QUESTION_AT_MOST))
    low, high = SUGGESTED_RANGE
    suggested = min(maximum, max(low, min(high, tokens // TOKENS_PER_SUGGESTED_QUESTION)))
    return suggested, maximum


def measure(
    chunks: list[Chunk],
    *,
    pages: tuple[int, int] | None = None,
    topic: str | None = None,
    semantic: dict[str, float] | None = None,
    hard_max: int,
) -> Scope:
    """How much material a scope holds, and how many questions suit it."""
    chosen = in_scope(chunks, pages=pages, topic=topic, semantic=semantic)
    tokens = sum(c.token_count for c in chosen)
    suggested, maximum = count_limits(tokens, hard_max)
    return Scope(
        passages=len(chosen),
        tokens=tokens,
        page_first=min((c.page_start for c in chosen), default=None),
        page_last=max((c.page_end for c in chosen), default=None),
        suggested=suggested,
        maximum=maximum,
    )
