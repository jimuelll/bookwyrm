"""documents bucket: a private Supabase Storage bucket for uploaded PDFs

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Buckets are rows in Supabase's storage.buckets table, so a migration can create one and every
    # environment gets the same settings. `public = false`: no object has a public URL, and with no
    # storage policies browsers can't list or read it with the publishable key. Only the backend (with
    # the secret key) can. Storage itself also refuses files over 25 MB or that aren't PDFs, a second
    # check behind the API's. A plain Postgres (CI, local tests) has no `storage` schema: skipped there.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
            INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
            VALUES ('documents', 'documents', false, 25 * 1024 * 1024, ARRAY['application/pdf'])
            ON CONFLICT (id) DO UPDATE SET
              public = false,
              file_size_limit = EXCLUDED.file_size_limit,
              allowed_mime_types = EXCLUDED.allowed_mime_types;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Left in place on purpose: removing the bucket would delete readers' PDFs. Empty and delete it in
    # the Supabase dashboard if that's really intended.
    pass
