import os
import time
import uuid
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.auth import AuthUser, TokenVerifier
from app.main import create_app
from app.profiles import InvalidDisplayName, clean_display_name, default_display_name

ISSUER = "https://demo.supabase.co/auth/v1"
KEY = ec.generate_private_key(ec.SECP256R1())
ANA = "11111111-1111-1111-1111-111111111111"


class MemoryProfiles:
    """A stand-in for the database table: same behaviour, kept in a dict."""

    def __init__(self) -> None:
        self.names: dict[str, str] = {}

    async def get_display_name(self, user_id: str) -> str | None:
        return self.names.get(user_id)

    async def set_display_name(self, user_id: str, name: str) -> None:
        self.names[user_id] = name


def token(sub: str = ANA, **metadata: Any) -> str:
    claims = {
        "sub": sub,
        "email": "ana.reyes@school.edu",
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 300,
        "user_metadata": metadata,
    }
    return jwt.encode(claims, KEY, algorithm="ES256")


@pytest.fixture
def store() -> MemoryProfiles:
    return MemoryProfiles()


@pytest.fixture
def client(store: MemoryProfiles) -> TestClient:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    return TestClient(create_app(Settings(_env_file=None), verifier, store))


def auth(bearer: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {bearer}"}


# --- the rules ---


def test_tidies_spaces_around_and_inside_a_name() -> None:
    assert clean_display_name("  Ana   Reyes ") == "Ana Reyes"


def test_rejects_an_empty_name() -> None:
    with pytest.raises(InvalidDisplayName, match="Enter"):
        clean_display_name("   ")


def test_rejects_a_name_longer_than_40_characters() -> None:
    with pytest.raises(InvalidDisplayName, match="40"):
        clean_display_name("a" * 41)


def test_rejects_invisible_characters_that_could_impersonate_someone() -> None:
    with pytest.raises(InvalidDisplayName):
        clean_display_name("Ana​Reyes")  # zero-width space


def test_accepts_names_in_any_language() -> None:
    assert clean_display_name("José Rizal") == "José Rizal"


def test_default_name_prefers_the_google_name_then_the_email() -> None:
    assert default_display_name(AuthUser(id=ANA, email="ana@x.edu", name="Ana Reyes")) == "Ana Reyes"
    assert default_display_name(AuthUser(id=ANA, email="ana@x.edu")) == "ana"


# --- the API ---


def test_suggests_a_name_until_one_is_chosen(client: TestClient) -> None:
    response = client.get("/profile", headers=auth(token(full_name="Ana Reyes")))
    assert response.json() == {"display_name": "Ana Reyes", "email": "ana.reyes@school.edu", "chosen": False}


def test_saves_a_new_name_for_the_logged_in_reader_only(client: TestClient, store: MemoryProfiles) -> None:
    response = client.put("/profile", json={"display_name": " Bookworm  Ana "}, headers=auth(token()))

    assert response.status_code == 200
    assert response.json()["display_name"] == "Bookworm Ana"
    assert store.names == {ANA: "Bookworm Ana"}
    assert client.get("/profile", headers=auth(token())).json()["chosen"] is True


def test_explains_an_invalid_name(client: TestClient, store: MemoryProfiles) -> None:
    response = client.put("/profile", json={"display_name": "x" * 41}, headers=auth(token()))
    assert response.status_code == 422
    assert "40 characters" in response.json()["detail"]
    assert store.names == {}


def test_refuses_to_change_a_name_without_logging_in(client: TestClient) -> None:
    assert client.put("/profile", json={"display_name": "Ana"}).status_code == 401


def test_says_the_database_is_not_configured() -> None:
    verifier = TokenVerifier(issuer=ISSUER, public_key_for=lambda _: KEY.public_key())
    client = TestClient(create_app(Settings(_env_file=None, database_url=""), verifier))
    assert client.get("/profile", headers=auth(token())).status_code == 503


# --- the real table (runs where a test database exists, e.g. CI) ---

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL (a disposable database) to run")
async def test_the_profiles_table_creates_then_updates_a_row() -> None:
    from app.db.session import make_engine, make_sessionmaker
    from app.profiles import SqlProfileStore

    engine = make_engine(TEST_DATABASE_URL)
    store = SqlProfileStore(make_sessionmaker(engine))
    user = str(uuid.uuid4())
    try:
        assert await store.get_display_name(user) is None
        await store.set_display_name(user, "First")
        await store.set_display_name(user, "Second")
        assert await store.get_display_name(user) == "Second"
    finally:
        await engine.dispose()
