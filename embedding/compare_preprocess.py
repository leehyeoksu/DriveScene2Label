"""One-off evaluation: which --preprocess gives better text -> image retrieval on the imported nuScenes data?

Ground truth per image = the is_night / is_rain flags of its scene (V3 generated columns, keyword match on
scene.description). Each text query is encoded with the same CLIP model's text encoder, every stored image of one
preprocess is ranked by cosine distance, and AP / precision@10 / precision@50 are computed per query.
Only images embedded with every preprocess are scored, so both sides rank the same set.

Decision rule (fixed before looking at results): mAP = mean AP of the night and day queries. Pick lr-square-crop-mean
if its mAP beats openclip-eval-224-centercrop by >= 0.03, otherwise keep openclip-eval-224-centercrop.
The rain query is reported for reference only: in v1.0-mini the single rain scene (scene-1094) is also a night scene,
so its labels are not independent of night.

Run with the same DB environment as embed_images.py (PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD):
  python embedding/compare_preprocess.py
"""
from __future__ import annotations

import argparse
import os

import torch

import embed_images as ei

# (name, query text, label: positive when the image's scene flag has this value)
QUERIES = [
    ("night", "a photo of a city street at night", ("is_night", True)),
    ("rain", "a photo of a street in the rain", ("is_rain", True)),
    ("day", "a photo of a city street during the day", ("is_night", False)),
]
MAP_QUERIES = ("night", "day")  # rain is reference only (see docstring)
BASELINE, CANDIDATE, MIN_GAIN = ei.CENTER_CROP, ei.LR_SQUARE_CROP_MEAN, 0.03


def average_precision(relevant: list[bool]) -> float:
    """Non-interpolated AP of a ranked list: mean of precision@k over the ranks k that hold a positive."""
    hits, total = 0, 0.0
    for k, rel in enumerate(relevant, start=1):
        if rel:
            hits += 1
            total += hits / k
    return total / hits if hits else 0.0


def precision_at(relevant: list[bool], k: int) -> float:
    return sum(relevant[:k]) / k


def ranked_labels(conn, dataset_id: int, model: str, preprocess: str, query_vec: str) -> list[dict]:
    """All scored images for one preprocess, nearest first, with their scene flags."""
    return conn.execute(
        """
        SELECT sc.is_night, sc.is_rain
        FROM image_embedding e
        JOIN sample_data sd ON sd.dataset_id=e.dataset_id AND sd.token=e.sample_data_token
        JOIN sample sa ON sa.dataset_id=sd.dataset_id AND sa.token=sd.sample_token
        JOIN scene sc ON sc.dataset_id=sa.dataset_id AND sc.token=sa.scene_token
        WHERE e.dataset_id=%(dataset)s AND e.model_name=%(model)s AND e.preprocess=%(preprocess)s
          AND e.sample_data_token IN (
            SELECT sample_data_token FROM image_embedding
            WHERE dataset_id=%(dataset)s AND model_name=%(model)s AND preprocess = ANY(%(all)s)
            GROUP BY sample_data_token HAVING count(DISTINCT preprocess) = cardinality(%(all)s))
        ORDER BY e.embedding <=> %(q)s::vector, e.sample_data_token
        """,
        {"dataset": dataset_id, "model": model, "preprocess": preprocess, "all": list(ei.PREPROCESS_MODES),
         "q": query_vec},
    ).fetchall()


@torch.no_grad()
def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--version", default=os.environ.get("NUSCENES_VERSION", "v1.0-mini"))
    p.add_argument("--device", default="auto", help="auto | cuda | mps | cpu")
    args = p.parse_args()

    device = ei.pick_device(args.device)
    model, _, tokenizer = ei.load_model(device)
    texts = model.encode_text(tokenizer([text for _, text, _ in QUERIES]).to(device)).float()
    texts = (texts / texts.norm(dim=-1, keepdim=True)).cpu()
    model_id = ei.model_key(ei.MODEL_NAME, ei.PRETRAINED)
    flag_index = {"is_night": 0, "is_rain": 1}

    results: dict[str, dict[str, tuple[float, float, float]]] = {}
    with ei.connect() as conn:
        dataset_id = ei.find_dataset(conn, args.version)
        for preprocess in (BASELINE, CANDIDATE):
            results[preprocess] = {}
            for (name, _, (flag, value)), vec in zip(QUERIES, texts):
                rows = ranked_labels(conn, dataset_id, model_id, preprocess, ei.to_pgvector(vec))
                relevant = [row[flag_index[flag]] == value for row in rows]
                results[preprocess][name] = (average_precision(relevant), precision_at(relevant, 10),
                                             precision_at(relevant, 50))
            if preprocess == BASELINE:
                print(f"{len(rows)} images scored per preprocess; positives: "
                      + ", ".join(f"{name}={sum(r[flag_index[f]] == v for r in rows)}" for name, _, (f, v) in QUERIES))

    print(f"\n{'preprocess':<30} {'query':<6} {'AP':>7} {'P@10':>6} {'P@50':>6}")
    maps = {}
    for preprocess, by_query in results.items():
        for name, (ap, p10, p50) in by_query.items():
            note = "" if name in MAP_QUERIES else "  (reference, not in mAP)"
            print(f"{preprocess:<30} {name:<6} {ap:7.4f} {p10:6.2f} {p50:6.2f}{note}")
        maps[preprocess] = sum(by_query[name][0] for name in MAP_QUERIES) / len(MAP_QUERIES)
        print(f"{preprocess:<30} {'mAP':<6} {maps[preprocess]:7.4f}  ({' + '.join(MAP_QUERIES)})")
    gain = maps[CANDIDATE] - maps[BASELINE]
    winner = CANDIDATE if gain >= MIN_GAIN else BASELINE
    print(f"\nmAP gain {CANDIDATE} - {BASELINE} = {gain:+.4f} (threshold {MIN_GAIN}) -> {winner}")


if __name__ == "__main__":
    main()
