"""Inactive host-side service entrypoint. Capture/validate only, no restore/migrate."""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
from urllib.parse import urlsplit, unquote
import uuid
import platform
import shutil
from docker_broker import private_file


@contextlib.contextmanager
def locked(paths):
    handles = []
    try:
        for path in sorted(set(map(str, paths))):
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            handles.append(fd)
            s = os.fstat(fd)
            if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o007:
                raise ValueError("PRIVATE_EXISTING_LOCK_REQUIRED")
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(handles):
            os.close(fd)


def private_directory(path):
    p = Path(path)
    s = p.lstat()
    if not p.is_absolute() or not stat.S_ISDIR(s.st_mode) or s.st_mode & 0o027:
        raise ValueError("PRIVATE_DIRECTORY_REQUIRED")
    return p


def configuration(path):
    c = json.loads(private_file(path).read_text())
    required = {"format", "source", "environment", "environment_manifest_sha256", "policy", "tool_sha", "runtime_sha", "inventory_version", "database", "database_user", "database_credential", "app_container", "pg_container", "media", "destination_root", "backup_lock", "broker_socket", "broker_uid", "minimum_free_bytes"}
    if set(c) != required or c["format"] != 1 or c["inventory_version"] not in ["v0.1", "v0.2"]:
        raise ValueError("EXPLICIT_BRIDGE_CONFIG_REQUIRED")
    if not all(re.fullmatch(r"[a-f0-9]{40}", c[k]) for k in ["tool_sha", "runtime_sha"]):
        raise ValueError("EXPLICIT_EXPECTED_IDENTITIES_REQUIRED")
    for k in ["source", "environment", "policy", "database_credential", "media", "destination_root", "backup_lock", "broker_socket"]:
        if not Path(c[k]).is_absolute():
            raise ValueError('ABSOLUTE_PATHS_REQUIRED')
    if c['broker_uid'] <= 0 or c['minimum_free_bytes'] < 10 * 1024**3:
        raise ValueError('EXPLICIT_PRIVILEGE_AND_FREE_SPACE_CONTRACT_REQUIRED')
    return c


def file_digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def dependency_digest(root):
    root = Path(root).resolve()
    h = hashlib.sha256()
    for p in sorted((p for p in root.rglob('*') if p.is_symlink() or p.is_file()), key=lambda p: str(p).encode()):
        h.update((p.relative_to(root).as_posix() + '\0').encode())
        if p.is_symlink():
            if not p.resolve().is_relative_to(root):
                raise ValueError('EXTERNAL_DEPENDENCY_LINK')
            h.update(('L' + os.readlink(p) + '\0').encode())
        else:
            h.update(('F' + file_digest(p) + '\0').encode())
    return h.hexdigest()


def execute(c, mode, directory=None):
    if sys.platform != "linux" or os.geteuid() == 0:
        raise ValueError("NONROOT_LINUX_RUNNER_REQUIRED")
    source = private_directory(c["source"])
    environment = private_directory(c["environment"])
    node = environment / "node"
    attestation = json.loads(private_file(environment / "environment.json").read_text())
    if file_digest(environment / "environment.json") != c["environment_manifest_sha256"] or attestation.get("format") != 1 or attestation.get("platform") != 'linux' or attestation.get('arch') != {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine()):
        raise ValueError("ENVIRONMENT_ATTESTATION_MISMATCH")
    if file_digest(node) != attestation["nodeSha256"] or file_digest(source / "package-lock.json") != attestation["lockfileSha256"] or dependency_digest(environment / 'node_modules') != attestation['dependenciesSha256'] or (source / 'node_modules').resolve() != (environment / 'node_modules').resolve():
        raise ValueError("ENVIRONMENT_SOURCE_MISMATCH")
    if subprocess.check_output([str(node), "--version"], text=True, stderr=subprocess.DEVNULL).strip() != "v24.20.0":
        raise ValueError("PINNED_NODE_REQUIRED")
    if not (source / 'node_modules/tsx/dist/cli.mjs').is_file():
        raise ValueError('TOOL_EXECUTABLE_MISSING')
    env = {"PATH": "/usr/bin:/bin", "HOME": str(environment), "GIT_OPTIONAL_LOCKS": "0", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "safe.directory", "GIT_CONFIG_VALUE_0": str(source), "GIT_CONFIG_KEY_1": "core.fsmonitor", "GIT_CONFIG_VALUE_1": "false", "PYTHONDONTWRITEBYTECODE": "1", "CULINOTE_BACKUP_DOCKER_BROKER": c["broker_socket"], "CULINOTE_BACKUP_BROKER_UID": str(c["broker_uid"])}
    if subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], env=env, text=True).strip() != c["tool_sha"] or subprocess.check_output(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=normal"], env=env, text=True).strip():
        raise ValueError("EXPECTED_CLEAN_TOOL_CHECKOUT_REQUIRED")
    private_file(c["policy"])
    credential = private_file(c["database_credential"])
    target = credential.read_text().strip()
    url = urlsplit(target)
    if url.scheme not in ["postgres", "postgresql"] or unquote(url.path[1:]) != c["database"] or unquote(url.username or "") != c["database_user"]:
        raise ValueError("EXPLICIT_DATABASE_TARGET_MISMATCH")
    env["BACKUP_BRIDGE_URL"] = target
    root = private_directory(c["destination_root"])
    if mode == 'capture' and shutil.disk_usage(root).free < c['minimum_free_bytes']:
        raise ValueError('BACKUP_FREE_SPACE_GATE')
    if mode == "capture":
        name = directory or datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8]
        if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", name):
            raise ValueError("SNAPSHOT_NAMING_CONTRACT_REQUIRED")
        destination = root / name
        if destination.exists():
            raise ValueError("IMMUTABLE_DESTINATION_EXISTS")
    elif mode == "validate":
        destination = Path(directory or "").absolute()
        if destination.parent != root:
            raise ValueError("VALIDATION_DESTINATION_OUTSIDE_ROOT")
    else:
        raise ValueError("CAPTURE_OR_VALIDATE_ONLY")
    args = [str(node), str(source / "node_modules/tsx/dist/cli.mjs"), str(source / "scripts/backup/cli.ts"), "--mode", mode, "--policy", c["policy"], "--directory", str(destination), "--runtime-sha", c["runtime_sha"], "--tool-sha", c["tool_sha"]]
    if mode == "capture":
        args += ["--database-env", "BACKUP_BRIDGE_URL", "--pg-container", c["pg_container"], "--app-container", c["app_container"], "--media", c["media"], "--version", c["inventory_version"]]
    with locked([c["backup_lock"]]):
        child = subprocess.Popen(args, env=env, cwd=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        previous = {}
        def interrupted(_sig, _frame):
            raise InterruptedError("CAPTURE_INTERRUPTED")
        try:
            for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
                previous[sig] = signal.signal(sig, interrupted)
            if child.wait(timeout=900) != 0:
                raise ValueError("VERSIONED_OPERATION_FAILED")
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            for sig, handler in previous.items():
                signal.signal(sig, handler)
        if not (destination / "COMPLETE").is_file():
            raise ValueError("COMPLETE_REQUIRED")
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--mode", choices=["capture", "validate"], required=True)
    parser.add_argument("--directory")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = execute(configuration(args.config), args.mode, args.directory)
        print("CULINOTE_BACKUP_SUCCESS snapshot=" + result.name if args.mode == "capture" else "CULINOTE_BACKUP_VALIDATED snapshot=" + result.name)
    except BlockingIOError:
        print("CULINOTE_BACKUP_BLOCKED_LOCK_BUSY", file=sys.stderr)
        sys.exit(75)
    except Exception as error:
        code = str(error) if re.fullmatch(r'[A-Z_]{3,80}', str(error)) else type(error).__name__
        print("CULINOTE_BACKUP_FAILURE code=" + code + "; no credentials or payload logged", file=sys.stderr)
        sys.exit(1)
