#!/usr/bin/env bash
# Regenerates the Cloudflare allow-list snippet from Cloudflare's published ranges, validates nginx, reloads.
# Usage (on the host, as root): deploy/nginx/update-cloudflare-ips.sh [/etc/nginx/snippets/cloudflare-allow.conf]
set -euo pipefail
target="${1:-/etc/nginx/snippets/cloudflare-allow.conf}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
v4="$(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v4)"
v6="$(curl -fsS --max-time 10 https://www.cloudflare.com/ips-v6)"
# Refuse to write an empty or suspicious list: that would lock Cloudflare out (or let everyone in).
[[ "$(wc -w <<<"$v4")" -ge 10 && "$(wc -w <<<"$v6")" -ge 5 ]] || { echo "unexpected Cloudflare IP list" >&2; exit 1; }
{
  echo "# Cloudflare edge IP ranges, generated $(date -u +%FT%TZ) by update-cloudflare-ips.sh"
  for cidr in $v4 $v6; do
    [[ "$cidr" =~ ^[0-9a-f:.]+/[0-9]+$ ]] || { echo "bad CIDR: $cidr" >&2; exit 1; }
    echo "allow $cidr;"
  done
} >"$tmp"
cp "$target" "$target.bak" 2>/dev/null || true
install -m 644 "$tmp" "$target"
if nginx -t; then
  systemctl reload nginx
else
  [[ -f "$target.bak" ]] && mv "$target.bak" "$target"
  echo "nginx -t failed; previous list restored" >&2
  exit 1
fi
