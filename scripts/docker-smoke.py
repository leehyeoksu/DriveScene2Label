"""Real-stack smoke test. Writes embeddings and optionally creates one VESPA job."""
import argparse
import json
import time
import urllib.request
import uuid

p = argparse.ArgumentParser()
p.add_argument("--backend", default="http://localhost:8080")
p.add_argument("--ai", default="http://localhost:8000")
p.add_argument("--auto-label", action="store_true")
p.add_argument("--wait-seconds", type=int, default=7500)
a = p.parse_args()

def call(base, path, body=None, method="GET", headers=None):
    req = urllib.request.Request(base+path, data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={"Content-Type":"application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)

health = call(a.ai,"/health")
print("AI health", health, flush=True)
# HTTP can be available while the initial import transaction is still running.
end = time.monotonic()+120
while True:
    datasets = call(a.backend,"/api/datasets")
    if datasets: break
    if time.monotonic()>=end: raise RuntimeError("Import nuScenes metadata first")
    time.sleep(3)
dataset = next((d for d in datasets if d["version"]=="v1.0-mini"), datasets[0])
scenes = call(a.backend,f"/api/datasets/{dataset['id']}/scenes")
scene = next((s for s in scenes if s["name"]=="scene-0061"), scenes[0])
samples = call(a.backend,f"/api/scenes/{scene['id']}/samples?limit=1")
sample = call(a.backend,f"/api/samples/{samples[0]['id']}")
image = next(f for f in sample["sensorFiles"] if f["modality"]=="camera")
for overwrite in ("true", "false"):
    result = call(a.backend,f"/api/sensor-files/{image['id']}/embedding?overwrite={overwrite}",method="POST")
    assert result["status"] == ("STORED" if overwrite=="true" else "SKIPPED"), result
    print("Image", result, flush=True)
result = call(a.backend,f"/api/search/scenes?q=rainy%20night%20road&datasetId={dataset['id']}&k=10")
assert result["scenes"], result
print("Search scene count", len(result["scenes"]), flush=True)
if a.auto_label:
    result=call(a.backend,"/api/auto-label/jobs",{"sceneToken":scene["token"],"datasetId":dataset["id"],"classMode":8},"POST",{"Idempotency-Key":str(uuid.uuid4())})
    job=result["jobId"]
    print("Job", result, flush=True)
    end=time.monotonic()+a.wait_seconds
    previous=None
    while time.monotonic()<end:
        status=call(a.backend,f"/api/auto-label/jobs/{job}")
        if status["status"]!=previous:
            print("Job status",status,flush=True);previous=status["status"]
        if previous=="FAILED": raise RuntimeError(status)
        if previous=="COMPLETED":
            result=call(a.backend,f"/api/auto-label/jobs/{job}/results")
            print("Result samples",len(result["sampleTokens"]),"boxes",len(result["boxes"]),flush=True)
            break
        time.sleep(5)
    else: raise TimeoutError(f"Job {job} still running; polling stopped, job not cancelled")
