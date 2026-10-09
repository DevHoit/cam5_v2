from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PendingMessage:
    message_id: str
    payload: dict[str, Any]
    attempts: int
    next_attempt_at: float


class LocalStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self._migrate()

    def close(self) -> None:
        self.db.close()

    def _migrate(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS outbound_messages (
              message_id TEXT PRIMARY KEY,
              boot_id TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT 'pending',
              attempts INTEGER NOT NULL DEFAULT 0,
              next_attempt_at REAL NOT NULL DEFAULT 0,
              last_error TEXT,
              sent_at REAL,
              dead_letter_at REAL
            );
            CREATE INDEX IF NOT EXISTS outbound_pending_idx
              ON outbound_messages(state, next_attempt_at, sequence);

            CREATE TABLE IF NOT EXISTS config_cache (
              singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
              config_version INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              updated_at REAL NOT NULL
            );
            """
        )
        self.db.commit()

    def queue(self, payload: dict[str, Any]) -> bool:
        message_id = str(payload["message_id"])
        with self.db:
            cursor = self.db.execute(
                """
                INSERT OR IGNORE INTO outbound_messages
                  (message_id, boot_id, sequence, created_at, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    str(payload["boot_id"]),
                    int(payload["sequence"]),
                    str(payload["created_at"]),
                    json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
                ),
            )
        return cursor.rowcount == 1

    def pending(self, limit: int = 25, now: float | None = None) -> list[PendingMessage]:
        current = time.time() if now is None else now
        rows = self.db.execute(
            """
            SELECT message_id, payload_json, attempts, next_attempt_at
            FROM outbound_messages
            WHERE state = 'pending' AND next_attempt_at <= ?
            ORDER BY rowid
            LIMIT ?
            """,
            (current, limit),
        ).fetchall()
        return [
            PendingMessage(
                message_id=row["message_id"],
                payload=json.loads(row["payload_json"]),
                attempts=row["attempts"],
                next_attempt_at=row["next_attempt_at"],
            )
            for row in rows
        ]

    def mark_sent(self, message_id: str, now: float | None = None) -> None:
        current = time.time() if now is None else now
        with self.db:
            self.db.execute(
                "UPDATE outbound_messages SET state='sent', sent_at=?, last_error=NULL WHERE message_id=?",
                (current, message_id),
            )

    def mark_dead_letter(self, message_id: str, error: str, now: float | None = None) -> None:
        current = time.time() if now is None else now
        with self.db:
            self.db.execute(
                """
                UPDATE outbound_messages
                SET state='dead_letter', dead_letter_at=?, last_error=?, attempts=attempts+1
                WHERE message_id=?
                """,
                (current, error[:1000], message_id),
            )

    def schedule_retry(self, message_id: str, delay_seconds: int, error: str, now: float | None = None) -> None:
        current = time.time() if now is None else now
        with self.db:
            self.db.execute(
                """
                UPDATE outbound_messages
                SET attempts=attempts+1, next_attempt_at=?, last_error=?
                WHERE message_id=? AND state='pending'
                """,
                (current + max(1, delay_seconds), error[:1000], message_id),
            )

    def prune_terminal(self, older_than_seconds: int = 7 * 24 * 60 * 60, now: float | None = None) -> int:
        current = time.time() if now is None else now
        cutoff = current - max(3600, older_than_seconds)
        with self.db:
            cursor = self.db.execute(
                """
                DELETE FROM outbound_messages
                WHERE (state='sent' AND sent_at IS NOT NULL AND sent_at < ?)
                   OR (state='dead_letter' AND dead_letter_at IS NOT NULL AND dead_letter_at < ?)
                """,
                (cutoff, cutoff),
            )
        return cursor.rowcount

    def stats(self) -> dict[str, int | float]:
        counts = {
            row["state"]: int(row["count"])
            for row in self.db.execute("SELECT state, COUNT(*) AS count FROM outbound_messages GROUP BY state")
        }
        pending_bytes = self.db.execute(
            "SELECT COALESCE(SUM(LENGTH(payload_json)),0) AS bytes FROM outbound_messages WHERE state='pending'"
        ).fetchone()["bytes"]
        file_bytes = self.path.stat().st_size if self.path.exists() else 0
        return {
            "pending_messages": counts.get("pending", 0),
            "pending_bytes": int(pending_bytes or 0),
            "dead_letter_messages": counts.get("dead_letter", 0),
            "database_bytes": int(file_bytes),
        }

    def save_config(self, payload: dict[str, Any]) -> None:
        version = int(payload["config_version"])
        with self.db:
            self.db.execute(
                """
                INSERT INTO config_cache(singleton, config_version, payload_json, updated_at)
                VALUES(1, ?, ?, ?)
                ON CONFLICT(singleton) DO UPDATE SET
                  config_version=excluded.config_version,
                  payload_json=excluded.payload_json,
                  updated_at=excluded.updated_at
                """,
                (version, json.dumps(payload, separators=(",", ":"), ensure_ascii=False), time.time()),
            )

    def load_config(self) -> dict[str, Any] | None:
        row = self.db.execute("SELECT payload_json FROM config_cache WHERE singleton=1").fetchone()
        return json.loads(row["payload_json"]) if row else None
