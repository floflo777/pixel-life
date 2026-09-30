#!/usr/bin/env bash
# Server-side half of scripts/deploy.sh. Copied over ssh to a temp file and run once per step, so it
# needs nothing pre-installed on the host beyond bash, docker compose, nginx, certbot, curl and openssl.
#
# Touches only Pixel Life resources: $ROOT (/home/ubuntu/pixel-life), the compose project `pixel-life`
# (containers pixel-life-*, network pixel-life-net, volume pixel-life-pgdata, images pixel-life-server:*),
# /etc/nginx/sites-{available,enabled}/pixel-life-origin.conf, /etc/nginx/snippets/pixel-life-cloudflare-allow.conf,
# /var/www/pixel-life-acme and the Let's Encrypt lineage named after $ORIGIN_HOST. Never another vhost or container.
#
# Environment (set by scripts/deploy.sh): RELEASE (git sha), ORIGIN_HOST, APP_URL, DRY_RUN (0/1), ROOT.
set -euo pipefail

ROOT="${ROOT:-/home/ubuntu/pixel-life}"
DRY_RUN="${DRY_RUN:-0}"
ORIGIN_HOST="${ORIGIN_HOST:-rf-origin.ailog.fr}"
APP_URL="${APP_URL:-https://pixel-life.florent-g.workers.dev}"
VHOST_NAME="pixel-life-origin.conf"
SNIPPET="/etc/nginx/snippets/pixel-life-cloudflare-allow.conf"
ACME_ROOT="/var/www/pixel-life-acme"
CERT="/etc/letsencrypt/live/$ORIGIN_HOST/fullchain.pem"
CERT_KEY="/etc/letsencrypt/live/$ORIGIN_HOST/privkey.pem"

log() { printf '  [ailog] %s\n' "$*" >&2; }
# Every state-changing command goes through run: printed, and skipped under --dry-run.
run() {
  printf '  [ailog] $ %s\n' "$*" >&2
  [[ "$DRY_RUN" == 1 ]] || "$@"
}
die() { printf '  [ailog] ERROR: %s\n' "$*" >&2; exit 1; }

release_dir() { echo "$ROOT/releases/${1:?release}"; }
compose() {
  # compose <release> <args...>: runs docker compose for that release's files with its image tag.
  local rel="$1"; shift
  run sudo env SERVER_TAG="$rel" docker compose -p pixel-life -f "$(release_dir "$rel")/deploy/docker-compose.yml" "$@"
}
# Under --dry-run the release may not be uploaded yet: steps that read its files stop after printing their intent.
need_release_files() {
  [[ -d "$(release_dir "${RELEASE:?}")" ]] && return 0
  [[ "$DRY_RUN" == 1 ]] || die "release $RELEASE not uploaded"
  log "(dry run) release not uploaded yet: would $1"
  return 1
}
current_release() { if [[ -L "$ROOT/current" ]]; then basename "$(readlink "$ROOT/current")"; else echo none; fi; }

# Removes the nginx vhost we are about to replace if nginx -t fails, restoring the previous file.
nginx_install() {
  # nginx_install <rendered file>
  local src="$1" avail="/etc/nginx/sites-available/$VHOST_NAME" enabled="/etc/nginx/sites-enabled/$VHOST_NAME"
  if sudo test -f "$avail" && sudo cmp -s "$src" "$avail"; then
    log "nginx vhost unchanged"
    sudo test -L "$enabled" || run sudo ln -s "$avail" "$enabled"
    return 0
  fi
  local had_old=0
  if sudo test -f "$avail"; then had_old=1; run sudo cp -a "$avail" "$avail.bak"; fi
  run sudo install -m 600 -o root -g root "$src" "$avail"
  sudo test -L "$enabled" || run sudo ln -s "$avail" "$enabled"
  [[ "$DRY_RUN" == 1 ]] && return 0
  printf '  [ailog] $ sudo nginx -t\n' >&2
  if sudo nginx -t; then
    run sudo systemctl reload nginx
  else
    log "nginx -t failed: restoring the previous Pixel Life vhost (no other vhost touched)"
    if [[ $had_old == 1 ]]; then sudo mv "$avail.bak" "$avail"; else sudo rm -f "$enabled" "$avail"; fi
    sudo nginx -t >/dev/null 2>&1 || die "nginx -t still failing after restore: investigate before reloading"
    die "vhost rejected by nginx -t"
  fi
}

step_prepare() {
  # Directory layout + release symlink to the root-only .env.
  local rel="${RELEASE:?}" dir
  dir="$(release_dir "$rel")"
  [[ -d "$dir" || "$DRY_RUN" == 1 ]] || die "release $rel not uploaded"
  run mkdir -p "$ROOT/backups"
  [[ -L "$dir/deploy/.env" ]] || run ln -sfn "$ROOT/.env" "$dir/deploy/.env"
}

step_secrets() {
  # Generates $ROOT/.env once (root:root 600). Existing secrets are never regenerated.
  local rel="${RELEASE:?}" example
  if sudo test -f "$ROOT/.env"; then
    log ".env exists (secrets kept)"
    sudo grep -q "^PUBLIC_ORIGINS=$APP_URL" "$ROOT/.env" || log "WARNING: PUBLIC_ORIGINS in $ROOT/.env does not include $APP_URL"
    return 0
  fi
  example="$(release_dir "$rel")/deploy/.env.example"
  log "generating $ROOT/.env from .env.example with openssl rand -hex 32 (values never printed)"
  [[ "$DRY_RUN" == 1 ]] && return 0
  local tmp
  tmp="$(sudo mktemp)"
  sudo chmod 600 "$tmp"
  sudo bash -c '
    set -euo pipefail
    example="$1"; out="$2"; app="$3"
    while IFS= read -r line; do
      case "$line" in
        POSTGRES_PASSWORD=*|ORIGIN_KEY=*|SESSION_SECRET=*|DAILY_SECRET=*)
          printf "%s=%s\n" "${line%%=*}" "$(openssl rand -hex 32)" ;;
        PUBLIC_ORIGINS=*) printf "PUBLIC_ORIGINS=%s\n" "$app" ;;
        *) printf "%s\n" "$line" ;;
      esac
    done < "$example" > "$out"
    ! grep -q change-me "$out"
  ' _ "$example" "$tmp" "$APP_URL"
  run sudo install -m 600 -o root -g root "$tmp" "$ROOT/.env"
  sudo rm -f "$tmp"
}

step_build() {
  local rel="${RELEASE:?}"
  if sudo docker image inspect "pixel-life-server:$rel" >/dev/null 2>&1; then
    log "image pixel-life-server:$rel exists (build skipped)"
    return 0
  fi
  compose "$rel" build server
}

step_migrate() {
  local rel="${RELEASE:?}"
  compose "$rel" up -d --wait --wait-timeout 120 postgres
  compose "$rel" run --rm --no-deps -T server node apps/server/dist/migrate.mjs
}

step_up() {
  local rel="${RELEASE:?}" prev
  prev="$(current_release)"
  compose "$rel" up -d --wait --wait-timeout 180 server postgres
  run sudo docker tag "pixel-life-server:$rel" pixel-life-server:latest
  if [[ "$prev" != "$rel" && "$prev" != none ]]; then
    [[ "$DRY_RUN" == 1 ]] || echo "$prev" > "$ROOT/.previous-release"
  fi
  run ln -sfn "$(release_dir "$rel")" "$ROOT/current"
  log "current release: $rel (previous: $prev)"
}

step_tls() {
  if sudo test -f "$CERT"; then
    log "certificate present: $(sudo openssl x509 -in "$CERT" -noout -enddate)"
    return 0
  fi
  local rel="${RELEASE:?}" tmp
  need_release_files "serve HTTP-01 for $ORIGIN_HOST and run certbot certonly --webroot" || return 0
  run sudo mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
  # Serve the HTTP-01 challenge for this host only (a temporary port-80 vhost), then request the certificate.
  tmp="$(mktemp)"
  sed "s|__ORIGIN_HOST__|$ORIGIN_HOST|g" "$(release_dir "$rel")/deploy/nginx/acme-bootstrap.conf.template" > "$tmp"
  nginx_install "$tmp"
  rm -f "$tmp"
  run sudo certbot certonly --webroot -w "$ACME_ROOT" -d "$ORIGIN_HOST" --cert-name "$ORIGIN_HOST" \
    --non-interactive --agree-tos --keep-until-expiring --deploy-hook "systemctl reload nginx"
}

step_nginx() {
  local rel="${RELEASE:?}" dir tmp
  dir="$(release_dir "$rel")"
  need_release_files "install $SNIPPET and render/install /etc/nginx/sites-available/$VHOST_NAME, nginx -t, reload" || return 0
  if ! sudo test -f "$SNIPPET"; then
    run sudo install -m 644 -o root -g root "$dir/deploy/nginx/cloudflare-allow.conf" "$SNIPPET"
  fi
  sudo test -f "$CERT" || [[ "$DRY_RUN" == 1 ]] || die "no certificate at $CERT: run the tls step first"
  tmp="$(sudo mktemp)"
  sudo env ORIGIN_HOST="$ORIGIN_HOST" SSL_CERT="$CERT" SSL_KEY="$CERT_KEY" \
    bash "$dir/deploy/nginx/render.sh" "$ROOT/.env" | sudo tee "$tmp" >/dev/null
  sudo chmod 600 "$tmp"
  nginx_install "$tmp"
  sudo rm -f "$tmp"
}

step_verify() {
  # On-host checks through nginx (loopback is allow-listed), with and without the key. The key stays in root's hands.
  [[ "$DRY_RUN" == 1 ]] && { log "verify skipped (dry run)"; return 0; }
  sudo bash -s "$ROOT/.env" "$ORIGIN_HOST" <<'EOF'
set -uo pipefail
key="$(sed -n 's/^ORIGIN_KEY=//p' "$1" | tail -n1)"; host="$2"; fail=0
hdr="$(mktemp)"; chmod 600 "$hdr"; printf 'x-pl-origin-key: %s\n' "$key" > "$hdr"; trap 'rm -f "$hdr"' EXIT
check() { # check <expected> <path> <with-key 0/1>
  local extra=(); [[ "$3" == 1 ]] && extra=(-H "@$hdr")
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve "$host:443:127.0.0.1" "${extra[@]}" "https://$host$2")"
  local tag=ok; [[ "$code" == "$1" ]] || { tag=FAIL; fail=1; }
  printf '  [ailog] %-4s %-12s key=%s → %s (want %s)\n' "$tag" "$2" "$3" "$code" "$1" >&2
}
check 200 /api/health 1; check 200 /api/ready 1; check 200 /health 1; check 200 /ready 1
check 403 /api/health 0; check 403 /ready 0; check 404 /healthz 1
body="$(curl -s --max-time 5 --resolve "$host:443:127.0.0.1" -H "@$hdr" "https://$host/api/ready")"
printf '  [ailog] /api/ready → %s\n' "$body" >&2
exit $fail
EOF
}

step_status() {
  log "current: $(current_release)  previous: $(cat "$ROOT/.previous-release" 2>/dev/null || echo none)"
  log "releases: $(ls "$ROOT/releases" 2>/dev/null | tr '\n' ' ')"
  sudo docker compose -p pixel-life ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' >&2 || true
  sudo docker image ls pixel-life-server --format '  [ailog] image {{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}' >&2
  sudo test -f "$CERT" && log "cert: $(sudo openssl x509 -in "$CERT" -noout -enddate)"
}

step_rollback() {
  local rel="${RELEASE:-}"
  [[ -n "$rel" ]] || rel="$(cat "$ROOT/.previous-release" 2>/dev/null)" || die "no previous release recorded"
  [[ -d "$(release_dir "$rel")" ]] || die "release $rel not on the host"
  sudo docker image inspect "pixel-life-server:$rel" >/dev/null 2>&1 || die "image pixel-life-server:$rel missing"
  log "rolling back to $rel (migrations are forward-only: the schema stays where it is)"
  RELEASE="$rel" step_up
}

step="${1:?step}"
case "$step" in
  prepare | secrets | build | migrate | up | tls | nginx | verify | status | rollback) "step_$step" ;;
  *) die "unknown step $step" ;;
esac
