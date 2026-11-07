"""PostgreSQL 연결 풀. DB가 꺼져 있어도 서버는 뜨고(규칙 판정은 계속), 저장만 건너뛴다."""
from __future__ import annotations

import logging
import pathlib

from psycopg_pool import ConnectionPool

from .config import DATABASE_URL

log = logging.getLogger("db")
_pool: ConnectionPool | None = None


def init_db() -> ConnectionPool | None:
    global _pool
    try:
        _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=True, timeout=5)
        sql = (pathlib.Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
        with _pool.connection() as c:
            c.execute(sql)
        log.info("DB 연결: %s", DATABASE_URL)
    except Exception as e:  # DB 없이도 데모는 돌아가야 한다
        log.warning("DB 연결 실패 → 저장 없이 동작: %s", e)
        _pool = None
    return _pool


def pool() -> ConnectionPool | None:
    return _pool
