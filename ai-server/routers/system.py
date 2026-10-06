from fastapi import APIRouter, Request
from uuid import UUID
from typing import Literal
from threading import Lock

_upload_caps_lock = Lock()

router = APIRouter(tags=["system"])


@router.get("/livez")
def livez():
    """Process liveness only. Feature readiness is /capabilities; /health keeps its CLIP readiness meaning."""
    return {"status": "alive", "service": "drivescene-ai"}


@router.get("/capabilities")
def capabilities(request: Request, refresh: bool = False, upload_id: UUID | None = None,
                 dataset_version: Literal["v1.0-mini", "v1.0-trainval"] = "v1.0-mini"):
    # Sync route: a refresh may run a bounded read-only VESPA check in the thread pool. Never starts inference.
    base = request.app.state.capability_service
    if upload_id is None:
        return base.snapshot(refresh)
    from services.capability_service import CapabilityService
    if base.vespa.executor != "local":
        result = base.snapshot(False)
        result["vespa"] = {"state": "UNAVAILABLE", "reasonCode": "UPLOAD_LOCAL_ONLY",
                           "executor": base.vespa.executor, "datasetVersion": dataset_version,
                           "metadataChecksum": None, "checkedAt": None, "expiresAt": None}
        return result
    from collections import OrderedDict
    with _upload_caps_lock:
        if not hasattr(request.app.state, "upload_capabilities"):
            request.app.state.upload_capabilities = OrderedDict()
        cache = request.app.state.upload_capabilities
        key = (str(upload_id), dataset_version)
        if key not in cache:
            cache[key] = CapabilityService(base.clip, base.vespa.for_upload(upload_id, dataset_version), base.recording, base.clip_error)
        selected = cache[key]
        cache.move_to_end(key)
        if len(cache) > 32:
            cache.popitem(last=False)
    return selected.snapshot(refresh)
