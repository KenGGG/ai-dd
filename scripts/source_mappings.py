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
from datetime import datetime
from pathlib import Path

# Ensure the project root is in the path for direct module use
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


def get_db_path() -> Path:
    """Get the path to the AIDDA SQLite database."""
    # The database is used by both Python and Node.js code
    data_dir = _PROJECT_ROOT / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "aidda.db"


def init_db() -> None:
    """Initialize the source_mappings table if it doesn't exist."""
    db_path = get_db_path()
    db = sqlite3.connect(db_path)
    try:
        db.executescript("""
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
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE(notebook_id, source_id)
            );

            CREATE INDEX IF NOT EXISTS idx_source_mapping_project ON source_mappings(project_id);
            CREATE INDEX IF NOT EXISTS idx_source_mapping_announcement ON source_mappings(announcement_id);
            CREATE INDEX IF NOT EXISTS idx_source_mapping_sha256 ON source_mappings(sha256);
        """)
        db.commit()
    finally:
        db.close()


def get_source_mappings_by_project(project_id: str) -> list[dict]:
    """Get all source mappings for a given project."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.prepare(
            "SELECT * FROM source_mappings WHERE project_id = ? ORDER BY id DESC"
        )
        cursor.execute(project_id)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_matched_mapping_count(
    project_id: str,
    announcement_id: str | None,
    sha256: str | None,
) -> int:
    """Count matched mappings by announcement_id or sha256."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.prepare(
            """
            SELECT COUNT(*) as cnt FROM source_mappings
            WHERE project_id = ?
              AND (announcement_id = ? OR sha256 = ?)
              AND status = 'active'
            """
        )
        cursor.execute(project_id, announcement_id, sha256)
        row = cursor.fetchone()
        return row[0] if row else 0
    finally:
        conn.close()


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
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.prepare(
            """
            INSERT INTO source_mappings (
                project_id, announcement_id, sha256, notebook_id,
                source_id, source_title, local_path, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(notebook_id, source_id) DO UPDATE SET
                announcement_id = excluded.announcement_id,
                sha256 = excluded.sha256,
                source_title = excluded.source_title,
                local_path = excluded.local_path,
                status = excluded.status,
                updated_at = CURRENT_TIMESTAMP
            """
        )
        cursor.execute(
            project_id,
            announcement_id,
            sha256,
            notebook_id,
            source_id,
            source_title,
            local_path,
        )
        conn.commit()
    finally:
        conn.close()


def clean_mappings_for_project(project_id: str) -> None:
    """Delete all source mappings for a project."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.prepare("DELETE FROM source_mappings WHERE project_id = ?")
        cursor.execute(project_id)
        conn.commit()
    finally:
        conn.close()


def check_and_get_existing_mapping(
    project_id: str,
    announcement_id: str | None,
    sha256: str | None,
    notebook_id: str | None = None,
) -> dict | None:
    """
    Check if there's an existing mapping for the given announcement_id or sha256.
    Returns the mapping dict if found, otherwise None.
    """
    # First try matching by announcement_id
    if announcement_id:
        count = get_matched_mapping_count(project_id, announcement_id, None)
        if count > 0:
            mappings = get_source_mappings_by_project(project_id)
            for m in mappings:
                if m.get("announcement_id") == announcement_id and m.get("status") == "active":
                    if notebook_id is None or m.get("notebook_id") == notebook_id:
                        return m

    # Then try matching by sha256
    if sha256:
        count = get_matched_mapping_count(project_id, None, sha256)
        if count > 0:
            mappings = get_source_mappings_by_project(project_id)
            for m in mappings:
                if m.get("sha256") == sha256 and m.get("status") == "active":
                    if notebook_id is None or m.get("notebook_id") == notebook_id:
                        return m

    return None