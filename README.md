# Pixel Life

A Rare Friends social world where **your Friend's pixels are its life**: every hit knocks a pixel off your Friend — grab it back, or regrow it. A Club Penguin-like hub of mini-game venues, with Pixel Life (the fling arcade) as the flagship.

Status: in development. Design documents live in [`docs/design`](docs/design). Vibeathon submission drafts (README, trailer plan, judges' FAQ) live in [`docs/submission`](docs/submission).

Playable preview: https://pixel-life.florent-g.workers.dev · Every RF amount in the preview is simulated; the contracts in [`contracts/`](contracts) are tested but not deployed.

## Layout

| Path                 | Package         | Role                                                                                             |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `packages/shared`    | `@pl/shared`    | Contracts: ids, Friend bitmaps, scars/regrowth, economy quotes, wire protocol, deterministic sim |
| `packages/venue-kit` | `@pl/venue-kit` | Venue module contract + native venue test harness                                                |
| `apps/game`          | `@pl/game`      | three.js renderer: stage, voxel Friend, hub scene, Pixel Life venue                              |
| `apps/web`           | `@pl/web`       | Web shell: landing, identity (FriendSDK), HUD, pages, venue manager                              |
| `apps/server`        | `@pl/server`    | Origin server (Node, Fastify, `ws`, PostgreSQL)                                                  |
| `workers/edge`       | `@pl/edge`      | Cloudflare edge Worker: static client + proxy to the origin                                      |
| `vendor/`            | —               | FriendSDK v0.1.4 packed from `spokesz/friendsdk@ca3bf18`                                         |

## Develop

```sh
npm ci
npm run check   # lint + format + typecheck + tests
```

Node 22+. See [CONTRIBUTING.md](CONTRIBUTING.md) for the team workflow.

## Credits

Rare Friends artwork via FriendSDK (Apache-2.0, see its NOTICE). Kenney 1-Bit Pack (CC0). Silkscreen font (SIL OFL 1.1).
