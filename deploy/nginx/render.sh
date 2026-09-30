#!/usr/bin/env bash
# Renders the origin vhost template to stdout, with the origin key read from the server's .env.
# Usage (on the host, as root, so the key never leaves it):
#   ORIGIN_HOST=rf-origin.app.ailog.fr SSL_CERT=/etc/letsencrypt/live/<host>/fullchain.pem \
#   SSL_KEY=/etc/letsencrypt/live/<host>/privkey.pem deploy/nginx/render.sh /home/ubuntu/pixel-life/.env > out.conf
# SSL_CERT / SSL_KEY default to the Let's Encrypt paths for ORIGIN_HOST.
set -euo pipefail
env_file="${1:?path to the server .env}"
host="${ORIGIN_HOST:-rf-origin.ailog.fr}"
cert="${SSL_CERT:-/etc/letsencrypt/live/$host/fullchain.pem}"
key_file="${SSL_KEY:-/etc/letsencrypt/live/$host/privkey.pem}"
here="$(cd "$(dirname "$0")" && pwd)"
key="$(grep -E '^ORIGIN_KEY=' "$env_file" | tail -n1 | cut -d= -f2-)"
[[ "$key" =~ ^[A-Za-z0-9_-]{32,}$ ]] || { echo "ORIGIN_KEY must be >= 32 chars of [A-Za-z0-9_-] (use openssl rand -hex 32)" >&2; exit 1; }
[[ "$host" =~ ^[a-z0-9.-]+$ ]] || { echo "bad ORIGIN_HOST: $host" >&2; exit 1; }
[[ "$cert$key_file" =~ ^[A-Za-z0-9/._-]+$ ]] || { echo "bad SSL_CERT/SSL_KEY path" >&2; exit 1; }
sed -e "s|__ORIGIN_KEY__|${key}|g" -e "s|__ORIGIN_HOST__|${host}|g" \
  -e "s|__SSL_CERT__|${cert}|g" -e "s|__SSL_KEY__|${key_file}|g" "$here/origin.conf.template"
