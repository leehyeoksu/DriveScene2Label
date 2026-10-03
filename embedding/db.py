"""PostgreSQL access shared by embed_images.py (DB sink) and import_results.py (npz -> DB)."""
from __future__ import annotations

import os
import sys

import psycopg

UPSERT_SQL = """
    INSERT INTO image_embedding(dataset_id, sample_data_token, model_name, preprocess, embedding)
    VALUES (%s, %s, %s, %s, %s::vector)
    ON CONFLICT(dataset_id, sample_data_token, model_name, preprocess)
    DO UPDATE SET embedding=EXCLUDED.embedding, created_at=now()
"""


def connect() -> psycopg.Connection:
    # libpq-style variables, set by scripts/embed.sh from .env. Default port = the Docker db mapping in compose.yml.
    return psycopg.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "55433")),
        user=os.environ.get("PGUSER", "drivescene"),
        dbname=os.environ.get("PGDATABASE", "drivescene"),
        password=os.environ.get("PGPASSWORD", ""),
    )


def find_dataset(conn: psycopg.Connection, version: str) -> int:
    row = conn.execute("SELECT id FROM dataset WHERE name='nuScenes' AND version=%s", (version,)).fetchone()
    if row is None:
        sys.exit(f"Dataset nuScenes {version} not found — run the catalog import first (README: Docker로 실행하기).")
    return row[0]


def to_pgvector(v) -> str:
    """pgvector text format [0.1,0.2,...] from a 1-D torch tensor or numpy array. Avoids a pgvector Python dependency."""
    return "[" + ",".join(f"{x:.7g}" for x in v.tolist()) + "]"
