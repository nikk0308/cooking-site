"""Fail closed before publishing only the explicitly allowed synthetic diagnostics."""
import json
from pathlib import Path
import sys
import zipfile

CANARY = b"CULINOTE_SYNTHETIC_CREDENTIAL_CANARY"


def check_bytes(data):
    if CANARY in data or b"AGE-SECRET-KEY-" in data or b"PRIVATE KEY-----" in data:
        raise ValueError("Sensitive diagnostic material detected")
    for line in data.splitlines():
        try:
            item = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(item, dict):
            continue
        snapshot = item.get("snapshot", {})
        for message in (snapshot.get("request", {}), snapshot.get("response", {})):
            if "/api/admin/" in message.get("url", ""):
                raise ValueError("Credentialed API trace detected")
            for header in message.get("headers", []):
                name = header.get("name", "").lower()
                value = header.get("value", "")
                if name == "authorization" or (name in ("cookie", "set-cookie") and "recipes-admin" in value):
                    raise ValueError("Credential header detected")
        params = item.get("params", {})
        if item.get("method") == "fill" and any(word in params.get("selector", "").lower() for word in ("password", "пароль", "email")):
            raise ValueError("Credential input action detected")


def check_tree(root):
    count = 0
    for file in Path(root).rglob("release-*"):
        if not file.is_file():
            continue
        if file.is_symlink() or file.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("Unsafe or oversized diagnostic")
        if file.name.endswith("-trace.zip"):
            with zipfile.ZipFile(file) as archive:
                if sum(info.file_size for info in archive.infolist()) > 128 * 1024 * 1024:
                    raise ValueError("Oversized diagnostic archive")
                for info in archive.infolist():
                    check_bytes(archive.read(info))
        elif file.name == "release-diagnostics.json" or file.suffix == ".png":
            check_bytes(file.read_bytes())
        else:
            raise ValueError("Unexpected diagnostic file")
        count += 1
    return count


if __name__ == "__main__":
    try:
        count = check_tree(sys.argv[1])
        print(f"SYNTHETIC_DIAGNOSTIC_PRIVACY=PASS files={count}")
    except Exception:
        print("SYNTHETIC_DIAGNOSTIC_PRIVACY=FAIL; artifact publication blocked", file=sys.stderr)
        sys.exit(1)
