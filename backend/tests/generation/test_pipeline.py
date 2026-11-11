import json
from typing import Any

import pytest

from app.generation.pipeline import GenerationError, QuizConfig, generate_quiz
from app.generation.prompts import VERIFY_SYSTEM
from app.ingestion.chunk import Chunk, chunk_pages
from app.ingestion.extract import Page
from app.providers.fake import FakeProvider, echo_handler

PAGES = [
    Page(1, "Mitochondria produce most of the cell's ATP. The inner membrane is folded into cristae."),
    Page(
        2, "Chloroplasts capture light energy for photosynthesis. Light reactions happen in the thylakoids."
    ),
    Page(3, "Osmosis moves water across a membrane. Water flows toward the higher solute concentration."),
]


def chunks() -> list[Chunk]:
    return chunk_pages(PAGES, target_tokens=20, max_tokens=40, overlap_tokens=0)


def true_false(evidence: str, chunk_id: str, prompt: str) -> dict[str, Any]:
    return {
        "type": "true_false",
        "prompt": prompt,
        "answer": "True",
        "explanation": "Stated in the passage.",
        "topic": "Cells",
        "difficulty": "medium",
        "source_chunk_id": chunk_id,
        "evidence": evidence,
    }


async def test_returns_the_requested_number_of_verified_questions_with_pages() -> None:
    result = await generate_quiz(chunks(), QuizConfig(count=3, types=("true_false",)), FakeProvider())

    assert len(result.questions) == 3
    for q in result.questions:
        # the page is where the quoted evidence really is
        assert q.evidence in next(p.text for p in PAGES if p.number == q.page)


async def test_drops_a_question_whose_evidence_is_invented() -> None:
    c = chunks()

    def handler(system: str, prompt: str) -> str:
        if system == VERIFY_SYSTEM:
            return json.dumps(
                {"answerable_from_source": True, "single_correct_answer": True, "ambiguous": False}
            )
        return json.dumps(
            {
                "questions": [
                    true_false(
                        "Mitochondria produce most of the cell's ATP.", c[0].id, "True or false: ATP?"
                    ),
                    true_false("Mitochondria were discovered by Darwin in 1859.", c[0].id, "Who found them?"),
                ]
            }
        )

    result = await generate_quiz(c, QuizConfig(count=1, types=("true_false",)), FakeProvider(handler))

    assert [q.prompt for q in result.questions] == ["True or false: ATP?"]
    assert result.rejected["evidence not found in the passage"] >= 1


async def test_drops_questions_the_verifier_rejects() -> None:
    def handler(system: str, prompt: str) -> str:
        if system == VERIFY_SYSTEM:
            ambiguous = "thylakoid" in prompt
            return json.dumps(
                {"answerable_from_source": True, "single_correct_answer": True, "ambiguous": ambiguous}
            )
        return echo_handler(system, prompt)

    result = await generate_quiz(chunks(), QuizConfig(count=2, types=("true_false",)), FakeProvider(handler))

    assert all("thylakoid" not in q.prompt for q in result.questions)
    assert result.rejected["rejected by the verifier"] >= 1


async def test_asks_again_after_a_malformed_reply() -> None:
    replies = iter(["this is not json"])

    def handler(system: str, prompt: str) -> str:
        if system != VERIFY_SYSTEM:
            bad = next(replies, None)
            if bad is not None:
                return bad
        return echo_handler(system, prompt)

    provider = FakeProvider(handler)
    result = await generate_quiz(chunks(), QuizConfig(count=1, types=("true_false",)), provider)

    assert len(result.questions) == 1
    assert "could not be used" in provider.calls[1][1]  # the retry says what was wrong


async def test_only_uses_passages_inside_the_page_range() -> None:
    result = await generate_quiz(
        chunks(), QuizConfig(count=1, types=("true_false",), pages=(3, 3)), FakeProvider()
    )
    assert [q.page for q in result.questions] == [3]


async def test_a_page_range_with_no_text_is_an_error() -> None:
    with pytest.raises(GenerationError, match="no readable text"):
        await generate_quiz(chunks(), QuizConfig(count=1, pages=(50, 60)), FakeProvider())
