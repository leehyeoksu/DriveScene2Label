import logging
import os
import sys
from pathlib import Path
from threading import Lock

import torch
from PIL import Image, UnidentifiedImageError

# Import only the shared inference module, never the DB-writing CLI.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "embedding"))
import clip_core
from schemas.embedding import EmbeddingResponse

logger = logging.getLogger(__name__)

class ClipError(RuntimeError):
    def __init__(self, status_code, code, message):
        super().__init__(message)
        self.status_code, self.code = status_code, code

class ClipService:
    def __init__(self):
        self.model = self.preprocess = self.tokenizer = None
        self.device = None
        self.lock = Lock()
        self.image_root = Path(os.environ.get("CLIP_IMAGE_ROOT", os.environ.get("NUSCENES_ROOT", "/data/nuscenes")))

    def load(self):
        if self.model is not None:
            return
        # Preserve availability-based cuda -> mps -> cpu selection.
        self.device = clip_core.available_devices()[0]
        self.model, self.preprocess, self.tokenizer = clip_core.load_model(self.device)
        logger.info("CLIP loaded once on %s", self.device)

    def close(self):
        self.model = self.preprocess = self.tokenizer = None

    def _ready(self):
        if self.model is None:
            raise ClipError(503, "CLIP_NOT_READY", "CLIP model is not ready.")

    def _response(self, vector, preprocess):
        if vector.shape != (clip_core.EMBED_DIM,) or not torch.isfinite(vector).all() or not torch.isclose(vector.norm(), torch.tensor(1.0), atol=1e-5):
            raise ClipError(500, "INVALID_MODEL_OUTPUT", "CLIP returned an invalid embedding.")
        return EmbeddingResponse(embedding=vector.tolist(), preprocess=preprocess)

    def encode_text(self, text):
        self._ready()
        try:
            with self.lock:
                vector = clip_core.encode_text(self.model, self.tokenizer, text, self.device)
            return self._response(vector, "clip-text-tokenizer")
        except ClipError:
            raise
        except Exception as exc:
            logger.exception("CLIP text inference failed")
            raise ClipError(500, "CLIP_INFERENCE_FAILED", "Text inference failed.") from exc

    def encode_image_path(self, image_path, mode):
        self._ready()
        try:
            path = clip_core.resolve(self.image_root, image_path)
        except FileNotFoundError as exc:
            raise ClipError(404, "IMAGE_NOT_FOUND", "Image or configured image root does not exist.") from exc
        except ValueError as exc:
            raise ClipError(400, "INVALID_IMAGE_PATH", "A relative image path inside CLIP_IMAGE_ROOT is required.") from exc
        except OSError as exc:
            raise ClipError(400, "IMAGE_NOT_READABLE", "Image path is not readable.") from exc
        try:
            with Image.open(path) as image:
                with self.lock:
                    vector = clip_core.encode_image(self.model, self.preprocess, image, self.device, mode)
            return self._response(vector, mode)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise ClipError(400, "INVALID_IMAGE", "File is not a readable image.") from exc
        except ClipError:
            raise
        except Exception as exc:
            logger.exception("CLIP image inference failed")
            raise ClipError(500, "CLIP_INFERENCE_FAILED", "Image inference failed.") from exc
