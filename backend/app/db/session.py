"""The database connection: one engine (a pool of connections) per process."""

from typing import Any

from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

SUPABASE_TRANSACTION_POOLER_PORT = 6543


def normalize_url(database_url: str) -> URL:
    """Accept the connection string exactly as Supabase shows it.

    Supabase gives `postgresql://...`; without a driver named, SQLAlchemy would pick psycopg, which we
    don't use. We talk to Postgres with asyncpg, so `postgres://` and `postgresql://` become
    `postgresql+asyncpg://`. A driver someone named on purpose is left alone.
    """
    url = make_url(database_url)
    if url.drivername in ("postgres", "postgresql"):
        url = url.set(drivername="postgresql+asyncpg")
    return url


def make_engine(database_url: str) -> AsyncEngine:
    url = normalize_url(database_url)
    local = (url.host or "") in ("localhost", "127.0.0.1", "db")
    # Supabase only accepts encrypted connections; a local Postgres usually has no TLS at all
    connect_args: dict[str, Any] = {} if local else {"ssl": "require"}
    if url.port == SUPABASE_TRANSACTION_POOLER_PORT:
        # The transaction pooler hands each statement to whichever connection is free, so a statement
        # prepared on one connection may not exist on the next. Turn statement caching off for it.
        connect_args["statement_cache_size"] = 0
        url = url.update_query_dict({"prepared_statement_cache_size": "0"})
    return create_async_engine(
        url,
        pool_pre_ping=True,  # check a pooled connection is still alive before using it
        connect_args=connect_args,
    )


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay readable after commit, without another query
    return async_sessionmaker(engine, expire_on_commit=False)
