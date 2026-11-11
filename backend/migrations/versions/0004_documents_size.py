"""documents.size_bytes: each file's size, for the per-reader storage quota (app/quotas.py)

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Rows uploaded before this get 0: they count toward the document limit but not the megabytes.
    # Fine for the few test books that exist; re-uploading one records its real size.
    op.add_column("documents", sa.Column("size_bytes", sa.BigInteger(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("documents", "size_bytes")
