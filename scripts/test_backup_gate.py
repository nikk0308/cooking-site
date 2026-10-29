"""Prepared offsite gate only: no S3, Docker, production paths or identities."""
import ast
import os
from pathlib import Path
import subprocess
import tempfile
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
        scope = {"os": os, "Path": Path, "subprocess": subprocess, "GateError": RuntimeError}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), scope)
        self.check = scope["versioned_local_contract"]

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


if __name__ == "__main__":
    unittest.main()
