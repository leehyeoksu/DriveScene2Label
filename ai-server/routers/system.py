from fastapi import APIRouter, Request

router = APIRouter(tags=["system"])


@router.get("/livez")
def livez():
    """Process liveness only. Feature readiness is /capabilities; /health keeps its CLIP readiness meaning."""
    return {"status": "alive", "service": "drivescene-ai"}


@router.get("/capabilities")
def capabilities(request: Request, refresh: bool = False):
    # Sync route: a refresh may run a bounded read-only VESPA check in the thread pool. Never starts inference.
    return request.app.state.capability_service.snapshot(refresh)
