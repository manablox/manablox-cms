#!/usr/bin/env bash
# Writes a self-signed certificate for the TLS domains into nginx/certs/, for a trial on a
# machine of your own. Browsers will warn about it. For production replace the two files
# with a real certificate (for example from certbot on the host) and run
# `docker compose restart nginx`. openssl runs in a container, so nothing is needed on
# the host.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p nginx/certs
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/nginx/certs:/certs" alpine/openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout /certs/privkey.pem -out /certs/fullchain.pem \
  -subj "/CN=__TLS_HOST__" -addext "subjectAltName=__TLS_SAN__"

echo "self-signed certificate for __TLS_HOSTS__ written to nginx/certs/"
