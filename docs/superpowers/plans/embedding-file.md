# 임베딩 파일 모드 + importer (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colab, 혁수 PC, 나중의 AWS 어디서 돌려도 token이 붙은 npz 결과 파일만 만들고, importer 하나로 어느 DB에든 넣을 수 있게 한다.

**Architecture:** 대상 목록은 `db` 또는 `nuscenes` JSON에서 읽고, 결과는 `db` 또는 `file`(npz part + manifest)로 쓴다. DB 쪽은 `import_results.py`가 검증한 뒤 upsert한다. 새 환경에서는 레포에 둔 기준 벡터(60장)로 일치 여부를 먼저 확인한다.

**Tech Stack:** Python 3.12+, torch 2.14.1, open_clip_torch 3.3.0, numpy, psycopg 3.3.6, pytest. PostgreSQL 16 + pgvector (Docker)

**Spec:** 프로젝트 문서 `claude/nuscenes-mini-embedding-design.md` §12 (실행 위치 독립 설계). 이 계획과 함께 읽을 것

**Branch:** `feature/clip-embedding`(PR 1)에서 `feature/embedding-file-mode`를 딴다. PR 1이 merge되기 전에는 PR 2의 base를 `feature/clip-embedding`으로 둔다

## Global Constraints

- 새 옵션 없이 실행하면 기존 동작(`db → db`)과 완전히 같아야 한다. 기존 pytest 6개와 `bash scripts/docker-test.sh` 6개가 계속 통과해야 한다
- `EMBED_DIM = 768`, 모델 키 `ViT-L-14-quickgelu/openai`, 기본 전처리 `lr-square-crop-mean`. 이 값을 새로 하드코딩하지 말고 `embed_images.py` 상수를 import한다
- npz 형식: `np.load(path, allow_pickle=False)`로 읽혀야 한다. `tokens`는 유니코드 문자열 배열(object dtype 금지), `vectors`는 float32 (N, 768), 각 행의 L2 norm은 1 ± 1e-3
- `FORMAT_VERSION = 1`, `PART_SIZE = 256`(part 하나당 이미지 수), 기준 일치 임계값은 코사인 최솟값 `>= 0.9999`
- 새 서드파티 의존성은 추가하지 않는다. numpy는 torch와 함께 이미 설치돼 있으니 현재 버전으로 `requirements.txt`에 고정만 한다
- 혁수 스크립트(`local-db.sh`, `run-local.sh`, `db-shell.sh`)와 Java 코드는 건드리지 않는다
- 커밋만 하고 푸시하지 않는다. 푸시와 PR은 사용자가 GitHub Desktop으로 한다
- 테스트 실행: `.venv/bin/python -m pytest embedding -v`. 테스트 파일은 기존 패턴대로 `embedding/test_*.py`에 둔다

## Review Focus

1. **Colab이 part 파일을 쓰다가 끊긴 경우** (깨진 npz): 이어서 할 때는 그 part의 token을 "없는 것"으로 보고 다시 계산하고, importer는 그 part만 거부한 뒤 이유를 출력해야 한다 → Task 2, Task 4 테스트
2. **`NUSCENES_ROOT`/버전 폴더가 틀린 경우**: "대상 0개, 완료"로 조용히 끝나면 안 된다. 경로가 들어간 에러와 exit 1 → Task 1 테스트
3. **다른 모델이나 전처리로 만든 out 폴더에 이어서 쓰는 경우**: 섞이면 안 되니까 거부해야 한다 → Task 2 테스트
4. **import 전에 dataset이 DB에 없는 경우**: 안내 메시지를 내고 exit 1, DB에는 아무것도 쓰지 않아야 한다 → Task 4 통합 확인
5. **같은 폴더를 두 번 import하는 경우**: 행 수와 벡터 값이 그대로여야 한다(멱등) → Task 4 통합 확인

---

### Task 1: nuScenes JSON에서 대상 목록 만들기

**Files:**
- Create: `embedding/targets.py`
- Test: `embedding/test_targets.py`

**Interfaces:**
- Produces: `Target(NamedTuple): token: str, relative_path: str` / `targets_from_nuscenes(root: Path, version: str, *, include_sweeps: bool = False, scene: str | None = None) -> list[Target]`
- 정렬 순서는 DB 조회(`pending_files`)와 같게 한다: `scene.name`, `sample_data.timestamp`, `sensor.channel`

- [ ] **Step 1: 실패하는 테스트 작성** — `tmp_path`에 작은 가짜 테이블을 만드는 fixture를 둔다. 구성은 scene 2개(`scene-a`, `scene-b`), scene마다 sample 1개, 센서 `CAM_FRONT`·`CAM_BACK`(camera)와 `LIDAR_TOP`(lidar), 센서마다 키프레임 1개와 sweep 1개다. 테이블은 `scene`, `sample`, `sample_data`, `calibrated_sensor`, `sensor`이고 필드는 nuScenes 원본 이름을 쓴다.

```python
def test_camera_keyframes_only(fake_root):
    t = targets_from_nuscenes(fake_root, "v1.0-mini")
    assert len(t) == 4                          # 2 scene × 2 camera, keyframe만
    assert all(x.relative_path.startswith("samples/CAM_") for x in t)
    assert [x.relative_path.split("/")[1] for x in t[:2]] == ["CAM_BACK", "CAM_FRONT"]  # channel 순

def test_include_sweeps(fake_root):
    assert len(targets_from_nuscenes(fake_root, "v1.0-mini", include_sweeps=True)) == 8

def test_scene_filter(fake_root):
    assert len(targets_from_nuscenes(fake_root, "v1.0-mini", scene="scene-b")) == 2

def test_missing_version_dir_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="v1.0-mini"):
        targets_from_nuscenes(tmp_path, "v1.0-mini")
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest embedding/test_targets.py -v` → FAIL (`ModuleNotFoundError: targets`)
- [ ] **Step 3: `targets_from_nuscenes` 구현** — JSON 5개를 token → row dict로 읽는다. 조건은 `sensor.modality == "camera"`이고 `is_key_frame`(sweeps 옵션이면 해제)이다. scene은 `sample_data.sample_token → sample.scene_token → scene.name`으로 연결한다. `relative_path`에는 `sample_data.filename`을 그대로 쓴다. 버전 폴더가 없으면 경로를 메시지에 넣어서 `FileNotFoundError`를 낸다
- [ ] **Step 4: 통과 확인** — 같은 명령 → 4 passed
- [ ] **Step 5: 실데이터에서 DB와 같은지 확인** — 아래가 `True 2424`를 출력해야 한다

```bash
.venv/bin/python - <<'EOF'
import embed_images as ei, targets as tg, os
from pathlib import Path
conn = ei.connect(); d = ei.find_dataset(conn, "v1.0-mini")
db = {r[0] for r in ei.pending_files(conn, d, ei.model_key(ei.MODEL_NAME, ei.PRETRAINED), ei.LR_SQUARE_CROP_MEAN, False, True, None, None)}
js = {t.token for t in tg.targets_from_nuscenes(Path(os.environ["NUSCENES_ROOT"]), "v1.0-mini")}
print(db == js, len(js))
EOF
```
(`embedding/`에서 `.env` 값을 넣고 실행. `pending_files`의 인자 순서는 실제 시그니처에 맞춘다)

- [ ] **Step 6: Commit** — `git add embedding/targets.py embedding/test_targets.py && git commit -m "Read embedding targets from nuScenes JSON without a DB"`

---

### Task 2: npz part 저장소

**Files:**
- Create: `embedding/npz_store.py`
- Create: `embedding/testutil.py` — 테스트 공용 헬퍼 `unit(n) -> np.ndarray`(L2 정규화된 float32 n×768)와 `MANIFEST`(아래 `M`). Task 4·5 테스트도 `from testutil import unit, MANIFEST as M`로 쓴다
- Test: `embedding/test_npz_store.py`

**Interfaces:**
- Produces:
  - `FORMAT_VERSION = 1`, `PART_SIZE = 256`
  - `class ManifestMismatch(Exception)`
  - `open_output(out_dir: Path, manifest: dict) -> None` — 폴더가 비어 있으면 `manifest.json`을 쓴다. 이미 있으면 `format_version, dataset, model_name, preprocess, embed_dim`을 비교하고 다르면 `ManifestMismatch`를 낸다(`env`는 비교하지 않음)
  - `read_manifest(out_dir: Path) -> dict`
  - `existing_tokens(out_dir: Path) -> set[str]` — 읽을 수 없는 part는 경고(stderr)만 하고 건너뛴다
  - `write_part(out_dir: Path, tokens: list[str], vectors: np.ndarray) -> Path` — 다음 번호 `part-00001.npz` …로 쓴다. 임시 파일에 먼저 쓰고 `os.replace`로 바꾼다
  - `iter_parts(out_dir: Path) -> Iterator[tuple[Path, np.ndarray, np.ndarray] | tuple[Path, Exception]]` — 정상 part는 `(path, tokens, vectors)`, 깨진 part는 `(path, error)`

- [ ] **Step 1: 실패하는 테스트 작성**

```python
# testutil.py 에 둘 내용
M = {"format_version": 1, "dataset": {"name": "nuScenes", "version": "v1.0-mini"},
     "model_name": "ViT-L-14-quickgelu/openai", "preprocess": "lr-square-crop-mean", "embed_dim": 768, "env": {}}

def unit(n): v = np.random.rand(n, 768).astype(np.float32); return v / np.linalg.norm(v, axis=1, keepdims=True)

# test_npz_store.py
def test_parts_roundtrip_and_resume(tmp_path):
    open_output(tmp_path, M)
    p1 = write_part(tmp_path, ["a", "b"], unit(2)); p2 = write_part(tmp_path, ["c"], unit(1))
    assert (p1.name, p2.name) == ("part-00001.npz", "part-00002.npz")
    assert existing_tokens(tmp_path) == {"a", "b", "c"}
    z = np.load(p1, allow_pickle=False); assert z["tokens"].dtype.kind == "U" and z["vectors"].dtype == np.float32

def test_resume_with_other_preprocess_refused(tmp_path):
    open_output(tmp_path, M)
    with pytest.raises(ManifestMismatch): open_output(tmp_path, {**M, "preprocess": "openclip-eval-224-centercrop"})

def test_resume_with_other_env_allowed(tmp_path):
    open_output(tmp_path, M); open_output(tmp_path, {**M, "env": {"device": "cuda"}})

def test_corrupt_part_is_skipped(tmp_path):
    open_output(tmp_path, M); write_part(tmp_path, ["a"], unit(1))
    (tmp_path / "part-00002.npz").write_bytes(b"truncated")
    assert existing_tokens(tmp_path) == {"a"}
    assert sum(1 for x in iter_parts(tmp_path) if isinstance(x[1], Exception)) == 1
```

- [ ] **Step 2: 실패 확인** — `.venv/bin/python -m pytest embedding/test_npz_store.py -v` → FAIL
- [ ] **Step 3: 구현** — 위 Interfaces대로 만든다. tokens는 `np.asarray(tokens, dtype=str)`로 저장한다
- [ ] **Step 4: 통과 확인** — 4 passed
- [ ] **Step 5: Commit** — `git add embedding/npz_store.py embedding/testutil.py embedding/test_npz_store.py && git commit -m "Add npz part store with manifest and resume"`

---

### Task 3: `embed_images.py`에 입력·출력 모드 연결

**Files:**
- Create: `embedding/db.py` — `embed_images.py`에서 `connect()`, `find_dataset()`, `UPSERT_SQL`, `to_pgvector()`를 옮긴다. `to_pgvector`는 torch 텐서와 numpy를 모두 받게 `.tolist()` 기반으로 바꾼다
- Modify: `embedding/embed_images.py` (`main` 인자 처리, `embed()` 루프)
- Test: `embedding/test_embed_images.py` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1 `targets_from_nuscenes`, Task 2 `open_output / existing_tokens / write_part / PART_SIZE`
- Produces:
  - CLI: `--source {db,nuscenes}`(기본 db), `--sink {db,file}`(기본 db), `--out DIR`
  - `validate_modes(source: str, sink: str, out: str | None, overwrite: bool) -> str | None` — 문제가 없으면 None, 있으면 에러 문구. 허용하는 조합은 `(db, db)`와 `(nuscenes, file)`뿐이다. `sink=file`이면 `--out`이 필수이고, `--overwrite`는 쓸 수 없다("새 --out 폴더를 쓰라")
  - `build_manifest(version: str, preprocess: str, device: str) -> dict` — Task 2의 manifest 형식을 따른다. `env`에는 device, torch, open_clip, python 버전, `platform.platform()`이 들어간다

- [ ] **Step 1: 실패하는 테스트 작성**

```python
@pytest.mark.parametrize("src,sink,out,ow,ok", [
    ("db", "db", None, False, True), ("nuscenes", "file", "/x", False, True),
    ("nuscenes", "db", None, False, False), ("db", "file", "/x", False, False),
    ("nuscenes", "file", None, False, False), ("nuscenes", "file", "/x", True, False)])
def test_validate_modes(src, sink, out, ow, ok):
    assert (ei.validate_modes(src, sink, out, ow) is None) == ok

def test_manifest_fields():
    m = ei.build_manifest("v1.0-mini", ei.LR_SQUARE_CROP_MEAN, "cpu")
    assert m["model_name"] == "ViT-L-14-quickgelu/openai" and m["embed_dim"] == 768 and m["format_version"] == 1
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `validate_modes`가 문구를 돌려주면 `sys.exit(문구)`로 끝낸다. `nuscenes → file` 경로의 동작은 이렇다
  1. `open_output`을 호출한다
  2. `existing_tokens`에 있는 대상은 뺀다
  3. 기존 배치 루프로 벡터를 만들고 `PART_SIZE`만큼 모일 때마다 `write_part`를 호출한다. 끝나면 남은 것도 쓴다
  4. `check_stored`는 그대로 적용한다(저장 0개 + skip 1개 이상이면 exit 1)

  `nuscenes → file` 경로에서는 DB 연결을 하지 않아야 한다. `db → db` 경로는 코드가 옮겨지는 것 말고는 바뀌지 않는다
- [ ] **Step 4: 단위 테스트 통과 확인** — `.venv/bin/python -m pytest embedding -v` → 기존 6개 + 신규 전부 통과
- [ ] **Step 5: 통합 확인 (Mac)**

```bash
OUT=$(mktemp -d)
PGPORT=1 .venv/bin/python embedding/embed_images.py --source nuscenes --sink file --out $OUT --limit 64   # DB 접속 불가 포트여도 성공해야 함
ls $OUT            # manifest.json, part-00001.npz
.venv/bin/python embedding/embed_images.py --source nuscenes --sink file --out $OUT --limit 64   # 이어서: "0 stored", exit 0
.venv/bin/python embedding/embed_images.py --source nuscenes --sink file --out $OUT --preprocess openclip-eval-224-centercrop --limit 1; echo $?   # ManifestMismatch 메시지, 1
NUSCENES_ROOT=/nonexistent .venv/bin/python embedding/embed_images.py --source nuscenes --sink file --out $(mktemp -d); echo $?   # 경로가 들어간 에러, 1
bash scripts/embed.sh --limit 1   # 기존 db→db 경로가 정상인지
```

- [ ] **Step 6: Commit** — `git commit -m "Add --source/--sink file mode to embed_images"`

---

### Task 4: importer (`import_results.py embeddings`)

**Files:**
- Create: `embedding/import_results.py`
- Test: `embedding/test_import_results.py`

**Interfaces:**
- Consumes: Task 2 `read_manifest / iter_parts`, Task 3 `db.connect / db.find_dataset / db.UPSERT_SQL / db.to_pgvector`
- Produces:
  - `validate_manifest(m: dict) -> list[str]` — 필수 키, `format_version == 1`, `embed_dim == 768`, `dataset.name == "nuScenes"`을 확인
  - `validate_part(tokens: np.ndarray, vectors: np.ndarray) -> list[str]` — 1차원 tokens, shape (len, 768), float32, 모두 유한값, norm 1 ± 1e-3, part 안 중복 없음
  - `@dataclass ImportReport: inserted: int, updated: int, unknown: int, rejected_parts: list[str]`
  - `import_embeddings(conn, out_dir: Path, *, dry_run: bool = False) -> ImportReport`
  - CLI: `python embedding/import_results.py embeddings <DIR> [--dry-run]`. `rejected_parts`가 있거나, part가 있는데 inserted + updated == 0이면 exit 1
  - VESPA 라벨용 `labels` 하위 명령은 만들지 않는다(PR 3)

- [ ] **Step 1: 실패하는 테스트 작성 (DB 없이)**

```python
def test_validate_part_ok():           assert validate_part(np.array(["a"]), unit(1)) == []
def test_validate_part_wrong_dim():    assert validate_part(np.array(["a"]), np.ones((1, 512), np.float32))
def test_validate_part_not_unit():     assert validate_part(np.array(["a"]), np.full((1, 768), 0.5, np.float32))
def test_validate_part_nan():          v = unit(1); v[0, 0] = np.nan; assert validate_part(np.array(["a"]), v)
def test_validate_part_duplicate():    assert validate_part(np.array(["a", "a"]), unit(2))
def test_validate_manifest_bad_dim():  assert validate_manifest({**M, "embed_dim": 512})
```
(`unit`과 `M`은 `embedding/testutil.py`에서 import한다)

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
  1. manifest를 검증하고, 실패하면 exit 1
  2. `find_dataset(conn, manifest.dataset.version)`. 없으면 `"Dataset nuScenes <ver> not found — run the catalog import first"`를 내고 exit 1. 여기까지는 아무것도 쓰지 않는다
  3. part마다: 깨졌거나 `validate_part`에 걸리면 `rejected_parts`에 추가하고 넘어간다. 통과하면 `SELECT token FROM sample_data WHERE dataset_id=%s AND token = ANY(%s)`로 모르는 token을 걸러낸다. `SELECT sample_data_token FROM image_embedding WHERE dataset_id=%s AND model_name=%s AND preprocess=%s AND sample_data_token = ANY(%s)`로 inserted/updated를 나눈다. `--dry-run`이 아니면 upsert한 뒤 part 단위로 commit한다
  4. 요약 한 줄과 거부·모르는 token 예시(최대 5개)를 출력한다
- [ ] **Step 4: 단위 테스트 통과 확인** → passed
- [ ] **Step 5: 통합 확인 (Mac, Docker DB)** — Task 3에서 만든 `$OUT`(B, 64장)을 쓴다

```bash
.venv/bin/python embedding/import_results.py embeddings $OUT --dry-run   # inserted 0, updated 64, unknown 0 (B가 이미 있으므로)
# DB 벡터를 백업한 뒤 실제 import → updated 64. 다시 실행해도 updated 64, 총 행 수 4,848 그대로
# 기존 벡터와의 코사인 최솟값 >= 0.9999 확인 후 필요하면 백업으로 복원
# 모르는 token: 가짜 token 1개가 든 part를 만들어 import → unknown 1, exit 0
# 깨진 part: part-00099.npz에 쓰레기 바이트를 쓰면 rejected 1, exit 1
# 없는 dataset: manifest의 version을 v9.9-none으로 바꾼 사본 → 안내 메시지, exit 1, image_embedding 행 수 변화 없음
```

- [ ] **Step 6: Commit** — `git commit -m "Add import_results.py for npz embedding parts"`

---

### Task 5: 기준 벡터로 환경 일치 확인

**Files:**
- Create: `embedding/make_reference.py` (1회용: DB의 B 벡터에서 기준 파일 생성)
- Create: `embedding/fixtures/reference.npz`
- Modify: `embedding/embed_images.py` (`--check-reference PATH`), `.gitignore` (`!embedding/fixtures/*.npz`)
- Test: `embedding/test_embed_images.py`

**Interfaces:**
- 기준 세트: **scene마다 첫 키프레임 sample의 카메라 6장 = 60장**(10 scene, 낮과 밤, 6채널을 모두 포함). 스펙의 "64장"은 이걸로 바꾼다
- `reference.npz` 내용: `tokens`(U), `relative_paths`(U), `vectors`(float32 60×768), `meta`(JSON 문자열: model_name, preprocess, 생성 env)
- `min_cosine(a: np.ndarray, b: np.ndarray) -> float` (행끼리 비교)
- `REFERENCE_MIN_COSINE = 0.9999`
- `--check-reference PATH`: DB 없이 `NUSCENES_ROOT`의 `relative_paths` 이미지를 meta의 preprocess로 다시 계산한다. `min cos`를 출력하고, 임계값 미만이면 exit 1

- [ ] **Step 1: 실패하는 테스트 작성**

```python
def test_min_cosine_identical():  v = unit(3); assert ei.min_cosine(v, v) == pytest.approx(1.0, abs=1e-6)
def test_min_cosine_detects_drift():
    v = unit(3); w = v.copy(); w[1] = unit(1)[0]; assert ei.min_cosine(v, w) < ei.REFERENCE_MIN_COSINE
```

- [ ] **Step 2: 실패 확인 → Step 3: `min_cosine`, `--check-reference`, `make_reference.py` 구현 → Step 4: 통과 확인**
- [ ] **Step 5: 기준 파일 생성 및 확인 (Mac)**

```bash
.venv/bin/python embedding/make_reference.py --out embedding/fixtures/reference.npz      # 60 rows, 약 200KB
.venv/bin/python embedding/embed_images.py --check-reference embedding/fixtures/reference.npz --device mps   # min cos >= 0.9999, exit 0
.venv/bin/python embedding/embed_images.py --check-reference embedding/fixtures/reference.npz --device cpu   # exit 0
git check-ignore embedding/fixtures/reference.npz; echo $?   # 1 (= 커밋 대상)
```

- [ ] **Step 6: Commit** — `git commit -m "Add reference vectors and --check-reference for cross-environment checks"`

---

### Task 6: Colab 실행 문서와 최종 검증

**Files:**
- Modify: `README.md` (임베딩 절 아래에 "Colab/외부 GPU에서 실행" 소절 추가), `embedding/requirements.txt` (numpy 버전 고정), 프로젝트 기획서는 사용자 쪽에서 갱신

- [ ] **Step 1: README에 Colab 셀 순서 작성**
  1. Drive 마운트
  2. `tar -xzf /content/drive/MyDrive/nuscenes/v1.0-mini.tgz -C /content/nuscenes` (Drive에서 바로 읽지 말 것)
  3. 레포 clone(브랜치 지정)
  4. `pip install -r embedding/requirements.txt`
  5. `export NUSCENES_ROOT=/content/nuscenes`
  6. `python embedding/embed_images.py --check-reference embedding/fixtures/reference.npz` (실패하면 중단)
  7. `python embedding/embed_images.py --source nuscenes --sink file --out /content/drive/MyDrive/nuscenes/embeddings/<날짜>-lr`
  8. DB 쪽에서 `python embedding/import_results.py embeddings <폴더>`

  끊기면 7번을 같은 `--out`으로 다시 실행하면 이어서 처리한다는 점도 적는다
- [ ] **Step 2: 최종 검증** — `.venv/bin/python -m pytest embedding -v`(전부 통과), `bash scripts/docker-test.sh`(6/6), `git status` 깨끗, `git diff --stat feature/clip-embedding`에 Global Constraints 위반(혁수 스크립트, Java 변경)이 없는지 확인
- [ ] **Step 3: Commit** — `git commit -m "Document Colab/external GPU workflow"`
- [ ] **Step 4: 결과 보고** — 커밋 목록, 테스트 결과, Task 3·4·5 통합 확인 출력, PR 2 본문 초안(`Claude outputs/PR-embedding-file-mode.md`). 푸시는 하지 않는다
