"""quizzes, questions, attempts, answers: a quiz written from a document, and each sitting of it

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("quizzes", "questions", "attempts", "answers")


def _id() -> sa.Column[sa.Uuid]:
    return sa.Column("id", sa.Uuid(), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _parent(column: str, table: str) -> sa.Column[sa.Uuid]:
    """A required link to a parent row; deleting the parent deletes this row too."""
    return sa.Column(column, sa.Uuid(), sa.ForeignKey(f"{table}.id", ondelete="CASCADE"), nullable=False)


def _now(column: str) -> sa.Column[sa.DateTime]:
    return sa.Column(column, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    # The four tables hang off each other with ON DELETE CASCADE:
    #   documents -> quizzes -> questions
    #                        -> attempts -> answers
    # so removing a book removes everything written from it, in one statement, by the database.
    op.create_table(
        "quizzes",
        _id(),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        _parent("document_id", "documents"),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), server_default="generating", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        _now("created_at"),
        _now("updated_at"),
        sa.CheckConstraint("status in ('generating', 'ready', 'failed')", name="quizzes_status_valid"),
    )
    op.create_index("quizzes_user_created_idx", "quizzes", ["user_id", "created_at"])
    # Postgres does not index a foreign key's column by itself; without this, deleting a document
    # would scan every quiz to find the ones to cascade to.
    op.create_index("quizzes_document_idx", "quizzes", ["document_id"])

    op.create_table(
        "questions",
        _id(),
        _parent("quiz_id", "quizzes"),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=True),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("topic", sa.String(80), nullable=False),
        sa.Column("difficulty", sa.String(8), nullable=False),
        # SET NULL, not CASCADE: a question outlives its passage (it keeps its own page and quote)
        sa.Column(
            "source_chunk_id", sa.Uuid(), sa.ForeignKey("chunks.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("page", sa.Integer(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("verifier_notes", sa.Text(), server_default="", nullable=False),
        # this unique constraint is also the index on quiz_id (it leads with it)
        sa.UniqueConstraint("quiz_id", "ordinal", name="questions_quiz_ordinal_key"),
    )
    op.create_index("questions_source_chunk_idx", "questions", ["source_chunk_id"])

    op.create_table(
        "attempts",
        _id(),
        _parent("quiz_id", "quizzes"),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("question_order", postgresql.JSONB(), nullable=False),
        sa.Column("option_order", postgresql.JSONB(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        _now("started_at"),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        # a score exists exactly when the attempt is finished, and can't exceed the number of questions
        sa.CheckConstraint("(score is null) = (finished_at is null)", name="attempts_score_when_finished"),
        sa.CheckConstraint("score is null or (score >= 0 and score <= total)", name="attempts_score_range"),
    )
    op.create_index("attempts_quiz_user_idx", "attempts", ["quiz_id", "user_id"])

    op.create_table(
        "answers",
        _id(),
        _parent("attempt_id", "attempts"),
        _parent("question_id", "questions"),
        sa.Column("response", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        _now("answered_at"),
        # one answer per question per attempt, whatever the code does
        sa.UniqueConstraint("attempt_id", "question_id", name="answers_attempt_question_key"),
    )
    op.create_index("answers_question_idx", "answers", ["question_id"])

    # As for documents (0002): on Supabase, deleting a login account deletes what it made.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
            ALTER TABLE quizzes ADD CONSTRAINT quizzes_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
            ALTER TABLE attempts ADD CONSTRAINT attempts_user_id_fkey
              FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
          END IF;
        END $$;
        """
    )
    # RLS on with no policies: only the backend's own connection can reach these (docs/ARCHITECTURE.md 9).
    # That matters most for `questions`, which holds the answers.
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
