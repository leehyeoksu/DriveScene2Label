"""Shared helpers for the embedding tests (not collected by pytest: no test_ prefix)."""
import json

import numpy as np

MANIFEST = {"format_version": 1, "dataset": {"name": "nuScenes", "version": "v1.0-mini"},
            "model_name": "ViT-L-14-quickgelu/openai", "preprocess": "lr-square-crop-mean", "embed_dim": 768, "env": {}}


def unit(n: int) -> np.ndarray:
    """n random L2-normalized float32 rows of 768 dims."""
    v = np.random.rand(n, 768).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def make_fake_nuscenes(tmp_path):
    """Two scenes with one sample each; CAM_FRONT, CAM_BACK (camera) and LIDAR_TOP, each with a keyframe and a sweep.
    Scenes, channels and timestamps are written out of order so the result order comes from sorting."""
    sensors = [{"token": f"sen-{ch}", "channel": ch, "modality": mod}
               for ch, mod in (("LIDAR_TOP", "lidar"), ("CAM_FRONT", "camera"), ("CAM_BACK", "camera"))]
    calibrated = [{"token": f"cs-{s['channel']}", "sensor_token": s["token"]} for s in sensors]
    scenes, samples, sample_data = [], [], []
    for i, name in enumerate(("scene-b", "scene-a")):
        scenes.append({"token": f"sc-{name}", "name": name})
        samples.append({"token": f"sa-{name}", "scene_token": f"sc-{name}"})
        base = 2000 if name == "scene-b" else 1000  # scene-b listed first but later in time too
        for s in sensors:
            ch = s["channel"]
            for key_frame, folder, offset in ((False, "sweeps", 5), (True, "samples", 0)):
                sample_data.append({
                    "token": f"sd-{name}-{ch}-{folder}", "sample_token": f"sa-{name}",
                    "calibrated_sensor_token": f"cs-{ch}", "timestamp": base + offset, "is_key_frame": key_frame,
                    "filename": f"{folder}/{ch}/{name}-{ch}.{'jpg' if s['modality'] == 'camera' else 'pcd.bin'}"})
    tables = {"scene": scenes, "sample": samples, "sample_data": sample_data,
              "calibrated_sensor": calibrated, "sensor": sensors}
    (tmp_path / "v1.0-mini").mkdir(parents=True)
    for table, rows in tables.items():
        (tmp_path / "v1.0-mini" / f"{table}.json").write_text(json.dumps(rows))
    return tmp_path
