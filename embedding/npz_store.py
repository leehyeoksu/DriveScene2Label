"""File sink for embeddings: an output folder of npz parts plus manifest.json, written wherever the embedder runs
(Colab, another PC) and loaded into a DB later by import_results.py.

  manifest.json      format_version, dataset {name, version}, model_name, preprocess, embed_dim, env
  part-00001.npz     tokens: unicode array (N,), vectors: float32 (N, embed_dim), L2-normalized rows

Parts are written to a temporary file and renamed, so a part either exists whole or not at all. A part that still
cannot be read (copied half-way, disk full, Drive sync cut off) is renamed to part-NNNNN.npz.corrupt when the
embedder resumes, and its tokens are computed again into a new part. import_results.py ignores *.corrupt files and
rejects a broken part that was never renamed.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Iterator

import numpy as np

FORMAT_VERSION = 1
PART_SIZE = 256  # images per part
MANIFEST_FILE = "manifest.json"
# Fields that must match to append to an existing folder. env (device, versions, host) may differ between runs.
MANIFEST_KEYS = ("format_version", "dataset", "model_name", "preprocess", "embed_dim")
PART_PATTERN = re.compile(r"part-(\d{5})\.npz")
CORRUPT_PATTERN = re.compile(r"part-(\d{5})\.npz\.corrupt")
CORRUPT_SUFFIX = ".corrupt"


class ManifestMismatch(Exception):
    pass


def read_manifest(out_dir: Path) -> dict:
    return json.loads((Path(out_dir) / MANIFEST_FILE).read_text(encoding="utf-8"))


def open_output(out_dir: Path, manifest: dict) -> None:
    """Start a new output folder, or check that an existing one holds the same kind of vectors."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if not (out_dir / MANIFEST_FILE).exists():
        if any(out_dir.iterdir()):
            raise ManifestMismatch(f"{out_dir} is not empty but has no {MANIFEST_FILE}; use a new --out folder")
        (out_dir / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return
    existing = read_manifest(out_dir)
    diff = [k for k in MANIFEST_KEYS if existing.get(k) != manifest.get(k)]
    if diff:
        details = ", ".join(f"{k}: folder has {existing.get(k)!r}, this run {manifest.get(k)!r}" for k in diff)
        raise ManifestMismatch(f"{out_dir} was made with different settings ({details}); use a new --out folder")


def part_paths(out_dir: Path) -> list[Path]:
    return sorted(p for p in Path(out_dir).iterdir() if PART_PATTERN.fullmatch(p.name))


def iter_parts(out_dir: Path) -> Iterator[tuple[Path, np.ndarray, np.ndarray] | tuple[Path, Exception]]:
    """(path, tokens, vectors) for each readable part, (path, error) for a broken one, in part order."""
    for path in part_paths(out_dir):
        try:
            with np.load(path, allow_pickle=False) as z:
                tokens, vectors = z["tokens"], z["vectors"]  # reading the members checks the zip CRCs
        except Exception as e:  # noqa: BLE001 - any unreadable part is reported, never fatal here
            yield path, e
        else:
            yield path, tokens, vectors


def corrupt_files(out_dir: Path) -> list[Path]:
    return sorted(p for p in Path(out_dir).iterdir() if CORRUPT_PATTERN.fullmatch(p.name))


def quarantine_corrupt(out_dir: Path) -> list[Path]:
    """Rename unreadable parts to part-NNNNN.npz.corrupt (kept for inspection, ignored by import). Returns new paths."""
    moved = []
    for path, *rest in iter_parts(out_dir):
        if isinstance(rest[0], Exception):
            target = path.with_name(path.name + CORRUPT_SUFFIX)
            os.replace(path, target)
            print(f"  warning: unreadable {path.name} ({rest[0]}); renamed to {target.name}, its images will be "
                  f"embedded again", file=sys.stderr)
            moved.append(target)
    return moved


def existing_tokens(out_dir: Path) -> set[str]:
    done = set()
    for path, *rest in iter_parts(out_dir):
        if isinstance(rest[0], Exception):
            print(f"  warning: unreadable {path.name} ({rest[0]}); its images will be embedded again", file=sys.stderr)
        else:
            done.update(rest[0].tolist())
    return done


def write_part(out_dir: Path, tokens: list[str], vectors: np.ndarray) -> Path:
    """Write the next part-NNNNN.npz (after the highest existing number, broken and .corrupt parts included)."""
    out_dir = Path(out_dir)
    numbers = [int(PART_PATTERN.fullmatch(p.name).group(1)) for p in part_paths(out_dir)]
    numbers += [int(CORRUPT_PATTERN.fullmatch(p.name).group(1)) for p in corrupt_files(out_dir)]
    path = out_dir / f"part-{max(numbers, default=0) + 1:05d}.npz"
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        np.savez(f, tokens=np.asarray(tokens, dtype=str), vectors=np.asarray(vectors, dtype=np.float32))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    return path
