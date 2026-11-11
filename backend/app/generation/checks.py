"""Cheap, deterministic checks that run before the (paid) verification call.

The most useful one: the model's "evidence" quote must really appear in the passage it cites.
Models sometimes invent a plausible quote; this catches it without another LLM call.
"""

import re
from difflib import SequenceMatcher

from app.ingestion.chunk import Chunk

# Quotes and dashes that models and PDFs write differently; all are mapped to one plain form.
# Each maps one character to one character, so offsets in the chunk text stay valid.
_FOLD = str.maketrans(
    {
        "\u201c": '"',  # left double quote
        "\u201d": '"',  # right double quote
        "\u201e": '"',  # low double quote
        "\u2018": "'",  # left single quote
        "\u2019": "'",  # right single quote / apostrophe
        "\u2013": "-",  # en dash
        "\u2014": "-",  # em dash
        "\u00a0": " ",  # no-break space
    }
)
_WORD = re.compile(r"\S+")

# How close a fuzzy match must be (0-1). High, because evidence is supposed to be copied exactly;
# this only forgives small slips like a dropped comma or a changed quote mark.
FUZZY_THRESHOLD = 0.9
MIN_EVIDENCE_WORDS = 4


def _fold(text: str) -> str:
    return text.translate(_FOLD).lower()


def find_evidence(evidence: str, chunk: Chunk) -> int | None:
    """Where `evidence` starts in the chunk's text, or None if it isn't really there."""
    needle = " ".join(_fold(evidence).split()).strip(" .\"'")
    if len(needle.split()) < MIN_EVIDENCE_WORDS:
        return None
    haystack = _fold(chunk.text)  # chunk text is already whitespace-normalised

    exact = haystack.find(needle)
    if exact != -1:
        return exact

    # Fuzzy: slide a window the size of the quote over the chunk's words and keep the best match.
    words = list(_WORD.finditer(haystack))
    size = len(needle.split())
    best_ratio, best_offset = 0.0, None
    for i in range(max(1, len(words) - size + 1)):
        window = words[i : i + size]
        if not window:
            break
        candidate = haystack[window[0].start() : window[-1].end()]
        ratio = SequenceMatcher(None, needle, candidate).ratio()
        if ratio > best_ratio:
            best_ratio, best_offset = ratio, window[0].start()
    return best_offset if best_ratio >= FUZZY_THRESHOLD else None


def is_near_duplicate(prompt: str, others: list[str], *, threshold: float = 0.85) -> bool:
    """True if `prompt` reads almost the same as one already accepted.

    M1 compares text; M2 switches to embedding similarity, which also catches reworded duplicates.
    """
    a = " ".join(_fold(prompt).split())
    return any(SequenceMatcher(None, a, " ".join(_fold(o).split())).ratio() >= threshold for o in others)
