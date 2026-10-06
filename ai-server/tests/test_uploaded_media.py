from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from uuid import uuid4
import pytest
from services.media_paths import media_path, upload_root
from services.vespa_service import VespaService, VespaError

def test_uploaded_and_original_media_are_separate(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    source = tmp_path / "source"
    key = str(uuid4())
    file = uploads / key / "samples" / "a.jpg"
    file.parent.mkdir(parents=True); file.write_bytes(b"uploaded")
    original = source / "samples" / "a.jpg"
    original.parent.mkdir(parents=True); original.write_bytes(b"original")
    monkeypatch.setenv("UPLOAD_ROOT", str(uploads))
    assert media_path(source, "__uploads__/" + key + "/samples/a.jpg").read_bytes() == b"uploaded"
    assert media_path(source, "samples/a.jpg").read_bytes() == b"original"
    for bad in ("../secret", "/etc/passwd", "__uploads__/" + key + "/../secret", "C:/secret", "a\\b"):
        with pytest.raises(ValueError):
            media_path(source, bad)
    outside = tmp_path / "outside"; outside.write_text("secret")
    (file.parent / "link").symlink_to(outside)
    with pytest.raises(ValueError):
        media_path(source, "__uploads__/" + key + "/samples/link")

def test_upload_vespa_clone_keeps_single_execution_lock(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    monkeypatch.setenv("VESPA_EXECUTOR", "local")
    service = VespaService()
    key = str(uuid4())
    selected = service.for_upload(key, "v1.0-mini")
    assert selected.lock is service.lock
    assert selected.data_root == tmp_path / key
    assert service.data_root != selected.data_root
    assert selected.version == "v1.0-mini"
    service.executor = "ssh"
    with pytest.raises(VespaError):
        service.for_upload(key, "v1.0-mini")

def test_uploaded_lidar_is_exported_by_real_subprocess(tmp_path, monkeypatch):
    from recording_fixtures import make_request
    from schemas.recording import RecordingRequest
    from services.recording_service import RecordingService
    source = tmp_path / "empty-source"; source.mkdir()
    uploads = tmp_path / "uploads"
    key = str(uuid4())
    monkeypatch.setenv("NUSCENES_ROOT", str(source))
    monkeypatch.setenv("UPLOAD_ROOT", str(uploads))
    monkeypatch.setenv("RECORDING_OUTPUT_ROOT", str(tmp_path / "recordings"))
    monkeypatch.delenv("RECORDING_PYTHON", raising=False)
    request = make_request(uploads / key, samples=2)
    for sample in request["samples"]:
        sample["lidar"]["relative_path"] = "__uploads__/" + key + "/" + sample["lidar"]["relative_path"]
    service = RecordingService()
    result = service.export(RecordingRequest.model_validate(request))
    assert result.size_bytes > 0
    assert len(result.samples) == 2
    assert all(sample.lidar_points > 0 for sample in result.samples)

def test_selected_upload_uses_its_own_scene_metadata(tmp_path, monkeypatch):
    import json
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path))
    monkeypatch.setenv("VESPA_EXECUTOR", "local")
    key = str(uuid4())
    metadata = tmp_path / key / "v1.0-mini"; metadata.mkdir(parents=True)
    (metadata / "scene.json").write_text(json.dumps([{"name": "scene-0001", "token": "uploaded-scene"}]))
    (metadata / "sample.json").write_text(json.dumps([{"token": "uploaded-sample", "scene_token": "uploaded-scene"}]))
    selected = VespaService().for_upload(key, "v1.0-mini")
    assert selected._targets("scene-0001") == {"uploaded-sample"}
