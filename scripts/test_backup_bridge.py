"""Mandatory Linux tests, actual flock/peer credentials; no production access."""
import multiprocessing
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import json
import hashlib
import platform
import subprocess
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent / 'backup'))
import bridge
import docker_broker as broker


def hold(paths, ready, finish):
    with bridge.locked(paths):
        ready.set()
        finish.wait(10)


class BridgeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='culinote-bridge-boundary-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backup = self.root / 'backup.lock'
        self.upload = self.root / 'upload.lock'
        for p in [self.backup, self.upload]:
            p.touch(mode=0o600)

    def test_backup_and_transition_cannot_overlap(self):
        for paths in [[self.backup], [self.upload]]:
            ready, finish = multiprocessing.Event(), multiprocessing.Event()
            worker = multiprocessing.Process(target=hold, args=(paths, ready, finish))
            worker.start()
            try:
                self.assertTrue(ready.wait(5))
                with self.assertRaises(BlockingIOError):
                    with bridge.locked([self.backup, self.upload]):
                        self.fail('transition entered while active')
            finally:
                finish.set()
                worker.join(5)
                if worker.is_alive():
                    worker.terminate()
                    worker.join()
        with bridge.locked([self.backup, self.upload]):
            pass

    def test_interruption_releases_locks_without_a_complete_marker(self):
        ready, finish = multiprocessing.Event(), multiprocessing.Event()
        worker = multiprocessing.Process(target=hold, args=([self.backup], ready, finish))
        worker.start()
        self.assertTrue(ready.wait(5))
        worker.terminate()
        worker.join(5)
        with bridge.locked([self.backup, self.upload]):
            self.assertFalse((self.root / 'COMPLETE').exists())

    def test_missing_world_accessible_and_symlink_locks_are_rejected(self):
        for p in [self.root / 'absent', self.root / 'link']:
            if p.name == 'link':
                p.symlink_to(self.backup)
            with self.assertRaises(OSError):
                with bridge.locked([p]):
                    pass
        self.backup.chmod(0o606)
        with self.assertRaises(ValueError):
            with bridge.locked([self.backup]):
                pass

    def test_wrong_peer_uid_is_rejected_before_any_docker_operation(self):
        server, client = socket.socketpair()
        with patch.object(broker, 'identities') as inspect:
            worker = threading.Thread(target=broker.serve_request, args=(server, {'runner_uid': os.getuid() + 1}))
            worker.start()
            self.assertIn(b'"code":1', client.recv(256))
            worker.join(5)
            inspect.assert_not_called()
        client.close()

    def test_runner_refuses_root_and_insecure_credentials(self):
        with patch.object(os, 'geteuid', return_value=0), self.assertRaisesRegex(ValueError, 'NONROOT'):
            bridge.execute({}, 'capture')
        p = self.root / 'synthetic-credential'
        p.write_text('synthetic-only')
        p.chmod(0o644)
        with self.assertRaises(ValueError):
            broker.private_file(p)

    def test_interrupted_capture_stops_real_child_group_and_never_publishes_complete(self):
        # Lifecycle-only executable fixture, not evidence of the pinned Node runtime.
        source, environment, daily = [self.root / n for n in ['source', 'environment', 'daily']]
        for p in [source, environment, daily]:
            p.mkdir(mode=0o700)
        deps = environment / 'node_modules/tsx/dist'
        deps.mkdir(parents=True)
        (deps / 'cli.mjs').write_text('synthetic lifecycle fixture')
        (source / '.gitignore').write_text('/node_modules\n')
        (source / 'package-lock.json').write_text('{}')
        def git(*args):
            return subprocess.check_output(['git', '-C', str(source), *args], text=True, stderr=subprocess.DEVNULL).strip()
        git('init'); git('add', '.')
        git('-c', 'user.name=Synthetic', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic lifecycle fixture')
        sha = git('rev-parse', 'HEAD')
        (source / 'node_modules').symlink_to(environment / 'node_modules')
        ready = self.root / 'ready.sock'
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as listener:
            listener.bind(str(ready)); listener.settimeout(15)
            node = environment / 'node'
            node.write_text("#!/usr/bin/python3\nimport sys,os,signal,socket,json\nfrom pathlib import Path\nif sys.argv[1:] == ['--version']:\n print('v24.20.0');sys.exit(0)\np=Path(sys.argv[sys.argv.index('--directory')+1]);p.mkdir(mode=0o700)\nf=p/'recipes.dump';f.write_text('synthetic partial');f.chmod(0o600)\ns=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM);s.sendto(json.dumps({'pid':os.getpid()}).encode()," + repr(str(ready)) + ")\nsignal.pause()\n")
            node.chmod(0o700)
            attestation = environment / 'environment.json'
            attestation.write_text(json.dumps({'format': 1, 'platform': 'linux', 'arch': {'x86_64': 'x64', 'aarch64': 'arm64'}[platform.machine()], 'nodeSha256': bridge.file_digest(node), 'lockfileSha256': bridge.file_digest(source / 'package-lock.json'), 'dependenciesSha256': bridge.dependency_digest(environment / 'node_modules')}))
            attestation.chmod(0o600)
            policy, credential = self.root / 'policy', self.root / 'credential'
            policy.write_text('{}'); policy.chmod(0o600)
            credential.write_text('postgresql://fixture_reader:synthetic@127.0.0.1/fixture_db'); credential.chmod(0o600)
            config = {'format': 1, 'source': str(source), 'environment': str(environment), 'environment_manifest_sha256': bridge.file_digest(attestation), 'policy': str(policy), 'tool_sha': sha, 'runtime_sha': 'a' * 40, 'inventory_version': 'v0.1', 'database': 'fixture_db', 'database_user': 'fixture_reader', 'database_credential': str(credential), 'app_container': 'fixture-app', 'pg_container': 'fixture-pg', 'media': str(self.root), 'destination_root': str(daily), 'backup_lock': str(self.backup), 'broker_socket': str(self.root / 'unused.sock'), 'broker_uid': os.getuid(), 'minimum_free_bytes': 10 * 1024**3}
            config_file = self.root / 'config.json'; config_file.write_text(json.dumps(config)); config_file.chmod(0o600)
            launcher = "import sys;sys.path.insert(0,sys.argv[1]);import bridge;from unittest.mock import patch;from types import SimpleNamespace\ntry:\n with patch('bridge.shutil.disk_usage',return_value=SimpleNamespace(free=20*1024**3)):\n  bridge.execute(bridge.configuration(sys.argv[2]),'capture','20260101T000000Z-00000001')\nexcept Exception as e:\n print(type(e).__name__+':'+(str(e) if isinstance(e,ValueError) else 'DETAILS_SUPPRESSED'),file=sys.stderr);sys.exit(1)"
            child = subprocess.Popen(['python3', '-B', '-c', launcher, str(Path(bridge.__file__).parent), str(config_file)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                try:
                    pid = json.loads(listener.recv(256))['pid']
                except TimeoutError:
                    if child.poll() is not None:
                        self.fail('Lifecycle fixture exited: ' + child.stderr.read().decode())
                    raise
                self.assertTrue((daily / '20260101T000000Z-00000001/recipes.dump').exists())
                child.terminate(); self.assertNotEqual(child.wait(timeout=10), 0)
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                self.assertFalse((daily / '20260101T000000Z-00000001/COMPLETE').exists())
                with bridge.locked([self.backup, self.upload]):
                    pass
            finally:
                if child.poll() is None:
                    child.kill(); child.wait()
                child.stderr.close()


if __name__ == '__main__':
    unittest.main()
