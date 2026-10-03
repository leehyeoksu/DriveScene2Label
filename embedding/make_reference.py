"""One-off: write embedding/fixtures/reference.npz from vectors already in image_embedding.

Reference set = the 6 camera images of each scene's first keyframe sample (60 images for v1.0-mini: 10 scenes, day and
night, all 6 channels). embed_images.py --check-reference re-embeds these on a new machine and compares.

  python embedding/make_reference.py --out embedding/fixtures/reference.npz
Uses the same PG* environment as embed_images.py.
"""
from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path

import numpy as np

from db import connect, find_dataset
from embed_images import EMBED_DIM, LR_SQUARE_CROP_MEAN, MODEL_NAME, PREPROCESS_MODES, PRETRAINED, model_key

REFERENCE_SQL = """
    WITH first_sample AS (
        SELECT DISTINCT ON (sa.scene_token) sa.dataset_id, sa.token, sc.name AS scene_name
        FROM sample sa JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
        WHERE sa.dataset_id=%(dataset)s
        ORDER BY sa.scene_token, sa.timestamp_us
    )
    SELECT sd.token, sd.relative_path, e.embedding::text
    FROM first_sample f
    JOIN sample_data sd ON sd.dataset_id=f.dataset_id AND sd.sample_token=f.token AND sd.is_key_frame
    JOIN calibrated_sensor cs ON cs.dataset_id=sd.dataset_id AND cs.token=sd.calibrated_sensor_token
    JOIN sensor s ON s.dataset_id=cs.dataset_id AND s.token=cs.sensor_token AND s.modality='camera'
    LEFT JOIN image_embedding e ON e.dataset_id=sd.dataset_id AND e.sample_data_token=sd.token
      AND e.model_name=%(model)s AND e.preprocess=%(preprocess)s
    ORDER BY f.scene_name, s.channel
"""


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--version", default="v1.0-mini")
    p.add_argument("--preprocess", choices=PREPROCESS_MODES, default=LR_SQUARE_CROP_MEAN)
    args = p.parse_args()

    model = model_key(MODEL_NAME, PRETRAINED)
    with connect() as conn:
        dataset_id = find_dataset(conn, args.version)
        rows = conn.execute(REFERENCE_SQL, {"dataset": dataset_id, "model": model, "preprocess": args.preprocess}).fetchall()
    missing = [path for _, path, vec in rows if vec is None]
    if not rows or missing:
        raise SystemExit(f"{len(missing)} of {len(rows)} reference images have no {model} / {args.preprocess} embedding; "
                         "embed them first")
    vectors = np.array([json.loads(vec) for _, _, vec in rows], dtype=np.float32)
    assert vectors.shape == (len(rows), EMBED_DIM)
    meta = {"model_name": model, "preprocess": args.preprocess, "dataset": {"name": "nuScenes", "version": args.version},
            "source": "image_embedding (vectors as stored in the DB)",
            "env": {"python": platform.python_version(), "platform": platform.platform(), "numpy": np.__version__}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(args.out, tokens=np.asarray([r[0] for r in rows], dtype=str),
             relative_paths=np.asarray([r[1] for r in rows], dtype=str), vectors=vectors, meta=np.asarray(json.dumps(meta)))
    print(f"Wrote {args.out}: {len(rows)} rows, {args.out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
