#!/usr/bin/env bash
# Pixel Life staging deploy: DNS → push release → secrets → build → migrate → up → TLS → nginx → verify → edge Worker.
# Idempotent: every step checks current state first and only changes what differs. Runbook: deploy/README.md.
#
#   scripts/deploy.sh                    # full deploy of the committed HEAD
#   scripts/deploy.sh --dry-run          # print every state-changing command, change nothing (wrangler --dry-run)
#   scripts/deploy.sh --only edge        # comma-separated subset of: dns,push,secrets,build,migrate,up,tls,nginx,verify,edge,verify-edge
#   scripts/deploy.sh --status           # releases, containers, images, certificate
#   scripts/deploy.sh --rollback [sha]   # server back to a previous release (default: the one before current)
#
# Configuration (environment, defaults = staging):
#   SSH_HOST=ailog  REMOTE_ROOT=/home/ubuntu/pixel-life  ORIGIN_IP=51.254.203.108
#   ORIGIN_HOST=rf-origin.app.ailog.fr   (target: rf-origin.ailog.fr, proxied, once the token has DNS:Edit; see README)
#   DNS_MODE=auto|cloudflare|skip         (cloudflare = create the proxied A record via API, fail if not permitted)
#   APP_URL=https://loose-pixels.florent-g.workers.dev
#   CF_ENV_FILE=<file exporting CLOUDFLARE_API_TOKEN>  CLOUDFLARE_ACCOUNT_ID  CF_ZONE_ID
# The Cloudflare token and the origin key are never printed.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SSH_HOST="${SSH_HOST:-ailog}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/ubuntu/pixel-life}"
ORIGIN_IP="${ORIGIN_IP:-51.254.203.108}"
ORIGIN_HOST="${ORIGIN_HOST:-rf-origin.app.ailog.fr}"
DNS_MODE="${DNS_MODE:-auto}"
APP_URL="${APP_URL:-https://loose-pixels.florent-g.workers.dev}"
CF_ZONE_ID="${CF_ZONE_ID:-62114316997926f94a39b912acd7c8d6}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-869416db860830f14b8416d67606325c}"
ALL_STEPS="dns,push,secrets,build,migrate,up,tls,nginx,verify,edge,verify-edge"

DRY_RUN=0
STEPS="$ALL_STEPS"
MODE=deploy
ROLLBACK_TO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run | -n) DRY_RUN=1 ;;
    --only) STEPS="${2:?--only needs a list}"; shift ;;
    --status) MODE=status ;;
    --rollback)
      MODE=rollback
      if [[ "${2:-}" =~ ^[0-9a-f]{7,40}$ ]]; then ROLLBACK_TO="$2"; shift; fi
      ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*" >&2; }
log() { printf '    %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
run() {
  printf '    $ %s\n' "$*" >&2
  [[ "$DRY_RUN" == 1 ]] || "$@"
}
want() { [[ ",$STEPS," == *",$1,"* ]]; }

load_cf() {
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] && return 0
  local f="${CF_ENV_FILE:-}"
  [[ -n "$f" && -f "$f" ]] || die "set CLOUDFLARE_API_TOKEN or CF_ENV_FILE=<file with CLOUDFLARE_API_TOKEN=...>"
  set -a; # shellcheck disable=SC1090
  . "$f"; set +a
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || die "$f does not define CLOUDFLARE_API_TOKEN"
}
cf_api() { # cf_api <method> <path> [json]
  curl -sS -X "$1" "https://api.cloudflare.com/client/v4$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H 'content-type: application/json' ${3:+--data "$3"}
}

# Runs one deploy/remote.sh step on the host (script copied to a temp file so no command can eat its stdin).
remote() {
  local step="$1" rel="${2-${RELEASE:-}}"
  ssh -o BatchMode=yes "$SSH_HOST" \
    "t=\$(mktemp) && cat > \$t && ROOT='$REMOTE_ROOT' RELEASE='$rel' ORIGIN_HOST='$ORIGIN_HOST' APP_URL='$APP_URL' DRY_RUN='$DRY_RUN' bash \$t '$step'; rc=\$?; rm -f \$t; exit \$rc" \
    < "$REPO/deploy/remote.sh"
}

step_dns() {
  say "dns: $ORIGIN_HOST → $ORIGIN_IP (mode $DNS_MODE)"
  [[ "$DNS_MODE" == skip ]] && { log "skipped"; return 0; }
  local resolved
  resolved="$(dig +short A "$ORIGIN_HOST" | tail -n1)"
  if [[ "$DNS_MODE" == auto && -n "$resolved" ]]; then
    # Existing DNS (e.g. the DNS-only *.app.ailog.fr wildcard) is left alone: a proxied record two levels deep
    # would not be covered by Cloudflare's Universal SSL certificate.
    log "$ORIGIN_HOST already resolves to $resolved: nothing to change"
    return 0
  fi
  load_cf
  local res
  res="$(cf_api GET "/zones/$CF_ZONE_ID/dns_records?type=A&name=$ORIGIN_HOST")"
  [[ "$(jq -r .success <<<"$res")" == true ]] ||
    die "Cloudflare DNS API refused: $(jq -c '.errors' <<<"$res") (the token needs Zone DNS:Edit on ailog.fr)"
  if [[ "$(jq '.result | length' <<<"$res")" -gt 0 ]]; then
    log "record exists: $(jq -c '.result[0] | {name, content, proxied}' <<<"$res")"
    [[ "$(jq -r '.result[0].content' <<<"$res")" == "$ORIGIN_IP" ]] || die "record points elsewhere: fix it by hand"
    return 0
  fi
  run cf_api POST "/zones/$CF_ZONE_ID/dns_records" \
    "{\"type\":\"A\",\"name\":\"$ORIGIN_HOST\",\"content\":\"$ORIGIN_IP\",\"proxied\":true,\"ttl\":1,\"comment\":\"Pixel Life origin (scripts/deploy.sh)\"}" |
    jq -c '{success, errors, result: (.result | {name, content, proxied}?)}' >&2
}

step_push() {
  say "push: release $RELEASE → $SSH_HOST:$REMOTE_ROOT/releases/$RELEASE"
  if ssh -o BatchMode=yes "$SSH_HOST" "test -d '$REMOTE_ROOT/releases/$RELEASE'"; then
    log "already on the host"
  else
    printf '    $ git archive %s | ssh %s tar -x -C %s/releases/%s\n' "$RELEASE" "$SSH_HOST" "$REMOTE_ROOT" "$RELEASE" >&2
    if [[ "$DRY_RUN" != 1 ]]; then
      git -C "$REPO" archive --format=tar "$RELEASE" |
        ssh -o BatchMode=yes "$SSH_HOST" "set -e; d='$REMOTE_ROOT/releases/$RELEASE'; mkdir -p \"\$d.tmp\"; tar -x -C \"\$d.tmp\"; mv \"\$d.tmp\" \"\$d\""
    fi
  fi
  remote prepare
}

# Local and gitignored (apps/web/dist), so it runs even under --dry-run: wrangler's dry run needs the directory.
stage_assets() {
  local dist="$REPO/apps/web/dist"
  if jq -e '.scripts.build' "$REPO/apps/web/package.json" >/dev/null; then
    say "edge assets: building apps/web"
    npm --prefix "$REPO" run build -w @pl/web
  else
    say "edge assets: apps/web has no build script yet → placeholder page (deploy/edge-placeholder)"
    rm -rf "$dist" && mkdir -p "$dist" && cp -R "$REPO/deploy/edge-placeholder/." "$dist/"
  fi
  [[ -f "$dist/index.html" ]] || die "no $dist/index.html after staging assets"
}

step_edge() {
  load_cf
  stage_assets
  say "edge: wrangler deploy pixel-life (ORIGIN_URL=https://$ORIGIN_HOST)"
  local wr=("$REPO/node_modules/.bin/wrangler")
  cd "$REPO/workers/edge"
  if [[ "$DRY_RUN" == 1 ]]; then
    "${wr[@]}" deploy --dry-run --outdir .wrangler/dry-run --var "ORIGIN_URL:https://$ORIGIN_HOST"
    log "(dry run) would set secret ORIGIN_KEY from $SSH_HOST:$REMOTE_ROOT/.env"
    return 0
  fi
  "${wr[@]}" deploy --var "ORIGIN_URL:https://$ORIGIN_HOST"
  printf '    $ ssh %s sudo sed -n s/^ORIGIN_KEY=//p .env | wrangler secret put ORIGIN_KEY\n' "$SSH_HOST" >&2
  ssh -o BatchMode=yes "$SSH_HOST" "sudo sed -n 's/^ORIGIN_KEY=//p' '$REMOTE_ROOT/.env' | tail -n1 | tr -d '\n'" |
    "${wr[@]}" secret put ORIGIN_KEY >/dev/null
  log "secret ORIGIN_KEY set"
}

step_verify_edge() {
  say "verify-edge: $APP_URL"
  [[ "$DRY_RUN" == 1 ]] && { log "skipped (dry run)"; return 0; }
  local fail=0 code jar
  jar="$(mktemp)"
  expect() { # expect <want> <label> <curl args...>; retried: a fresh Worker version takes a few seconds to roll out
    local want="$1" label="$2" i; shift 2
    for i in 1 2 3 4 5 6; do
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" || true)"
      [[ "$code" == "$want" ]] && break
      sleep 5
    done
    if [[ "$code" == "$want" ]]; then log "ok   $label → $code"; else log "FAIL $label → $code (want $want)"; fail=1; fi
  }
  local ws=(--http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13'
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H "Origin: $APP_URL")
  expect 200 "GET /" "$APP_URL/"
  expect 200 "GET /api/health (via Worker)" "$APP_URL/api/health"
  expect 200 "GET /api/ready (via Worker)" "$APP_URL/api/ready"
  log "     /api/ready body: $(curl -s --max-time 10 "$APP_URL/api/ready")"
  # Without a session the origin's room handler refuses the upgrade (401): proves the Worker → nginx → server path.
  expect 401 "WS upgrade /ws/room/plaza, no session" "${ws[@]}" "$APP_URL/ws/room/plaza"
  # With a guest session (creates one guest row in the staging DB) the upgrade completes end to end (101).
  curl -s -o /dev/null --max-time 10 -c "$jar" -X POST "$APP_URL/api/guest" -H "Origin: $APP_URL" \
    -H 'content-type: application/json' -d '{}'
  expect 101 "WS upgrade /ws/room/plaza, guest session" --max-time 3 -b "$jar" "${ws[@]}" "$APP_URL/ws/room/plaza"
  rm -f "$jar"
  expect 403 "direct origin, no key (not via Cloudflare)" "https://$ORIGIN_HOST/api/health"
  expect 403 "direct origin, forged key, non-Cloudflare IP" -H 'x-pl-origin-key: forged' "https://$ORIGIN_HOST/api/health"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://$ORIGIN_IP:3100/healthz" || true)"
  if [[ "$code" == 000 ]]; then log "ok   $ORIGIN_IP:3100 unreachable from outside"; else log "FAIL $ORIGIN_IP:3100 → $code"; fail=1; fi
  [[ $fail == 0 ]] || die "edge verification failed"
}

cd "$REPO"
command -v jq >/dev/null || die "jq is required"
RELEASE="$(git -C "$REPO" rev-parse --short=12 HEAD)"
[[ -z "$(git -C "$REPO" status --porcelain -- apps packages deploy workers vendor package.json package-lock.json)" ]] ||
  log "WARNING: uncommitted changes are NOT deployed (the release is the committed HEAD $RELEASE)"

case "$MODE" in
  status) remote status; exit 0 ;;
  rollback)
    say "rollback server to ${ROLLBACK_TO:-previous release}"
    remote rollback "$ROLLBACK_TO"
    remote verify
    remote status
    log "The edge Worker is unchanged. To roll it back too: (cd workers/edge && npx wrangler rollback)"
    exit 0
    ;;
esac

[[ "$DRY_RUN" == 1 ]] && say "DRY RUN: nothing will be changed"
say "release $RELEASE  origin https://$ORIGIN_HOST  app $APP_URL  steps $STEPS"
want dns && step_dns
want push && step_push
for s in secrets build migrate up tls nginx verify; do
  if want "$s"; then say "$s"; remote "$s"; fi
done
want edge && step_edge
want verify-edge && step_verify_edge
say "done: release $RELEASE"
