"""Settings, read from environment variables or the repository's .env file (see .env.example)."""

from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",  # .env also holds frontend/database values this module doesn't use
    )

    # Primary LLM. The other real provider is used as a fallback when its key is set.
    llm_provider: Literal["gemini", "groq", "fake"] = "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    llm_timeout_seconds: float = 60.0

    # Ingestion limits (docs/ARCHITECTURE.md §4.1)
    max_pages: int = 500
    max_upload_mb: int = 25

    # Chunking, in estimated tokens; kept in config so the evaluation can vary them
    chunk_target_tokens: int = 600
    chunk_max_tokens: int = 800
    chunk_overlap_tokens: int = 80

    # Supabase (auth, database, storage). The API only *checks* login tokens; Supabase issues them.
    supabase_url: str = ""  # e.g. https://abcd1234.supabase.co
    # Only for projects still on the legacy shared-secret (HS256) JWTs. New projects sign tokens with
    # asymmetric keys that are fetched from the project's public JWKS endpoint, so no secret is needed.
    supabase_jwt_secret: str = ""

    # API
    cors_origins: str = "http://localhost:5173"  # comma-separated browser origins allowed to call the API

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def get_settings() -> Settings:
    return Settings()
