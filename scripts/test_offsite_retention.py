import contextlib
import ast
import datetime as dt
import hashlib
import json
from pathlib import Path
import tempfile
import types
import sys
import unittest
from unittest.mock import patch

import offsite_retention as r


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.deletes = []
        self.error = None

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return self

    def paginate(self, **kwargs):
        assert kwargs == {"Bucket": r.BUCKET, "Prefix": r.PREFIX}
        if self.error == "list":
            raise OSError("S3 unavailable")
        return [{"Contents": [{"Key": k, "Size": len(v), "ETag": hashlib.md5(v).hexdigest()}
                              for k, v in sorted(self.objects.items())]}]

    def put_object(self, Bucket, Key, Body, **kwargs):
        assert Bucket == r.BUCKET and Key.startswith(r.PREFIX)
        if self.error == "put":
            raise OSError("S3 write failed")
        self.objects[Key] = Body

    def head_object(self, Bucket, Key):
        assert Bucket == r.BUCKET
        if self.error == "head":
            raise OSError("Object permission denied")
        value = self.objects[Key]
        return {"ContentLength": len(value), "ETag": hashlib.md5(value).hexdigest()}

    def delete_object(self, Bucket, Key):
        assert Bucket == r.BUCKET and Key.startswith(r.PREFIX)
        if self.error == "delete":
            raise OSError("S3 delete failed")
        self.deletes.append(Key)
        del self.objects[Key]


class API:
    BUCKET = r.BUCKET
    ORIGIN = "https://culinote-backups.fra1.digitaloceanspaces.com"

    @staticmethod
    def retention_lock():
        return contextlib.nullcontext()

    @staticmethod
    def latest_local():
        success = API.current_inputs[1]
        return Path(success["snapshot"].rsplit("-", 1)[0]), {}

    @staticmethod
    def now():
        return dt.datetime.fromisoformat(API.current_inputs[1]["verified_utc"])

    @staticmethod
    def load_config():
        return API.config

    @staticmethod
    def read_json(path):
        return json.loads(path.read_text())

    @staticmethod
    def atomic(path, data):
        path.write_text(json.dumps(data))

    @staticmethod
    def safe_code(exc):
        return str(exc) if isinstance(exc, r.RetentionError) else type(exc).__name__

    @staticmethod
    def gc_event(event, **fields):
        API.events.append({"event": event, **fields})

    @staticmethod
    def retention_inputs():
        return API.current_inputs

    @staticmethod
    def validate_marker(marker):
        if set(marker["objects"]) != {"database.encrypted", "media.encrypted", "manifest.encrypted"}:
            raise ValueError("Incomplete marker")
        for name, item in marker["objects"].items():
            if item["key"] != f"culinote/blobs/{marker['snapshot']}/{name}":
                raise ValueError("Unsafe reference")
        return marker

    @staticmethod
    def get_marker(s3, key):
        if s3.error == "get":
            raise OSError("S3 credentials/access failure")
        return json.loads(s3.objects[key])

    @staticmethod
    def verify_object(s3, key, item):
        value = s3.objects[key]
        if len(value) != item["bytes"] or hashlib.sha256(value).hexdigest() != item["sha256"]:
            raise ValueError("Ciphertext corrupted")

    @staticmethod
    def object_exists(s3, key):
        return key in s3.objects

    @staticmethod
    def anonymous_denied(url):
        return True


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        self.markers = []
        state = tempfile.TemporaryDirectory(prefix="culinote-gc-test-")
        self.addCleanup(state.cleanup)
        API.STATE = Path(state.name)
        API.events = []
        API.config = {"deletion_enabled": True}
        API.atomic(API.STATE / "retention-activation.json", {
            "sole_workflow_writer": True, "bucket": r.BUCKET, "prefix": r.PREFIX,
            "policy": {"daily": 2, "weekly": 1, "monthly": 1, "max_unique": 4}})

    def add(self, date, periods=True):
        index = len(self.markers)
        stamp = dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc)
        sid = stamp.strftime("%Y%m%dT%H%M%SZ") + f"-{index:08x}-123456789abc"
        marker = {"snapshot": sid, "backup_created_utc": stamp.isoformat(), "source_sha": "fixture-source", "objects": {}}
        for name in ["database.encrypted", "media.encrypted", "manifest.encrypted"]:
            key = f"culinote/blobs/{sid}/{name}"
            value = (sid + name).encode()
            self.s3.objects[key] = value
            marker["objects"][name] = {"key": key, "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
        self.s3.objects[f"culinote/daily/{sid}/COMPLETE"] = json.dumps(marker).encode()
        if periods:
            r.ensure_periods(API, self.s3, marker)
        self.markers.append(marker)
        return marker

    def args(self, protected=0):
        latest = self.markers[-1]
        result = ({"snapshot": self.markers[protected]["snapshot"], "status": "PASS", "local_pipeline_test": False},
                {"snapshot": latest["snapshot"], "complete_key": f"culinote/daily/{latest['snapshot']}/COMPLETE",
                 "verified_utc": (r.stamp(latest) + dt.timedelta(hours=1)).isoformat(),
                 "backup_created_utc": latest["backup_created_utc"], "remote_ciphertext_verification": "PASS"})
        API.current_inputs = (*result, None)
        return result

    def plan(self, protected=0):
        return r.plan(API, self.s3, *self.args(protected))

    def test_daily_rotation_shared_periods(self):
        for day in range(1, 5):
            self.add(f"2026-10-{day:02d}T03:00:00")
        plan = self.plan()
        self.assertEqual(len(plan["categories"]["daily"]), 2)
        self.assertEqual(len(plan["keep_snapshots"]), 3)
        self.assertEqual(len(plan["delete_blobs"]), 3)
        self.assertTrue(all(self.markers[1]["snapshot"] in k for k in plan["delete_blobs"]))

    def test_week_and_month_boundary_missing_days(self):
        self.add("2026-09-29T03:00:00")
        self.add("2026-10-01T03:00:00")
        self.add("2026-10-09T03:00:00")
        plan = self.plan()
        self.assertEqual(plan["categories"]["weekly"], ["culinote/weekly/2026-W41/COMPLETE"])
        self.assertEqual(plan["categories"]["monthly"], ["culinote/monthly/2026-10/COMPLETE"])
        self.assertEqual(API.get_marker(self.s3, plan["categories"]["monthly"][0])["snapshot"], self.markers[1]["snapshot"])

    def test_iso_year_boundary(self):
        marker = self.add("2027-01-01T03:00:00")
        self.assertEqual(r.period_keys(marker), ("culinote/weekly/2026-W53/COMPLETE", "culinote/monthly/2027-01/COMPLETE"))

    def test_backup_finishing_after_midnight(self):
        marker = self.add("2026-10-31T23:59:59", periods=False)
        marker["backup_created_utc"] = "2026-11-01T00:00:10+00:00"
        self.s3.objects[f"culinote/daily/{marker['snapshot']}/COMPLETE"] = json.dumps(marker).encode()
        r.ensure_periods(API, self.s3, marker)
        self.assertEqual(self.plan()["categories"]["monthly"], ["culinote/monthly/2026-11/COMPLETE"])

    def test_same_snapshot_all_categories(self):
        self.add("2026-10-01T03:00:00")
        plan = self.plan()
        self.assertEqual(len(plan["keep_snapshots"]), 1)
        self.assertEqual(plan["delete_objects"], [])

    def test_repeated_period_is_frozen(self):
        first = self.add("2026-10-01T03:00:00")
        second = self.add("2026-10-02T03:00:00")
        for key in r.period_keys(second):
            self.assertEqual(API.get_marker(self.s3, key), first)

    def test_multiple_backups_same_day(self):
        self.add("2026-10-01T03:00:00")
        self.add("2026-10-02T03:00:00")
        latest = self.add("2026-10-02T04:00:00")
        plan = self.plan()
        self.assertEqual(len(plan["categories"]["daily"]), 2)
        self.assertIn(latest["snapshot"], plan["keep_snapshots"])

    def test_incomplete_snapshot_blocks(self):
        marker = self.add("2026-10-01T03:00:00")
        del self.s3.objects[marker["objects"]["database.encrypted"]["key"]]
        with self.assertRaisesRegex(r.RetentionError, "INCOMPLETE"):
            self.plan()
        self.assertEqual(self.s3.deletes, [])

    def test_corruption_blocks(self):
        marker = self.add("2026-10-01T03:00:00")
        self.s3.objects[marker["objects"]["media.encrypted"]["key"]] = b"corrupt"
        with self.assertRaises(Exception):
            self.plan()

    def test_orphan_upload_blocks(self):
        self.add("2026-10-01T03:00:00")
        self.s3.objects["culinote/blobs/20261002T030000Z-00000000-123456789abc/media.encrypted"] = b"partial"
        with self.assertRaisesRegex(r.RetentionError, "ORPHAN"):
            self.plan()

    def test_unknown_scope_blocks(self):
        self.add("2026-10-01T03:00:00")
        self.s3.objects["other-bucket/data"] = b"unknown"
        with self.assertRaisesRegex(r.RetentionError, "UNKNOWN"):
            self.plan()

    def test_s3_errors_no_deletes(self):
        self.add("2026-10-01T03:00:00")
        for error in ["list", "get"]:
            self.s3.error = error
            with self.assertRaises(OSError):
                self.plan()
        self.assertEqual(self.s3.deletes, [])

    def test_failed_upload_blocks(self):
        self.add("2026-10-01T03:00:00")
        with self.assertRaisesRegex(r.RetentionError, "UPLOAD_FAILURE"):
            r.plan(API, self.s3, *self.args(), {"utc": "2027-03-01T00:00:00+00:00"})

    def test_protected_fifth_blocks_until_new_restore(self):
        for date in ["2026-09-01", "2026-10-01", "2026-10-12", "2026-10-14", "2026-10-15"]:
            self.add(date + "T03:00:00")
        old = self.plan()
        self.assertEqual(len(old["keep_snapshots"]), 5)
        self.assertIsNotNone(old["blocked"])
        self.assertIn(self.markers[0]["snapshot"], old["keep_snapshots"])
        with self.assertRaisesRegex(r.RetentionError, "BLOCKED"):
            r.execute(API, self.s3, old, *self.args(), enabled=True, approved_hash=old["plan_sha256"])
        self.assertIsNone(self.plan(protected=-1)["blocked"])

    def test_no_restore_proof_blocks(self):
        self.add("2026-10-01T03:00:00")
        with self.assertRaisesRegex(r.RetentionError, "PROOF_REQUIRED"):
            r.plan(API, self.s3, None, self.args()[1])

    def rotation(self):
        for day in range(1, 5):
            self.add(f"2026-10-{day:02d}T03:00:00")
        return self.plan()

    def test_gc_disabled_by_default(self):
        plan = self.rotation()
        with self.assertRaisesRegex(r.RetentionError, "DISABLED"):
            r.execute(API, self.s3, plan, *self.args())
        self.assertEqual(self.s3.deletes, [])

    def test_gc_reference_safe(self):
        plan = self.rotation()
        count = r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(count, len(plan["delete_objects"]))
        self.assertEqual(self.s3.deletes, plan["delete_markers"] + plan["delete_blobs"])
        for sid in plan["keep_snapshots"]:
            self.assertEqual(sum(f"blobs/{sid}/" in k for k in self.s3.objects), 3)

    def test_changed_inventory_invalidates_approval(self):
        plan = self.rotation()
        self.add("2026-10-05T03:00:00")
        with self.assertRaisesRegex(r.RetentionError, "CHANGED"):
            r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(self.s3.deletes, [])

    def test_tampered_plan_rejected(self):
        plan = self.rotation()
        plan["delete_blobs"].append("elsewhere/key")
        with self.assertRaisesRegex(r.RetentionError, "TAMPERED"):
            r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])

    def test_delete_error_stops(self):
        plan = self.rotation()
        before = dict(self.s3.objects)
        self.s3.error = "delete"
        with self.assertRaises(OSError):
            r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(self.s3.objects, before)

    def test_period_write_failure_keeps_old_reference(self):
        self.add("2026-10-01T03:00:00")
        newer = self.add("2026-11-02T03:00:00", periods=False)
        before = dict(self.s3.objects)
        self.s3.error = "put"
        with self.assertRaises(OSError):
            r.ensure_periods(API, self.s3, newer)
        self.assertEqual(self.s3.objects, before)

    def test_local_backup_failure_blocks_executor(self):
        plan = self.rotation()
        with patch.object(API, "latest_local", side_effect=RuntimeError("Local backup failed")):
            with self.assertRaises(RuntimeError):
                r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(self.s3.deletes, [])

    def test_lock_contention_blocks_executor(self):
        plan = self.rotation()
        with patch.object(API, "retention_lock", side_effect=BlockingIOError("Upload running")):
            with self.assertRaises(BlockingIOError):
                r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(self.s3.deletes, [])

    def test_changed_local_proof_blocks_executor(self):
        plan = self.rotation()
        with patch.object(API, "retention_inputs", return_value=(None, None, None)):
            with self.assertRaisesRegex(r.RetentionError, "LOCAL_STATE_CHANGED"):
                r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        self.assertEqual(self.s3.deletes, [])

    def test_missing_complete_blocks_plan(self):
        marker = self.add("2026-10-01T03:00:00", periods=False)
        del self.s3.objects[f"culinote/daily/{marker['snapshot']}/COMPLETE"]
        with self.assertRaisesRegex(r.RetentionError, "ORPHAN"):
            self.plan()

    def test_bucket_admin_denied_does_not_block_object_access(self):
        self.add("2026-10-01T03:00:00")
        with patch.object(self.s3, "get_bucket_policy", create=True, side_effect=PermissionError("AccessDenied")) as policy:
            with patch.object(self.s3, "get_bucket_acl", create=True, side_effect=PermissionError("AccessDenied")) as acl:
                with self.assertRaises(PermissionError):
                    self.s3.get_bucket_policy(Bucket=r.BUCKET)
                policy.reset_mock()
                plan = self.plan()
                self.assertEqual(plan["access_gate"]["object_list_get_head"], "PASS")
                policy.assert_not_called()
                acl.assert_not_called()

    def test_wrong_bucket_blocks(self):
        self.add("2026-10-01T03:00:00")
        with patch.object(API, "BUCKET", "unmanaged-bucket"):
            with self.assertRaisesRegex(r.RetentionError, "BUCKET_SCOPE"):
                self.plan()

    def test_object_head_denied_blocks(self):
        self.add("2026-10-01T03:00:00")
        self.s3.error = "head"
        with self.assertRaises(OSError):
            self.plan()

    def test_missing_period_reference_blocks(self):
        self.add("2026-10-01T03:00:00")
        before = dict(self.s3.objects)
        for key in r.period_keys(self.markers[0]):
            self.s3.objects = dict(before)
            del self.s3.objects[key]
            with self.assertRaisesRegex(r.RetentionError, "CATEGORY_MISSING"):
                self.plan()

    def test_concurrent_writer_during_catalog_blocks(self):
        self.add("2026-10-01T03:00:00")
        before = r.inventory(self.s3)
        changed = dict(before)
        changed[next(iter(changed))] = {"bytes": 0, "etag": "changed"}
        with patch.object(r, "inventory", side_effect=[before, changed]):
            with self.assertRaisesRegex(r.RetentionError, "CONCURRENT_CHANGE"):
                self.plan()

    def test_safe_repeat_after_fixture_gc(self):
        plan = self.rotation()
        r.execute(API, self.s3, plan, *self.args(), enabled=True, approved_hash=plan["plan_sha256"])
        deleted = list(self.s3.deletes)
        fresh = self.plan()
        self.assertEqual(fresh["delete_objects"], [])
        self.assertEqual(r.execute(API, self.s3, fresh, *self.args(), enabled=True, approved_hash=fresh["plan_sha256"]), 0)
        self.assertEqual(self.s3.deletes, deleted)

    def test_enabled_empty_cycles_are_idempotent(self):
        self.add("2026-10-01T03:00:00")
        self.args()
        before = dict(self.s3.objects)
        for _ in range(2):
            status = r.cycle(API, self.s3)
            self.assertEqual(status["status"], "PASS")
            self.assertEqual(status["deleted_objects"], 0)
        self.assertEqual(self.s3.objects, before)

    def test_enabled_cycle_deletes_only_fixture_candidates(self):
        plan = self.rotation()
        status = r.cycle(API, self.s3)
        self.assertEqual(status["status"], "PASS")
        self.assertEqual(status["deleted_objects"], len(plan["delete_objects"]))
        self.assertEqual(len([e for e in API.events if e["event"] == "DELETE_PASS"]), len(plan["delete_objects"]))
        self.assertEqual(r.cycle(API, self.s3)["deleted_objects"], 0)

    def test_cycle_blocks_fifth_point_without_partial_cleanup(self):
        for date in ["2026-09-01", "2026-10-01", "2026-10-12", "2026-10-14", "2026-10-15"]:
            self.add(date + "T03:00:00")
        self.args()
        before = dict(self.s3.objects)
        status = r.cycle(API, self.s3)
        self.assertEqual(status["status"], "BLOCKED")
        self.assertEqual(status["code"], "RECOVERY_REVALIDATION_REQUIRED")
        self.assertEqual(self.s3.objects, before)

    def test_cycle_unknown_object_isolated_error(self):
        self.rotation()
        self.s3.objects["culinote/unknown"] = b"unknown"
        status = r.cycle(API, self.s3)
        self.assertEqual(status["status"], "ERROR")
        self.assertEqual(status["code"], "RETENTION_UNKNOWN_OR_DUPLICATE_KEY")
        self.assertEqual(self.s3.deletes, [])

    def test_cycle_requires_owner_receipt(self):
        self.rotation()
        (API.STATE / "retention-activation.json").unlink()
        self.assertEqual(r.cycle(API, self.s3)["status"], "ERROR")
        self.assertEqual(self.s3.deletes, [])

    def test_disabled_cycle_does_not_touch_s3(self):
        self.rotation()
        API.config["deletion_enabled"] = False
        self.s3.error = "list"
        self.assertEqual(r.cycle(API, self.s3)["status"], "DISABLED")
        self.assertEqual(self.s3.deletes, [])

    def test_cycle_failed_upload_never_deletes(self):
        self.rotation()
        proof, success, _ = API.current_inputs
        API.current_inputs = (proof, success, {"utc": "2027-03-01T00:00:00+00:00"})
        self.assertEqual(r.cycle(API, self.s3)["code"], "RETENTION_UNRESOLVED_UPLOAD_FAILURE")
        self.assertEqual(self.s3.deletes, [])

    def test_cycle_requires_current_verified_upload(self):
        self.rotation()
        proof, success, failure = API.current_inputs
        for changes in [{"remote_ciphertext_verification": "FAIL"},
                        {"backup_created_utc": "2020-01-01T00:00:00+00:00"}]:
            API.current_inputs = (proof, dict(success, **changes), failure)
            self.assertEqual(r.cycle(API, self.s3)["code"], "RETENTION_UPLOAD_NOT_CURRENT")
        self.assertEqual(self.s3.deletes, [])

    def test_cycle_requires_local_snapshot_binding(self):
        self.rotation()
        with patch.object(API, "latest_local", return_value=(Path("unuploaded-local"), {})):
            self.assertEqual(r.cycle(API, self.s3)["code"], "RETENTION_UPLOAD_NOT_CURRENT")
        self.assertEqual(self.s3.deletes, [])

    def test_change_mid_gc_stops_before_blob_deletes(self):
        self.rotation()
        original = self.s3.delete_object
        def concurrent(**kwargs):
            original(**kwargs)
            self.s3.objects["culinote/unknown"] = b"concurrent"
        with patch.object(self.s3, "delete_object", side_effect=concurrent):
            status = r.cycle(API, self.s3)
        self.assertEqual(status["status"], "ERROR")
        self.assertEqual(len(self.s3.deletes), 1)
        self.assertTrue(self.s3.deletes[0].endswith("/COMPLETE"))

    def workflow(self):
        # Exercise the real Linux entrypoint functions without importing Linux
        # fcntl/boto3 on Windows or ever constructing a production S3 client.
        path = Path(__file__).with_name("culinote_offsite.py")
        if not path.exists():
            path = Path(__file__).with_name("offsite.py")  # Installed server name.
        tree = ast.parse(path.read_text(encoding="utf-8"))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ("main", "run_gc", "watchdog")]
        module = types.ModuleType("culinote_workflow_fixture")
        marker = self.markers[-1]
        module.__dict__.update({"sys": sys, "retention": r, "STATE": API.STATE, "STAGING": API.STATE,
            "load_config": API.load_config, "client": lambda: self.s3, "latest_local": API.latest_local,
            "probe": lambda _: {}, "prepare": lambda *args: (API.STATE, marker),
            "publish": lambda *args: f"culinote/daily/{marker['snapshot']}/COMPLETE",
            "validate_marker": API.validate_marker, "get_marker": API.get_marker, "verify_object": API.verify_object,
            "now": API.now, "atomic": API.atomic, "read_json": API.read_json,
            "gc_event": API.gc_event, "safe_code": API.safe_code, "datetime": dt, "GateError": r.RetentionError,
            "shutil": types.SimpleNamespace(disk_usage=lambda _: types.SimpleNamespace(free=20 * 1024**3)),
            "fcntl": types.SimpleNamespace(flock=lambda *args: None, LOCK_EX=1, LOCK_NB=2)})
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), "exec"), module.__dict__)
        return module

    def test_gc_failure_does_not_invalidate_upload_success(self):
        self.add("2026-10-01T03:00:00")
        self.args()
        module = self.workflow()
        with patch.dict(sys.modules, {module.__name__: module}):
            with patch.object(r, "cycle", side_effect=OSError("Synthetic GC state write failure")):
                module.main("upload")
        success = API.read_json(API.STATE / "last-success.json")
        self.assertEqual(success["remote_ciphertext_verification"], "PASS")
        self.assertEqual(API.events[-1]["event"], "ERROR")

    def test_failed_publish_does_not_call_gc(self):
        self.add("2026-10-01T03:00:00")
        self.args()
        module = self.workflow()
        with patch.object(module, "publish", side_effect=OSError("Upload failed")):
            with patch.object(r, "cycle") as cycle:
                with self.assertRaises(OSError):
                    module.main("upload")
                cycle.assert_not_called()
        self.assertFalse((API.STATE / "last-success.json").exists())

    def test_watchdog_warns_about_gc_without_failing_healthy_backup(self):
        self.add("2026-10-01T03:00:00")
        _, success = self.args()
        API.atomic(API.STATE / "last-success.json", success)
        module = self.workflow()
        for code in ["RECOVERY_REVALIDATION_REQUIRED", "RETENTION_CONCURRENT_CHANGE"]:
            API.atomic(API.STATE / "gc-status.json", {"status": "BLOCKED", "code": code,
                       "updated_utc": API.now().isoformat()})
            module.watchdog()
            self.assertEqual(API.events[-1]["event"], "WATCHDOG_WARNING")
            self.assertEqual(API.events[-1]["code"], code)
        self.assertEqual(self.s3.deletes, [])


if __name__ == "__main__":
    unittest.main()
