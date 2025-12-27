#!/usr/bin/env python3
"""
Database Migration Script for OpenAlgo Flow

Usage:
    uv run migration/migrate_all.py    (from backend folder)
    uv run migrate_all.py              (from migration folder)

This script handles all database migrations including:
- Adding new columns to existing tables
- Creating new tables if needed
- Data migrations
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime

# Determine the correct database path regardless of where script is run from
SCRIPT_DIR = Path(__file__).parent.resolve()
BACKEND_DIR = SCRIPT_DIR.parent

# Check if we're in migration folder or backend folder
if SCRIPT_DIR.name == "migration":
    DB_PATH = BACKEND_DIR / "openalgo_flow.db"
else:
    DB_PATH = SCRIPT_DIR / "openalgo_flow.db"

# Also check current working directory
CWD = Path.cwd()
if (CWD / "openalgo_flow.db").exists():
    DB_PATH = CWD / "openalgo_flow.db"
elif (CWD / "backend" / "openalgo_flow.db").exists():
    DB_PATH = CWD / "backend" / "openalgo_flow.db"


def get_connection():
    """Get database connection"""
    if not DB_PATH.exists():
        print(f"Database not found at: {DB_PATH}")
        print("The database will be created when you first run the application.")
        sys.exit(0)

    return sqlite3.connect(DB_PATH)


def get_existing_columns(conn, table_name: str) -> set:
    """Get existing columns in a table"""
    cursor = conn.execute(f"PRAGMA table_info({table_name})")
    return {row[1] for row in cursor.fetchall()}


def table_exists(conn, table_name: str) -> bool:
    """Check if a table exists"""
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,)
    )
    return cursor.fetchone() is not None


def log_migration(message: str):
    """Log migration message with timestamp"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{timestamp}] {message}")


# =============================================================================
# MIGRATION DEFINITIONS
# =============================================================================

MIGRATIONS = [
    {
        "id": "001_add_webhook_secret",
        "description": "Add webhook_secret column to workflows table",
        "table": "workflows",
        "column": "webhook_secret",
        "sql": "ALTER TABLE workflows ADD COLUMN webhook_secret VARCHAR(64);",
    },
]


def run_migrations():
    """Run all pending migrations"""
    print("=" * 60)
    print("OpenAlgo Flow - Database Migration")
    print("=" * 60)
    print(f"Database: {DB_PATH}")
    print()

    conn = get_connection()

    try:
        migrations_applied = 0
        migrations_skipped = 0

        for migration in MIGRATIONS:
            migration_id = migration["id"]
            description = migration["description"]
            table = migration["table"]

            # Check if table exists
            if not table_exists(conn, table):
                log_migration(f"SKIP: {migration_id} - Table '{table}' does not exist yet")
                migrations_skipped += 1
                continue

            # Check if column already exists
            if "column" in migration:
                existing_columns = get_existing_columns(conn, table)
                if migration["column"] in existing_columns:
                    log_migration(f"SKIP: {migration_id} - Column already exists")
                    migrations_skipped += 1
                    continue

            # Run migration
            log_migration(f"RUN:  {migration_id} - {description}")
            try:
                conn.execute(migration["sql"])
                conn.commit()
                log_migration(f"OK:   {migration_id} - Migration applied successfully")
                migrations_applied += 1
            except sqlite3.Error as e:
                log_migration(f"ERR:  {migration_id} - {str(e)}")
                conn.rollback()
                raise

        print()
        print("-" * 60)
        print(f"Migrations applied: {migrations_applied}")
        print(f"Migrations skipped: {migrations_skipped}")
        print("-" * 60)

        if migrations_applied > 0:
            print("\nDatabase migration completed successfully!")
        else:
            print("\nNo migrations needed - database is up to date.")

    finally:
        conn.close()


if __name__ == "__main__":
    run_migrations()
