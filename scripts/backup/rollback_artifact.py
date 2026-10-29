"""Owner-operated rollback artifact utility. Never part of backup automation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from docker_broker import private_file


def digest(p):
    h = hashlib.sha256()
    with Path(p).open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def image_identity(image):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('EXACT_IMAGE_ID_REQUIRED')
    raw = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{json .Id}}\n{{json .RepoDigests}}', image], stderr=subprocess.DEVNULL, timeout=15).splitlines()
    if json.loads(raw[0]) != image:
        raise ValueError('IMAGE_ID_MISMATCH')
    return {'image_id': image, 'repo_digests': json.loads(raw[1]) or []}


def preserve(directory, image, compose, runtime_env, media, pg_image, confirmation=False, export_image=False):
    if not confirmation or os.geteuid() == 0:
        raise ValueError('EXPLICIT_NONROOT_OWNER_OPERATION_REQUIRED')
    image_identity(pg_image)
    identity = image_identity(image)
    root = Path(directory)
    if not root.is_absolute() or root.exists():
        raise ValueError('FRESH_PRIVATE_ARTIFACT_DIRECTORY_REQUIRED')
    private_file(runtime_env)
    c = Path(compose).lstat()
    if not stat.S_ISREG(c.st_mode) or c.st_mode & 0o022:
        raise ValueError('TRUSTED_COMPOSE_REQUIRED')
    root.mkdir(mode=0o700)
    for name, source in [('compose.yaml', compose), ('runtime.env', runtime_env)]:
        with (root / name).open('xb') as out:
            os.chmod(root / name, 0o600)
            out.write(Path(source).read_bytes())
    files = ['compose.yaml', 'runtime.env']
    if export_image:
        with (root / 'image.tar').open('xb') as out:
            os.chmod(root / 'image.tar', 0o600)
            subprocess.run(['docker', 'image', 'save', image], stdout=out, stderr=subprocess.DEVNULL, check=True, timeout=300)
        files.append('image.tar')
    record = {'format': 1, **identity, 'postgres_image': pg_image, 'media_mount': media,
              'files': {n: digest(root / n) for n in files}}
    with (root / 'artifact.json').open('x') as f:
        os.chmod(root / 'artifact.json', 0o600)
        json.dump(record, f, indent=2)
    verify(root, require_image=True, require_complete=False)
    for name in [*files, 'artifact.json']:
        with (root / name).open('rb') as f:
            os.fsync(f.fileno())
    with (root / 'COMPLETE').open('x') as f:
        os.chmod(root / 'COMPLETE', 0o600)
        f.write('CULINOTE_ROLLBACK_ARTIFACT_VERIFIED\n')
        f.flush()
        os.fsync(f.fileno())
    fd = os.open(root, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return record


def verify(directory, require_image=True, require_complete=True, expected_record_sha=None):
    root = Path(directory)
    st = root.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_mode & 0o077:
        raise ValueError('PRIVATE_ARTIFACT_REQUIRED')
    metadata = private_file(root / 'artifact.json')
    if expected_record_sha is not None and digest(metadata) != expected_record_sha:
        raise ValueError('APPROVED_RECORD_MISMATCH')
    if require_complete and private_file(root / 'COMPLETE').read_text() != 'CULINOTE_ROLLBACK_ARTIFACT_VERIFIED\n':
        raise ValueError('COMPLETE_REQUIRED')
    record = json.loads(metadata.read_text())
    if set(record) != {'format', 'image_id', 'repo_digests', 'postgres_image', 'media_mount', 'files'} or record.get('format') != 1 or set(record.get('files', {})) not in [{'compose.yaml', 'runtime.env'}, {'compose.yaml', 'runtime.env', 'image.tar'}]:
        raise ValueError('ARTIFACT_INVENTORY_MISMATCH')
    if not all(re.fullmatch(r'sha256:[a-f0-9]{64}', record[k]) for k in ['image_id', 'postgres_image']) or not Path(record['media_mount']).is_absolute():
        raise ValueError('EXPLICIT_ARTIFACT_IDENTITIES_REQUIRED')
    for name, expected in record['files'].items():
        p = private_file(root / name)
        if p.stat().st_mode & 0o077 or digest(p) != expected:
            raise ValueError('ARTIFACT_CHECKSUM_OR_PERMISSION_FAILURE')
    if require_image:
        image_identity(record['image_id'])
    return record


def restore_image(directory, confirmation=False, expected_record_sha=None):
    if not confirmation or os.geteuid() == 0 or not expected_record_sha:
        raise ValueError('EXPLICIT_NONROOT_OWNER_OPERATION_REQUIRED')
    root = Path(directory)
    if private_file(root / 'COMPLETE').read_text() != 'CULINOTE_ROLLBACK_ARTIFACT_VERIFIED\n':
        raise ValueError('COMPLETE_REQUIRED')
    record = verify(root, require_image=False, expected_record_sha=expected_record_sha)
    if 'image.tar' in record['files']:
        with (root / 'image.tar').open('rb') as source:
            subprocess.run(['docker', 'image', 'load'], stdin=source, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=300)
    image_identity(record['image_id'])
    # No application start, DB change, env installation or media copy.
    return record


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['preserve', 'verify', 'restore-image'])
    for key in ['directory', 'image', 'compose', 'runtime-env', 'media', 'postgres-image']:
        p.add_argument('--' + key, required=key == 'directory')
    p.add_argument('--confirm-owner-authorized-preservation', action='store_true')
    p.add_argument('--expected-record-sha')
    p.add_argument('--export-image', action='store_true')
    v = p.parse_args()
    os.umask(0o077)
    try:
        if v.mode == 'preserve':
            preserve(v.directory, v.image, v.compose, v.runtime_env, v.media, v.postgres_image, v.confirm_owner_authorized_preservation, v.export_image)
        elif v.mode == 'restore-image':
            restore_image(v.directory, v.confirm_owner_authorized_preservation, v.expected_record_sha)
        else:
            if not v.expected_record_sha:
                raise ValueError('APPROVED_RECORD_SHA_REQUIRED')
            verify(v.directory, expected_record_sha=v.expected_record_sha)
        print('ROLLBACK_ARTIFACT=PASS; contents not logged')
    except Exception:
        print('ROLLBACK_ARTIFACT=FAIL; private details suppressed', file=sys.stderr)
        sys.exit(1)
