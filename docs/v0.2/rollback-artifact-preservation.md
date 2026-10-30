# Owner rollback artifact procedure — NOT EXECUTED ON PRODUCTION

Distinguish rebuilt v0.1 source compatibility, the currently installed image,
and a verified immutable rollback artifact. CI rebuilds source
`4f4807aa90c1bb52d6faaec5121f7c27bdada464`; it does not establish byte identity with
the observed production image `sha256:f4d91a98d61246eed4696bbd977bfab2c2fddd48cb4d5364c5ab2eed997b5809`.
The known previous configuration directory is
`/opt/docker-stacks/recipes/releases/4f4807aa90c1bb52d6faaec5121f7c27bdada464/`.
These are prior observations, not values automatically discovered or fetched.

The owner has not chosen separate OCI archiving. Default preservation therefore
records exact image identity/reference and privately copies matching configuration;
it never pulls or exports an image. Keep the actual local image available through
release/rollback. Reference-only recovery fails if that image is missing; source
rebuild is then distinct evidence and cannot be called an exact-image rollback.
Do not introduce an automatic registry/archive task.

## Future owner-approved operation

STOP until acquisition/private configuration copying is authorized. None of
these commands run in this phase. The trusted owner supplies an already securely
delegated private runtime.env copy; do not weaken the original root:0600 file or
grant general host root access. Use an encrypted private workspace outside Git,
sync folders and public storage. Never echo or source that file into logs.

Record the actual image ID/RepoDigest/revision, actual PG image/version, media
bind mapping, Compose configuration hash, file modes/ownership and source CI in
the release record. Reinspect identities at operation time; stop on mismatch.

```sh
# IMAGE_ID, PG_IMAGE_ID, MEDIA_PATH and private input paths must be explicitly
# filled from the approved release record, not a mutable tag or guessed SHA.
python3 scripts/backup/rollback_artifact.py preserve \
  --directory /private/rollback-ARTIFACT_ID --image "$IMAGE_ID" \
  --compose /private/approved-compose.yaml --runtime-env /private/approved-runtime.env \
  --media "$MEDIA_PATH" --postgres-image "$PG_IMAGE_ID" \
  --confirm-owner-authorized-preservation
sha256sum /private/rollback-ARTIFACT_ID/artifact.json
```

Record that metadata SHA separately in the approved release record. The tool
creates private files, validates checksums and publishes COMPLETE last. The
metadata never contains environment values. `runtime.env` itself is sensitive and
is copied only inside that private directory. Do not upload this directory to CI.

An archive is optional ONLY under separate explicit owner approval. Adding
`--export-image` runs `docker image save` and adds private `image.tar`. CI exercises
that path solely with a uniquely labelled synthetic image, never a production
image. No production image archive is generated or acquired in this phase.

```sh
python3 scripts/backup/rollback_artifact.py verify \
  --directory /private/rollback-ARTIFACT_ID --expected-record-sha "$APPROVED_RECORD_SHA"
# Separate owner authorization required. With an archive this loads only the
# validated archive; reference-only mode checks that the exact image exists.
python3 scripts/backup/rollback_artifact.py restore-image \
  --directory /private/rollback-ARTIFACT_ID --expected-record-sha "$APPROVED_RECORD_SHA" \
  --confirm-owner-authorized-preservation
```

The utility rejects root execution, missing approval, existing output targets,
symlink/public inputs, missing COMPLETE and checksum/identity mismatches. It does
not start an application, install an env, modify PostgreSQL or copy media.
Do not infer that Docker save/load preserves every registry alias across engine
implementations; exact inspected image ID must still match or verification fails.

## Application/configuration recovery

After separate rollback approval, verify private configuration hashes and restore
its original reviewed owner/mode through the authorized deployment mechanism.
Use the actual previous image by digest, exact Compose/project and matching media
mount. Keep schema 0002/0003 and full v0.2 inventory bridge after app-only rollback.
No destructive down-migration exists. Revalidate public/admin/media/readiness and
backups before lifting maintenance. Do not overwrite IndexedDB or basket data.

Full database recovery is a different owner-approved operation with matching
dump/media/app/policy, first rehearsed in isolation. All server-side writes after
the selected recovery point may be lost. Never automatically restore over live
PostgreSQL. Actual-image acquisition/testing and a fresh rollback checkpoint remain
production-only gates; synthetic image/config roundtrip is not their completion.
