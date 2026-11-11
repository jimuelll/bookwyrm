from app.db.session import normalize_url

SUPABASE = "postgresql://postgres.abc:pw@aws-0-region.pooler.supabase.com:5432/postgres"


def test_uses_asyncpg_for_a_url_copied_from_supabase() -> None:
    url = normalize_url(SUPABASE)
    assert url.drivername == "postgresql+asyncpg"
    assert (url.host, url.port, url.database) == ("aws-0-region.pooler.supabase.com", 5432, "postgres")


def test_accepts_the_short_postgres_scheme() -> None:
    assert normalize_url("postgres://u:p@h/db").drivername == "postgresql+asyncpg"


def test_keeps_a_driver_named_on_purpose() -> None:
    assert normalize_url("postgresql+asyncpg://u:p@h/db").drivername == "postgresql+asyncpg"
