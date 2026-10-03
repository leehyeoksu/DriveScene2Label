from fastapi import APIRouter, Request
from schemas.auto_label import AutoLabelRequest, AutoLabelResponse

router = APIRouter(prefix="/auto-label", tags=["auto-label"])

@router.post("", response_model=AutoLabelResponse,
             responses={409: {"description": "Worker busy"}, 503: {"description": "Not configured"},
                        502: {"description": "Execution/result error"}, 504: {"description": "Timeout"}})
def create_auto_labels(body: AutoLabelRequest, request: Request):
    # Sync route runs in FastAPI's thread pool. The HTTP client still waits.
    return request.app.state.vespa_service.generate(body)
