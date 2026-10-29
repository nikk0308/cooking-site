"""Restricted Docker transport. NOT installed. No generic shell/run/restore API."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import subprocess
import sys
import threading

CONTRACT = json.loads(Path(__file__).with_name("broker-contract.json").read_text())
MAX_INPUT = 32 * 1024**3
READ_ROLE_SQL = """SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
 AND NOT has_database_privilege(current_database(),'CREATE')
 AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('public','drizzle') AND has_schema_privilege(oid,'CREATE'))
 AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relkind IN ('r','p') AND has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
 FROM pg_roles WHERE rolname=current_user"""


def private_file(path):
    p = Path(path)
    s = p.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o027 or s.st_uid not in (0, os.getuid()):
        raise ValueError("PRIVATE_REGULAR_FILE_REQUIRED")
    return p


def configuration(path):
    c = json.loads(private_file(path).read_text())
    required = {"format", "runner_uid", "socket", "docker", "docker_socket", "project", "app_container", "pg_container", "pg_image", "pg_uid", "database", "database_user", "runtimes"}
    if set(c) != required or c["format"] != 1 or c["runner_uid"] <= 0 or c["pg_uid"] <= 0:
        raise ValueError("EXPLICIT_BROKER_CONTRACT_REQUIRED")
    if any(type(c[k]) is not int for k in ['runner_uid', 'pg_uid']):
        raise ValueError('NUMERIC_NONROOT_IDENTITIES_REQUIRED')
    for k in ["project", "app_container", "pg_container", "database", "database_user"]:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", c[k]):
            raise ValueError("UNSAFE_TARGET")
    if c["app_container"] == c["pg_container"] or not Path(c["docker"]).is_absolute():
        raise ValueError("UNSAFE_EXECUTABLE_OR_TARGET")
    d = Path(c["docker"]).stat()
    if d.st_mode & 0o022 or d.st_uid not in (0, os.getuid()):
        raise ValueError("UNTRUSTED_DOCKER_EXECUTABLE")
    ds = Path(c["docker_socket"]).stat()
    if not Path(c["docker_socket"]).is_absolute() or not stat.S_ISSOCK(ds.st_mode) or ds.st_mode & 0o007 or ds.st_uid not in (0, os.getuid()):
        raise ValueError("TRUSTED_EXPLICIT_DOCKER_SOCKET_REQUIRED")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", c["pg_image"]) or not 1 <= len(c["runtimes"]) <= 2:
        raise ValueError("EXPLICIT_IMAGE_IDENTITIES_REQUIRED")
    for r in c["runtimes"]:
        if set(r) != {"sha", "image"} or not re.fullmatch(r"[a-f0-9]{40}", r["sha"]) or not re.fullmatch(r"sha256:[a-f0-9]{64}", r["image"]):
            raise ValueError("UNSAFE_RUNTIME_IDENTITY")
    if len({r['sha'] for r in c['runtimes']}) != len(c['runtimes']):
        raise ValueError('DISTINCT_RUNTIME_IDENTITIES_REQUIRED')
    return c


def docker_args(c, args):
    return [c['docker'], '--host', 'unix://' + c['docker_socket'], *args]


DOCKER_ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'DOCKER_CONFIG': '/nonexistent'}


def authorize(c, args, input_bytes):
    if not isinstance(args, list) or not all(isinstance(a, str) and len(a) <= 2048 for a in args) or len(args) > 20:
        raise ValueError("BAD_ARGUMENTS")
    if not isinstance(input_bytes, int) or not 0 <= input_bytes <= MAX_INPUT:
        raise ValueError("BAD_INPUT_SIZE")
    if args == ["inspect", "--format", CONTRACT["runtimeInspect"], c["app_container"]] or args == ["inspect", "--format", CONTRACT["imageInspect"], c["pg_container"]]:
        if input_bytes:
            raise ValueError("UNEXPECTED_INPUT")
        return args
    prefix = ["exec", "-i", c["pg_container"]]
    if args[:3] != prefix:
        raise ValueError("DOCKER_OPERATION_DENIED")
    rest = args[3:]
    system = ["psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", c["database_user"], "-d", c["database"], "-c", CONTRACT["systemQuery"]]
    dump = ["pg_dump", "-U", c["database_user"], "-d", c["database"], "-Fc"]
    allowed = rest == system or (rest[:6] == dump and len(rest) == 7 and re.fullmatch(r"--snapshot=[A-Fa-f0-9]+-[A-Fa-f0-9]+-[0-9]+", rest[-1]))
    if rest == ["pg_restore", "--list"]:
        allowed = input_bytes > 0
    elif input_bytes:
        allowed = False
    if not allowed:
        raise ValueError("DOCKER_EXEC_DENIED")
    # Never run even a parser as root in the PostgreSQL container.
    return ["exec", "--user", str(c["pg_uid"]), "-i", c["pg_container"], *rest]


def identities(c):
    for name, service in [(c["app_container"], "app"), (c["pg_container"], "postgres")]:
        raw = subprocess.check_output(docker_args(c, ["inspect", "--format", CONTRACT["runtimeInspect"], name]), env=DOCKER_ENV, stderr=subprocess.DEVNULL, timeout=10)
        d = json.loads(raw)
        if d["project"] != c["project"] or d["service"] != service:
            raise ValueError("CONTAINER_PROJECT_MISMATCH")
        if service == "app":
            if {"sha": d["sha"], "image": d["image"]} not in c["runtimes"]:
                raise ValueError("RUNTIME_IDENTITY_MISMATCH")
        elif d["image"] != c["pg_image"]:
            raise ValueError("POSTGRES_IMAGE_MISMATCH")
    safe = subprocess.check_output(docker_args(c, ["exec", "--user", str(c["pg_uid"]), c["pg_container"], "psql", "-XqAt", "-v", "ON_ERROR_STOP=1", "-U", c["database_user"], "-d", c["database"], "-c", READ_ROLE_SQL]), env=DOCKER_ENV, stderr=subprocess.DEVNULL, timeout=10).strip()
    if safe != b"t":
        raise ValueError("READ_ONLY_DATABASE_ROLE_REQUIRED")


def exact(stream, count):
    result = b""
    while len(result) < count:
        chunk = stream.read(count - len(result))
        if not chunk:
            raise ValueError("TRUNCATED_RPC")
        result += chunk
    return result


def serve_request(conn, c):
    process = None
    try:
        conn.settimeout(330)
        _pid, uid, _gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != c["runner_uid"]:
            raise ValueError("PEER_UID_DENIED")
        reader = conn.makefile("rb")
        header = reader.readline(8193)
        if len(header) > 8192 or not header.endswith(b"\n"):
            raise ValueError("RPC_HEADER_LIMIT")
        request = json.loads(header)
        if set(request) != {"args", "input_bytes"}:
            raise ValueError("RPC_FIELDS_DENIED")
        args = authorize(c, request["args"], request["input_bytes"])
        identities(c)
        process = subprocess.Popen(docker_args(c, args), env=DOCKER_ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        def feed():
            remaining = request["input_bytes"]
            try:
                while remaining:
                    chunk = reader.read(min(65536, remaining))
                    if not chunk:
                        raise ValueError("RPC_INPUT_INTERRUPTED")
                    process.stdin.write(chunk)
                    remaining -= len(chunk)
            except Exception:
                process.kill()
            finally:
                process.stdin.close()
        thread = threading.Thread(target=feed, daemon=True)
        thread.start()
        timer = threading.Timer(300, process.kill)
        timer.start()
        try:
            while chunk := process.stdout.read(65536):
                conn.sendall(struct.pack("!I", len(chunk)) + chunk)
            code = process.wait(timeout=10)
            thread.join(timeout=10)
            conn.sendall(struct.pack("!I", 0) + json.dumps({"code": code}).encode() + b"\n")
        finally:
            timer.cancel()
    except Exception as error:
        code = str(error) if re.fullmatch(r'[A-Z_]{3,80}', str(error)) else type(error).__name__
        print('BACKUP_BROKER_REQUEST_FAILED code=' + code, file=sys.stderr, flush=True)
        try:
            conn.sendall(struct.pack("!I", 0) + b'{"code":1}\n')
        except OSError:
            pass
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
        conn.close()


def server(c):
    p = Path(c["socket"])
    parent = p.parent.stat()
    if not p.is_absolute() or p.exists() or parent.st_uid != os.getuid() or parent.st_mode & 0o022:
        raise ValueError("PRIVATE_FRESH_SOCKET_PATH_REQUIRED")
    # No replacement of existing sockets and no automatic target discovery.
    admission = threading.BoundedSemaphore(2)
    def handle(conn):
        try:
            serve_request(conn, c)
        finally:
            admission.release()
    with socket.socket(socket.AF_UNIX) as sock, concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        sock.bind(str(p))
        os.chmod(p, 0o660)
        sock.listen(2)
        notify = os.environ.get('NOTIFY_SOCKET')
        if notify:
            with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as ready:
                ready.sendto(b'READY=1', '\0' + notify[1:] if notify.startswith('@') else notify)
        print('BACKUP_BROKER_READY', flush=True)
        while True:
            conn, _ = sock.accept()
            if admission.acquire(blocking=False):
                workers.submit(handle, conn)
            else:
                conn.close()


def client(path, args, input_bytes):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(330)
        sock.connect(path)
        expected = os.environ.get("CULINOTE_BACKUP_BROKER_UID")
        if expected is None or struct.unpack("3i", sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1] != int(expected):
            raise ValueError("BROKER_PEER_UID_MISMATCH")
        sock.sendall(json.dumps({"args": args, "input_bytes": input_bytes}).encode() + b"\n")
        def send():
            remaining = input_bytes
            try:
                while remaining:
                    chunk = sys.stdin.buffer.read(min(65536, remaining))
                    if not chunk:
                        break
                    sock.sendall(chunk)
                    remaining -= len(chunk)
                sock.shutdown(socket.SHUT_WR)
            except OSError:
                pass
        threading.Thread(target=send, daemon=True).start()
        stream = sock.makefile("rb")
        while size := struct.unpack("!I", exact(stream, 4))[0]:
            if size > 65536:
                raise ValueError("RPC_FRAME_LIMIT")
            sys.stdout.buffer.write(exact(stream, size))
            sys.stdout.buffer.flush()
        result = json.loads(stream.readline(256))
        return 0 if result == {"code": 0} else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("mode", choices=["serve", "client"])
    p.add_argument("--config")
    p.add_argument("--allow-docker-authority", action="store_true")
    p.add_argument("--socket")
    p.add_argument("--input-bytes", type=int, default=0)
    options, rest = p.parse_known_args()
    try:
        if options.mode == "serve":
            if not options.allow_docker_authority or rest or not options.config:
                raise ValueError("EXPLICIT_DOCKER_AUTHORITY_REQUIRED")
            server(configuration(options.config))
        else:
            if not options.socket or not rest or rest[0] != "--":
                raise ValueError("EXPLICIT_RPC_TARGET_REQUIRED")
            sys.exit(client(options.socket, rest[1:], options.input_bytes))
    except Exception as error:
        code = str(error) if re.fullmatch(r'[A-Z_]{3,80}', str(error)) else type(error).__name__
        print("BACKUP_DOCKER_BROKER=FAIL code=" + code + "; details suppressed", file=sys.stderr)
        sys.exit(1)
