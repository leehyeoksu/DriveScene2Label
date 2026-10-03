"""DB-free checks for reading embedding targets straight from nuScenes JSON. Run: python -m pytest embedding"""
import json

import pytest

from targets import targets_from_nuscenes


@pytest.fixture
def fake_root(tmp_path):
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
    (tmp_path / "v1.0-mini").mkdir()
    for table, rows in tables.items():
        (tmp_path / "v1.0-mini" / f"{table}.json").write_text(json.dumps(rows))
    return tmp_path


def test_camera_keyframes_only(fake_root):
    t = targets_from_nuscenes(fake_root, "v1.0-mini")
    assert len(t) == 4                          # 2 scene × 2 camera, keyframe만
    assert all(x.relative_path.startswith("samples/CAM_") for x in t)
    assert [x.relative_path.split("/")[1] for x in t[:2]] == ["CAM_BACK", "CAM_FRONT"]  # channel 순
    assert [x.token for x in t] == ["sd-scene-a-CAM_BACK-samples", "sd-scene-a-CAM_FRONT-samples",
                                    "sd-scene-b-CAM_BACK-samples", "sd-scene-b-CAM_FRONT-samples"]  # scene 순


def test_include_sweeps(fake_root):
    t = targets_from_nuscenes(fake_root, "v1.0-mini", include_sweeps=True)
    assert len(t) == 8
    # Within a scene: timestamp first (keyframe at +0 before sweep at +5), then channel.
    assert [x.relative_path.split("/")[0] for x in t[:4]] == ["samples", "samples", "sweeps", "sweeps"]


def test_scene_filter(fake_root):
    assert len(targets_from_nuscenes(fake_root, "v1.0-mini", scene="scene-b")) == 2


def test_missing_version_dir_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="v1.0-mini"):
        targets_from_nuscenes(tmp_path, "v1.0-mini")
