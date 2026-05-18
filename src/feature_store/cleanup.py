"""Nightly cleanup — prunes stale rows from the app DB and forces TimescaleDB compression."""
from __future__ import annotations

import json
import logging
import os

import asyncpg

logger = logging.getLogger(__name__)


async def run_cleanup() -> None:
    db_url = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(db_url)
    try:
        result = await conn.fetchval("SELECT cleanup_old_data()")
        stats = json.loads(result)
        logger.info(
            "DB cleanup: signals=-%d  strategies=-%d  backtests=-%d  opportunities=-%d",
            stats["signals_deleted"],
            stats["strategies_deleted"],
            stats["backtests_deleted"],
            stats["opportunities_deleted"],
        )
    except Exception as exc:
        logger.warning("DB cleanup failed: %s", exc)
    finally:
        await conn.close()
