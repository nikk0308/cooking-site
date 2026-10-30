"""Prepared offsite gate only: no S3, Docker, production paths or identities."""
import ast
import os
from pathlib import Path
import subprocess
import tempfile
import json
import hashlib
import re
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class BackupGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="culinote-gate-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ("scripts/backup/cli.ts", "node_modules/tsx/dist/cli.mjs"):
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("fixture")
        source = Path(__file__).with_name("culinote_offsite.py")
        tree = ast.parse(source.read_text())
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "versioned_local_contract"]
        scope = {"os": os, "re": re, "Path": Path, "subprocess": subprocess, "GateError": RuntimeError, "STATE": self.root, "read_json": lambda p: json.loads(Path(p).read_text()), "sha": lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), scope)
        self.check = scope["versioned_local_contract"]
        self.scope = scope

    def test_legacy_remains_compatible_without_activation(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(subprocess, "run") as run:
            self.check(self.root, {}, "a" * 40)
            run.assert_not_called()

    def test_v02_cannot_fall_back_to_legacy_inventory(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "POLICY_REQUIRED"):
                self.check(self.root, {"inventory_version": "v0.2"}, "a" * 40)

    def test_activated_gate_uses_exact_runtime_and_fails_closed(self):
        env = {"CULINOTE_BACKUP_RELEASE_POLICY": str(self.root / "policy.json"), "CULINOTE_BACKUP_RELEASE_SOURCE": str(self.root)}
        with patch.dict(os.environ, env, clear=True), patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.check(self.root, {"inventory_version": "v0.2"}, "a" * 40)
            self.assertEqual(run.call_args.args[0][-1], "a" * 40)
            self.assertEqual(run.call_args.kwargs["stdout"], subprocess.DEVNULL)
        with patch.dict(os.environ, env, clear=True), patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
            with self.assertRaisesRegex(RuntimeError, "CONTRACT_FAILED"):
                self.check(self.root, {"inventory_version": "v0.2"}, "a" * 40)

    def test_missing_validator_blocks(self):
        env = {"CULINOTE_BACKUP_RELEASE_POLICY": "fixture.json", "CULINOTE_BACKUP_RELEASE_SOURCE": str(self.root / "absent")}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(RuntimeError, "VALIDATOR_MISSING"):
                self.check(self.root, {"inventory_version": "v0.2"}, "a" * 40)

    def test_explicit_source_or_required_flag_never_falls_back(self):
        for env in [{"CULINOTE_BACKUP_RELEASE_SOURCE": str(self.root)}, {"CULINOTE_BACKUP_BRIDGE_REQUIRED": "1"}]:
            with patch.dict(os.environ, env, clear=True), self.assertRaisesRegex(RuntimeError, "POLICY_REQUIRED"):
                self.check(self.root, {}, "a" * 40)

    def test_persistent_activation_blocks_legacy_even_when_environment_is_removed(self):
        (self.root / 'backup-bridge-required.json').write_text('{"format":1}')
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, 'POLICY_REQUIRED'):
            self.check(self.root, {}, 'a' * 40)

    def test_activation_binds_policy_proof_and_tool_and_rejects_legacy(self):
        point = '20261027T155249Z-012c8349-1a6e2ddc5110'
        policy = self.root / 'policy.json'
        policy.write_text(json.dumps({'toolSha': 'a' * 40, 'protectedRecoverySnapshot': point}))
        receipt = {'format': 1, 'tool_sha': 'a' * 40, 'policy_sha256': hashlib.sha256(policy.read_bytes()).hexdigest(), 'protected_snapshot': point}
        (self.root / 'backup-bridge-required.json').write_text(json.dumps(receipt))
        (self.root / 'remote-restore-proof.json').write_text(json.dumps({'snapshot': point}))
        env = {'CULINOTE_BACKUP_RELEASE_POLICY': str(policy), 'CULINOTE_BACKUP_RELEASE_SOURCE': str(self.root), 'CULINOTE_BACKUP_NODE': str(self.root / 'node')}
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'ACTIVATED_BRIDGE_CONTRACT_REQUIRED'):
                self.check(self.root, {}, 'a' * 40)
            with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                self.check(self.root, {'inventory_version': 'v0.2', 'backup_tool_sha': 'a' * 40}, 'a' * 40)
            policy.write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'ACTIVATION_BINDING'):
                self.check(self.root, {'inventory_version': 'v0.2'}, 'a' * 40)

    def test_invalid_snapshot_cannot_reach_encryption_upload_or_gc(self):
        from unittest.mock import Mock
        tree = ast.parse(Path(__file__).with_name('culinote_offsite.py').read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        prepare, publish, gc = Mock(), Mock(), Mock()
        self.scope.update({'load_config': lambda: {}, 'client': Mock(), 'probe': Mock(),
                           'fcntl': SimpleNamespace(LOCK_EX=2, LOCK_NB=4, flock=Mock()),
                           'prepare': prepare, 'publish': publish, 'run_gc': gc})
        def latest():
            self.check(self.root, {'inventory_version': 'v0.2'}, 'a' * 40)
            return self.root, {}
        self.scope['latest_local'] = latest
        exec(compile(ast.Module(body=[main], type_ignores=[]), '<isolated-upload>', 'exec'), self.scope)
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, 'POLICY_REQUIRED'):
            self.scope['main']('upload')
        for stage in [prepare, publish, gc]:
            stage.assert_not_called()

    def test_missing_node_executable_fails_closed(self):
        env = {'CULINOTE_BACKUP_RELEASE_POLICY': 'fixture.json', 'CULINOTE_BACKUP_RELEASE_SOURCE': str(self.root)}
        with patch.dict(os.environ, env, clear=True), patch.object(subprocess, 'run', side_effect=FileNotFoundError()), self.assertRaisesRegex(RuntimeError, 'RUNTIME_UNAVAILABLE'):
            self.check(self.root, {'inventory_version': 'v0.2'}, 'a' * 40)


if __name__ == "__main__":
    unittest.main()
