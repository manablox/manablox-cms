#!/usr/bin/env bash
# Writes pnpm-lock.yaml without installing anything on the host, using the same Node and
# pnpm the image uses. The Dockerfile installs with --frozen-lockfile, so the lockfile has
# to exist and be committed. Rerun after changing package.json.
set -euo pipefail
cd "$(dirname "$0")/.."

# `corepack pnpm` rather than `corepack enable`: enabling symlinks into /usr/local/bin,
# which the non-root user this runs as (so the lockfile is yours) cannot write.
docker run --rm -u "$(id -u):$(id -g)" -e CI=true -e HOME=/tmp \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -v "$PWD:/app" -w /app \
  node:24-bookworm-slim corepack pnpm install --lockfile-only
