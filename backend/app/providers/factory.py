"""Build the provider the settings ask for: the primary, with the other real one as fallback."""

import httpx

from app.config import Settings
from app.providers.base import LLMProvider, ProviderError
from app.providers.fake import FakeProvider
from app.providers.fallback import FallbackProvider
from app.providers.gemini import GeminiProvider
from app.providers.groq import GroqProvider


def build_provider(settings: Settings, client: httpx.AsyncClient) -> LLMProvider:
    """Groq then Gemini by default (or the reverse with LLM_PROVIDER=gemini). Needs at least one key."""
    if settings.llm_provider == "fake":
        return FakeProvider()

    available: dict[str, LLMProvider] = {}
    if settings.gemini_api_key:
        available["gemini"] = GeminiProvider(settings.gemini_api_key, settings.gemini_model, client)
    if settings.groq_api_key:
        available["groq"] = GroqProvider(settings.groq_api_key, settings.groq_model, client)
    if not available:
        raise ProviderError(
            "No API key found. Set GEMINI_API_KEY (and optionally GROQ_API_KEY) in .env, "
            "or set LLM_PROVIDER=fake to try it without one."
        )

    order = ["gemini", "groq"] if settings.llm_provider == "gemini" else ["groq", "gemini"]
    return FallbackProvider([available[name] for name in order if name in available])
