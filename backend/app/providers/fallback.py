"""Try the primary provider; if it fails, use the next one for the rest of the run."""

import logging

from app.providers.base import LLMProvider, ProviderError

log = logging.getLogger(__name__)


class FallbackProvider:
    """Wraps providers in priority order (e.g. Gemini, then Groq).

    A provider that fails is skipped for the rest of this object's life, so a rate-limited primary
    isn't retried (with backoff) on every one of the dozens of calls in a quiz.
    """

    def __init__(self, providers: list[LLMProvider]) -> None:
        if not providers:
            raise ValueError("FallbackProvider needs at least one provider")
        self._providers = providers
        self._down: set[int] = set()

    @property
    def name(self) -> str:
        return self._current.name

    @property
    def model(self) -> str:
        return self._current.model

    @property
    def _current(self) -> LLMProvider:
        for i, p in enumerate(self._providers):
            if i not in self._down:
                return p
        return self._providers[-1]

    async def generate_json(self, system: str, prompt: str, *, temperature: float = 0.2) -> str:
        errors: list[str] = []
        for i, provider in enumerate(self._providers):
            if i in self._down:
                continue
            try:
                return await provider.generate_json(system, prompt, temperature=temperature)
            except ProviderError as e:
                errors.append(str(e))
                if i < len(self._providers) - 1:
                    self._down.add(i)
                    log.warning(
                        "%s failed (%s); falling back to %s", provider.name, e, self._providers[i + 1].name
                    )
        raise ProviderError("; ".join(errors) or "all providers are down")
