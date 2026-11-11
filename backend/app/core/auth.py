"""Checking Supabase login tokens (JWTs) on every API request.

The browser logs in with Supabase and sends its access token as `Authorization: Bearer <token>`.
A JWT is three base64 parts: header.claims.signature. We trust the claims (who the user is) only
after checking that Supabase signed them, that they haven't expired, and that they were issued by
our project for logged-in users. See docs/ARCHITECTURE.md §9.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt

# Only these algorithms are accepted. Never let the token's own header decide freely: a forged token
# could claim "alg: none" (no signature) or HS256 signed with our *public* key (algorithm confusion).
ASYMMETRIC = {"RS256", "ES256"}
AUDIENCE = "authenticated"  # Supabase's audience for logged-in users (anon keys carry "anon")


class InvalidToken(Exception):
    """The token is missing, malformed, expired, or not signed by our Supabase project."""


@dataclass(frozen=True)
class AuthUser:
    id: str  # Supabase user id (UUID), the `sub` claim
    email: str | None


KeyLookup = Callable[[str], Any]  # token -> public key that should have signed it


class TokenVerifier:
    def __init__(self, *, issuer: str, public_key_for: KeyLookup | None, hs256_secret: str = "") -> None:
        self._issuer = issuer
        self._public_key_for = public_key_for
        self._secret = hs256_secret

    def verify(self, token: str) -> AuthUser:
        try:
            algorithm = jwt.get_unverified_header(token).get("alg")
            if algorithm in ASYMMETRIC and self._public_key_for:
                key: Any = self._public_key_for(token)
            elif algorithm == "HS256" and self._secret:
                key = self._secret
            else:
                raise InvalidToken(f"unsupported signing algorithm: {algorithm}")
            claims = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=AUDIENCE,
                issuer=self._issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        # bad signature, expired, wrong audience/issuer, unreadable token, signing key not found
        except jwt.PyJWTError as e:
            raise InvalidToken(str(e)) from e
        return AuthUser(id=str(claims["sub"]), email=claims.get("email"))


def supabase_verifier(supabase_url: str, hs256_secret: str = "") -> TokenVerifier:
    """Verifier for a Supabase project. Public keys come from its JWKS endpoint and are cached."""
    base = supabase_url.rstrip("/")
    jwks = jwt.PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=600)
    return TokenVerifier(
        issuer=f"{base}/auth/v1",
        public_key_for=lambda token: jwks.get_signing_key_from_jwt(token).key,
        hs256_secret=hs256_secret,
    )
