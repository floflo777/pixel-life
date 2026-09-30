#!/usr/bin/env bash
# Renders the vhost template with the origin key from deploy/.env and prints it to stdout.
# Usage: deploy/nginx/render.sh deploy/.env > /tmp/rf-origin.conf && sudo install -m 600 /tmp/rf-origin.conf /etc/nginx/sites-available/rf-origin.ailog.fr.conf
set -euo pipefail
env_file="${1:?path to deploy/.env}"
here="$(cd "$(dirname "$0")" && pwd)"
key="$(grep -E '^ORIGIN_KEY=' "$env_file" | tail -n1 | cut -d= -f2-)"
[[ "$key" =~ ^[A-Za-z0-9_-]{32,}$ ]] || { echo "ORIGIN_KEY must be >= 32 chars of [A-Za-z0-9_-] (use openssl rand -hex 32)" >&2; exit 1; }
sed "s/__ORIGIN_KEY__/${key}/g" "$here/rf-origin.ailog.fr.conf.template"
