import json
from typing import Any

import pytest

from app.generation.pipeline import GenerationError, Progress, QuizConfig, generate_quiz
from app.generation.prompts import VERIFY_SYSTEM
from app.ingestion.chunk import Chunk, chunk_pages
from app.ingestion.extract import Page
from app.providers.fake import FakeProvider, echo_handler, verify_reply

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
            return verify_reply(prompt)
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
            return verify_reply(prompt, lambda item: {"ambiguous": "thylakoid" in item})
        return echo_handler(system, prompt)

    result = await generate_quiz(chunks(), QuizConfig(count=2, types=("true_false",)), FakeProvider(handler))

    assert all("thylakoid" not in q.prompt for q in result.questions)
    assert result.rejected["rejected by the verifier"] >= 1


async def test_checks_several_questions_in_one_call_and_shows_only_an_excerpt() -> None:
    provider = FakeProvider()

    result = await generate_quiz(chunks(), QuizConfig(count=3, types=("true_false",)), provider)

    verifying = [prompt for system, prompt in provider.calls if system == VERIFY_SYSTEM]
    assert len(result.questions) == 3
    assert len(verifying) == 1  # three questions, one call (not one each)
    assert verifying[0].count("<item id=") >= 3
    assert "<chunk" not in verifying[0]  # an excerpt around the evidence, never the whole passage


async def test_a_question_the_verifier_forgot_to_judge_is_not_kept() -> None:
    def handler(system: str, prompt: str) -> str:
        if system == VERIFY_SYSTEM:
            # answers only item 1 of the batch
            return json.dumps({"verdicts": json.loads(verify_reply(prompt))["verdicts"][:1]})
        return echo_handler(system, prompt)

    result = await generate_quiz(chunks(), QuizConfig(count=3, types=("true_false",)), FakeProvider(handler))

    assert len(result.questions) < 3  # no verdict is not a pass: every kept question was checked
    assert result.rejected["verification failed to run"] >= 1


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


async def test_a_topic_quiz_is_written_only_from_the_passages_about_it() -> None:
    provider = FakeProvider()
    config = QuizConfig(count=1, types=("true_false",), topic="osmosis")

    result = await generate_quiz(chunks(), config, provider)

    assert len(result.questions) == 1
    generation_prompt = provider.calls[0][1]
    assert 'about this topic: "osmosis"' in generation_prompt
    assert "Mitochondria" not in generation_prompt  # the other passages were never shown to the model


async def test_a_topic_the_document_never_mentions_cannot_be_quizzed() -> None:
    with pytest.raises(GenerationError, match="Nothing in this PDF mentions"):
        await generate_quiz(chunks(), QuizConfig(topic="tax law"), FakeProvider())


async def test_reports_how_far_it_has_got_and_never_goes_backwards() -> None:
    seen: list[Progress] = []

    await generate_quiz(chunks(), QuizConfig(count=3, types=("true_false",)), FakeProvider(), seen.append)

    assert (seen[0].stage, seen[0].wanted, seen[0].checked) == ("writing", 3, 0)
    checking = [p for p in seen if p.stage == "checking"]
    counts = [p.checked for p in checking]
    assert counts[0] == 0 and counts == sorted(counts)  # they are checked in batches, so it jumps
    assert counts[-1] == checking[0].candidates  # ...but ends having checked all of them
    fractions = [p.fraction for p in seen]
    assert fractions == sorted(fractions)
    assert 0 < fractions[0] < fractions[-1] < 1  # being ready is the finish line, not a fraction
