# syntax=docker/dockerfile:1.7
# Provisioning artifact ONLY. Never run with a Docker socket or production mounts.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS dependencies
WORKDIR /work
COPY package.json package-lock.json ./
COPY scripts/backup/environment-manifest.mjs scripts/backup/build-inputs.json ./scripts/backup/
RUN npm ci && test "$(node --version)" = "v24.20.0"
RUN mkdir /bundle && cp /usr/local/bin/node /bundle/node && cp -a node_modules /bundle/node_modules && \
    node scripts/backup/environment-manifest.mjs /bundle package-lock.json && \
    chmod -R go-w /bundle && chmod 600 /bundle/environment.json
FROM scratch AS bundle
COPY --from=dependencies /bundle /bundle
