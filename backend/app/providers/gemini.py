"""Google Gemini via its REST API (generateContent), in JSON mode."""

from typing import Any

import httpx

from app.providers.base import ProviderError, post_json

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider:
    name = "gemini"

    def __init__(
        self, api_key: str, model: str, client: httpx.AsyncClient, *, base_delay: float = 1.0
    ) -> None:
        if not api_key:
            raise ProviderError("GEMINI_API_KEY is not set.")
        self.model = model
        self._key = api_key
        self._client = client
        self._base_delay = base_delay

    async def generate_json(self, system: str, prompt: str, *, temperature: float = 0.2) -> str:
        body: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
        }
        data = await post_json(
            self._client,
            f"{BASE_URL}/models/{self.model}:generateContent",
            provider=f"gemini/{self.model}",
            # the key goes in a header, not the URL, so it never lands in logs
            headers={"x-goog-api-key": self._key},
            body=body,
            base_delay=self._base_delay,
        )
        try:
            parts = data["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as e:
            # e.g. the reply was blocked by a safety filter and has no content
            reason = data.get("promptFeedback") or data.get("candidates", [{}])[0].get("finishReason")
            raise ProviderError(f"gemini returned no text ({reason})") from e
