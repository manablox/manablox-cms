#!/usr/bin/env bash
# Build the production images from docker/Dockerfile.*:
#
#   api    docker/Dockerfile.api    the management API, the public API (same image, other
#                                   entrypoint) and the migrations
#   admin  docker/Dockerfile.admin  the prebuilt admin behind nginx
#
# Images are named <prefix>/cms-<image>:<tag>, ghcr.io/manablox/cms-api:0.50.0 by default - the
# names the release workflow pushes. CI builds with the docker actions instead, for the
# layer cache; the Dockerfiles are the same.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$ROOT"

ALL_IMAGES=(api admin)

prefix="${IMAGE_PREFIX:-ghcr.io/manablox}"
tag=""
push=false
images=()

usage() {
  cat <<'USAGE'
Usage: scripts/docker-build.sh [options] [image...]

  image             api, admin (default: both)
  --tag <tag>       image tag (default: the workspace version, e.g. 0.50.0)
  --prefix <name>   registry and namespace (default: $IMAGE_PREFIX or ghcr.io/manablox)
  --push            push each image after building it (log in to the registry first)
  -h, --help        this message
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="${2:?--tag needs a tag}"; shift ;;
    --prefix) prefix="${2:?--prefix needs a name}"; shift ;;
    --push) push=true ;;
    -h|--help) usage; exit 0 ;;
    -*) usage_error "unknown option '$1'" ;;
    *)
      case " ${ALL_IMAGES[*]} " in
        *" $1 "*) images+=("$1") ;;
        *) usage_error "unknown image '$1'" ;;
      esac
      ;;
  esac
  shift
done

if [ ${#images[@]} -eq 0 ]; then images=("${ALL_IMAGES[@]}"); fi
if [ -z "$tag" ]; then
  tag="$(sed -nE 's/^  "version": "([^"]+)",?$/\1/p' package.json | head -n1)"
  [ -n "$tag" ] || die "could not read the version from package.json; pass --tag"
fi

require_docker

built=()
for image in "${images[@]}"; do
  name="$prefix/cms-$image:$tag"
  log "building $name from docker/Dockerfile.$image"
  DOCKER_BUILDKIT=1 docker build \
    --file "docker/Dockerfile.$image" \
    --tag "$name" \
    --label "org.opencontainers.image.source=https://github.com/manablox/manablox-cms" \
    --label "org.opencontainers.image.version=$tag" \
    .
  built+=("$name")
done

if [ "$push" = true ]; then
  for name in "${built[@]}"; do
    log "pushing $name"
    docker push "$name"
  done
fi

log "built: ${built[*]}"
