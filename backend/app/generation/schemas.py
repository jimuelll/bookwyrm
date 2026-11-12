"""The shapes the model must return, checked with Pydantic before anything is trusted."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

QuestionType = Literal["mcq", "true_false", "fill_blank", "short_answer"]
Difficulty = Literal["easy", "medium", "hard"]
BLANK = "____"


class GeneratedQuestion(BaseModel):
    """One question as the model wrote it. Every rule here is cheap to check and catches real failures."""

    type: QuestionType
    prompt: str = Field(min_length=8)
    options: list[str] | None = None
    answer: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    topic: str = Field(min_length=1, max_length=80)
    difficulty: Difficulty
    source_chunk_id: str
    # a verbatim quote from the cited chunk that supports the answer
    evidence: str = Field(min_length=12)

    @model_validator(mode="after")
    def _type_rules(self) -> "GeneratedQuestion":
        if self.type == "mcq":
            if not self.options or len(self.options) != 4:
                raise ValueError("a multiple-choice question needs exactly 4 options")
            if len({o.strip().casefold() for o in self.options}) != 4:
                raise ValueError("multiple-choice options must all be different")
            if self.answer not in self.options:
                raise ValueError("the answer must be one of the options, word for word")
        elif self.options is not None and self.type != "true_false":
            raise ValueError(f"a {self.type} question has no options")
        if self.type == "true_false":
            if self.answer.strip().capitalize() not in ("True", "False"):
                raise ValueError('a true/false answer must be "True" or "False"')
            self.answer = self.answer.strip().capitalize()
            self.options = None
        if self.type == "fill_blank" and BLANK not in self.prompt:
            raise ValueError(f"a fill-in-the-blank prompt must contain {BLANK}")
        return self


class Verdict(BaseModel):
    """The verifier's judgement of one question against only its cited passage."""

    answerable_from_source: bool
    single_correct_answer: bool
    ambiguous: bool
    reason: str = ""

    @property
    def passed(self) -> bool:
        return self.answerable_from_source and self.single_correct_answer and not self.ambiguous


class NumberedVerdict(Verdict):
    """A verdict tagged with the number of the question it is about (the verifier checks several at once)."""

    id: int


class VerdictBatch(BaseModel):
    verdicts: list[NumberedVerdict]


class Question(GeneratedQuestion):
    """A question that passed every check, with the exact page its evidence is on."""

    page: int
    verifier_notes: str = ""
