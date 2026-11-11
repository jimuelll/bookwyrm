"""documents and chunks: uploaded PDFs and the passages cut from them

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), server_default="queued", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status in ('queued', 'extracting', 'chunking', 'ready', 'failed')", name="documents_status_valid"
        ),
        sa.UniqueConstraint("user_id", "content_hash", name="documents_user_hash_key"),
    )
    op.create_index("documents_user_created_idx", "documents", ["user_id", "created_at"])

    op.create_table(
        "chunks",
        sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),  # delete a document, its chunks go too
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("page_start", sa.Integer(), nullable=False),
        sa.Column("page_end", sa.Integer(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("page_marks", postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint("document_id", "ordinal", name="chunks_document_ordinal_key"),
    )
    op.create_index("chunks_document_page_idx", "chunks", ["document_id", "page_start"])

    # As for profiles (0001): on Supabase, deleting a login account deletes its documents (and through
    # them their chunks). A plain Postgres has no `auth` schema, so the link is skipped there.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
            ALTER TABLE documents ADD CONSTRAINT documents_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
          END IF;
        END $$;
        """
    )
    # RLS on with no policies: browsers can't reach these tables through Supabase's Data API at all;
    # only the backend's own connection can (docs/ARCHITECTURE.md 9).
    op.execute("ALTER TABLE documents ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE chunks ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("chunks")
    op.drop_table("documents")
