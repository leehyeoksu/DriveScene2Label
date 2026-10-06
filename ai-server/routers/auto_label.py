from fastapi import APIRouter, Request
from schemas.auto_label import AutoLabelRequest, AutoLabelResponse

router = APIRouter(prefix="/auto-label", tags=["auto-label"])

@router.post("", response_model=AutoLabelResponse,
             responses={409: {"description": "Worker busy"}, 503: {"description": "Not configured"},
                        502: {"description": "Execution/result error"}, 504: {"description": "Timeout"}})
def create_auto_labels(body: AutoLabelRequest, request: Request):
    # Sync route runs in FastAPI's thread pool. The HTTP client still waits.
    service = request.app.state.vespa_service
    if body.upload_id is not None:
        service = service.for_upload(body.upload_id, body.dataset_version)
    return service.generate(body)
