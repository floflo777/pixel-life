/**
 * `/venue/:id`: opens an SDK booth (native venue ids redirect to `/play?venue=`). Owners get the stock SDK game through
 * `ConnectedGameHost`; guests see what the booth is, its published odds, a local demo pull (nothing is bought, nothing
 * is stored) and a "use your own Friend" CTA: they never enter the SDK runtime (D-11).
 */
import { SEED_PACK } from "@pl/shared";
import { canEnter } from "@pl/venue-kit";
import { lazy, Suspense, useEffect, useState } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { formatBps } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { Button, Card, LinkButton, Loading, SimTag } from "../ui/kit.js";
import { playHref } from "../hub/doors.js";
import { NATIVE_VENUES, SDK_VENUES } from "./registry.js";

const SdkVenueView = lazy(() => import("./SdkVenueView.js"));

const rf = (wei: string): string => (Number(BigInt(wei) / 10n ** 14n) / 10_000).toString();

/** The published Seed Pack odds (exact table from `SEED_PACK`). */
export function SeedPackOdds() {
  return (
    <table className="odds">
      <caption className="mono">
        Seed Pack · {rf(SEED_PACK.price)} RF <SimTag />
      </caption>
      <thead>
        <tr>
          <th scope="col">outcome</th>
          <th scope="col">chance</th>
          <th scope="col">redeem value</th>
        </tr>
      </thead>
      <tbody>
        {SEED_PACK.outcomes.map((o) => (
          <tr key={o.name}>
            <th scope="row">{o.name}</th>
            <td className="num">{formatBps(o.chanceBps)}</td>
            <td className="num">{rf(o.reward)} RF</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Index of the outcome a roll `r` in [0, 1) lands on, walking the published chances in order (pure). */
export function pickOutcome(chancesBps: readonly number[], r: number): number {
  const total = chancesBps.reduce((a, b) => a + b, 0);
  let x = Math.min(Math.max(r, 0), 0.999999999) * total;
  for (let i = 0; i < chancesBps.length; i++) {
    x -= chancesBps[i] ?? 0;
    if (x < 0) return i;
  }
  return chancesBps.length - 1;
}

/** A uniform [0, 1) roll from the platform CSPRNG. */
function roll(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] ?? 0) / 2 ** 32;
}

/** Guest demo: draws from the published table locally. Nothing is bought or stored. */
export function SeedPackDemo({ random = roll }: { random?: () => number }) {
  const [pulls, setPulls] = useState<string[]>([]);
  return (
    <div className="seed-demo" data-testid="seed-demo">
      <p className="mono">
        demo pull · nothing is bought or kept <SimTag />
      </p>
      <Button
        onClick={() => {
          const o =
            SEED_PACK.outcomes[
              pickOutcome(
                SEED_PACK.outcomes.map((x) => x.chanceBps),
                random(),
              )
            ];
          if (o) setPulls((p) => [`${o.name} · ${rf(o.reward)} RF`, ...p].slice(0, 5));
        }}
      >
        try a demo pull
      </Button>
      <ol className="seed-demo-pulls" aria-live="polite">
        {pulls.map((p, i) => (
          <li key={`${pulls.length - i}`}>{p}</li>
        ))}
      </ol>
    </div>
  );
}

/** The booth screen. */
export default function VenueScreen({ params }: PageProps) {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const id = params.id ?? "";
  const venue = SDK_VENUES[id];
  const native = NATIVE_VENUES[id];

  useEffect(() => {
    if (native) navigate(playHref(id, "quick"), { replace: true });
  }, [native, id]);

  if (native) return null;
  if (!venue)
    return (
      <div className="page">
        <Card title="No such booth">
          <LinkButton to="/sky">back to the sky</LinkButton>
        </Card>
      </div>
    );

  const vid =
    identity.mode === "none" ? null : { mode: identity.mode, friend: identity.view, loaned: identity.mode === "guest" };
  const allowed = vid !== null && canEnter(venue.manifest, vid);
  return (
    <div className="page page-venue">
      <h1 className="display">{venue.manifest.name}</h1>
      <p className="venue-rule">{venue.rule}</p>
      {allowed ? (
        <Suspense fallback={<Loading label="opening the booth" />}>
          <SdkVenueView venue={venue} />
        </Suspense>
      ) : (
        <Card title="Owners only">
          <p>
            Seed Packs belong to a Friend's own wallet, so the booth needs your own Rare Friend (generation 1 or
            higher). Loaned Friends can look, not buy.
          </p>
          <SeedPackOdds />
          <SeedPackDemo />
          <LinkButton to="/connect" variant="now">
            Use my Friend
          </LinkButton>
        </Card>
      )}
      <LinkButton to="/sky">← back to the sky</LinkButton>
    </div>
  );
}
