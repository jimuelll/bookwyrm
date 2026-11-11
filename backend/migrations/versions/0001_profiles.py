"""profiles: each user's display name

Revision ID: 0001
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("display_name", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("char_length(display_name) between 1 and 40", name="display_name_length"),
    )
    # On Supabase, link each profile to its login account so deleting the account deletes the profile.
    # A plain Postgres (CI, local tests) has no `auth` schema, so the link is skipped there.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
            ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
              FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
          END IF;
        END $$;
        """
    )
    # Supabase also exposes every table in `public` to browsers through its Data API. Turning on Row
    # Level Security with no policies means browsers can neither read nor write this table; only our
    # backend (which connects as the database owner) can. Every write goes through the API.
    op.execute("ALTER TABLE profiles ENABLE ROW LEVEL SECURITY")
    # Alembic's own bookkeeping table sits in `public` too; lock it the same way.
    op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("profiles")
