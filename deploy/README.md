# Pixel Life deployment runbook

Topology (architecture.md, HOSTING DECISION; `docs/DECISIONS.md` D-01):

```
browser ──https──▶ pixel-life.<account>.workers.dev   (Cloudflare edge Worker, workers/edge)
                     ├─ static client: Workers Static Assets (apps/web/dist, SDK child docs + CSP)
                     └─ /api/*, /ws/* ──https + x-pl-origin-key──▶ rf-origin.ailog.fr (Cloudflare-proxied DNS)
                                                                    │ nginx: Cloudflare IPs only, key required,
                                                                    │ only /api/ and /ws/
                                                                    ▼
                                             127.0.0.1:3100  server (Node 22, Fastify + ws, Docker)
                                             127.0.0.1:55432 postgres 16 (Docker, volume pixel-life-pgdata)
```

Nothing here has been deployed. Every step that touches the server or Cloudflare needs the owner's go-ahead.

## Secrets and variables

| Name                                            | Where                                           | Notes                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN_KEY`                                    | `deploy/.env`, Worker secret, nginx vhost       | Same value in all three. `openssl rand -hex 32`.                                                                          |
| `SESSION_SECRET`                                | `deploy/.env`                                   | HS256 key for `pl_sess` / `pl_guest`. Rotating logs everyone out.                                                         |
| `DAILY_SECRET`                                  | `deploy/.env`                                   | Daily seed HMAC. Rotate only between UTC days.                                                                            |
| `POSTGRES_PASSWORD`                             | `deploy/.env`                                   | Hex, so it is URL-safe inside `DATABASE_URL`.                                                                             |
| `PUBLIC_ORIGINS`                                | `deploy/.env`                                   | The Worker's public origin(s). SIWE only accepts these hosts. Update if the workers.dev subdomain is renamed (floflo777). |
| `POSTGRES_DB`, `POSTGRES_USER`                  | `deploy/.env`                                   | Defaults `pixel_life`.                                                                                                    |
| `RPC_URL`, `ECONOMY_MODE`, `LOG_LEVEL`          | `deploy/.env`                                   | Defaults: public Robinhood RPC, `sim`, `info`.                                                                            |
| `ORIGIN_URL`                                    | `workers/edge/wrangler.jsonc` `vars`            | `https://rf-origin.ailog.fr`.                                                                                             |
| `SHELL_CSP`                                     | `workers/edge/wrangler.jsonc` `vars` (optional) | Override the shell CSP; `""` disables it.                                                                                 |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the deploying shell / CI environment only       | For `wrangler deploy`. Never committed.                                                                                   |

Optional server variables (defaults in `apps/server/src/config.ts`): `CHAIN_ID` (4663), `GENERATIONS_ADDRESS`, `ROOMS`,
`SESSION_TTL_DAYS` (7), `GUEST_TTL_DAYS` (30), `DB_POOL_MAX` (10), `TRUST_EDGE_CLIENT_IP` (true), `MIGRATE_ON_START` (true).
The server refuses to start (exit 78) and lists every problem if the environment is invalid.

## First install on ailog (owner-authorized)

Rules: everything lives under `/home/ubuntu/pixel-life/`, the compose project is `pixel-life` with its own network
`pixel-life-net` and volume `pixel-life-pgdata`, and only 127.0.0.1:3100 and 127.0.0.1:55432 are bound. Ports already in use
on the host (never touch those services): 3000, 3004, 3010-3014, 3020, 3306, 4000, 4100, 5433, 8000, 8020, 8080, 8090, 8100, 8900.

1. **Code and secrets**

   ```sh
   git clone https://github.com/floflo777/pixel-life.git /home/ubuntu/pixel-life && cd /home/ubuntu/pixel-life
   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
   # fill every change-me with: openssl rand -hex 32
   ```

2. **Containers**

   ```sh
   ss -ltn '( sport = :3100 or sport = :55432 )'   # must print nothing
   cd deploy && docker compose up -d --build
   docker compose ps                                # both healthy
   curl -fsS http://127.0.0.1:3100/healthz && curl -fsS http://127.0.0.1:3100/readyz
   ```

   Migrations run on start (advisory-locked, each in a transaction). `/readyz` reports the applied migration.

3. **TLS for the origin.** Cloudflare dashboard, zone `ailog.fr`: SSL/TLS mode **Full (strict)**; create an **Origin
   Certificate** for `rf-origin.ailog.fr` and save it as `/etc/ssl/cloudflare/rf-origin.ailog.fr.pem` and `.key`
   (mode 600, root). Optional hardening: enable Authenticated Origin Pulls and uncomment the `ssl_verify_client` lines.

4. **DNS.** `rf-origin.ailog.fr` A `51.254.203.108`, **proxied** (orange cloud).

5. **nginx vhost**

   ```sh
   sudo install -m 644 deploy/nginx/cloudflare-allow.conf /etc/nginx/snippets/cloudflare-allow.conf
   deploy/nginx/render.sh deploy/.env > /tmp/rf-origin.conf
   sudo install -m 600 /tmp/rf-origin.conf /etc/nginx/sites-available/rf-origin.ailog.fr.conf && rm /tmp/rf-origin.conf
   sudo ln -s /etc/nginx/sites-available/rf-origin.ailog.fr.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

   The template uses `http2 on;` (nginx >= 1.25.1). On older nginx, replace it with `listen 443 ssl http2;`.
   Keep the allow list fresh: `sudo deploy/nginx/update-cloudflare-ips.sh` (e.g. weekly cron); it validates and rolls back.

6. **Edge Worker** (from a workstation with Cloudflare credentials; builds the web client first)

   ```sh
   npm ci && npm run build            # produces apps/web/dist
   cd workers/edge
   npm run check:deploy               # wrangler deploy --dry-run: bundles, lists bindings, uploads nothing
   npx wrangler secret put ORIGIN_KEY # paste the same value as deploy/.env
   npm run deploy                     # wrangler deploy → https://pixel-life.<subdomain>.workers.dev
   ```

7. **Smoke test**
   ```sh
   APP=https://pixel-life.florent-g.workers.dev
   curl -fsS $APP/ -o /dev/null -w '%{http_code} %{content_type}\n'
   curl -fsS $APP/api/auth/nonce                                   # {"nonce":"..."}
   curl -s -o /dev/null -w '%{http_code}\n' https://rf-origin.ailog.fr/api/auth/nonce   # 403 (no key)
   curl -s -o /dev/null -w '%{http_code}\n' http://51.254.203.108:3100/healthz --max-time 3  # fails: loopback only
   ```

## Operations

- **Logs:** `docker compose logs -f server` (JSON lines, pino; cookies and the origin key are redacted). Rotated by the
  json-file driver (5 × 10 MB per container). nginx: `/var/log/nginx/rf-origin.*.log`.
- **Update:** `git pull && cd deploy && docker compose up -d --build server`. The server drains on SIGTERM (WebSockets
  closed with 1001; clients reconnect) and applies new migrations on start. Readiness stays 503 until the schema matches.
- **Rollback:** `git checkout <previous tag> && docker compose up -d --build server`. Migrations are forward-only: a
  rollback across a schema change needs a new down-migration written for it.
- **Manual migration:** `docker compose run --rm server node apps/server/dist/migrate.mjs`.
- **Backup:** `docker compose exec -T postgres pg_dump -U pixel_life -Fc pixel_life > /home/ubuntu/pixel-life/backups/$(date -u +%F).dump`
  (daily cron recommended, keep 14). **Restore:** `docker compose exec -T postgres pg_restore -U pixel_life -d pixel_life --clean < file.dump`.
- **psql:** `docker compose exec postgres psql -U pixel_life pixel_life` (or `127.0.0.1:55432` from the host).
- **Rotate `ORIGIN_KEY`** (brief 403 window): update `deploy/.env`, re-render nginx, `docker compose up -d server`,
  `nginx -t && reload`, then `wrangler secret put ORIGIN_KEY`. For zero downtime, deploy the Worker last and accept a
  few seconds of 403 on API calls; clients retry.
- **Rotate `SESSION_SECRET`:** update `deploy/.env` and restart `server`. All sessions and guest ids become invalid.
- **Revoke a wallet's sessions:** `UPDATE sessions SET revoked_at = now() WHERE address = lower('0x...') AND revoked_at IS NULL;`
- **Stop everything:** `docker compose down` (keeps the volume). `down -v` deletes the database: never on production.

## Local checks (no server, no Cloudflare)

```sh
npm run check                                   # lint, format, typecheck, tests (server tests start postgres:16-alpine in Docker)
docker build -f deploy/Dockerfile -t pixel-life-server .   # image builds from the repo root
(cd workers/edge && npm run check:deploy)       # needs apps/web/dist
```

Server tests use a throwaway `postgres:16-alpine` container on a random loopback port, or `TEST_DATABASE_URL` if set.
