"""VESPA_EXECUTOR=ssh against a fake ssh + fake Slurm (sbatch/squeue/sacct/scancel) running locally."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.vespa_service import VespaService, VespaError
from schemas.auto_label import AutoLabelRequest

FAKE_SSH = """#!/usr/bin/env bash
[ "${TEST_SSH_MODE:-ok}" = down ] && { echo "ssh: connect to host fake-host: Connection refused" >&2; exit 255; }
echo "$@" >> "$TEST_SLURM_STATE/ssh_args"
for last; do :; done
exec bash -c "$last"
"""
FAKE_SBATCH = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
mode = os.environ.get('TEST_SLURM_MODE', 'ok')
if mode == 'fail-submit':
    print('sbatch: error: invalid partition', file=sys.stderr); sys.exit(1)
assert sys.argv[1] == '--parsable' and sys.argv[2] == 'pseudo_scenes_lowmem.sh', sys.argv
Path('logs').mkdir(exist_ok=True)
Path('logs/slurm-4242.out').write_text('fake slurm log\\n')
Path(os.environ['TEST_SLURM_STATE'], 'submitted').write_text(os.environ['EXP'] + ' ' + os.environ['SCENES'])
if mode in ('ok', 'purged', 'controller-down'):
    exp, scene = os.environ['EXP'], os.environ['SCENES']
    out = Path(f'outs/vlm/{exp}/#out_labels_scene/{scene}'); out.mkdir(parents=True, exist_ok=True)
    for mapping, cls in [('1class', 'vehicle'), ('3class', 'pedestrian'), ('8class', 'car')]:
        box = {'sample_token': 'sample-a', 'translation': [1, 2, 3], 'size': [2, 4, 1], 'rotation': [1, 0, 0, 0],
               'velocity': [0, 0], 'detection_name': cls, 'detection_score': 1.0, 'attribute_name': ''}
        payload = {'split': 'mini_train', 'mapping_name': mapping,
                   'meta': {'use_camera': True, 'use_lidar': True, 'use_radar': False, 'use_map': False, 'use_external': False},
                   'results': {'sample-a': [box], 'sample-empty': []}}
        (out / f'vlm_{exp}_{scene}_{mapping}.json').write_text(json.dumps(payload, indent=2))
print('4242;cluster')
"""
FAKE_SQUEUE = """#!/usr/bin/env bash
state="$TEST_SLURM_STATE/squeue_calls"
n=$(( $(cat "$state" 2>/dev/null || echo 0) + 1 )); echo $n > "$state"
mode="${TEST_SLURM_MODE:-ok}"
if [ "$mode" = never ]; then echo RUNNING; exit 0; fi
if [ "$mode" = controller-down ] && [ $n -le 2 ]; then echo "slurm_load_jobs error: Unable to contact slurm controller" >&2; exit 1; fi
if [ "$mode" = controller-dead ]; then echo "slurm_load_jobs error: Unable to contact slurm controller" >&2; exit 1; fi
case $n in 1) echo PENDING ;; 2) echo RUNNING ;; 3|4) ;; *) if [ "$mode" = purged ]; then echo "slurm_load_jobs error: Invalid job id specified" >&2; exit 1; fi ;; esac
"""
FAKE_SACCT = "#!/usr/bin/env bash\necho COMPLETED\n"
FAKE_SCANCEL = '#!/usr/bin/env bash\necho "$1" > "$TEST_SLURM_STATE/cancelled"\n'


def _script(path, body):
    path.write_text(body); path.chmod(0o755)


@pytest.fixture
def ssh_service(tmp_path, monkeypatch):
    bin_dir = tmp_path / 'bin'; bin_dir.mkdir()
    for name, body in [('ssh', FAKE_SSH), ('sbatch', FAKE_SBATCH), ('squeue', FAKE_SQUEUE),
                       ('sacct', FAKE_SACCT), ('scancel', FAKE_SCANCEL)]:
        _script(bin_dir / name, body)
    state = tmp_path / 'slurm-state'; state.mkdir()
    remote = tmp_path / 'remote VESPA'; remote.mkdir()  # space checks shell quoting
    data = tmp_path / 'data/v1.0-mini'; data.mkdir(parents=True)
    (data / 'scene.json').write_text(json.dumps([{'name': 'scene-0061', 'token': 'scene-token'}]))
    (data / 'sample.json').write_text(json.dumps([{'token': t, 'scene_token': 'scene-token'} for t in ['sample-a', 'sample-empty']]))
    monkeypatch.setenv('PATH', f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv('TEST_SLURM_STATE', str(state))
    for key, value in {'VESPA_EXECUTOR': 'ssh', 'VESPA_SSH_BIN': bin_dir / 'ssh', 'VESPA_SSH_TARGET': 'fake-host',
                       'VESPA_SSH_REMOTE_ROOT': remote, 'VESPA_SSH_POLL_SECONDS': '0',
                       'VESPA_DATA_ROOT': data.parent, 'VESPA_DATASET_VERSION': 'v1.0-mini',
                       'VESPA_OUTPUT_ROOT': tmp_path / 'runs', 'VESPA_TIMEOUT_SECONDS': '60'}.items():
        monkeypatch.setenv(key, str(value))
    for key in ('VESPA_SSH_PORT', 'VESPA_SSH_KEY', 'VESPA_SSH_KNOWN_HOSTS', 'VESPA_ROOT', 'VESPA_PYTHON'):
        monkeypatch.delenv(key, raising=False)
    service = VespaService()
    service.remote, service.state = remote, state
    return service


def _lock_free(service):
    assert service.lock.acquire(blocking=False)
    service.lock.release()


@pytest.mark.parametrize('mode', [1, 3, 8])
def test_ssh_success(ssh_service, mode):
    assert ssh_service.executor == 'ssh' and ssh_service.configured()
    result = ssh_service.generate(AutoLabelRequest(scene_name='scene-0061', class_mode=mode))
    assert result.mapping_name == f'{mode}class'
    assert result.results['sample-empty'] == []
    assert len(result.result_checksum) == 64
    copied = ssh_service.output_root / result.artifact_path
    assert copied.is_file()
    assert result.artifact_path.endswith(f'#out_labels_scene/scene-0061/vlm_p_final_scene-0061_{mode}class.json')
    assert (ssh_service.state / 'submitted').read_text() == 'p_final scene-0061'
    log = (copied.parents[5] / 'execution.log').read_text()
    assert 'slurm job 4242 submitted' in log and 'PENDING' in log and 'RUNNING' in log
    assert 'sacct: COMPLETED' in log and 'fake slurm log' in log
    assert not (ssh_service.state / 'cancelled').exists()
    _lock_free(ssh_service)


@pytest.mark.parametrize('slurm_mode', ['purged', 'controller-down'])
def test_ssh_squeue_edge_cases(ssh_service, monkeypatch, slurm_mode):
    # purged: finished job reported as "Invalid job id"; controller-down: transient errors are retried, not "finished".
    monkeypatch.setenv('TEST_SLURM_MODE', slurm_mode)
    result = ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert result.results['sample-a'][0].detection_name == 'car'
    log = next(ssh_service.output_root.glob('*/execution.log')).read_text()
    assert ('Unable to contact' in log) == (slurm_mode == 'controller-down')


def test_ssh_controller_unavailable(ssh_service, monkeypatch):
    monkeypatch.setenv('TEST_SLURM_MODE', 'controller-dead')
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert caught.value.code == 'VESPA_REMOTE_UNREACHABLE'
    _lock_free(ssh_service)


def test_ssh_rerun_needs_new_output(ssh_service, monkeypatch):
    first = ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert first.results['sample-a'][0].detection_name == 'car'
    # Same path still holds the previous run's file, but the job wrote nothing new: must not be reused.
    monkeypatch.setenv('TEST_SLURM_MODE', 'no-output')
    (ssh_service.state / 'squeue_calls').unlink()
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert caught.value.code == 'VESPA_EXECUTION_FAILED' and caught.value.status_code == 502
    _lock_free(ssh_service)


@pytest.mark.parametrize('slurm_mode,ssh_mode,status,code', [
    ('no-output', 'ok', 502, 'VESPA_EXECUTION_FAILED'),
    ('fail-submit', 'ok', 503, 'VESPA_LAUNCH_FAILED'),
    ('ok', 'down', 503, 'VESPA_LAUNCH_FAILED'),
])
def test_ssh_errors(ssh_service, monkeypatch, slurm_mode, ssh_mode, status, code):
    monkeypatch.setenv('TEST_SLURM_MODE', slurm_mode)
    monkeypatch.setenv('TEST_SSH_MODE', ssh_mode)
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert (caught.value.status_code, caught.value.code) == (status, code)
    _lock_free(ssh_service)


def test_ssh_timeout_cancels_job(ssh_service, monkeypatch):
    monkeypatch.setenv('TEST_SLURM_MODE', 'never')
    ssh_service.timeout = 0
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert caught.value.code == 'VESPA_TIMEOUT' and caught.value.status_code == 504
    assert (ssh_service.state / 'cancelled').read_text().strip() == '4242'
    _lock_free(ssh_service)


def test_ssh_lost_contact_while_running(ssh_service, monkeypatch):
    import services.vespa_service as module
    real = ssh_service._ssh
    def flaky(command, log, keep_output=False):
        if 'squeue' in command:
            return module.SSH_UNREACHABLE, ''
        return real(command, log, keep_output)
    monkeypatch.setattr(ssh_service, '_ssh', flaky)
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert caught.value.code == 'VESPA_REMOTE_UNREACHABLE'
    _lock_free(ssh_service)


def test_ssh_not_configured_and_unknown_scene(ssh_service):
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-9999'))
    assert caught.value.status_code == 404
    ssh_service.ssh_target = ''
    assert not ssh_service.configured()
    with pytest.raises(VespaError) as caught:
        ssh_service.generate(AutoLabelRequest(scene_name='scene-0061'))
    assert caught.value.code == 'VESPA_NOT_CONFIGURED'
    assert not (ssh_service.state / 'submitted').exists()
    ssh_service.ssh_target = 'fake-host'
    ssh_service.ssh_key = '/no/such/key'
    assert not ssh_service.configured()


def test_ssh_command_options(ssh_service, tmp_path):
    key, known = tmp_path / 'id_ed25519', tmp_path / 'known_hosts'
    key.write_text('k'); known.write_text('h')
    ssh_service.ssh_port, ssh_service.ssh_key, ssh_service.ssh_known_hosts = '2222', str(key), str(known)
    assert ssh_service.configured()
    command = ssh_service._ssh_command('hostname')
    assert command[0] == ssh_service.ssh_bin and command[-2:] == ['fake-host', 'hostname']
    joined = ' '.join(command)
    for part in ['BatchMode=yes', '-p 2222', f'-i {key}', 'IdentitiesOnly=yes',
                 f'UserKnownHostsFile={known}', 'StrictHostKeyChecking=yes']:
        assert part in joined


@pytest.mark.parametrize('name,value', [('VESPA_EXECUTOR', 'slurm'), ('VESPA_SSH_PORT', '22; rm'), ('VESPA_SSH_POLL_SECONDS', '-1')])
def test_invalid_settings(ssh_service, monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        VespaService()


def test_health_reports_executor(ssh_service):
    from main import app
    import clip_core
    with patch.object(clip_core, 'load_model', return_value=(object(), None, None)):
        with TestClient(app) as client:
            app.state.vespa_service = ssh_service
            inference = client.get('/health').json()['inference']
            assert inference['vespa'] == 'configured' and inference['vespa_executor'] == 'ssh'
