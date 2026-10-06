from fastapi import APIRouter, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from schemas.recording import RecordingRequest, RecordingResponse


class CodedValidationRoute(APIRoute):
    """422 as {"detail":{"code","message"}} for this router only; never echoes input values."""
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def route(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                message = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:5])
                return JSONResponse(status_code=422, content={"detail": {"code": "RECORDING_INVALID_REQUEST", "message": message}})
        return route


router = APIRouter(prefix="/recordings", tags=["recordings"], route_class=CodedValidationRoute)

@router.post("", response_model=RecordingResponse,
             responses={422: {"description": "Invalid request or path"}, 404: {"description": "Lidar file missing"},
                        503: {"description": "SDK/config missing"}, 502: {"description": "Exporter failed"}, 504: {"description": "Timeout"}})
def create_recording(body: RecordingRequest, request: Request):
    # Sync route runs in FastAPI's thread pool while the exporter subprocess writes the .rrd.
    return request.app.state.recording_service.export(body)
