"""Culinote-only reference retention. No deletion is enabled by deployment.

All callers, including GC, must hold offsite.py's upload.lock. No independent
writers to this prefix are supported during GC. Credentials never enter plans.
"""

import datetime as dt
import hashlib
import json
import re

BUCKET = "culinote-backups"
PREFIX = "culinote/"
SID = r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}-[0-9a-f]{12}"
MARKER = re.compile(rf"culinote/(daily/({SID})|weekly/(\d{{4}}-W\d{{2}})|monthly/(\d{{4}}-\d{{2}}))/COMPLETE")
BLOB = re.compile(rf"culinote/blobs/({SID})/(database|media|manifest)\.encrypted")


class RetentionError(Exception):
    pass


def fail(code):
    raise RetentionError(code)


def stamp(marker):
    value = dt.datetime.fromisoformat(marker["backup_created_utc"])
    if value.utcoffset() != dt.timedelta(0):
        fail("RETENTION_TIMESTAMP_NOT_UTC")
    return value


def period_keys(marker):
    date = stamp(marker)
    year, week, _ = date.isocalendar()
    return (f"culinote/weekly/{year:04d}-W{week:02d}/COMPLETE",
            f"culinote/monthly/{date:%Y-%m}/COMPLETE")


def inventory(s3):
    result = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key in result or not (MARKER.fullmatch(key) or BLOB.fullmatch(key)):
                fail("RETENTION_UNKNOWN_OR_DUPLICATE_KEY")
            result[key] = {"bytes": obj["Size"], "etag": obj["ETag"]}
    if not result:
        fail("RETENTION_EMPTY_PREFIX")
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def catalog(api, s3):
    # Limited keys need object access, never bucket administration permissions.
    if getattr(api, "BUCKET", BUCKET) != BUCKET:
        fail("RETENTION_BUCKET_SCOPE_MISMATCH")
    objects = inventory(s3)
    for key, expected in objects.items():
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if head["ContentLength"] != expected["bytes"] or head["ETag"] != expected["etag"]:
            fail("RETENTION_OBJECT_CHANGED")
    markers, snapshots = {}, {}
    for key in objects:
        match = MARKER.fullmatch(key)
        if not match:
            continue
        marker = api.validate_marker(api.get_marker(s3, key))
        sid = marker["snapshot"]
        stamp(marker)  # Completion can cross midnight after the snapshot ID was allocated.
        if key.startswith("culinote/daily/"):
            if match[2] != sid:
                fail("RETENTION_DAILY_REFERENCE_MISMATCH")
        elif key not in period_keys(marker):
            fail("RETENTION_PERIOD_REFERENCE_MISMATCH")
        if sid in snapshots and snapshots[sid] != marker:
            fail("RETENTION_CONFLICTING_SNAPSHOT")
        snapshots[sid] = marker
        markers[key] = marker
    referenced = set()
    for marker in snapshots.values():
        for item in marker["objects"].values():
            key = item["key"]
            if key not in objects or objects[key]["bytes"] != item["bytes"]:
                fail("RETENTION_INCOMPLETE_SNAPSHOT")
            api.verify_object(s3, key, item)
            referenced.add(key)
    if set(objects) - set(markers) != referenced:
        fail("RETENTION_ORPHAN_OR_INCOMPLETE_UPLOAD")
    if inventory(s3) != objects:
        fail("RETENTION_CONCURRENT_CHANGE")
    return objects, markers, snapshots


def ensure_periods(api, s3, marker):
    """First verified successful snapshot of UTC ISO week/month, never overwrite."""
    api.validate_marker(marker)
    for item in marker["objects"].values():
        api.verify_object(s3, item["key"], item)
    for key in period_keys(marker):
        if not api.object_exists(s3, key):
            s3.put_object(Bucket=BUCKET, Key=key,
                          Body=json.dumps(marker, sort_keys=True, separators=(",", ":")).encode(),
                          ACL="private", ContentType="application/json")
        actual = api.validate_marker(api.get_marker(s3, key))
        if key not in period_keys(actual):
            fail("RETENTION_PERIOD_REFERENCE_MISMATCH")
        for item in actual["objects"].values():
            api.verify_object(s3, item["key"], item)
        if not api.anonymous_denied(api.ORIGIN + "/" + key):
            fail("RETENTION_PERIOD_PUBLIC")


def plan(api, s3, proof, last_success, upload_failure=None):
    if not proof or proof.get("status") != "PASS" or proof.get("local_pipeline_test") is not False:
        fail("RETENTION_OWNER_RESTORE_PROOF_REQUIRED")
    if upload_failure and upload_failure["utc"] > last_success["verified_utc"]:
        fail("RETENTION_UNRESOLVED_UPLOAD_FAILURE")
    objects, markers, snapshots = catalog(api, s3)
    protected = proof["snapshot"]
    if protected not in snapshots:
        fail("RETENTION_RESTORED_SNAPSHOT_MISSING")
    if last_success["complete_key"] not in markers or markers[last_success["complete_key"]]["snapshot"] != last_success["snapshot"]:
        fail("RETENTION_LAST_SUCCESS_MISSING")
    # One daily point per UTC day, even if an operator created multiple backups.
    days = {}
    for key, marker in sorted(markers.items(), key=lambda pair: (stamp(pair[1]), pair[0]), reverse=True):
        if key.startswith("culinote/daily/"):
            days.setdefault(stamp(marker).date(), key)
    daily = list(days.values())[:2]
    weekly = sorted(k for k in markers if k.startswith("culinote/weekly/"))[-1:]
    monthly = sorted(k for k in markers if k.startswith("culinote/monthly/"))[-1:]
    if not daily or not weekly or not monthly:
        fail("RETENTION_CATEGORY_MISSING")
    keep = set(daily + weekly + monthly)
    if protected not in {markers[k]["snapshot"] for k in keep}:
        keep.add(next(k for k in sorted(markers) if markers[k]["snapshot"] == protected))
    kept_snapshots = sorted({markers[k]["snapshot"] for k in keep})
    blocked = "RESTORED_POINT_WOULD_EXCEED_FOUR" if len(kept_snapshots) > 4 else None
    referenced = {i["key"] for sid in kept_snapshots for i in snapshots[sid]["objects"].values()}
    delete_markers = sorted(set(markers) - keep)
    delete_blobs = sorted(set(objects) - set(markers) - referenced)
    proposed = delete_markers + delete_blobs
    result = {"policy": {"daily": 2, "weekly": 1, "monthly": 1, "max_unique": 4},
              "access_gate": {"object_list_get_head": "PASS", "bucket_admin_api": "NOT_REQUIRED",
                              "independent_writers": "OWNER_CONFIRMATION_REQUIRED"},
              "bucket": BUCKET, "prefix": PREFIX, "deletion_enabled": False,
              "protected_snapshot": protected, "categories": {"daily": daily, "weekly": weekly, "monthly": monthly},
              "keep_markers": sorted(keep), "keep_snapshots": kept_snapshots,
              "remote_snapshot_count": len(snapshots), "blocked": blocked,
              "delete_markers": delete_markers, "delete_blobs": delete_blobs,
              "delete_objects": [{"key": k, **objects[k]} for k in proposed],
              "delete_bytes": sum(objects[k]["bytes"] for k in proposed),
              "inventory": objects, "proof_sha256": digest(proof),
              "last_success_sha256": digest(last_success)}
    result["plan_sha256"] = digest(result)
    return result


def execute(api, s3, approved, proof, last_success, upload_failure=None, *, enabled=False, approved_hash=None):
    """Prepared GC executor; no CLI or timer enables it. Must hold upload.lock.

    Replan before deletion. Delete obsolete references first, rescan references
    before every blob deletion. Failures stop immediately, leaving extra blobs.
    """
    if not enabled or approved_hash != approved.get("plan_sha256"):
        fail("RETENTION_DELETION_DISABLED")
    with api.retention_lock():
        api.latest_local()
        if api.retention_inputs() != (proof, last_success, upload_failure):
            fail("RETENTION_LOCAL_STATE_CHANGED")
        return _execute_locked(api, s3, approved, proof, last_success, upload_failure,
                               approved_hash=approved_hash)


def _execute_locked(api, s3, approved, proof, last_success, upload_failure, *, approved_hash):
    unsigned = {k: v for k, v in approved.items() if k != "plan_sha256"}
    if digest(unsigned) != approved_hash:
        fail("RETENTION_PLAN_TAMPERED")
    fresh = plan(api, s3, proof, last_success, upload_failure)
    if fresh != approved or fresh["blocked"]:
        fail("RETENTION_PLAN_CHANGED_OR_BLOCKED")
    remaining = dict(fresh["inventory"])
    for key in fresh["delete_markers"] + fresh["delete_blobs"]:
        if inventory(s3) != remaining:
            fail("RETENTION_CONCURRENT_CHANGE")
        if BLOB.fullmatch(key):
            for ref in remaining:
                if MARKER.fullmatch(ref):
                    marker = api.validate_marker(api.get_marker(s3, ref))
                    if any(item["key"] == key for item in marker["objects"].values()):
                        fail("RETENTION_BLOB_STILL_REFERENCED")
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if head["ETag"] != remaining[key]["etag"] or head["ContentLength"] != remaining[key]["bytes"]:
            fail("RETENTION_OBJECT_CHANGED")
        s3.delete_object(Bucket=BUCKET, Key=key)
        del remaining[key]
        if inventory(s3) != remaining:
            fail("RETENTION_DELETE_NOT_CONFIRMED")
    return len(fresh["delete_objects"])
