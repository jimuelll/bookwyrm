"""Database tables, as SQLAlchemy classes. The schema itself is created by Alembic migrations."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

DISPLAY_NAME_MAX = 40


class Base(DeclarativeBase):
    pass


class Profile(Base):
    """Our own per-user data. `id` is the Supabase Auth user id (auth.users.id)."""

    __tablename__ = "profiles"
    __table_args__ = (
        # the database enforces the rule too, so no code path can store an empty or huge name
        CheckConstraint(
            f"char_length(display_name) between 1 and {DISPLAY_NAME_MAX}", name="display_name_length"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(DISPLAY_NAME_MAX))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
