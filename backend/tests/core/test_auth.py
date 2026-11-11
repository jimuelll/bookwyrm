import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.config import Settings
from app.core.auth import TokenVerifier
from app.main import create_app

ISSUER = "https://demo.supabase.co/auth/v1"
SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())  # stands in for Supabase's private key
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())
LEGACY_SECRET = "a-legacy-shared-secret-of-32-bytes!"


def token(key: Any = SIGNING_KEY, algorithm: str = "ES256", **overrides: Any) -> str:
    claims = {
        "sub": "user-123",
        "email": "ana@school.edu",
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 300,
    } | overrides
    return jwt.encode(claims, key, algorithm=algorithm)


@pytest.fixture
def client() -> TestClient:
    verifier = TokenVerifier(
        issuer=ISSUER, public_key_for=lambda _: SIGNING_KEY.public_key(), hs256_secret=LEGACY_SECRET
    )
    return TestClient(create_app(Settings(_env_file=None), verifier))


def me(client: TestClient, bearer: str | None) -> Any:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    return client.get("/auth/me", headers=headers)


def test_returns_the_user_for_a_valid_token(client: TestClient) -> None:
    response = me(client, token())
    assert response.status_code == 200
    assert response.json() == {"id": "user-123", "email": "ana@school.edu"}


def test_refuses_a_request_without_a_token(client: TestClient) -> None:
    response = me(client, None)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_refuses_an_expired_token(client: TestClient) -> None:
    assert me(client, token(exp=int(time.time()) - 10)).status_code == 401


def test_refuses_a_token_signed_by_someone_else(client: TestClient) -> None:
    assert me(client, token(key=OTHER_KEY)).status_code == 401


def test_refuses_an_anonymous_key_token(client: TestClient) -> None:
    # Supabase's public anon key is itself a JWT, with audience "anon"; it must not count as a login
    assert me(client, token(aud="anon")).status_code == 401


def test_refuses_a_token_from_another_project(client: TestClient) -> None:
    assert me(client, token(iss="https://someone-else.supabase.co/auth/v1")).status_code == 401


def test_refuses_an_unsigned_token(client: TestClient) -> None:
    unsigned = jwt.encode({"sub": "x", "aud": "authenticated", "iss": ISSUER}, None, algorithm="none")
    assert me(client, unsigned).status_code == 401


def test_accepts_a_legacy_shared_secret_token(client: TestClient) -> None:
    assert me(client, token(key=LEGACY_SECRET, algorithm="HS256")).status_code == 200


def test_says_auth_is_not_configured_without_a_supabase_url() -> None:
    client = TestClient(create_app(Settings(_env_file=None, supabase_url="")))
    assert me(client, token()).status_code == 503


def test_health_needs_no_login(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}
