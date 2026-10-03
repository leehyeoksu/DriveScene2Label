"""Compute CLIP image embeddings for nuScenes camera files and store them in image_embedding (pgvector).

The DB is the Docker Compose `db` service (published on 127.0.0.1:55433); this script runs on the host in a Python
venv so it can use the local GPU (cuda, or mps on Apple Silicon). It reads camera rows from the catalog that the
Docker import created, loads each JPG from NUSCENES_ROOT, encodes it with open_clip, L2-normalizes, and upserts one
row per (camera file, model_name, preprocess). Rows that already have an embedding for the model and --preprocess are
skipped unless --overwrite is given.

Run through scripts/embed.sh, which creates the venv (.venv) and sets the DB connection from .env:
  bash scripts/embed.sh                         # keyframe camera images (6 per sample)
  bash scripts/embed.sh --include-sweeps        # also non-keyframe camera images
  bash scripts/embed.sh --search "rainy night intersection"   # quick text -> image check
  bash scripts/embed.sh --device cpu            # force a device (default: cuda -> mps -> cpu)
  bash scripts/embed.sh --preprocess openclip-eval-224-centercrop   # single center crop instead of left/right squares

File mode (no DB; Colab or another GPU machine): targets come from the nuScenes JSON under --root and vectors go to
npz parts in --out, which import_results.py loads into a DB later. Re-running with the same --out resumes.
  python embedding/embed_images.py --source nuscenes --sink file --out /path/to/out
"""
from __future__ import annotations

import argparse
import html
import json
import platform
import subprocess
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import npz_store
from db import UPSERT_SQL, connect, find_dataset, to_pgvector  # noqa: F401 - re-exported for compare_preprocess.py
from targets import targets_from_nuscenes

# OpenAI CLIP weights were trained with QuickGELU; plain "ViT-L-14" loads them with GELU and warns (slightly worse vectors).
MODEL_NAME = "ViT-L-14-quickgelu"
PRETRAINED = "openai"
EMBED_DIM = 768  # must match vector(768) in V2__image_embedding.sql
# --preprocess values, stored as-is in image_embedding.preprocess. Rename the value when its behavior changes.
# Both feed each image (or crop) through open_clip's eval transform for the model:
# resize shorter side to 224 bicubic, center crop 224x224, OpenAI CLIP mean/std.
CENTER_CROP = "openclip-eval-224-centercrop"  # whole image -> one center crop (drops both sides of a 16:9 frame)
LR_SQUARE_CROP_MEAN = "lr-square-crop-mean"   # left and right h x h squares, embedded separately and averaged
PREPROCESS_MODES = (LR_SQUARE_CROP_MEAN, CENTER_CROP)
DEVICES = ("auto", "cuda", "mps", "cpu")
# Where targets come from -> where vectors go. db -> db is the default; nuscenes -> file needs no DB at all.
MODES = {("db", "db"), ("nuscenes", "file")}
# --check-reference passes when every reference image re-embeds to at least this cosine with its stored vector.
REFERENCE_MIN_COSINE = 0.9999


def model_key(model_name: str, pretrained: str) -> str:
    return f"{model_name}/{pretrained}"


def resolve(root: Path, relative_path: str) -> Path:
    """Same rule as DatasetFiles.resolve: relative path only, must stay inside the dataset root."""
    if not relative_path or Path(relative_path).is_absolute():
        raise ValueError("Relative dataset path required")
    real_root = root.resolve(strict=True)
    real_file = (real_root / relative_path).resolve(strict=True)
    if not real_file.is_relative_to(real_root) or not real_file.is_file():
        raise ValueError(f"Invalid dataset file: {relative_path}")
    return real_file


def available_devices() -> list[str]:
    found = ["cuda"] if torch.cuda.is_available() else []
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        found.append("mps")
    return found + ["cpu"]


def pick_device(requested: str) -> str:
    """auto -> first of cuda, mps, cpu that this torch build can use. A forced device must be available."""
    available = available_devices()
    if requested == "auto":
        device = available[0]
    elif requested in available:
        device = requested
    else:
        sys.exit(f"--device {requested} is not available in this torch build (available: {', '.join(available)})")
    detail = torch.cuda.get_device_name(0) if device == "cuda" else platform.machine()
    print(f"Device: {device} ({'auto' if requested == 'auto' else 'forced'}; {detail}; torch {torch.__version__})")
    return device


def square_crops(img: Image.Image) -> list[Image.Image]:
    """Landscape image -> left (0,0,h,h) and right (w-h,0,w,h) squares, which together cover the full width.
    Square or portrait images are returned as the single original."""
    w, h = img.size
    if w > h:
        return [img.crop((0, 0, h, h)), img.crop((w - h, 0, w, h))]
    return [img]


def image_crops(img: Image.Image, mode: str) -> list[Image.Image]:
    return square_crops(img) if mode == LR_SQUARE_CROP_MEAN else [img]


def combine_crops(features: torch.Tensor, counts: list[int]) -> torch.Tensor:
    """features holds one row per crop, grouped by image (counts[i] rows for image i).
    L2-normalize each crop, average per image, L2-normalize again -> one unit vector per image."""
    features = features / features.norm(dim=-1, keepdim=True)
    means = torch.stack([group.mean(dim=0) for group in features.split(counts)])
    return means / means.norm(dim=-1, keepdim=True)


def check_stored(done: int, skipped: int, root: Path) -> None:
    """Every file skipped and none stored almost always means a wrong data root, not bad files: fail the run."""
    if done == 0 and skipped > 0:
        sys.exit(f"All {skipped} files were skipped and none stored. Check --root / NUSCENES_ROOT (now {root}).")


def load_model(device: str):
    import open_clip

    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED, device=device)
    model.eval()
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    return model, preprocess, tokenizer


def validate_modes(source: str, sink: str, out: str | None, overwrite: bool) -> str | None:
    """None when the combination is usable, otherwise the error message."""
    if (source, sink) not in MODES:
        return f"--source {source} --sink {sink} is not supported; use db -> db (default) or nuscenes -> file"
    if sink == "file" and not out:
        return "--sink file needs --out DIR"
    if sink == "file" and overwrite:
        return "--overwrite does not apply to --sink file; use a new --out folder to recompute"
    return None


def build_manifest(version: str, preprocess: str, device: str) -> dict:
    import open_clip

    return {
        "format_version": npz_store.FORMAT_VERSION,
        "dataset": {"name": "nuScenes", "version": version},
        "model_name": model_key(MODEL_NAME, PRETRAINED),
        "preprocess": preprocess,
        "embed_dim": EMBED_DIM,
        "env": {"device": device, "torch": torch.__version__, "open_clip": open_clip.__version__,
                "python": platform.python_version(), "platform": platform.platform()},
    }


def pending_files(conn, dataset_id: int, model: str, preprocess: str, include_sweeps: bool, overwrite: bool, scene: str | None,
                  limit: int | None):
    sql = """
        SELECT sd.token, sd.relative_path
        FROM sample_data sd
        JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
        JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token
        JOIN sample sa ON sa.dataset_id=sd.dataset_id AND sa.token=sd.sample_token
        JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
        WHERE sd.dataset_id=%(dataset)s AND s.modality='camera'
          AND (%(sweeps)s OR sd.is_key_frame)
          AND (%(scene)s::text IS NULL OR sc.name=%(scene)s)
          AND (%(overwrite)s OR NOT EXISTS (
            SELECT 1 FROM image_embedding e
            WHERE e.dataset_id=sd.dataset_id AND e.sample_data_token=sd.token
              AND e.model_name=%(model)s AND e.preprocess=%(preprocess)s))
        ORDER BY sc.name, sd.timestamp_us, s.channel
    """
    params = {"dataset": dataset_id, "sweeps": include_sweeps, "scene": scene, "overwrite": overwrite, "model": model,
              "preprocess": preprocess}
    if limit:
        sql += " LIMIT %(limit)s"
        params["limit"] = limit
    return conn.execute(sql, params).fetchall()


@torch.no_grad()
def encode_batches(rows, root: Path, mode: str, device: str, batch_size: int):
    """Yield (tokens, unit vectors (len(tokens), EMBED_DIM) on CPU, files skipped in this batch) per batch of rows."""
    model, preprocess, _ = load_model(device)
    for start in range(0, len(rows), batch_size):
        tokens, crops, counts, skipped = [], [], [], 0
        for token, relative_path in rows[start:start + batch_size]:
            try:
                with Image.open(resolve(root, relative_path)) as img:
                    parts = [preprocess(c) for c in image_crops(img.convert("RGB"), mode)]
                crops.extend(parts)
                counts.append(len(parts))
                tokens.append(token)
            except (OSError, ValueError) as e:
                skipped += 1
                print(f"  skip {relative_path}: {e}", file=sys.stderr)
        if not crops:
            yield [], None, skipped
            continue
        features = combine_crops(model.encode_image(torch.stack(crops).to(device)).float(), counts)
        assert features.shape[1] == EMBED_DIM, f"model gives {features.shape[1]} dims, table expects {EMBED_DIM}"
        yield tokens, features.cpu(), skipped


def embed(args) -> None:
    root = Path(args.root)
    device = pick_device(args.device)
    if args.sink == "file":
        embed_to_files(args, root, device)
    else:
        embed_to_db(args, root, device)


def embed_to_db(args, root: Path, device: str) -> None:
    model_id = model_key(MODEL_NAME, PRETRAINED)
    with connect() as conn:
        dataset_id = find_dataset(conn, args.version)
        if args.scene and conn.execute("SELECT 1 FROM scene WHERE dataset_id=%s AND name=%s",
                                       (dataset_id, args.scene)).fetchone() is None:
            names = [r[0] for r in conn.execute("SELECT name FROM scene WHERE dataset_id=%s ORDER BY name LIMIT 5",
                                                (dataset_id,))]
            sys.exit(f"scene {args.scene!r} is not in {args.version} (e.g. {', '.join(names)})")
        rows = pending_files(conn, dataset_id, model_id, args.preprocess, args.include_sweeps, args.overwrite, args.scene,
                             args.limit)
        print(f"{len(rows)} camera files to embed with {model_id} ({args.preprocess}) on {device} (dataset id {dataset_id})")
        if not rows:
            return
        started, done, skipped = time.time(), 0, 0
        for tokens, features, batch_skipped in encode_batches(rows, root, args.preprocess, device, args.batch_size):
            skipped += batch_skipped
            if not tokens:
                continue
            with conn.cursor() as cur:
                cur.executemany(UPSERT_SQL, [(dataset_id, t, model_id, args.preprocess, to_pgvector(f))
                                             for t, f in zip(tokens, features)])
            conn.commit()  # commit per batch so an interrupted run resumes where it stopped
            done += len(tokens)
            rate = done / max(time.time() - started, 1e-6)
            print(f"  {done}/{len(rows)}  ({rate:.1f} img/s)")
        print(f"Done: {done} stored, {skipped} skipped, {time.time() - started:.0f}s")
        check_stored(done, skipped, root)


def embed_to_files(args, root: Path, device: str) -> None:
    """nuScenes JSON -> npz parts in args.out. No DB connection. Tokens already in readable parts are skipped."""
    out = Path(args.out)
    try:
        targets = targets_from_nuscenes(root, args.version, include_sweeps=args.include_sweeps, scene=args.scene)
    except (FileNotFoundError, ValueError) as e:
        sys.exit(str(e))
    try:
        npz_store.open_output(out, build_manifest(args.version, args.preprocess, device))
    except npz_store.ManifestMismatch as e:
        sys.exit(str(e))
    npz_store.quarantine_corrupt(out)
    have = npz_store.existing_tokens(out)
    rows = [(t.token, t.relative_path) for t in targets if t.token not in have]
    if args.limit:
        rows = rows[:args.limit]
    print(f"{len(rows)} camera files to embed with {model_key(MODEL_NAME, PRETRAINED)} ({args.preprocess}) on {device} "
          f"-> {out} ({len(targets)} targets, {len(have)} already in the folder)")
    if not rows:
        print("Done: 0 stored, 0 skipped")
        return
    started, done, skipped = time.time(), 0, 0
    buf_tokens: list[str] = []
    buf_vectors: list[np.ndarray] = []

    def flush(size: int) -> None:
        nonlocal buf_tokens, buf_vectors
        vectors = np.concatenate(buf_vectors)
        path = npz_store.write_part(out, buf_tokens[:size], vectors[:size])
        print(f"  wrote {path.name} ({min(size, len(buf_tokens))} images)")
        buf_tokens, buf_vectors = buf_tokens[size:], [vectors[size:]]

    for tokens, features, batch_skipped in encode_batches(rows, root, args.preprocess, device, args.batch_size):
        skipped += batch_skipped
        if not tokens:
            continue
        buf_tokens += tokens
        buf_vectors.append(features.numpy().astype(np.float32))
        done += len(tokens)
        while len(buf_tokens) >= npz_store.PART_SIZE:
            flush(npz_store.PART_SIZE)
        rate = done / max(time.time() - started, 1e-6)
        print(f"  {done}/{len(rows)}  ({rate:.1f} img/s)")
    if buf_tokens:
        flush(len(buf_tokens))
    print(f"Done: {done} stored, {skipped} skipped, {time.time() - started:.0f}s")
    check_stored(done, skipped, root)


def min_cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Smallest cosine similarity between matching rows of a and b."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    cos = (a * b).sum(axis=1) / (np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1))
    return float(cos.min())


def check_reference(args) -> None:
    """Re-embed the reference images under --root (no DB) and compare with the stored vectors. Run this first on a
    new machine (Colab, another GPU): below REFERENCE_MIN_COSINE its vectors must not be mixed with the DB's."""
    root = Path(args.root)
    with np.load(args.check_reference, allow_pickle=False) as z:
        tokens, paths, expected = z["tokens"].tolist(), z["relative_paths"].tolist(), z["vectors"]
        meta = json.loads(str(z["meta"]))
    if meta["model_name"] != model_key(MODEL_NAME, PRETRAINED):
        sys.exit(f"Reference was made with {meta['model_name']}, this script uses {model_key(MODEL_NAME, PRETRAINED)}")
    device = pick_device(args.device)
    print(f"Checking {len(tokens)} reference images ({meta['preprocess']}) under {root}")
    got, skipped = {}, 0
    for batch_tokens, features, batch_skipped in encode_batches(list(zip(tokens, paths)), root, meta["preprocess"],
                                                                device, args.batch_size):
        skipped += batch_skipped
        got.update(zip(batch_tokens, features.numpy() if batch_tokens else []))
    if skipped:
        sys.exit(f"{skipped} reference images could not be read under {root}. Check --root / NUSCENES_ROOT.")
    actual = np.stack([got[t] for t in tokens])
    lowest = min_cosine(expected, actual)
    verdict = "OK" if lowest >= REFERENCE_MIN_COSINE else "FAIL"
    print(f"Reference check: min cos {lowest:.7f} over {len(tokens)} images (threshold {REFERENCE_MIN_COSINE}) -> {verdict}")
    if verdict == "FAIL":
        sys.exit(1)


@torch.no_grad()
def search(args) -> None:
    """Text -> image sanity check: encode the query with the same CLIP model and list the nearest camera images."""
    device = pick_device(args.device)
    model, _, tokenizer = load_model(device)
    q = model.encode_text(tokenizer([args.search]).to(device)).float()
    q = (q / q.norm(dim=-1, keepdim=True))[0].cpu()
    with connect() as conn:
        dataset_id = find_dataset(conn, args.version)
        rows = conn.execute(
            """
            SELECT sd.id, sc.name, s.channel, sd.relative_path, e.embedding <=> %(q)s::vector AS distance
            FROM image_embedding e
            JOIN sample_data sd ON sd.dataset_id=e.dataset_id AND sd.token=e.sample_data_token
            JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
            JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token
            JOIN sample sa ON sa.dataset_id=sd.dataset_id AND sa.token=sd.sample_token
            JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
            WHERE e.dataset_id=%(dataset)s AND e.model_name=%(model)s AND e.preprocess=%(preprocess)s
            ORDER BY e.embedding <=> %(q)s::vector
            LIMIT %(k)s
            """,
            {"q": to_pgvector(q), "dataset": dataset_id, "model": model_key(MODEL_NAME, PRETRAINED),
             "preprocess": args.preprocess, "k": args.k},
        ).fetchall()
    print(f'Top {len(rows)} for "{args.search}" (cosine distance, lower = closer):')
    for sd_id, scene, channel, path, dist in rows:
        print(f"  {dist:.4f}  {scene}  {channel:<16} sensor-file {sd_id}  {path}")
    if args.open and rows:
        open_results(args, rows)


def open_results(args, rows) -> None:
    """Write a small HTML grid of the result images (local file:// paths) and open it in the default browser."""
    root = Path(args.root).resolve()
    cards = []
    for sd_id, scene, channel, path, dist in rows:
        src = resolve(root, path).as_uri()
        cards.append(f'<figure><img src="{html.escape(src)}" loading="lazy"><figcaption>{dist:.4f} · {html.escape(scene)} · '
                     f'{html.escape(channel)} · sensor-file {sd_id}</figcaption></figure>')
    page = (f'<!doctype html><meta charset="utf-8"><title>{html.escape(args.search)}</title>'
            '<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}'
            '.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}'
            'img{width:100%;border-radius:6px}figure{margin:0}</style>'
            f'<h2>{html.escape(args.search)}</h2><div class="g">{"".join(cards)}</div>')
    out = Path(".local/search/last.html").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")
    print(f"Saved {out}")
    opener = {"Darwin": ["open"], "Linux": ["xdg-open"]}.get(platform.system())
    if opener:
        subprocess.run(opener + [str(out)], check=False)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", default=os.environ.get("NUSCENES_ROOT", "/home/hyuksu/Cap_Project_Data/v1.0-mini"),
                   help="nuScenes data root (same as nuscenes.root in application.properties)")
    p.add_argument("--version", default=os.environ.get("NUSCENES_VERSION", "v1.0-mini"))
    p.add_argument("--device", choices=DEVICES, default="auto", help="default auto: cuda -> mps -> cpu")
    p.add_argument("--batch-size", type=int, default=32, help="images per batch (lr-square-crop-mean encodes 2 crops each)")
    p.add_argument("--preprocess", choices=PREPROCESS_MODES, default=LR_SQUARE_CROP_MEAN,
                   help="how images become CLIP input; stored in image_embedding.preprocess")
    p.add_argument("--include-sweeps", action="store_true", help="also embed non-keyframe camera images (~6x more)")
    p.add_argument("--scene", help="only this scene name, e.g. scene-0061")
    p.add_argument("--limit", type=int, help="embed at most N files (for a quick trial)")
    p.add_argument("--overwrite", action="store_true", help="recompute files that already have an embedding")
    p.add_argument("--source", choices=("db", "nuscenes"), default="db",
                   help="where the target list comes from: the catalog DB, or the nuScenes JSON under --root")
    p.add_argument("--sink", choices=("db", "file"), default="db",
                   help="where vectors go: image_embedding, or npz parts in --out (load with import_results.py)")
    p.add_argument("--out", metavar="DIR", help="output folder for --sink file; reuse it to resume")
    p.add_argument("--check-reference", metavar="PATH",
                   help="instead of embedding, re-embed the reference images (embedding/fixtures/reference.npz) "
                        "under --root and compare; exit 1 below the threshold. No DB needed")
    p.add_argument("--search", metavar="TEXT", help="instead of embedding, search stored images with a text query")
    p.add_argument("-k", type=int, default=10, help="results for --search")
    p.add_argument("--open", action="store_true", help="with --search: show the result images in the browser")
    args = p.parse_args()
    if args.check_reference:
        check_reference(args)
        return
    if args.search:
        search(args)
        return
    error = validate_modes(args.source, args.sink, args.out, args.overwrite)
    if error:
        sys.exit(error)
    embed(args)


if __name__ == "__main__":
    main()
