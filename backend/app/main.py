"""The HTTP API. Run with:  uv run uvicorn app.main:app --reload

For now: a health check and one protected route proving that Supabase logins are checked.
Upload, quiz and stats routes come next (docs/ARCHITECTURE.md §6).
"""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.core.auth import AuthUser, InvalidToken, TokenVerifier, supabase_verifier


class Me(BaseModel):
    id: str
    email: str | None


def create_app(settings: Settings | None = None, verifier: TokenVerifier | None = None) -> FastAPI:
    settings = settings or get_settings()
    if verifier is None and settings.supabase_url:
        verifier = supabase_verifier(settings.supabase_url, settings.supabase_jwt_secret)

    app = FastAPI(title="Bookwyrm API", version="0.1.0")
    # Browsers block a page on one origin (localhost:5173) from reading another (localhost:8000) unless
    # the API says it's allowed. Only our own frontend is listed; never "*" with credentials.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    bearer = HTTPBearer(auto_error=False)

    # A plain `def` dependency: FastAPI runs it in a worker thread, so fetching signing keys
    # (a network call, cached afterwards) doesn't block other requests.
    def current_user(
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> AuthUser:
        if verifier is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Auth is not configured (set SUPABASE_URL)."
            )
        if credentials is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Log in first.", headers={"WWW-Authenticate": "Bearer"}
            )
        try:
            return verifier.verify(credentials.credentials)
        except InvalidToken:
            # don't echo why: telling an attacker "expired" vs "bad signature" only helps them
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Your session is invalid or expired. Log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from None

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/auth/me")
    def me(user: Annotated[AuthUser, Depends(current_user)]) -> Me:
        return Me(id=user.id, email=user.email)

    return app


app = create_app()
