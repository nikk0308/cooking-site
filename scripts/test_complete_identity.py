"""Offline regressions: execute production functions with disposable S3/state only."""
import ast
import copy
import contextlib
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import sys
import types
import unittest
from unittest.mock import patch

import offsite_retention as retention
from test_offsite_retention import FakeS3


def production():
    tree = ast.parse(Path(__file__).with_name("culinote_offsite.py").read_text())
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef)
             or isinstance(node, ast.ClassDef) and node.name == "GateError"]
    module = types.ModuleType("complete_identity_fixture")
    sys.modules[module.__name__] = module
    scope = module.__dict__
    scope.update(contextlib=contextlib, sys=sys, retention=retention, json=json, re=re, hashlib=hashlib,
                 datetime=datetime, APP="culinote-backup-v1", BUCKET=retention.BUCKET,
                 ORIGIN="https://offline.invalid", Path=Path)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "culinote_offsite.py", "exec"), scope)
    return scope


class Store(FakeS3):
    def __init__(self):
        super().__init__()
        self.puts = []

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, **kwargs):
        self.puts.append(kwargs["Key"])
        return super().put_object(**kwargs)


class CompleteIdentity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.api = production()
        self.store = Store()
        self.sid = "20261103T024026Z-2b8aee04-1a6e2ddc5110"
        self.key = f"culinote/daily/{self.sid}/COMPLETE"
        self.marker = dict(application="culinote-backup-v1", format=1, snapshot=self.sid,
                           source_sha="a" * 40, backup_created_utc="2026-11-03T02:40:26+00:00",
                           recipient_fingerprint="b" * 64, local_manifest_sha256="c" * 64,
                           verification="ciphertext-size-and-full-download-sha256",
                           private_identity_on_server=False, objects={})
        for name in ("database.encrypted", "media.encrypted", "manifest.encrypted"):
            key = f"culinote/blobs/{self.sid}/{name}"
            self.marker["objects"][name] = dict(key=key, bytes=1, sha256=hashlib.sha256(b"x").hexdigest())
            self.store.objects[key] = b"x"
        self.store.objects[self.key] = json.dumps(self.marker).encode()
        for key in retention.period_keys(self.marker):
            self.store.objects[key] = json.dumps(self.marker).encode()
        self.receipt = dict(snapshot=self.sid, complete_key=self.key,
                            backup_created_utc=self.marker["backup_created_utc"],
                            verified_utc="2026-11-03T03:00:00+00:00",
                            marker_sha256=retention.marker_digest(self.marker))
        (self.root / "last-success.json").write_text(json.dumps(self.receipt))
        (self.root / "protected-state.json").write_text('{"protected":"untouched"}')
        self.api.update(STATE=self.root, now=lambda: datetime.datetime.fromisoformat("2026-11-03T04:00:00+00:00"),
                        load_config=lambda: {"deletion_enabled": False}, client=lambda: self.store,
                        object_exists=lambda store, key: store.objects.get(key), anonymous_denied=lambda _: True)

    def state(self):
        return (copy.deepcopy(self.store.objects),
                {p.name: p.read_bytes() for p in self.root.iterdir()},
                list(self.store.puts), list(self.store.deletes))

    def reject(self, code, call):
        before = self.state()
        with self.assertRaisesRegex(Exception, "^" + code + "$"):
            call()
        self.assertEqual(before, self.state(), "rejection mutated inventory/ACK/protected state or PUT/DELETE")

    def test_python_equality_is_not_identity(self):
        for value in (True, 1.0):
            other = dict(self.marker, format=value)
            self.assertEqual(other, self.marker)  # Reproduces the original defect.
            self.assertFalse(retention.same_marker(other, self.marker))
        self.assertEqual(len({retention.marker_digest({"format": x}) for x in (True, 1, 1.0)}), 3)

    def test_format_and_nested_size_require_actual_integers(self):
        for value in (True, False, 1.0, "1", None):
            with self.subTest(format=value):
                bad = dict(self.marker, format=value)
                self.reject("INVALID_REMOTE_MARKER_FORMAT", lambda: self.api["validate_marker"](bad))
            with self.subTest(size=value):
                bad = copy.deepcopy(self.marker)
                bad["objects"]["media.encrypted"]["bytes"] = value
                self.reject("INVALID_REMOTE_OBJECT_SIZE", lambda: self.api["validate_marker"](bad))

    def test_legacy_integer_marker_and_reordering_remain_valid(self):
        reordered = dict(reversed(list(self.marker.items())))
        self.assertIs(self.api["validate_marker"](reordered), reordered)
        self.assertTrue(retention.same_marker(self.marker, reordered))
        before = self.state()
        self.assertEqual(self.api["publish"](self.store, self.root, reordered), self.key)
        self.api["watchdog"]()
        self.assertEqual(before, self.state())

    def test_new_publication_preserves_existing_ack_and_ciphertext(self):
        for key in (self.key, *retention.period_keys(self.marker)):
            del self.store.objects[key]
        before_files = {p.name: p.read_bytes() for p in self.root.iterdir()}
        before_blobs = dict(self.store.objects)
        self.assertEqual(self.api["publish"](self.store, self.root, self.marker), self.key)
        self.assertEqual(set(self.store.puts), {self.key, *retention.period_keys(self.marker)})
        self.assertFalse(self.store.deletes)
        self.assertEqual({k: self.store.objects[k] for k in before_blobs}, before_blobs)
        self.assertEqual(before_files, {p.name: p.read_bytes() for p in self.root.iterdir()})
        self.api["watchdog"]()

    def test_retention_checks_receipt_binding(self):
        inventory, markers, snapshots = retention.catalog(types.SimpleNamespace(
            BUCKET=retention.BUCKET, validate_marker=self.api["validate_marker"],
            get_marker=self.api["get_marker"], verify_object=self.api["verify_object"]), self.store)
        receipt = dict(self.receipt, marker_sha256="0" * 64)
        proof = dict(snapshot=self.sid, status="PASS", local_pipeline_test=False)
        self.reject("RETENTION_LAST_SUCCESS_IDENTITY_MISMATCH",
                    lambda: retention._plan(inventory, markers, snapshots, proof, receipt))

    def test_publish_conflicts_before_any_put(self):
        for key in (self.key, *retention.period_keys(self.marker)):
            for value, code in ((True, "INVALID_REMOTE_MARKER_FORMAT"),
                                (1.0, "INVALID_REMOTE_MARKER_FORMAT"),
                                (2, "INVALID_REMOTE_MARKER_FORMAT")):
                with self.subTest(key=key, value=value):
                    original = self.store.objects[key]
                    self.store.objects[key] = json.dumps(dict(self.marker, format=value)).encode()
                    self.reject(code, lambda: self.api["publish"](self.store, self.root, self.marker))
                    self.store.objects[key] = original
        self.store.objects[self.key] = json.dumps(dict(self.marker, extension=True)).encode()
        self.reject("IMMUTABLE_REMOTE_POINT_CONFLICT", lambda: self.api["publish"](self.store, self.root, self.marker))

    def test_watchdog_binds_new_receipt_and_period_identity(self):
        self.store.objects[self.key] = json.dumps(dict(self.marker, extension=1)).encode()
        self.reject("REMOTE_COMPLETE_IDENTITY_MISMATCH", self.api["watchdog"])
        self.store.objects[self.key] = json.dumps(self.marker).encode()
        period = retention.period_keys(self.marker)[0]
        self.store.objects[period] = json.dumps(dict(self.marker, extension=1.0)).encode()
        self.reject("REMOTE_COMPLETE_IDENTITY_MISMATCH", self.api["watchdog"])

    def test_legacy_receipt_is_not_rewritten_or_minted_as_trust_anchor(self):
        del self.receipt["marker_sha256"]
        (self.root / "last-success.json").write_text(json.dumps(self.receipt))
        before = self.state()
        self.api["watchdog"]()
        self.assertEqual(before, self.state())

    def test_retention_detects_reference_extension_type_change(self):
        for marker in self.store.objects.copy():
            if marker.endswith("COMPLETE"):
                self.store.objects[marker] = json.dumps(dict(self.marker, extension=1)).encode()
        key = retention.period_keys(self.marker)[0]
        self.store.objects[key] = json.dumps(dict(self.marker, extension=True)).encode()
        api = types.SimpleNamespace(BUCKET=retention.BUCKET,
              validate_marker=self.api["validate_marker"], get_marker=self.api["get_marker"],
              verify_object=self.api["verify_object"])
        self.reject("RETENTION_CONFLICTING_SNAPSHOT", lambda: retention.catalog(api, self.store))

    def test_staging_replay_validates_before_return(self):
        self.api.update(STAGING=self.root, sha=lambda _: "c" * 64)
        cfg = {"recipient": "test-only-recipient"}
        fingerprint = hashlib.sha256(cfg["recipient"].encode()).hexdigest()
        local = self.root / self.sid.rsplit("-", 1)[0]
        dest = self.root / (local.name + "-" + fingerprint[:12])
        dest.mkdir()
        staging = dict(self.marker, format=True, recipient_fingerprint=fingerprint)
        (dest / "staging.json").write_text(json.dumps(staging))
        before = (dest / "staging.json").read_bytes()
        with self.assertRaisesRegex(Exception, "^INVALID_REMOTE_MARKER_FORMAT$"):
            self.api["prepare"](local, {}, cfg)
        self.assertEqual(before, (dest / "staging.json").read_bytes())
        self.assertFalse(self.store.puts or self.store.deletes)

    def test_staging_replay_binds_derived_snapshot_and_manifest(self):
        self.api["STAGING"] = self.root
        cfg = {"recipient": "test-only-recipient"}
        fingerprint = hashlib.sha256(cfg["recipient"].encode()).hexdigest()
        local = self.root / self.sid.rsplit("-", 1)[0]
        local.mkdir()
        (local / "manifest.json").write_text("synthetic manifest")
        sid = local.name + "-" + fingerprint[:12]
        dest = self.root / sid
        dest.mkdir()
        marker = copy.deepcopy(self.marker)
        marker.update(snapshot=sid, recipient_fingerprint=fingerprint,
                      local_manifest_sha256=self.api["sha"](local / "manifest.json"))
        for name, item in marker["objects"].items():
            item["key"] = f"culinote/blobs/{sid}/{name}"
            (dest / name).write_bytes(b"x")
        stage = dest / "staging.json"
        stage.write_text(json.dumps(marker))
        manifest = dict(source_sha=marker["source_sha"], completed_utc=marker["backup_created_utc"])
        before = stage.read_bytes()
        self.assertEqual(self.api["prepare"](local, manifest, cfg), (dest, marker))
        self.assertEqual(before, stage.read_bytes())
        for field, value in (("snapshot", self.sid), ("source_sha", "d" * 40),
                             ("backup_created_utc", "2026-11-03T02:40:27+00:00")):
            bad = copy.deepcopy(marker)
            bad[field] = value
            if field == "snapshot":
                for name, item in bad["objects"].items():
                    item["key"] = f"culinote/blobs/{value}/{name}"
            stage.write_text(json.dumps(bad))
            before = stage.read_bytes()
            with self.assertRaisesRegex(Exception, "^STAGING_IDENTITY_MISMATCH$"):
                self.api["prepare"](local, manifest, cfg)
            self.assertEqual(before, stage.read_bytes())
            self.assertFalse(self.store.puts or self.store.deletes)

    def test_strict_wire_json(self):
        for value in ('{"format":1,"format":true}', '{"size":NaN}', '{"size":Infinity}', '{'):
            self.reject("INVALID_MARKER_JSON", lambda: retention.strict_json_loads(value))
        for value in (float("nan"), float("inf")):
            self.reject("INVALID_MARKER_JSON", lambda: retention.marker_digest({"extension": value}))


if __name__ == "__main__":
    unittest.main()
