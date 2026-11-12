"""Settings, read from environment variables or the repository's .env file (see .env.example)."""

from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.ingestion.sandbox import Limits

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",  # .env also holds frontend/database values this module doesn't use
    )

    # Primary LLM. The other real provider is used as a fallback when its key is set.
    llm_provider: Literal["gemini", "groq", "fake"] = "groq"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    # Embeddings (app/providers/embeddings.py): what lets a topic find passages by meaning, not only by
    # spelling. With no Gemini key there is no embedder and topics fall back to keyword search.
    # The dimension is baked into the database column (chunks.embedding is vector(768)): changing it
    # needs a migration and re-embedding every passage.
    embedding_provider: Literal["gemini", "fake"] = "gemini"
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    # How the topic search keeps a passage: it must be one of the closest `semantic_top_k` AND at least
    # this similar (cosine, 1 = same direction). A search by distance always returns *something*, even
    # for a topic the PDF never mentions; the floor is what lets us say "nothing here about that".
    # Measured with gemini-embedding-001 (768 dims) on one 3-passage biology book: topics that are in the book
    # scored 0.62-0.72 against their best passage; topics that are not ("French Revolution", "stock market",
    # ...) never passed 0.54. 0.58 sits in that gap. It is one small sample, so re-check it on real,
    # longer PDFs (and again whenever the embedding model changes: every model has its own scale).
    semantic_top_k: int = 12
    semantic_min_similarity: float = 0.58
    # Writing a batch of questions is a long generation (a reasoning model can think for a while
    # before the first token), so 60s was cutting off healthy calls. This is the read timeout.
    llm_timeout_seconds: float = 180.0

    # Ingestion limits (docs/ARCHITECTURE.md §4.1)
    max_pages: int = 500
    max_upload_mb: int = 25
    # Where uploaded PDFs are kept (app/storage.py): a private Supabase Storage bucket when the secret key
    # below is set, else this folder (relative paths are under backend/). The folder also holds temporary
    # files while an upload is checked and read.
    storage_dir: str = "storage"
    storage_bucket: str = "documents"  # created by migrations/versions/0003_documents_bucket.py

    # Per-reader upload limits (app/quotas.py, docs/ARCHITECTURE.md §9)
    max_documents_per_user: int = 50
    max_storage_mb_per_user: int = 500
    upload_rate_count: int = 10  # at most this many upload attempts...
    upload_rate_window_seconds: int = 600  # ...in any window this long

    # Quiz generation: every quiz costs LLM calls, so each reader gets a ceiling on size and pace
    max_quiz_questions: int = 20
    quiz_rate_count: int = 10  # at most this many quizzes asked for...
    quiz_rate_window_seconds: int = 600  # ...in any window this long

    # PDF parsing runs in a child process (app/ingestion/sandbox.py)
    pdf_inspect_timeout_seconds: float = 20.0  # the quick checks, while the upload request waits
    pdf_extract_timeout_seconds: float = 180.0  # reading every page, in the background
    pdf_memory_mb: int = 1024  # address-space cap for the child; Linux only, 0 = none
    pdf_max_parallel: int = 2  # children running at once, across all readers

    # Chunking, in estimated tokens; kept in config so the evaluation can vary them
    chunk_target_tokens: int = 600
    chunk_max_tokens: int = 800
    chunk_overlap_tokens: int = 80

    # Supabase (auth, database, storage). The API only *checks* login tokens; Supabase issues them.
    supabase_url: str = ""  # e.g. https://abcd1234.supabase.co
    # Only for projects still on the legacy shared-secret (HS256) JWTs. New projects sign tokens with
    # asymmetric keys that are fetched from the project's public JWKS endpoint, so no secret is needed.
    supabase_jwt_secret: str = ""
    # The project's secret key (dashboard -> Project Settings -> API Keys: an sb_secret_... key, or the
    # legacy service_role key). Used only to reach Storage. Server-side only: it bypasses every access
    # rule, so it must never reach the browser or a VITE_* variable.
    supabase_secret_key: str = ""
    # The Postgres connection string as Supabase shows it (dashboard -> Connect -> pooler), e.g.
    # postgresql://postgres.<project-id>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
    # (app/db/session.py switches it to the asyncpg driver)
    # Server-side only: it contains the database password and bypasses Row Level Security.
    database_url: str = ""

    # API
    cors_origins: str = "http://localhost:5173"  # comma-separated browser origins allowed to call the API

    @field_validator("embedding_model", mode="before")
    @classmethod
    def _blank_means_default(cls, value: object) -> object:
        """`EMBEDDING_MODEL=` (a blank line, as older .env.example files had) means "use the default".

        An environment variable that is set but empty still *overrides* a default, so without this the
        model name would be "" and every embedding call would fail with a 404."""
        if isinstance(value, str) and not value.strip():
            return cls.model_fields["embedding_model"].default
        return value

    @property
    def storage_path(self) -> Path:
        path = Path(self.storage_dir)
        return path if path.is_absolute() else REPO_ROOT / "backend" / path

    def pdf_limits(self, timeout_seconds: float) -> Limits:
        return Limits(
            timeout_seconds=timeout_seconds, memory_mb=self.pdf_memory_mb, max_parallel=self.pdf_max_parallel
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def get_settings() -> Settings:
    return Settings()
