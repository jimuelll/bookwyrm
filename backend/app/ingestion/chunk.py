"""Step 2 of ingestion: cut page text into overlapping chunks of whole sentences.

Why chunks: the model only sees a few passages at a time, and each question must cite one of them.
Chunks are packed sentence by sentence, so a sentence is never cut in half (except one that is
longer than a whole chunk). Consecutive chunks share a few sentences of overlap, so an idea that
straddles a boundary still appears whole in one of them. Each chunk remembers where every page's
text starts inside it, so a quote can be traced to the exact page, not just the chunk's range.
"""

import math
import re
from dataclasses import dataclass, replace

from app.ingestion.extract import Page

# A sentence ends at . ! or ? followed by space and something that starts a new sentence.
# Abbreviations like "e.g. The" are occasionally split; that only makes a chunk boundary a bit early.
_SENTENCE_BREAK = re.compile(
    r"(?<=[.!?])\s+(?=[\"\u201c\u2018(\[]?[A-Z0-9])"
)  # opening quotes: straight, curly double, curly single
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")  # "photo-\nsynthesis" -> "photosynthesis"
_WHITESPACE = re.compile(r"\s+")


def estimate_tokens(text: str) -> int:
    """About 4 tokens per 3 English words. Close enough for sizing; no tokenizer dependency."""
    return math.ceil(len(text.split()) * 4 / 3)


def clean_text(text: str) -> str:
    return _WHITESPACE.sub(" ", _HYPHEN_BREAK.sub(r"\1\2", text)).strip()


def split_sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE_BREAK.split(text) if s]


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    page_start: int
    page_end: int
    token_count: int
    # (offset in `text`, page number) for where each page's text begins inside this chunk
    page_marks: tuple[tuple[int, int], ...]

    def page_at(self, offset: int) -> int:
        """The page that the character at `offset` came from."""
        page = self.page_marks[0][1]
        for start, number in self.page_marks:
            if start > offset:
                break
            page = number
        return page

    def within(self, first: int, last: int) -> "Chunk | None":
        """This chunk trimmed to pages first..last, or None if it has no text on those pages."""
        if self.page_end < first or self.page_start > last:
            return None
        if first <= self.page_start and self.page_end <= last:
            return self
        # each page's span inside the text: from its mark to just before the next page's mark
        ends = [start - 1 for start, _ in self.page_marks[1:]] + [len(self.text)]
        kept = [(start, end, page) for (start, page), end in zip(self.page_marks, ends, strict=True)]
        kept = [span for span in kept if first <= span[2] <= last]
        begin, stop = kept[0][0], kept[-1][1]
        text = self.text[begin:stop]
        return replace(
            self,
            text=text,
            page_start=kept[0][2],
            page_end=kept[-1][2],
            token_count=estimate_tokens(text),
            page_marks=tuple((start - begin, page) for start, _, page in kept),
        )

    @property
    def pages_label(self) -> str:
        return (
            str(self.page_start) if self.page_start == self.page_end else f"{self.page_start}-{self.page_end}"
        )


@dataclass(frozen=True)
class _Unit:
    page: int
    text: str
    tokens: int


def _units(pages: list[Page], max_tokens: int) -> list[_Unit]:
    units: list[_Unit] = []
    # an over-long sentence is cut into pieces of about 75% of a chunk (tokens -> words is x3/4)
    piece_words = max(1, int(max_tokens * 0.75 * 0.75))
    for page in pages:
        if page.likely_scanned:
            continue
        for sentence in split_sentences(clean_text(page.text)):
            tokens = estimate_tokens(sentence)
            if tokens <= max_tokens:
                units.append(_Unit(page.number, sentence, tokens))
                continue
            words = sentence.split()
            for i in range(0, len(words), piece_words):
                piece = " ".join(words[i : i + piece_words])
                units.append(_Unit(page.number, piece, estimate_tokens(piece)))
    return units


def _build(index: int, units: list[_Unit]) -> Chunk:
    parts: list[str] = []
    marks: list[tuple[int, int]] = []
    offset = 0
    for u in units:
        if not marks or marks[-1][1] != u.page:
            marks.append((offset, u.page))
        parts.append(u.text)
        offset += len(u.text) + 1  # +1 for the joining space
    return Chunk(
        id=f"c{index}",
        text=" ".join(parts),
        page_start=units[0].page,
        page_end=units[-1].page,
        token_count=sum(u.tokens for u in units),
        page_marks=tuple(marks),
    )


def _overlap_tail(units: list[_Unit], overlap_tokens: int) -> list[_Unit]:
    """The last few sentences, up to `overlap_tokens`, to start the next chunk with."""
    tail: list[_Unit] = []
    total = 0
    for u in reversed(units):
        if total + u.tokens > overlap_tokens:
            break
        tail.insert(0, u)
        total += u.tokens
    # never carry the whole chunk over, or the next chunk would just repeat it
    return [] if len(tail) == len(units) else tail


def chunk_pages(
    pages: list[Page], *, target_tokens: int = 600, max_tokens: int = 800, overlap_tokens: int = 80
) -> list[Chunk]:
    if not 0 <= overlap_tokens < target_tokens <= max_tokens:
        raise ValueError("need 0 <= overlap_tokens < target_tokens <= max_tokens")

    chunks: list[Chunk] = []
    current: list[_Unit] = []
    fresh = 0  # sentences in `current` that no earlier chunk contains

    def flush() -> None:
        nonlocal current, fresh
        chunks.append(_build(len(chunks) + 1, current))
        current = _overlap_tail(current, overlap_tokens)
        fresh = 0

    for unit in _units(pages, max_tokens):
        if current and sum(u.tokens for u in current) + unit.tokens > max_tokens:
            flush()
            if sum(u.tokens for u in current) + unit.tokens > max_tokens:
                current = []  # the overlap plus this long sentence won't fit; start clean
        current.append(unit)
        fresh += 1
        if sum(u.tokens for u in current) >= target_tokens:
            flush()
    if fresh:
        chunks.append(_build(len(chunks) + 1, current))
    return chunks
