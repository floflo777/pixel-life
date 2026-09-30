/**
 * `/venue/:id`: opens an SDK booth (or the native venue slot). Guests see what the booth is, its published odds and a
 * "use your own Friend" CTA: they never enter the SDK runtime (D-11).
 */
import { SEED_PACK } from "@pl/shared";
import { canEnter } from "@pl/venue-kit";
import { lazy, Suspense, useEffect } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { formatBps } from "../lib/format.js";
import { navigate } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { Card, LinkButton, Loading, SimTag } from "../ui/kit.js";
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

/** The booth screen. */
export default function VenueScreen({ params }: PageProps) {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const id = params.id ?? "";
  const venue = SDK_VENUES[id];
  const native = NATIVE_VENUES[id];

  useEffect(() => {
    if (native) navigate("/play", { replace: true });
  }, [native]);

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
          <LinkButton to="/connect" variant="now">
            Use my Friend
          </LinkButton>
        </Card>
      )}
    </div>
  );
}
