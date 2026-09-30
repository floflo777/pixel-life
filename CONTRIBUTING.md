# Contributing

This repository is built by a small team of agents coordinated by a lead. These rules keep parallel work mergeable.

## Workflow

1. One task = one branch `feat/<task>` (or `fix/<topic>`) from an up-to-date `main`, worked in its own git worktree.
2. Only touch the paths your task owns (see the task brief). Need a change in `packages/shared` or `packages/venue-kit`? Stop and ask the lead: those are the contracts everyone builds on.
3. Small, focused commits, imperative subject line (`Add voxel greedy mesher`), body explaining _why_ when it isn't obvious.
4. Before pushing: `npm run check` must pass (lint, format, typecheck, tests).
5. Open a PR to `main` with: what/why, how it was tested (commands + results), screenshots or GIFs for anything visual, known limitations. The lead reviews and merges; nobody merges their own PR.

## Code standards

- TypeScript strict (see `tsconfig.base.json`), no `any`, no non-null assertions without a comment proving the invariant.
- Pure logic lives in `@pl/shared` and is unit-tested; rendering, IO and frameworks stay at the edges.
- `packages/shared/src/sim/**` is deterministic: no `Math.random`, trig/pow/exp/log, `Date` or `performance` (lint-enforced). Use the fixed-math helpers and ticks.
- Every exported function/type has a one-line doc comment saying what it guarantees. Comments explain _why_, not _what_.
- Errors are handled where they can be acted on; user-facing failures have loading / error / retry states.
- No secrets in the repo. Configuration via environment variables documented in `.env.example`.
- Accessibility: keyboard + touch, mute, reduced motion, 360 px width.
- Simulated RF is always labelled as simulated in the UI.

## Tests

- Unit tests next to the code (`*.test.ts`), Vitest. Property tests (fast-check) for invariants (economy splits, bitmaps).
- Determinism: sim changes must keep the golden-hash corpus green, or update it deliberately in the same PR with a reason.
- End-to-end: Playwright under `tests/e2e`.
