"""Quiz generation: chunks in, verified questions out (docs/ARCHITECTURE.md §4.3).

    select chunks → generate ~1.5x candidates → validate schema → check citation + evidence
    → verify each with a second LLM call → drop near-duplicates → keep N

Each stage only removes questions, never edits them, so whatever survives was checked as written.
If too few survive, another round asks for the shortfall (up to MAX_ROUNDS).
"""

import asyncio
import json
import logging
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from app.generation.checks import find_evidence, is_near_duplicate
from app.generation.prompts import GENERATE_SYSTEM, VERIFY_SYSTEM, generation_prompt, verification_prompt
from app.generation.schemas import Difficulty, GeneratedQuestion, Question, QuestionType, Verdict
from app.ingestion.chunk import Chunk
from app.providers.base import LLMProvider, ProviderError

log = logging.getLogger(__name__)

OVERGENERATE = 1.5  # ask for 50% more than needed; checks and the verifier drop some
MAX_ROUNDS = 3
MAX_CONTEXT_CHUNKS = 8  # passages per generation call: enough variety, small enough prompt
JSON_RETRIES = 2  # re-asks when a reply isn't valid JSON in the right shape
VERIFY_CONCURRENCY = 4


class GenerationError(Exception):
    """No quiz could be made (e.g. no text in the chosen pages, or the model kept failing)."""


@dataclass(frozen=True)
class QuizConfig:
    count: int = 5
    difficulty: Difficulty = "medium"
    types: tuple[QuestionType, ...] = ("mcq",)
    pages: tuple[int, int] | None = None  # inclusive page range, e.g. (40, 60)


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
    is what we want. M2 adds topic/section-targeted retrieval on top of this.
    """
    if config.pages:
        first, last = config.pages
        # trim passages that straddle the edge, so the model never sees text outside the range
        chunks = [trimmed for c in chunks if (trimmed := c.within(first, last))]
    if not chunks:
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


async def verify(provider: LLMProvider, question: GeneratedQuestion, chunk: Chunk) -> Verdict:
    verdict: Verdict = await ask_json(
        provider, VERIFY_SYSTEM, verification_prompt(question, chunk), _parse_model(Verdict)
    )
    return verdict


async def generate_quiz(chunks: list[Chunk], config: QuizConfig, provider: LLMProvider) -> QuizResult:
    if config.count < 1:
        raise GenerationError("Ask for at least one question.")
    context = select_chunks(chunks, config)
    by_id = {c.id: c for c in context}
    result = QuizResult(questions=[])
    semaphore = asyncio.Semaphore(VERIFY_CONCURRENCY)

    async def check_one(q: GeneratedQuestion) -> tuple[GeneratedQuestion, int, Verdict] | str:
        """Run every check on one candidate; return it with its page and verdict, or why it failed."""
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
        async with semaphore:
            try:
                verdict = await verify(provider, q, chunk)
            except (ProviderError, GenerationError):
                return "verification failed to run"
        if not verdict.passed:
            log.info("verifier rejected %r: %s", q.prompt[:60], verdict.reason)
            return "rejected by the verifier"
        return q, page, verdict

    while len(result.questions) < config.count and result.rounds < MAX_ROUNDS:
        result.rounds += 1
        need = config.count - len(result.questions)
        ask_for = math.ceil(need * OVERGENERATE)
        prompt = generation_prompt(context, count=ask_for, difficulty=config.difficulty, types=config.types)
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

        outcomes = await asyncio.gather(*(check_one(q) for q in candidates))
        for outcome in outcomes:
            if isinstance(outcome, str):
                result.rejected[outcome] += 1
                continue
            q, page, verdict = outcome
            if is_near_duplicate(q.prompt, [a.prompt for a in result.questions]):
                result.rejected["near-duplicate"] += 1
                continue
            if len(result.questions) < config.count:
                result.questions.append(Question(**q.model_dump(), page=page, verifier_notes=verdict.reason))
            else:
                result.spare += 1

    return result
