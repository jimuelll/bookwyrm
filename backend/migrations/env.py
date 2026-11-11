"""Alembic runs this to apply migrations:  uv run alembic upgrade head

The connection string is DATABASE_URL from .env (via app/config.py), never hard-coded here.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

from app.config import get_settings
from app.db.models import Base
from app.db.session import make_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# lets `alembic revision --autogenerate` compare the models with the database
target_metadata = Base.metadata


def database_url() -> str:
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    if not url:
        raise SystemExit("DATABASE_URL is not set (see .env.example).")
    return url


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql`: print the SQL instead of running it."""
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = make_engine(database_url())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
