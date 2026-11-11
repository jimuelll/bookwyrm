"""The HTTP API. Run with:  uv run uvicorn app.main:app --reload

Routes so far: health, who-am-I, and the reader's profile (display name).
Every write to the database goes through here; browsers never write tables directly.
Upload, quiz and stats routes come next (docs/ARCHITECTURE.md §6).
"""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.core.auth import AuthUser, InvalidToken, TokenVerifier, supabase_verifier
from app.db.session import make_engine, make_sessionmaker
from app.profiles import (
    InvalidDisplayName,
    ProfileStore,
    SqlProfileStore,
    clean_display_name,
    default_display_name,
)


class Me(BaseModel):
    id: str
    email: str | None


class ProfileOut(BaseModel):
    display_name: str
    email: str | None
    # False until they save a name, so the UI can say the shown name is only a suggestion
    chosen: bool


class ProfileIn(BaseModel):
    display_name: str


def create_app(
    settings: Settings | None = None,
    verifier: TokenVerifier | None = None,
    profiles: ProfileStore | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if verifier is None and settings.supabase_url:
        verifier = supabase_verifier(settings.supabase_url, settings.supabase_jwt_secret)
    if profiles is None and settings.database_url:
        profiles = SqlProfileStore(make_sessionmaker(make_engine(settings.database_url)))

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

    def profile_store() -> ProfileStore:
        if profiles is None:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "The database is not configured (set DATABASE_URL)."
            )
        return profiles

    User = Annotated[AuthUser, Depends(current_user)]
    Profiles = Annotated[ProfileStore, Depends(profile_store)]

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/auth/me")
    def me(user: User) -> Me:
        return Me(id=user.id, email=user.email)

    @app.get("/profile")
    async def get_profile(user: User, store: Profiles) -> ProfileOut:
        saved = await store.get_display_name(user.id)
        return ProfileOut(
            display_name=saved or default_display_name(user), email=user.email, chosen=saved is not None
        )

    @app.put("/profile")
    async def update_profile(body: ProfileIn, user: User, store: Profiles) -> ProfileOut:
        # The user id comes from the verified token, never from the request body, so nobody can
        # change someone else's name by sending a different id.
        try:
            name = clean_display_name(body.display_name)
        except InvalidDisplayName as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
        await store.set_display_name(user.id, name)
        return ProfileOut(display_name=name, email=user.email, chosen=True)

    return app


app = create_app()
