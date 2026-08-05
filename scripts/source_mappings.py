#!/usr/bin/env python3
"""
Source mappings management for attachment deduplication and source matching.

This module provides operations to track the relationship between:
- Announcement ID (from CNINFO)
- SHA256 hash of the PDF
- Notebook ID (NotebookLM)
- Source ID (NotebookLM source)

The data is stored in the same SQLite database used by the Node.js server.
"""
import os
import sqlite3
import sys
from pathlib import Path

# Ensure the project root is in the path for direct module use
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


def get_db_path() -> Path:
    """Get the path to the AIDDA SQLite database."""
    raw_db_path = os.getenv("AIDDA_DB_PATH", "").strip()
    raw_data_dir = os.getenv("AIDDA_DATA_DIR", "").strip()

    if raw_db_path:
        path = Path(raw_db_path).expanduser()
    elif raw_data_dir:
        path = Path(raw_data_dir).expanduser() / "aidda.sqlite"
    else:
        path = _PROJECT_ROOT / "data" / "aidda.sqlite"

    if not path.is_absolute():
        path = (_PROJECT_ROOT / path).resolve()
    else:
        path = path.resolve()

    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def connect_db() -> sqlite3.Connection:
    """Create a unified database connection with proper settings."""
    conn = sqlite3.connect(
        get_db_path(),
        timeout=30,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db() -> None:
    """Initialize the source_mappings table if it doesn't exist."""
    with connect_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS source_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL,
                announcement_id TEXT,
                adjunct_url TEXT,
                sha256 TEXT,
                notebook_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_title TEXT,
                local_path TEXT,
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(notebook_id, source_id)
            );

            CREATE INDEX IF NOT EXISTS idx_source_mapping_project ON source_mappings(project_id);
            CREATE INDEX IF NOT EXISTS idx_source_mapping_announcement ON source_mappings(announcement_id);
            CREATE INDEX IF NOT EXISTS idx_source_mapping_sha256 ON source_mappings(sha256);
        """)
        conn.commit()


def get_source_mappings_by_project(
    project_id: str,
) -> list[dict]:
    """Get all source mappings for a given project."""
    with connect_db() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM source_mappings
            WHERE project_id = ?
            ORDER BY id DESC
            """,
            (project_id,),
        ).fetchall()

    return [dict(row) for row in rows]


def get_matched_mapping_count(
    project_id: str,
    announcement_id: str | None,
    sha256: str | None,
) -> int:
    """Count matched mappings by announcement_id or sha256."""
    with connect_db() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) as cnt FROM source_mappings
            WHERE project_id = ?
              AND (announcement_id = ? OR sha256 = ?)
              AND status = 'active'
            """,
            (project_id, announcement_id, sha256),
        ).fetchone()

        return row[0] if row else 0


def create_or_update_mapping(
    project_id: str,
    announcement_id: str | None,
    sha256: str | None,
    notebook_id: str,
    source_id: str,
    source_title: str | None,
    local_path: str,
) -> None:
    """Create or update a source mapping."""
    if not project_id:
        raise ValueError("project_id 不能为空")
    if not notebook_id:
        raise ValueError("notebook_id 不能为空")
    if not source_id:
        raise ValueError("source_id 不能为空")
    if not announcement_id and not sha256:
        raise ValueError(
            "announcement_id 和 sha256 至少需要一个",
        )

    with connect_db() as conn:
        conn.execute(
            """
            INSERT INTO source_mappings (
                project_id,
                announcement_id,
                sha256,
                notebook_id,
                source_id,
                source_title,
                local_path,
                status,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
            ON CONFLICT(notebook_id, source_id)
            DO UPDATE SET
                project_id = excluded.project_id,
                announcement_id = excluded.announcement_id,
                sha256 = excluded.sha256,
                source_title = excluded.source_title,
                local_path = excluded.local_path,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                project_id,
                announcement_id,
                sha256,
                notebook_id,
                source_id,
                source_title,
                local_path,
            ),
        )
        conn.commit()


def clean_mappings_for_project(project_id: str) -> None:
    """Delete all source mappings for a project."""
    with connect_db() as conn:
        conn.execute(
            "DELETE FROM source_mappings WHERE project_id = ?",
            (project_id,),
        )
        conn.commit()


def check_and_get_existing_mapping(
    project_id: str,
    notebook_id: str,
    announcement_id: str | None,
    sha256: str | None,
) -> dict | None:
    """
    Check if there's an existing mapping for the given announcement_id or sha256
    in the specified notebook. Returns the mapping dict if found, otherwise None.
    """
    with connect_db() as conn:
        if announcement_id:
            row = conn.execute(
                """
                SELECT *
                FROM source_mappings
                WHERE project_id = ?
                  AND notebook_id = ?
                  AND announcement_id = ?
                  AND status = 'active'
                ORDER BY id DESC
                LIMIT 1
                """,
                (
                    project_id,
                    notebook_id,
                    announcement_id,
                ),
            ).fetchone()

            if row:
                return dict(row)

        if sha256:
            row = conn.execute(
                """
                SELECT *
                FROM source_mappings
                WHERE project_id = ?
                  AND notebook_id = ?
                  AND sha256 = ?
                  AND status = 'active'
                ORDER BY id DESC
                LIMIT 1
                """,
                (
                    project_id,
                    notebook_id,
                    sha256,
                ),
            ).fetchone()

            if row:
                return dict(row)

    return None
