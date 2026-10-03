"""Checks for the npz part store (file sink of embed_images.py). Run: python -m pytest embedding"""
import numpy as np
import pytest

from npz_store import ManifestMismatch, existing_tokens, iter_parts, open_output, read_manifest, write_part
from testutil import MANIFEST as M, unit


def test_parts_roundtrip_and_resume(tmp_path):
    open_output(tmp_path, M)
    p1 = write_part(tmp_path, ["a", "b"], unit(2)); p2 = write_part(tmp_path, ["c"], unit(1))
    assert (p1.name, p2.name) == ("part-00001.npz", "part-00002.npz")
    assert existing_tokens(tmp_path) == {"a", "b", "c"}
    z = np.load(p1, allow_pickle=False); assert z["tokens"].dtype.kind == "U" and z["vectors"].dtype == np.float32
    assert read_manifest(tmp_path) == M
    assert not list(tmp_path.glob("*.tmp*"))  # temporary files are renamed away


def test_resume_with_other_preprocess_refused(tmp_path):
    open_output(tmp_path, M)
    with pytest.raises(ManifestMismatch): open_output(tmp_path, {**M, "preprocess": "openclip-eval-224-centercrop"})


def test_resume_with_other_env_allowed(tmp_path):
    open_output(tmp_path, M); open_output(tmp_path, {**M, "env": {"device": "cuda"}})
    assert read_manifest(tmp_path)["env"] == {}  # the first run's manifest is kept


def test_corrupt_part_is_skipped(tmp_path):
    open_output(tmp_path, M); write_part(tmp_path, ["a"], unit(1))
    (tmp_path / "part-00002.npz").write_bytes(b"truncated")
    assert existing_tokens(tmp_path) == {"a"}
    assert sum(1 for x in iter_parts(tmp_path) if isinstance(x[1], Exception)) == 1
    assert write_part(tmp_path, ["b"], unit(1)).name == "part-00003.npz"  # never overwrites the broken part


def test_nonempty_folder_without_manifest_refused(tmp_path):
    (tmp_path / "notes.txt").write_text("someone else's files")
    with pytest.raises(ManifestMismatch, match="no manifest.json"):
        open_output(tmp_path, M)
