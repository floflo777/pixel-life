/**
 * Builds the `VenueHost` the shell lends to a native venue (architecture §1b.2): identity, the shared stage, audio,
 * accessibility, pause, host-confirmed economy, seeds and result reporting. Guests get a working host with no economy
 * and local-only scars (D-11).
 */
import type { CueName } from "@pl/audio";
import type { DailySeed, RunAck } from "@pl/shared";
import { createSignal, type ReadonlySignal, type VenueHost, type VenueIdentity, type VenueResult } from "@pl/venue-kit";
import type { Services } from "../app/services.js";
import { utcDay } from "../lib/format.js";
import { reducedMotionOf } from "../settings/settings.js";
import { getQuote, requestEconomy } from "../meta/economy.js";
import type { GameStage } from "../stage/runtime.js";

/** Base64 of bytes (the `POST /api/runs` input log encoding). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** What the shell learns when a venue reports a run. */
export interface ReportedRun {
  result: VenueResult;
  ack: RunAck;
  /** Server/verification problem to show on the results card, if any. */
  problem: string | null;
}

/** Options of {@link createVenueHost}. */
export interface VenueHostOptions {
  services: Services;
  identity: VenueIdentity;
  stage: GameStage;
  paused: ReadonlySignal<boolean>;
  onReported(run: ReportedRun): void;
  onExit(reason: "done" | "quit"): void;
}

/** A 32-bit seed from the platform CSPRNG (free runs are not ranked, so the client may pick it). */
export function freeSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
}

/** Creates the host for one mounted venue. */
export function createVenueHost(o: VenueHostOptions): VenueHost<GameStage> {
  const { services: s } = o;
  const muted = createSignal(s.settings.get().muted);
  s.settings.subscribe(() => muted.set(s.settings.get().muted));
  const mode = o.identity.mode;

  return {
    identity: o.identity,
    stage: o.stage,
    audio: {
      play: (cue, opts) => s.audio.play(cue as CueName, opts?.volume === undefined ? undefined : { gain: opts.volume }),
      muted: muted.signal,
    },
    reducedMotion: reducedMotionOf(s.settings.get()),
    paused: o.paused,
    economy: {
      quote: (action) => getQuote(s, action, o.identity.friend.pub.economy),
      request: (action) => requestEconomy(s, action),
    },
    seeds: {
      daily: (): Promise<DailySeed> => s.api.daily(),
      free: freeSeed,
    },
    async reportResult(result) {
      const now = Date.now();
      const req = {
        venueId: result.venueId,
        kind: result.kind,
        seed: result.seed,
        inputs: toBase64(result.inputs),
        claimed: result.claimed,
        ...(result.kind === "daily" ? { day: utcDay(now) } : {}),
      };
      let ack: RunAck;
      let problem: string | null = null;
      if (mode === "guest") {
        // Guest scars live on the local copy only; the server run (visitors board) is best-effort.
        s.identity.applyGuestLoss(result.claimed.lostDelta);
        ack = { runId: result.runId, verified: "pending", applied: false, reason: "guest", scars: null };
        void s.api.submitRun(req).catch(() => undefined);
      } else {
        try {
          ack = await s.api.submitRun(req);
          if (ack.scars) s.identity.updateOwner({ scars: ack.scars });
          if (ack.verified === "mismatch") problem = "We couldn't verify this run: no scars, no rank.";
        } catch {
          ack = { runId: result.runId, verified: "pending", applied: false, reason: "unverified", scars: null };
          problem = "Offline or server busy: this run won't leave scars or rank.";
        }
      }
      o.onReported({ result, ack, problem });
      return ack;
    },
    exit: (reason = "quit") => o.onExit(reason),
  };
}
