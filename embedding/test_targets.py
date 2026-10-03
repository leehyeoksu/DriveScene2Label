"""DB-free checks for reading embedding targets straight from nuScenes JSON. Run: python -m pytest embedding"""
import pytest

from targets import targets_from_nuscenes
from testutil import make_fake_nuscenes


@pytest.fixture
def fake_root(tmp_path):
    return make_fake_nuscenes(tmp_path)


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


def test_unknown_scene_raises(fake_root):
    with pytest.raises(ValueError, match="scene-zzz"):
        targets_from_nuscenes(fake_root, "v1.0-mini", scene="scene-zzz")
