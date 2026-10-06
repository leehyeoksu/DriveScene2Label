"""Synthetic (not nuScenes) fixtures for recording tests and the browser sample recording.

python tests/recording_fixtures.py --out <dir>  ->  <dir>/scene-test.rrd, sample-request.json, sample-response.json
"""
import argparse
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

SENSOR_TRANSLATION = [0.94, 0.0, 1.84]
SENSOR_ROTATION = [math.cos(math.pi/4), 0.0, 0.0, math.sin(math.pi/4)]  # yaw +90 deg, exercises sensor->ego
START_US = 1700000000000000


def yaw(rad):
    return [math.cos(rad/2), 0.0, 0.0, math.sin(rad/2)]


def write_lidar(path, n_ring=360):
    """Sensor-frame float32x5 (x,y,z,intensity,ring): a 10 m ring plus a ground grid 1.84 m below the sensor."""
    a = np.linspace(0, 2*np.pi, n_ring, endpoint=False)
    ring = np.stack([10*np.cos(a), 10*np.sin(a), np.zeros_like(a)], 1)
    g = np.linspace(-15, 15, 31)
    gx, gy = np.meshgrid(g, g)
    ground = np.stack([gx.ravel(), gy.ravel(), np.full(gx.size, -1.84)], 1)
    xyz = np.concatenate([ring, ground])
    rows = np.concatenate([xyz, np.full((len(xyz), 1), 0.5), np.arange(len(xyz))[:, None] % 32], 1).astype(np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows.tofile(path)
    return len(rows)


def make_request(data_root, samples=6, gt=2, predictions=2, job_id=1, recording_id=1,
                 execution_token="5a3e0000-0000-4000-8000-000000000001", scene_name="scene-0000"):
    rows = []
    for i in range(samples):
        rel = f"samples/LIDAR_TOP/synthetic-{i}.pcd.bin"
        write_lidar(Path(data_root) / rel)
        ego = [400.0 + 2*i, 1100.0, 0.0]
        boxes = [{"id": 1000*i + k + 1, "category_name": ["vehicle.car", "human.pedestrian.adult"][k % 2],
                  "center": [ego[0] + 8 + 3*k, ego[1] + (2 if k % 2 else -3), 0.8 + 0.1*k],
                  "size_wlh": [1.9, 4.5, 1.6] if k % 2 == 0 else [0.7, 0.7, 1.8], "rotation_wxyz": yaw(0.3*k)}
                 for k in range(gt)]
        preds = [{"id": 1000*i + 500 + k + 1, "detection_name": ["car", "pedestrian"][k % 2],
                  "center": [ego[0] + 8.3 + 3*k, ego[1] + (2.2 if k % 2 else -2.8), 0.8],
                  "size_wlh": [2.0, 4.4, 1.5] if k % 2 == 0 else [0.8, 0.7, 1.7], "rotation_wxyz": yaw(0.3*k + 0.05)}
                 for k in range(predictions)] if job_id is not None else []
        rows.append({"index": i, "sample_token": f"synthetic-sample-{i}", "timestamp_us": START_US + 500000*i,
                     "lidar": {"relative_path": rel, "sensor_translation": SENSOR_TRANSLATION, "sensor_rotation": SENSOR_ROTATION,
                               "ego_translation": ego, "ego_rotation": yaw(0.02*i)},
                     "gt": boxes, "predictions": preds})
    return {"recording_id": recording_id, "execution_token": execution_token, "scene_name": scene_name,
            "scene_token": "synthetic-scene-token", "job_id": job_id, "samples": rows}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    out = Path(p.parse_args().out).absolute()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    with tempfile.TemporaryDirectory() as tmp:
        os.environ.update(NUSCENES_ROOT=f"{tmp}/data", RECORDING_OUTPUT_ROOT=f"{tmp}/recordings")
        from schemas.recording import RecordingRequest
        from services.recording_service import RecordingService
        service = RecordingService()
        request = RecordingRequest(**make_request(f"{tmp}/data"))
        response = service.export(request)
        out.mkdir(parents=True, exist_ok=True)
        (out / "sample-request.json").write_text(request.model_dump_json(indent=1))
        shutil.copyfile(service.output_root / response.relative_path, out / "scene-test.rrd")
        (out / "sample-response.json").write_text(response.model_dump_json(indent=1))
    print(out / "scene-test.rrd", response.size_bytes, response.checksum)


if __name__ == "__main__":
    main()
