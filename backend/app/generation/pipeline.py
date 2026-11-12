"""Quiz generation: chunks in, verified questions out (docs/ARCHITECTURE.md §4.3).

    select chunks → generate ~1.3x candidates → validate schema → check citation + evidence
    → verify them in small batches with a second kind of LLM call → drop near-duplicates → keep N

Each stage only removes questions, never edits them, so whatever survives was checked as written.
If too few survive, another round asks for the shortfall (up to MAX_ROUNDS).

The budget is tokens per minute, not dollars: this is sized to fit a free tier. So the verifier sees a
short excerpt around each question's evidence (not the whole passage), several questions per call.
"""

import json
import logging
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from app.generation.checks import find_evidence, is_near_duplicate
from app.generation.prompts import GENERATE_SYSTEM, VERIFY_SYSTEM, generation_prompt, verification_prompt
from app.generation.schemas import (
    Difficulty,
    GeneratedQuestion,
    Question,
    QuestionType,
    Verdict,
    VerdictBatch,
)
from app.generation.scope import in_scope
from app.ingestion.chunk import Chunk
from app.providers.base import LLMProvider, ProviderError

log = logging.getLogger(__name__)

OVERGENERATE = 1.3  # ask for 30% more than needed; checks and the verifier drop some
MAX_ROUNDS = 3
MAX_CONTEXT_CHUNKS = 6  # passages per generation call: enough variety, small enough prompt
JSON_RETRIES = 1  # re-asks when a reply isn't valid JSON in the right shape (each one resends the prompt)
VERIFY_BATCH = 6  # questions per verification call; one after another, so calls don't burst the rate limit
EXCERPT_RADIUS = 450  # characters either side of a question's evidence that the verifier is shown
PROGRESS_START, PROGRESS_END = 0.08, 0.95  # the passages are picked at once; saving comes after
WRITING_SHARE = 0.35  # of a round's progress, how much the one writing call counts for


class GenerationError(Exception):
    """No quiz could be made (e.g. no text in the chosen pages, or the model kept failing)."""


@dataclass(frozen=True)
class QuizConfig:
    count: int = 5
    difficulty: Difficulty = "medium"
    types: tuple[QuestionType, ...] = ("mcq",)
    pages: tuple[int, int] | None = None  # inclusive page range, e.g. (40, 60)
    topic: str | None = None  # only passages about this, and only questions on it (app/generation/scope.py)


@dataclass(frozen=True)
class Progress:
    """How far a quiz has got, reported as it is written so a waiting reader can be shown.

    A quiz is written in rounds: the model writes a batch of candidates (one slow call, nothing to
    count), then each candidate is checked (several calls, countable). Later rounds only make up
    what the checks threw out.
    """

    stage: Literal["writing", "checking"]
    round: int
    wanted: int
    kept: int  # questions that passed in earlier rounds
    candidates: int = 0  # written this round
    checked: int = 0  # of those, checked so far

    @property
    def fraction(self) -> float:
        """A rough 0-1 for a progress bar. Honest about order, not about time: it never claims done."""
        done = min(1.0, self.kept / self.wanted) if self.wanted else 0.0
        if self.stage == "writing":
            in_round = 0.0
        else:  # the writing call was this round's first share; the checks fill the rest
            in_round = WRITING_SHARE + (1 - WRITING_SHARE) * (
                self.checked / self.candidates if self.candidates else 1.0
            )
        return PROGRESS_START + (PROGRESS_END - PROGRESS_START) * (done + (1 - done) * in_round)


@dataclass
class QuizResult:
    questions: list[Question]
    candidates: int = 0
    rejected: Counter[str] = field(default_factory=Counter)
    spare: int = 0  # passed every check but weren't needed (we over-generate on purpose)
    rounds: int = 0


def select_chunks(chunks: list[Chunk], config: QuizConfig) -> list[Chunk]:
    """Spread the passages evenly over the document (or page range), so the quiz covers all of it.

    Similarity search would cluster around one theme; for "quiz me on this whole PDF" even coverage
    is what we want. With a topic, the same even spread runs over just the passages that match it.
    """
    chunks = in_scope(chunks, pages=config.pages, topic=config.topic)
    if not chunks:
        if config.topic:
            raise GenerationError(
                f"Nothing in this PDF mentions \u201c{config.topic}\u201d. "
                "Try a word or phrase that appears in the text."
            )
        raise GenerationError("There is no readable text in the selected pages.")
    k = min(len(chunks), MAX_CONTEXT_CHUNKS, max(3, config.count))
    step = len(chunks) / k
    return [chunks[int(i * step + step / 2)] for i in range(k)]


async def ask_json[T](provider: LLMProvider, system: str, prompt: str, parse: Callable[[str], T]) -> T:
    """Ask for JSON and parse it; on a malformed reply, say what was wrong and ask again."""
    message = prompt
    for attempt in range(JSON_RETRIES + 1):
        raw = await provider.generate_json(system, message)
        try:
            return parse(raw)
        except (ValueError, ValidationError) as e:  # json.JSONDecodeError is a ValueError
            log.warning("malformed reply (attempt %d): %s", attempt + 1, str(e)[:200])
            message = (
                f"{prompt}\n\nYour previous reply could not be used: {str(e)[:300]}\n"
                "Reply again with only the JSON object, in exactly the shape shown."
            )
    raise GenerationError("The model kept returning malformed replies.")


def parse_batch(raw: str) -> tuple[list[GeneratedQuestion], int]:
    """Valid questions plus how many were thrown out. One bad question doesn't sink the batch."""
    data: Any = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("questions"), list):
        raise ValueError('expected an object with a "questions" list')
    valid: list[GeneratedQuestion] = []
    invalid = 0
    for item in data["questions"]:
        try:
            valid.append(GeneratedQuestion.model_validate(item))
        except ValidationError as e:
            invalid += 1
            log.info("dropped malformed question: %s", str(e)[:200])
    return valid, invalid


def _parse_model(model: type[BaseModel]) -> Callable[[str], Any]:
    return lambda raw: model.model_validate_json(raw)


def excerpt(chunk: Chunk, offset: int, evidence: str) -> str:
    """The stretch of a passage around a question's evidence: what the verifier needs, and little else."""
    start = max(0, offset - EXCERPT_RADIUS)
    end = min(len(chunk.text), offset + len(evidence) + EXCERPT_RADIUS)
    return chunk.text[start:end]


async def verify_batch(
    provider: LLMProvider, items: list[tuple[GeneratedQuestion, str]]
) -> dict[int, Verdict]:
    """Verdicts for a batch of (question, excerpt), keyed by position (1 is the first). A question the
    verifier left out is simply absent, so the caller can tell "not checked" from "failed the check"."""
    batch = await ask_json(provider, VERIFY_SYSTEM, verification_prompt(items), _parse_model(VerdictBatch))
    return {v.id: v for v in batch.verdicts}


async def generate_quiz(
    chunks: list[Chunk],
    config: QuizConfig,
    provider: LLMProvider,
    on_progress: Callable[[Progress], None] | None = None,
) -> QuizResult:
    if config.count < 1:
        raise GenerationError("Ask for at least one question.")
    context = select_chunks(chunks, config)
    by_id = {c.id: c for c in context}
    result = QuizResult(questions=[])

    def precheck(q: GeneratedQuestion) -> tuple[GeneratedQuestion, int, str] | str:
        """The checks that need no model: return the candidate with its page and the excerpt the
        verifier will see, or why it failed."""
        chunk = by_id.get(q.source_chunk_id)
        if chunk is None:
            return "cites a passage it wasn't given"
        offset = find_evidence(q.evidence, chunk)
        if offset is None:
            return "evidence not found in the passage"
        page = chunk.page_at(offset)
        # a passage can straddle the edge of the range, so check the quote's own page too
        if config.pages and not config.pages[0] <= page <= config.pages[1]:
            return "evidence outside the requested pages"
        return q, page, excerpt(chunk, offset, q.evidence)

    def report(stage: Literal["writing", "checking"], candidates: int = 0, checked: int = 0) -> None:
        if on_progress:
            on_progress(
                Progress(stage, result.rounds, config.count, len(result.questions), candidates, checked)
            )

    while len(result.questions) < config.count and result.rounds < MAX_ROUNDS:
        result.rounds += 1
        need = config.count - len(result.questions)
        report("writing")
        ask_for = math.ceil(need * OVERGENERATE)
        prompt = generation_prompt(
            context, count=ask_for, difficulty=config.difficulty, types=config.types, topic=config.topic
        )
        try:
            candidates, invalid = await ask_json(provider, GENERATE_SYSTEM, prompt, parse_batch)
        except ProviderError as e:
            raise GenerationError(f"The question generator is unavailable: {e}") from e
        result.candidates += len(candidates) + invalid
        if invalid:
            result.rejected["invalid format"] += invalid
        wrong_type = sum(q.type not in config.types for q in candidates)
        if wrong_type:
            result.rejected["question type not requested"] += wrong_type
        candidates = [q for q in candidates if q.type in config.types]

        total = len(candidates)
        report("checking", total)
        checked = 0
        to_verify: list[tuple[GeneratedQuestion, int, str]] = []
        for q in candidates:
            outcome = precheck(q)
            if isinstance(outcome, str):
                result.rejected[outcome] += 1
                checked += 1
            else:
                to_verify.append(outcome)
        if checked:
            report("checking", total, checked)

        verified: list[tuple[GeneratedQuestion, int, Verdict]] = []
        for start in range(0, len(to_verify), VERIFY_BATCH):
            batch = to_verify[start : start + VERIFY_BATCH]
            try:
                verdicts = await verify_batch(provider, [(q, shown) for q, _, shown in batch])
            except (ProviderError, GenerationError):
                verdicts = {}
            for number, (q, page, _) in enumerate(batch, start=1):
                verdict = verdicts.get(number)
                if verdict is None:
                    result.rejected["verification failed to run"] += 1
                elif not verdict.passed:
                    log.info("verifier rejected %r: %s", q.prompt[:60], verdict.reason)
                    result.rejected["rejected by the verifier"] += 1
                else:
                    verified.append((q, page, verdict))
            checked += len(batch)
            report("checking", total, checked)

        for q, page, verdict in verified:
            if is_near_duplicate(q.prompt, [a.prompt for a in result.questions]):
                result.rejected["near-duplicate"] += 1
                continue
            if len(result.questions) < config.count:
                result.questions.append(Question(**q.model_dump(), page=page, verifier_notes=verdict.reason))
            else:
                result.spare += 1

    return result
