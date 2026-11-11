"""Display names: the rules for them, and where they are stored.

The rules live here, on the server, because the browser can be tampered with: whatever the
Settings form checks, a hand-made request could skip. The database repeats the length rule as a
last line of defence (migrations/versions/0001_profiles.py).
"""

import re
import unicodedata
from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.auth import AuthUser
from app.db.models import DISPLAY_NAME_MAX, Profile

_SPACES = re.compile(r"\s+")


class InvalidDisplayName(ValueError):
    """The message is shown to the reader as is."""


def clean_display_name(raw: str) -> str:
    """Tidy a submitted name, or raise InvalidDisplayName saying what to fix."""
    # NFC: a letter typed as "e" + accent and the single character "é" become the same text
    name = _SPACES.sub(" ", unicodedata.normalize("NFC", raw)).strip()
    if not name:
        raise InvalidDisplayName("Enter a display name.")
    if len(name) > DISPLAY_NAME_MAX:
        raise InvalidDisplayName(f"Keep it to {DISPLAY_NAME_MAX} characters or fewer.")
    # control and invisible formatting characters (e.g. zero-width spaces, right-to-left overrides)
    # can make a name look like someone else's on a leaderboard
    if any(unicodedata.category(ch) in ("Cc", "Cf") for ch in name):
        raise InvalidDisplayName("Use letters, numbers, spaces and ordinary punctuation only.")
    return name


def default_display_name(user: AuthUser) -> str:
    """Until they choose one: their Google name, else the part of their email before the @."""
    for candidate in (user.name, (user.email or "").split("@")[0]):
        try:
            return clean_display_name(candidate or "")[:DISPLAY_NAME_MAX]
        except InvalidDisplayName:
            continue
    return "Reader"


class ProfileStore(Protocol):
    async def get_display_name(self, user_id: str) -> str | None: ...
    async def set_display_name(self, user_id: str, name: str) -> None: ...


class SqlProfileStore:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def get_display_name(self, user_id: str) -> str | None:
        async with self._sessions() as session:
            name: str | None = await session.scalar(
                select(Profile.display_name).where(Profile.id == UUID(user_id))
            )
            return name

    async def set_display_name(self, user_id: str, name: str) -> None:
        # "upsert": create the row the first time, update it after that, in one statement
        statement = insert(Profile).values(id=UUID(user_id), display_name=name)
        statement = statement.on_conflict_do_update(
            index_elements=[Profile.id],
            set_={"display_name": name, "updated_at": statement.excluded.updated_at},
        )
        async with self._sessions() as session, session.begin():
            await session.execute(statement)
