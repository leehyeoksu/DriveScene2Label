"""Embedding targets (camera files) read straight from the nuScenes JSON tables, so a run needs no catalog DB.

Same selection and order as embed_images.pending_files: camera modality, keyframes unless include_sweeps, optional
scene name, ordered by scene name, timestamp, channel.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

TABLES = ("scene", "sample", "sample_data", "calibrated_sensor", "sensor")


class Target(NamedTuple):
    token: str          # sample_data.token
    relative_path: str  # sample_data.filename, relative to the dataset root


def load_tables(root: Path, version: str) -> dict[str, dict[str, dict]]:
    """table name -> token -> row, for the tables needed to pick camera files."""
    version_dir = Path(root) / version
    if not version_dir.is_dir():
        raise FileNotFoundError(f"nuScenes metadata folder not found: {version_dir} (check --root / NUSCENES_ROOT "
                                f"and --version)")
    tables = {}
    for name in TABLES:
        rows = json.loads((version_dir / f"{name}.json").read_text(encoding="utf-8"))
        tables[name] = {row["token"]: row for row in rows}
    return tables


def targets_from_nuscenes(root: Path, version: str, *, include_sweeps: bool = False,
                          scene: str | None = None) -> list[Target]:
    t = load_tables(root, version)
    picked = []
    for sd in t["sample_data"].values():
        sensor = t["sensor"][t["calibrated_sensor"][sd["calibrated_sensor_token"]]["sensor_token"]]
        if sensor["modality"] != "camera" or not (include_sweeps or sd["is_key_frame"]):
            continue
        scene_name = t["scene"][t["sample"][sd["sample_token"]]["scene_token"]]["name"]
        if scene is not None and scene_name != scene:
            continue
        picked.append(((scene_name, sd["timestamp"], sensor["channel"]), Target(sd["token"], sd["filename"])))
    picked.sort(key=lambda item: item[0])
    return [target for _, target in picked]
