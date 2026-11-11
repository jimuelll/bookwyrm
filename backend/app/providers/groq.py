"""Groq via its OpenAI-compatible chat completions API, in JSON mode."""

from typing import Any

import httpx

from app.providers.base import ProviderError, post_json

BASE_URL = "https://api.groq.com/openai/v1"


class GroqProvider:
    name = "groq"

    def __init__(
        self, api_key: str, model: str, client: httpx.AsyncClient, *, base_delay: float = 1.0
    ) -> None:
        if not api_key:
            raise ProviderError("GROQ_API_KEY is not set.")
        self.model = model
        self._key = api_key
        self._client = client
        self._base_delay = base_delay

    async def generate_json(self, system: str, prompt: str, *, temperature: float = 0.2) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }
        data = await post_json(
            self._client,
            f"{BASE_URL}/chat/completions",
            provider=f"groq/{self.model}",
            headers={"Authorization": f"Bearer {self._key}"},
            body=body,
            base_delay=self._base_delay,
        )
        try:
            content: str = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise ProviderError("groq returned no message") from e
        return content
