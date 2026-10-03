import logging
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from routers import auto_label, embedding
from services.clip_service import ClipService, ClipError
from services.vespa_service import VespaService, VespaError

@asynccontextmanager
async def lifespan(app: FastAPI):
    service = ClipService()
    app.state.clip_service = service
    app.state.vespa_service = VespaService()
    try:
        service.load()  # Fail startup if weights/dependencies cannot load; never pretend ready.
        yield
    except Exception:
        logging.getLogger("uvicorn.error").exception("AI lifecycle failed")
        raise
    finally:
        service.close()

app = FastAPI(title="DriveScene2Label AI Server", version="0.2.0", lifespan=lifespan)
@app.middleware("http")
async def request_logging(request: Request, call_next):
    started = time.monotonic()
    try:
        response = await call_next(request)
        logging.getLogger("uvicorn.error").info("AI method=%s path=%s status=%s elapsed_ms=%.0f", request.method, request.url.path, response.status_code, (time.monotonic()-started)*1000)
        return response
    except Exception:
        logging.getLogger("uvicorn.error").exception("AI request failed path=%s", request.url.path)
        raise

app.include_router(embedding.router)
app.include_router(auto_label.router)

@app.exception_handler(ClipError)
async def clip_error_handler(request: Request, exc: ClipError):
    logging.getLogger("uvicorn.error").warning("AI error path=%s code=%s", request.url.path, exc.code)
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, "message": str(exc)}})

@app.exception_handler(VespaError)
async def vespa_error_handler(request, exc):
    logging.getLogger("uvicorn.error").warning("AI error path=%s code=%s", request.url.path, exc.code)
    return JSONResponse(status_code=exc.status_code, content={"detail": {"code": exc.code, "message": str(exc)}})

@app.get("/health", tags=["health"])
def health(request: Request):
    service = request.app.state.clip_service
    ready = service.model is not None
    return JSONResponse(status_code=200 if ready else 503, content={"status": "ok" if ready else "not_ready", "service": "drivescene-ai", "inference": {"clip": "ready" if ready else "not_ready", "vespa": "configured" if request.app.state.vespa_service.configured() else "not_configured"}, "device": service.device})
