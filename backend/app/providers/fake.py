"""A provider that needs no network or key, for tests, CI and trying the CLI for free.

By default it "writes" simple questions straight from the passages in the prompt, quoting a real
sentence as evidence, and approves every verification. That makes the whole pipeline (schema,
evidence check, page lookup, de-duplication) run for real. Tests can pass their own `handler` to
script exact replies, including broken ones.
"""

import json
import re
from collections.abc import Callable
from typing import Any

from app.generation.prompts import VERIFY_SYSTEM

Handler = Callable[[str, str], str]

_CHUNK = re.compile(r'<chunk id="([^"]+)" pages="[^"]+">\n(.*?)\n</chunk>', re.DOTALL)
_COUNT = re.compile(r"Write (\d+) (\w+) questions")
_FIRST_TYPE = re.compile(r"Allowed question types:\n- (\w+):")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


class FakeProvider:
    name = "fake"
    model = "fake"

    def __init__(self, handler: Handler | None = None) -> None:
        self._handler = handler or echo_handler
        self.calls: list[tuple[str, str]] = []

    async def generate_json(self, system: str, prompt: str, *, temperature: float = 0.2) -> str:
        self.calls.append((system, prompt))
        return self._handler(system, prompt)


_ITEM = re.compile(r'<item id="(\d+)">\n(.*?)\n</item>', re.DOTALL)


def verify_reply(prompt: str, judge: Callable[[str], dict[str, Any]] | None = None) -> str:
    """A reply to a verification prompt: one verdict per item, all passing unless `judge` says otherwise.

    `judge` gets the text of one item (its question and excerpt) and returns the verdict fields to
    change, e.g. {"ambiguous": True}.
    """
    verdicts = []
    for number, block in _ITEM.findall(prompt):
        verdict: dict[str, Any] = {
            "id": int(number),
            "answerable_from_source": True,
            "single_correct_answer": True,
            "ambiguous": False,
            "reason": "fake",
        }
        verdicts.append(verdict | (judge(block) if judge else {}))
    return json.dumps({"verdicts": verdicts})


def echo_handler(system: str, prompt: str) -> str:
    if system == VERIFY_SYSTEM:
        return verify_reply(prompt)
    count_match = _COUNT.search(prompt)
    type_match = _FIRST_TYPE.search(prompt)
    count = int(count_match.group(1)) if count_match else 1
    difficulty = count_match.group(2) if count_match else "medium"
    qtype = type_match.group(1) if type_match else "true_false"

    sentences = [
        (chunk_id, s)
        for chunk_id, text in _CHUNK.findall(prompt)
        for s in _SENTENCE.split(text)
        if len(s.split()) >= 6
    ]
    questions = [_question(qtype, difficulty, chunk_id, s) for chunk_id, s in sentences[:count]]
    return json.dumps({"questions": questions})


def _question(qtype: str, difficulty: str, chunk_id: str, sentence: str) -> dict[str, Any]:
    longest = max(sentence.rstrip(".!?").split(), key=len).strip(",;:()\"'")
    base: dict[str, Any] = {
        "type": qtype,
        "explanation": "Stated directly in the passage.",
        "topic": f"Passage {chunk_id}",
        "difficulty": difficulty,
        "source_chunk_id": chunk_id,
        "evidence": sentence,
    }
    if qtype == "mcq":
        options = [
            sentence,
            "A statement the passage does not make.",
            "The opposite claim.",
            "None of these.",
        ]
        opening = " ".join(sentence.split()[:5])
        prompt = f'Which statement starting "{opening}" does the passage make?'
        return base | {"prompt": prompt, "options": options, "answer": sentence}
    if qtype in ("fill_blank", "short_answer"):
        blanked = sentence.replace(longest, "____", 1)
        prompt = blanked if qtype == "fill_blank" else f"Which word completes this: {blanked}"
        return base | {"prompt": prompt, "answer": longest}
    return base | {"prompt": f"True or false: {sentence}", "answer": "True"}
