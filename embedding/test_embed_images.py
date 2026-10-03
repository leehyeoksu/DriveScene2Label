"""Model- and DB-free checks for the preprocessing in embed_images.py. Run: python -m pytest embedding"""
import os

import open_clip
import pytest
import torch
from PIL import Image

import embed_images as ei


def random_image(w: int, h: int) -> Image.Image:
    return Image.frombytes("RGB", (w, h), os.urandom(w * h * 3))


def eval_transform(resize_mode: str | None = None):
    """open_clip's eval transform for the embedder's model, built from its configs without loading weights.
    resize_mode="squash" resizes straight to 224x224, i.e. the same pipeline with the center crop turned off."""
    cfg = open_clip.get_pretrained_cfg(ei.MODEL_NAME, ei.PRETRAINED)
    size = open_clip.get_model_config(ei.MODEL_NAME)["vision_cfg"]["image_size"]
    return open_clip.image_transform(size, is_train=False, mean=cfg["mean"], std=cfg["std"],
                                     interpolation=cfg["interpolation"], resize_mode=resize_mode or cfg["resize_mode"])


def column(img: Image.Image, x: int) -> bytes:
    return img.crop((x, 0, x + 1, img.height)).tobytes()


def test_landscape_splits_into_left_and_right_squares():
    img = random_image(1600, 900)
    left, right = ei.square_crops(img)
    assert left.size == right.size == (900, 900)
    assert column(left, 0) == column(img, 0)
    assert column(right, 899) == column(img, 1599)
    assert left.tobytes() == img.crop((0, 0, 900, 900)).tobytes()
    assert right.tobytes() == img.crop((700, 0, 1600, 900)).tobytes()


def test_square_image_stays_single():
    img = random_image(900, 900)
    crops = ei.square_crops(img)
    assert len(crops) == 1 and crops[0] is img


def test_center_crop_mode_keeps_whole_image():
    img = random_image(1600, 900)
    assert ei.image_crops(img, ei.CENTER_CROP) == [img]
    assert len(ei.image_crops(img, ei.LR_SQUARE_CROP_MEAN)) == 2


def test_combined_vectors_are_unit_length():
    torch.manual_seed(0)
    features = torch.randn(5, ei.EMBED_DIM) * 7
    combined = ei.combine_crops(features, [2, 1, 2])
    assert combined.shape == (3, ei.EMBED_DIM)
    assert torch.allclose(combined.norm(dim=-1), torch.ones(3), atol=1e-6)
    # One crop: same direction as the input. Two crops: normalized before averaging, so scale does not matter.
    assert torch.allclose(combined[1], features[2] / features[2].norm(), atol=1e-6)
    pair = features[:2] * torch.tensor([[1.0], [100.0]])
    assert torch.allclose(ei.combine_crops(pair, [2])[0], combined[0], atol=1e-6)


def test_eval_center_crop_does_not_cut_a_square_crop():
    square = random_image(900, 900)
    with_crop, without_crop = eval_transform(), eval_transform("squash")
    assert torch.equal(with_crop(square), without_crop(square))
    # Control: on the full 16:9 frame the center crop does cut content, so the comparison above is meaningful.
    wide = random_image(1600, 900)
    assert not torch.allclose(with_crop(wide), without_crop(wide))


def test_run_fails_when_every_file_is_skipped(tmp_path):
    with pytest.raises(SystemExit) as failed:
        ei.check_stored(done=0, skipped=3, root=tmp_path)
    assert failed.value.code != 0  # a message string exits with status 1
    assert "--root / NUSCENES_ROOT" in str(failed.value.code)
    ei.check_stored(done=2, skipped=1, root=tmp_path)  # some stored: a few bad files are only reported
    ei.check_stored(done=0, skipped=0, root=tmp_path)  # nothing to do is not an error


@pytest.mark.parametrize("src,sink,out,ow,ok", [
    ("db", "db", None, False, True), ("nuscenes", "file", "/x", False, True),
    ("nuscenes", "db", None, False, False), ("db", "file", "/x", False, False),
    ("nuscenes", "file", None, False, False), ("nuscenes", "file", "/x", True, False)])
def test_validate_modes(src, sink, out, ow, ok):
    assert (ei.validate_modes(src, sink, out, ow) is None) == ok


def test_manifest_fields():
    m = ei.build_manifest("v1.0-mini", ei.LR_SQUARE_CROP_MEAN, "cpu")
    assert m["model_name"] == "ViT-L-14-quickgelu/openai" and m["embed_dim"] == 768 and m["format_version"] == 1
    assert m["dataset"] == {"name": "nuScenes", "version": "v1.0-mini"} and m["preprocess"] == ei.LR_SQUARE_CROP_MEAN
    assert {"device", "torch", "open_clip", "python", "platform"} <= m["env"].keys() and m["env"]["device"] == "cpu"


def test_to_pgvector_accepts_numpy_and_torch():
    import numpy as np
    import db
    v = np.array([0.5, -0.25, 1e-8], dtype=np.float32)
    assert db.to_pgvector(v) == db.to_pgvector(torch.from_numpy(v)) == "[0.5,-0.25,1e-08]"


def test_min_cosine_identical():
    from testutil import unit
    v = unit(3); assert ei.min_cosine(v, v) == pytest.approx(1.0, abs=1e-6)


def test_min_cosine_detects_drift():
    from testutil import unit
    v = unit(3); w = v.copy(); w[1] = -v[1]; assert ei.min_cosine(v, w) < ei.REFERENCE_MIN_COSINE
    assert ei.min_cosine(v, w) == pytest.approx(-1.0, abs=1e-6)  # row-wise: only the flipped row counts


def test_file_run_writes_completion_only_when_all_targets_are_stored(tmp_path, monkeypatch):
    import argparse
    import npz_store
    from testutil import make_fake_nuscenes, unit

    def fake_encode(rows, root, mode, device, batch_size):  # no model: one unit vector per row
        for start in range(0, len(rows), batch_size):
            batch = rows[start:start + batch_size]
            yield [t for t, _ in batch], torch.from_numpy(unit(len(batch))), 0

    monkeypatch.setattr(ei, "encode_batches", fake_encode)
    root, out = make_fake_nuscenes(tmp_path / "data"), tmp_path / "out"
    args = argparse.Namespace(out=str(out), version="v1.0-mini", preprocess=ei.LR_SQUARE_CROP_MEAN, include_sweeps=False,
                              scene=None, limit=3, batch_size=2)
    ei.embed_to_files(args, root, "cpu")
    c = npz_store.read_completion(out)
    assert (c["targets"], c["present"], c["complete"]) == (4, 3, False)
    args.limit = None
    ei.embed_to_files(args, root, "cpu")  # resume: the 4th target
    assert npz_store.read_completion(out)["complete"] is True
    assert len(npz_store.existing_tokens(out)) == 4
