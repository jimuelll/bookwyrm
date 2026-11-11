from typing import Any

import pytest
from pydantic import ValidationError

from app.generation.schemas import GeneratedQuestion, Verdict

BASE: dict[str, Any] = {
    "prompt": "What do mitochondria produce?",
    "explanation": "The passage says they produce ATP.",
    "topic": "Mitochondria",
    "difficulty": "easy",
    "source_chunk_id": "c1",
    "evidence": "Mitochondria produce most of the cell's ATP.",
}


def mcq(**overrides: Any) -> dict[str, Any]:
    return BASE | {"type": "mcq", "options": ["ATP", "DNA", "Glucose", "Oxygen"], "answer": "ATP"} | overrides


def test_accepts_a_well_formed_multiple_choice_question() -> None:
    assert GeneratedQuestion.model_validate(mcq()).answer == "ATP"


def test_rejects_an_mcq_answer_that_is_not_one_of_the_options() -> None:
    with pytest.raises(ValidationError, match="one of the options"):
        GeneratedQuestion.model_validate(mcq(answer="Adenosine triphosphate"))


def test_rejects_duplicate_mcq_options() -> None:
    with pytest.raises(ValidationError, match="different"):
        GeneratedQuestion.model_validate(mcq(options=["ATP", "atp ", "DNA", "Oxygen"]))


def test_normalises_a_true_false_answer() -> None:
    q = GeneratedQuestion.model_validate(BASE | {"type": "true_false", "answer": "true"})
    assert q.answer == "True"


def test_fill_in_the_blank_needs_a_blank() -> None:
    with pytest.raises(ValidationError, match="____"):
        GeneratedQuestion.model_validate(BASE | {"type": "fill_blank", "answer": "ATP"})


def test_a_verdict_passes_only_when_answerable_single_and_unambiguous() -> None:
    assert Verdict(answerable_from_source=True, single_correct_answer=True, ambiguous=False).passed
    assert not Verdict(answerable_from_source=True, single_correct_answer=True, ambiguous=True).passed
