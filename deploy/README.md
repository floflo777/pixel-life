# Pixel Life deployment runbook

Topology (architecture.md, HOSTING DECISION; `docs/DECISIONS.md` D-01):

```
browser ──https──▶ pixel-life.florent-g.workers.dev   (Cloudflare edge Worker, workers/edge)
                     ├─ static client: Workers Static Assets (apps/web/dist, SDK child docs + CSP)
                     └─ /api/*, /ws/* ──https + x-pl-origin-key──▶ ORIGIN_HOST (staging: rf-origin.app.ailog.fr)
                                                                    │ nginx 1.18: Cloudflare IPs (+ loopback) only,
                                                                    │ key required, /api/, /ws/, health aliases
                                                                    ▼
                                             127.0.0.1:3100  server (Node 22, Fastify + ws, Docker)
                                             127.0.0.1:55432 postgres 16 (Docker, volume pixel-life-pgdata)
```

## Staging (live)

| What              | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| App (Worker)      | https://pixel-life.florent-g.workers.dev                                                               |
| Health via Worker | https://pixel-life.florent-g.workers.dev/api/health, `/api/ready`                                      |
| Origin            | https://rf-origin.app.ailog.fr (403 unless the request comes from Cloudflare **and** carries the key)  |
| Host              | `ailog` (51.254.203.108), everything under `/home/ubuntu/pixel-life/`                                  |
| TLS               | Let's Encrypt `rf-origin.app.ailog.fr` (HTTP-01 webroot, auto-renewed by certbot.timer, reloads nginx) |

**Why `rf-origin.app.ailog.fr` and not `rf-origin.ailog.fr`.** The Cloudflare API token we were given has
`zone:read, zone_settings:*, worker:*` on ailog.fr but **no DNS permission**: `GET`/`POST /zones/…/dns_records`
return `10000 Authentication error`. `rf-origin.ailog.fr` does not exist yet and could not be created. The zone already
has a DNS-only wildcard `*.app.ailog.fr → 51.254.203.108`, so staging uses a name under it (exact `server_name` wins
over the team-chat regex vhost; nothing else changed). Consequence: the origin IP is visible for that name (it already
is for `*.app.ailog.fr`); the Cloudflare IP allow-list and the origin key still refuse everything that is not the Worker.

**Switching to the target `rf-origin.ailog.fr` (proxied)** once a token with `Zone → DNS → Edit` on ailog.fr exists:

```sh
ORIGIN_HOST=rf-origin.ailog.fr CF_ENV_FILE=~/cf.env scripts/deploy.sh --only dns,tls,nginx,verify,edge,verify-edge
```

`dns` creates the proxied A record (after checking it does not exist), `tls` gets a Let's Encrypt certificate over
HTTP-01 through the proxy, `nginx` re-renders the vhost for the new host, `edge` redeploys the Worker with the new
`ORIGIN_URL`. Then set `ORIGIN_HOST` default in `scripts/deploy.sh` and `ORIGIN_URL` in `workers/edge/wrangler.jsonc`
to the new host and commit. (With SSL mode Full (strict) a Cloudflare Origin Certificate also works: place it under
`/etc/ssl/cloudflare/` and render with `SSL_CERT`/`SSL_KEY`; the token cannot issue one today, it lacks SSL:Edit.)

## Deploying: `scripts/deploy.sh`

Deploys the **committed** `HEAD` (release id = 12-char sha); uncommitted changes are ignored with a warning.
Requirements on the workstation: `ssh ailog` (passwordless sudo), `git`, `jq`, `curl`, `dig`, `npm ci` done.

```sh
export CF_ENV_FILE=/path/to/cf.env           # file with CLOUDFLARE_API_TOKEN=... (never committed, never printed)
scripts/deploy.sh --dry-run                  # prints every state-changing command, changes nothing
scripts/deploy.sh                            # full deploy (idempotent: re-running changes only what differs)
scripts/deploy.sh --only build,migrate,up    # server only; steps listed below
scripts/deploy.sh --only edge,verify-edge    # Worker only
scripts/deploy.sh --status                   # releases, containers, images, certificate
scripts/deploy.sh --rollback [sha]           # server back to the previous (or given) release
```

| Step          | Where       | What it does (skipped when already in the desired state)                                                                                                                                                                                                                                 |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dns`         | Cloudflare  | `auto`: if `ORIGIN_HOST` resolves, nothing; else create proxied A → `ORIGIN_IP` via API (after a GET). `DNS_MODE=cloudflare` always uses the API, `skip` skips.                                                                                                                          |
| `push`        | ailog       | `git archive <sha>` → `releases/<sha>/` (atomic `mv`), `releases/<sha>/deploy/.env` → symlink to `/home/ubuntu/pixel-life/.env`.                                                                                                                                                         |
| `secrets`     | ailog       | Creates `/home/ubuntu/pixel-life/.env` **once** (root:root 600): `ORIGIN_KEY`, `SESSION_SECRET`, `DAILY_SECRET`, `POSTGRES_PASSWORD` = `openssl rand -hex 32`, `PUBLIC_ORIGINS=$APP_URL`. Never regenerated, never printed.                                                              |
| `build`       | ailog       | `docker compose build server` → image `pixel-life-server:<sha>` (skipped if the image exists).                                                                                                                                                                                           |
| `migrate`     | ailog       | `up -d --wait postgres`, then `run --rm server node apps/server/dist/migrate.mjs` (advisory-locked, transactional; the server also migrates on start).                                                                                                                                   |
| `up`          | ailog       | `up -d --wait server postgres` with `SERVER_TAG=<sha>` (waits for healthchecks), tags `:latest`, `current → releases/<sha>`, previous sha in `.previous-release`.                                                                                                                        |
| `tls`         | ailog       | If `/etc/letsencrypt/live/$ORIGIN_HOST/` is missing: temporary port-80 vhost serving `/var/www/pixel-life-acme`, `certbot certonly --webroot --deploy-hook "systemctl reload nginx"`.                                                                                                    |
| `nginx`       | ailog       | Installs `/etc/nginx/snippets/pixel-life-cloudflare-allow.conf` (if absent), renders `origin.conf.template` as root (key never leaves the host), installs `pixel-life-origin.conf` if changed, `nginx -t` then reload; on a failed `nginx -t` the previous Pixel Life vhost is restored. |
| `verify`      | ailog       | Through nginx on loopback: `/api/health`, `/api/ready`, `/health`, `/ready` with key → 200; without key → 403; `/healthz` → 404.                                                                                                                                                         |
| `edge`        | Cloudflare  | Stages assets (see below), `wrangler deploy --var ORIGIN_URL:https://$ORIGIN_HOST`, then pipes `ORIGIN_KEY` from the host's `.env` into `wrangler secret put ORIGIN_KEY`.                                                                                                                |
| `verify-edge` | workstation | Worker `/` 200, `/api/health` + `/api/ready` 200, WS `/ws/room/plaza` without session 401, with a fresh guest 101; origin direct (no key / forged key) 403; `:3100` unreachable from outside.                                                                                            |

Configuration (environment; defaults are staging): `SSH_HOST=ailog`, `REMOTE_ROOT=/home/ubuntu/pixel-life`,
`ORIGIN_HOST=rf-origin.app.ailog.fr`, `ORIGIN_IP=51.254.203.108`, `DNS_MODE=auto`,
`APP_URL=https://pixel-life.florent-g.workers.dev`, `CF_ENV_FILE` or `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ZONE_ID`.

### Static assets: placeholder until the web build lands

`apps/web` has no `build` script on `main` yet, so `edge` copies `deploy/edge-placeholder/` ("Pixel Life — coming soon")
into `apps/web/dist` (gitignored) and deploys that. As soon as `apps/web/package.json` gets a `build` script (Vite →
`apps/web/dist`), the same command builds and deploys the real client instead; nothing else changes:

```sh
scripts/deploy.sh --only edge,verify-edge
```

## Layout on ailog

```
/home/ubuntu/pixel-life/
  .env                        root:root 600, secrets (see table below)
  current -> releases/<sha>   running release
  .previous-release           sha before the last `up` (rollback target)
  releases/<sha>/             git archive of each deployed commit; deploy/.env -> ../../../.env (symlink)
  backups/                    pg_dump output
/etc/nginx/sites-available/pixel-life-origin.conf   (+ symlink in sites-enabled), rendered, mode 600
/etc/nginx/snippets/pixel-life-cloudflare-allow.conf
/var/www/pixel-life-acme/                           HTTP-01 webroot
/etc/letsencrypt/live/rf-origin.app.ailog.fr/
docker: project pixel-life, containers pixel-life-{server,postgres}-1, network pixel-life-net,
        volume pixel-life-pgdata, images pixel-life-server:<sha> and :latest
```

Nothing else on the host is touched. Ports already used by other services (never touch them): 3000, 3004, 3010-3014,
3020, 3306, 4000, 4100, 5433, 8000, 8020, 8080, 8090, 8100, 8900.

## Secrets and variables

| Name                                            | Where                                        | Notes                                                                                     |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ORIGIN_KEY`                                    | host `.env`, Worker secret, nginx vhost      | Same value in all three; the script copies it host → vhost and host → Worker.             |
| `SESSION_SECRET`                                | host `.env`                                  | HS256 key for `pl_sess` / `pl_guest`. Rotating logs everyone out.                         |
| `DAILY_SECRET`                                  | host `.env`                                  | Daily seed HMAC. Rotate only between UTC days.                                            |
| `POSTGRES_PASSWORD`                             | host `.env`                                  | Hex, so it is URL-safe inside `DATABASE_URL`. Only read by postgres on first volume init. |
| `PUBLIC_ORIGINS`                                | host `.env`                                  | The Worker's public origin(s). SIWE only accepts these hosts.                             |
| `POSTGRES_DB`, `POSTGRES_USER`                  | host `.env`                                  | Defaults `pixel_life`.                                                                    |
| `RPC_URL`, `ECONOMY_MODE`, `LOG_LEVEL`          | host `.env`                                  | Defaults: public Robinhood RPC, `sim`, `info`.                                            |
| `ORIGIN_URL`                                    | `wrangler.jsonc` `vars` (+ `--var` override) | `https://$ORIGIN_HOST`.                                                                   |
| `SHELL_CSP`                                     | `wrangler.jsonc` `vars` (optional)           | Override the shell CSP; `""` disables it.                                                 |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | deploying shell only (`CF_ENV_FILE`)         | Never committed, never printed.                                                           |

Optional server variables (defaults in `apps/server/src/config.ts`): `CHAIN_ID` (4663), `GENERATIONS_ADDRESS`, `ROOMS`,
`SESSION_TTL_DAYS` (7), `GUEST_TTL_DAYS` (30), `DB_POOL_MAX` (10), `TRUST_EDGE_CLIENT_IP` (true), `MIGRATE_ON_START` (true).
The server refuses to start (exit 78) and lists every problem if the environment is invalid.

## Operations (on ailog unless noted)

```sh
cd /home/ubuntu/pixel-life/current/deploy
C="sudo docker compose -p pixel-life -f docker-compose.yml"
```

- **Status:** `scripts/deploy.sh --status` (workstation) or `$C ps`.
- **Logs:** `$C logs -f --tail 200 server` (JSON lines, pino; cookies and the origin key are redacted), `$C logs postgres`.
  Rotated by the json-file driver (5 × 10 MB per container). nginx: `sudo tail -f /var/log/nginx/pixel-life-origin.{access,error}.log`.
  Worker: `cd workers/edge && npx wrangler tail pixel-life` (workstation), or the dashboard (observability is on).
- **Update:** commit, then `scripts/deploy.sh` (or `--only push,build,migrate,up,verify` for the server alone). The server
  drains on SIGTERM (WebSockets closed with 1001; clients reconnect). `/readyz` stays 503 until the schema matches.
- **Rollback server:** `scripts/deploy.sh --rollback` (previous release) or `--rollback <sha>` (any release still under
  `releases/` with its image). It re-points `current`, retags `:latest`, restarts `server`, runs `verify`. Manual
  equivalent: `sudo env SERVER_TAG=<sha> docker compose -p pixel-life -f releases/<sha>/deploy/docker-compose.yml up -d --wait server`.
  Migrations are forward-only: a rollback across a schema change needs a down-migration written for it.
- **Rollback Worker:** `cd workers/edge && npx wrangler deployments list && npx wrangler rollback [<version-id>]`.
- **Manual migration:** `$C run --rm --no-deps -T server node apps/server/dist/migrate.mjs`.
- **Backup:** `$C exec -T postgres pg_dump -U pixel_life -Fc pixel_life > /home/ubuntu/pixel-life/backups/$(date -u +%F).dump`
  (daily cron recommended, keep 14). **Restore:** `$C exec -T postgres pg_restore -U pixel_life -d pixel_life --clean < file.dump`.
- **psql:** `$C exec postgres psql -U pixel_life pixel_life` (or `127.0.0.1:55432` from the host).
- **Refresh the Cloudflare allow-list:** `sudo /home/ubuntu/pixel-life/current/deploy/nginx/update-cloudflare-ips.sh`
  (validates with `nginx -t`, rolls back on failure; weekly cron recommended).
- **Rotate `ORIGIN_KEY`** (a few seconds of 403 on API calls; clients retry): `sudoedit /home/ubuntu/pixel-life/.env`
  (new value from `openssl rand -hex 32`), then from the workstation `scripts/deploy.sh --only up,nginx,verify,edge,verify-edge`
  (`up` recreates the server because its environment changed, `nginx` re-renders the vhost, `edge` re-puts the secret).
- **Rotate `SESSION_SECRET`:** edit `.env`, `$C up -d --force-recreate server`. All sessions and guest ids become invalid.
- **Revoke a wallet's sessions:** `UPDATE sessions SET revoked_at = now() WHERE address = lower('0x...') AND revoked_at IS NULL;`
- **Prune old releases:** keep the last few; for each old `<sha>` (never `current` or `.previous-release`):
  `rm -rf releases/<sha> && sudo docker image rm pixel-life-server:<sha>`. Never `docker system prune` on this host.
- **Stop Pixel Life:** `$C down` (keeps the volume). `down -v` deletes the database: never on production.
- **Remove Pixel Life entirely:** `$C down`, `sudo rm /etc/nginx/sites-enabled/pixel-life-origin.conf`, `sudo nginx -t && sudo systemctl reload nginx`,
  `sudo certbot delete --cert-name rf-origin.app.ailog.fr`, `npx wrangler delete pixel-life`; the volume `pixel-life-pgdata` holds the data.

## Local checks (no server, no Cloudflare)

```sh
npm run check                                   # lint, format, typecheck, tests (server tests start postgres:16-alpine in Docker)
docker build -f deploy/Dockerfile -t pixel-life-server .   # image builds from the repo root
scripts/deploy.sh --dry-run                     # whole plan, incl. wrangler deploy --dry-run (needs ssh + CF_ENV_FILE)
```

Server tests use a throwaway `postgres:16-alpine` container on a random loopback port, or `TEST_DATABASE_URL` if set.
