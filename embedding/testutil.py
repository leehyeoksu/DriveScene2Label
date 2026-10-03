"""Shared helpers for the embedding tests (not collected by pytest: no test_ prefix)."""
import numpy as np

MANIFEST = {"format_version": 1, "dataset": {"name": "nuScenes", "version": "v1.0-mini"},
            "model_name": "ViT-L-14-quickgelu/openai", "preprocess": "lr-square-crop-mean", "embed_dim": 768, "env": {}}


def unit(n: int) -> np.ndarray:
    """n random L2-normalized float32 rows of 768 dims."""
    v = np.random.rand(n, 768).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)
