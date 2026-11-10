-- Runs once, when the local Postgres volume is first created (docker-compose.yml).
-- Real schema changes go through Alembic migrations, not here.
CREATE EXTENSION IF NOT EXISTS vector;
