import hashlib
import json
import logging
import os
import signal
import subprocess
import sys
from pathlib import Path
from threading import Lock
from uuid import uuid4

from schemas.auto_label import AutoLabelRequest, AutoLabelResponse

logger = logging.getLogger(__name__)
CLASSES = {1: {"vehicle"}, 3: {"vehicle", "pedestrian", "bicycle"},
           8: {"car", "truck", "bus", "trailer", "construction_vehicle", "pedestrian", "motorcycle", "bicycle"}}

class VespaError(RuntimeError):
    def __init__(self, status_code, code, message):
        super().__init__(message)
        self.status_code, self.code = status_code, code

class VespaService:
    def __init__(self):
        project = Path(__file__).resolve().parents[2]
        self.repo = Path(os.environ.get("VESPA_ROOT", str(project / ".local/VESPA"))).resolve()
        # Preserve the venv interpreter path: resolving its symlink would bypass the venv.
        self.python = Path(os.environ.get("VESPA_PYTHON", sys.executable)).absolute()
        self.data_root = Path(os.environ.get("VESPA_DATA_ROOT", os.environ.get("NUSCENES_ROOT", "/data/nuscenes"))).resolve()
        self.version = os.environ.get("VESPA_DATASET_VERSION", "v1.0-trainval")
        self.output_root = Path(os.environ.get("VESPA_OUTPUT_ROOT", str(project / ".local/vespa-runs"))).resolve()
        self.timeout = int(os.environ.get("VESPA_TIMEOUT_SECONDS", "7200"))
        if self.timeout <= 0 or self.version not in ("v1.0-mini", "v1.0-trainval"):
            raise ValueError("Invalid VESPA timeout/dataset version")
        self.num_threads = int(os.environ.get("VESPA_NUM_THREADS", "1"))
        if self.num_threads <= 0:
            raise ValueError("VESPA_NUM_THREADS must be positive")
        self.lock = Lock()

    def configured(self):
        return ((self.repo / "main_pseudo_vlm.py").is_file() and self.python.is_file()
                and (self.repo / "configs/vlm/p_final.yaml").is_file()
                and all((self.data_root / self.version / f"{t}.json").is_file() for t in ("scene", "sample")))

    def _targets(self, scene_name):
        try:
            scenes = json.loads((self.data_root / self.version / "scene.json").read_text())
            samples = json.loads((self.data_root / self.version / "sample.json").read_text())
            scene = next((s for s in scenes if s["name"] == scene_name), None)
            if scene is None:
                raise VespaError(404, "SCENE_NOT_FOUND", "Scene does not exist in the configured dataset.")
            tokens = {s["token"] for s in samples if s["scene_token"] == scene["token"]}
            if not tokens:
                raise ValueError("No samples")
            return tokens
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise VespaError(503, "VESPA_DATA_NOT_READY", "nuScenes metadata is unavailable or invalid.") from exc

    def generate(self, request: AutoLabelRequest):
        if not self.lock.acquire(blocking=False):
            raise VespaError(409, "VESPA_BUSY", "A VESPA run is already active on this AI worker.")
        try:
            if not self.configured():
                raise VespaError(503, "VESPA_NOT_CONFIGURED", "Configure VESPA repository, Python environment and nuScenes data first.")
            expected = self._targets(request.scene_name)
            run_id = uuid4()
            logger.info("[VESPA] job=%s scene=%s run=%s started", request.job_id, request.scene_name, run_id)
            run_dir = self.output_root / str(run_id)
            try:
                run_dir.mkdir(parents=True, exist_ok=False)
                command = [str(self.python), str(Path(__file__).with_name("vespa_runner.py")),
                           "--repo", str(self.repo), "--config", str(self.repo / "configs/vlm/p_final.yaml"),
                           "--scene", request.scene_name, "--class-mode", str(request.class_mode),
                           "--output-root", str(run_dir), "--data-root", str(self.data_root), "--dataset-version", self.version]
                # Small RANSAC linear solves suffer from BLAS oversubscription.
                env = os.environ.copy()
                for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
                    env[key] = str(self.num_threads)
                with (run_dir / "execution.log").open("wb") as log:
                    with subprocess.Popen(command, cwd=self.repo, stdout=log, stderr=subprocess.STDOUT,
                                          start_new_session=(os.name == "posix"), env=env) as process:
                        try:
                            code = process.wait(timeout=self.timeout)
                        except subprocess.TimeoutExpired as exc:
                            if os.name == "posix":
                                try:
                                    os.killpg(process.pid, signal.SIGKILL)
                                except ProcessLookupError:
                                    pass
                            else:
                                process.kill()
                            process.wait()
                            logger.error("VESPA timeout: run %s", run_id)
                            raise VespaError(504, "VESPA_TIMEOUT", "VESPA exceeded the configured runtime limit.") from exc
                if code != 0:
                    logger.error("VESPA run %s exited with %s; see execution.log", run_id, code)
                    raise VespaError(502, "VESPA_EXECUTION_FAILED", "VESPA execution failed; check the AI server run log.")
            except OSError as exc:
                raise VespaError(503, "VESPA_LAUNCH_FAILED", "Could not launch VESPA or write its run files.") from exc
            mapping = f"{request.class_mode}class"
            path = run_dir / "outs/vlm/p_final/#out_labels" / f"vlm_p_final_{request.scene_name}_{mapping}.json"
            try:
                payload = json.loads(path.read_text())
                if payload["mapping_name"] != mapping or set(payload["results"]) != expected:
                    raise ValueError("Mapping/sample coverage mismatch")
                response = AutoLabelResponse(run_id=run_id, scene_name=request.scene_name,
                    class_mode=request.class_mode, job_id=request.job_id, execution_token=request.execution_token,
                    mapping_name=payload["mapping_name"], split=payload["split"], meta=payload["meta"], results=payload["results"],
                    artifact_path=str(path.relative_to(self.output_root)),
                    result_checksum=hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest())
                for token, boxes in response.results.items():
                    for box in boxes:
                        if box.sample_token != token or box.detection_name not in CLASSES[request.class_mode] or box.detection_score != 1.0:
                            raise ValueError("Invalid box class, token or score")
                logger.info("[VESPA] job=%s run=%s completed boxes=%s", request.job_id, run_id, sum(len(b) for b in response.results.values()))
                return response
            except (OSError, KeyError, TypeError, ValueError) as exc:
                logger.exception("Invalid final JSON for run %s", run_id)
                raise VespaError(502, "VESPA_INVALID_RESULT", "Final VESPA JSON is missing or invalid.") from exc
        finally:
            self.lock.release()
