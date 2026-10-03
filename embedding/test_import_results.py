"""DB-free checks for import_results.py validation. Run: python -m pytest embedding"""
import numpy as np

from import_results import validate_manifest, validate_part
from testutil import MANIFEST as M, unit


def test_validate_part_ok():           assert validate_part(np.array(["a"]), unit(1)) == []
def test_validate_part_wrong_dim():    assert validate_part(np.array(["a"]), np.ones((1, 512), np.float32))
def test_validate_part_not_unit():     assert validate_part(np.array(["a"]), np.full((1, 768), 0.5, np.float32))
def test_validate_part_nan():          v = unit(1); v[0, 0] = np.nan; assert validate_part(np.array(["a"]), v)
def test_validate_part_duplicate():    assert validate_part(np.array(["a", "a"]), unit(2))
def test_validate_manifest_bad_dim():  assert validate_manifest({**M, "embed_dim": 512})


def test_validate_part_float64_and_length_mismatch():
    assert validate_part(np.array(["a"]), unit(1).astype(np.float64))
    assert validate_part(np.array(["a", "b"]), unit(1))


def test_validate_manifest_ok_and_missing_keys():
    assert validate_manifest(M) == []
    assert validate_manifest({k: v for k, v in M.items() if k != "preprocess"})
    assert validate_manifest({**M, "format_version": 2})
    assert validate_manifest({**M, "dataset": {"name": "Waymo", "version": "x"}})


def test_completion_problem():
    from import_results import completion_problem
    done = {"targets": 3, "present": 3, "complete": True}
    assert completion_problem(done, {"a", "b", "c"}) is None
    assert "complete.json" in completion_problem(None, {"a"})                    # run unfinished or not synced
    assert "2 of 3" in completion_problem({**done, "present": 2, "complete": False}, {"a", "b"})  # partial run
    assert "missing" in completion_problem(done, {"a", "b"})                     # parts not synced yet
