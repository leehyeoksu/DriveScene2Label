"""Load results made elsewhere (Colab, another GPU machine) into the DB after checking them.

  python embedding/import_results.py embeddings DIR [--dry-run]

DIR is an embed_images.py --sink file folder (manifest.json + part-*.npz). The manifest is checked first and the
dataset must already be in the catalog; nothing is written until both pass. Each part is then checked on its own
(shape, float32, finite, unit length, no duplicate tokens): a broken or invalid part is rejected with its reason and
the rest still load. part-*.npz.corrupt files (set aside by the embedder on resume) are ignored. Tokens that are not in sample_data are counted and skipped. Rows are upserted and committed per
part, so importing the same folder again leaves the same rows and values.

Exit 1 when a part was rejected, when there are no parts, or when parts exist but nothing was stored.
Uses the same PG* environment as embed_images.py.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

import npz_store
from db import UPSERT_SQL, connect, find_dataset, to_pgvector
from embed_images import EMBED_DIM

NORM_TOLERANCE = 1e-3
EXAMPLES = 5


def validate_manifest(m: dict) -> list[str]:
    errors = [f"missing {k}" for k in npz_store.MANIFEST_KEYS if k not in m]
    if errors:
        return errors
    if m["format_version"] != npz_store.FORMAT_VERSION:
        errors.append(f"format_version {m['format_version']!r}, expected {npz_store.FORMAT_VERSION}")
    if m["embed_dim"] != EMBED_DIM:
        errors.append(f"embed_dim {m['embed_dim']!r}, expected {EMBED_DIM}")
    dataset = m["dataset"] if isinstance(m["dataset"], dict) else {}
    if dataset.get("name") != "nuScenes" or not dataset.get("version"):
        errors.append(f"dataset {m['dataset']!r}, expected {{'name': 'nuScenes', 'version': ...}}")
    for key in ("model_name", "preprocess"):
        if not isinstance(m[key], str) or not m[key]:
            errors.append(f"{key} must be a non-empty string")
    return errors


def validate_part(tokens: np.ndarray, vectors: np.ndarray) -> list[str]:
    if tokens.ndim != 1 or tokens.dtype.kind != "U":
        return [f"tokens must be a 1-D unicode array, got {tokens.dtype} {tokens.shape}"]
    if vectors.shape != (len(tokens), EMBED_DIM):
        return [f"vectors shape {vectors.shape}, expected ({len(tokens)}, {EMBED_DIM})"]
    errors = []
    if vectors.dtype != np.float32:
        errors.append(f"vectors dtype {vectors.dtype}, expected float32")
    if not np.isfinite(vectors).all():
        errors.append("vectors contain NaN or inf")
    else:
        norms = np.linalg.norm(vectors.astype(np.float64), axis=1)
        bad = np.flatnonzero(np.abs(norms - 1) > NORM_TOLERANCE)
        if bad.size:
            errors.append(f"{bad.size} rows are not unit length (e.g. row {bad[0]} norm {norms[bad[0]]:.4f})")
    unique, counts = np.unique(tokens, return_counts=True)
    if (counts > 1).any():
        errors.append(f"duplicate tokens in part, e.g. {unique[counts > 1][0]}")
    return errors


@dataclass
class ImportReport:
    inserted: int = 0
    updated: int = 0
    unknown: int = 0
    rejected_parts: list[str] = field(default_factory=list)
    parts: int = 0
    unknown_examples: list[str] = field(default_factory=list)


def import_embeddings(conn, out_dir: Path, *, dry_run: bool = False) -> ImportReport:
    out_dir = Path(out_dir)
    try:
        manifest = npz_store.read_manifest(out_dir)
    except (OSError, ValueError) as e:
        sys.exit(f"Cannot read {out_dir / npz_store.MANIFEST_FILE}: {e}")
    errors = validate_manifest(manifest)
    if errors:
        sys.exit(f"Invalid manifest in {out_dir}: " + "; ".join(errors))
    dataset_id = find_dataset(conn, manifest["dataset"]["version"])
    model_name, preprocess = manifest["model_name"], manifest["preprocess"]
    report = ImportReport()
    for path, *rest in npz_store.iter_parts(out_dir):
        report.parts += 1
        if isinstance(rest[0], Exception):
            report.rejected_parts.append(f"{path.name}: unreadable ({rest[0]})")
            continue
        tokens, vectors = rest
        errors = validate_part(tokens, vectors)
        if errors:
            report.rejected_parts.append(f"{path.name}: " + "; ".join(errors))
            continue
        token_list = tokens.tolist()
        known = {r[0] for r in conn.execute(
            "SELECT token FROM sample_data WHERE dataset_id=%s AND token = ANY(%s)", (dataset_id, token_list))}
        existing = {r[0] for r in conn.execute(
            "SELECT sample_data_token FROM image_embedding WHERE dataset_id=%s AND model_name=%s AND preprocess=%s "
            "AND sample_data_token = ANY(%s)", (dataset_id, model_name, preprocess, token_list))}
        rows = [(dataset_id, t, model_name, preprocess, to_pgvector(v)) for t, v in zip(token_list, vectors) if t in known]
        unknown = [t for t in token_list if t not in known]
        report.unknown += len(unknown)
        report.unknown_examples += unknown[:EXAMPLES - len(report.unknown_examples)]
        report.updated += sum(1 for r in rows if r[1] in existing)
        report.inserted += sum(1 for r in rows if r[1] not in existing)
        if not dry_run and rows:
            with conn.cursor() as cur:
                cur.executemany(UPSERT_SQL, rows)
            conn.commit()  # per part: an interrupted import keeps the parts already loaded
    if dry_run:
        conn.rollback()
    return report


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="kind", required=True)
    e = sub.add_parser("embeddings", help="load an embed_images.py --sink file folder into image_embedding")
    e.add_argument("dir", type=Path)
    e.add_argument("--dry-run", action="store_true", help="check and count only; write nothing")
    args = p.parse_args()

    with connect() as conn:
        report = import_embeddings(conn, args.dir, dry_run=args.dry_run)
    verb = "would insert" if args.dry_run else "inserted"
    print(f"{args.dir}: {report.parts} parts, {verb} {report.inserted}, updated {report.updated}, "
          f"unknown {report.unknown}, rejected parts {len(report.rejected_parts)}" + (" (dry run)" if args.dry_run else ""))
    if report.unknown:
        print(f"  unknown tokens (not in sample_data), e.g.: {', '.join(report.unknown_examples)}")
    for reason in report.rejected_parts[:EXAMPLES]:
        print(f"  rejected {reason}")
    corrupt = npz_store.corrupt_files(args.dir)
    if corrupt:
        print(f"  ignored {len(corrupt)} *.corrupt file(s) set aside by the embedder (their images were embedded again)")
    if report.rejected_parts or report.parts == 0 or report.inserted + report.updated == 0:
        if report.parts == 0:
            print(f"  no part-*.npz files in {args.dir}")
        sys.exit(1)


if __name__ == "__main__":
    main()
