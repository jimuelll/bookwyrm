"""chunks.embedding (pgvector) and the `embedding` document status

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DIM = 768  # must match Settings.embedding_dim
OLD = "('queued', 'extracting', 'chunking', 'ready', 'failed')"
NEW = "('queued', 'extracting', 'chunking', 'embedding', 'ready', 'failed')"


def upgrade() -> None:
    # Local docker already ran this from backend/db/init; on Supabase it enables the extension (once).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Nullable on purpose: a passage with no embedding is a normal state (no key configured, the
    # embedding service was down, or the book was read before this migration). Those passages are still
    # found by keyword search; "embed what is missing" can backfill them later.
    op.add_column("chunks", sa.Column("embedding", Vector(DIM), nullable=True))
    # Which model wrote the vector. Vectors from two models are not comparable, so when the model changes
    # we must know which rows to redo (docs/ARCHITECTURE.md 4.1, step 5).
    op.add_column("chunks", sa.Column("embedding_model", sa.String(64), nullable=True))

    # No vector index (HNSW/IVFFlat) on purpose. Every search here is "the nearest passages *within one
    # document*", a few hundred rows that the existing (document_id, page_start) index already narrows
    # to. Scanning those exactly is fast and gives the exact answer; an approximate index pays off when
    # one search spans millions of rows (a search across every reader's books), which we don't do.

    op.drop_constraint("documents_status_valid", "documents", type_="check")
    op.create_check_constraint("documents_status_valid", "documents", f"status in {NEW}")


def downgrade() -> None:
    op.execute(
        "UPDATE documents SET status = 'failed', error = 'Upload it again.' WHERE status = 'embedding'"
    )
    op.drop_constraint("documents_status_valid", "documents", type_="check")
    op.create_check_constraint("documents_status_valid", "documents", f"status in {OLD}")
    op.drop_column("chunks", "embedding_model")
    op.drop_column("chunks", "embedding")
