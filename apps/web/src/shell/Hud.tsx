/**
 * The HUD shell (GDD §6.5 top bar): brand, the Friend card (live silhouette with scars, pixels N/N0, free-heal timer,
 * "on loan" for guests), simulated RF balance labelled SIMULATED, local Bits, inbox badge, quick mute and settings, and
 * the navigation menu. Everything is reachable by keyboard and fits 360 px.
 */
import { effectiveLost, frontMask, type FriendView, nextRegrowthAt, popcount } from "@pl/shared";
import { useState } from "react";
import { useBits } from "../app/hooks.js";
import { ROUTES } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { formatClock, formatRf } from "../lib/format.js";
import { Link } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { useNow } from "../lib/use-async.js";
import { Badge, FriendPortrait, SimulatedBadge } from "../ui/index.js";

/** Live pixel stats of a Friend at `now` (regrowth applied). */
export function friendStats(view: FriendView, now: number) {
  const tokenId = view.appearance.tokenId;
  const goldHeld = view.loaned ? 0 : view.pub.goldHeld;
  const lost = effectiveLost(view.pub.scars, now, tokenId, { goldHeld });
  const total = popcount(frontMask(view.appearance));
  const next = nextRegrowthAt(view.pub.scars, now, tokenId, { goldHeld });
  return { lost, total, present: total - popcount(lost), nextInMs: next === null ? null : next - now };
}

function FriendCard({ view, label }: { view: FriendView; label: string }) {
  const now = useNow(1000);
  const st = friendStats(view, now);
  return (
    <Link
      to={view.loaned ? "/sky" : `/f/${view.appearance.tokenId}`}
      className="hud-friend"
      data-testid="hud-friend"
      aria-label={`${label}: ${st.present} of ${st.total} pixels${st.nextInMs === null ? "" : `, next pixel heals in ${formatClock(st.nextInMs)}`}`}
    >
      <FriendPortrait view={view} lost={st.lost} scale={2} label="" halo={false} showNextHeal={false} />
      <span className="hud-friend-text">
        <span className="hud-friend-name">
          {label}
          {view.loaned && <Badge>on loan</Badge>}
        </span>
        <span className="mono hud-friend-px">
          <b className="num">
            {st.present}/{st.total}
          </b>{" "}
          px{st.nextInMs !== null && <> · heals {formatClock(st.nextInMs)}</>}
        </span>
      </span>
    </Link>
  );
}

/** Top bar shown on every screen. */
export function Hud({ current }: { current: string | null }) {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const settings = useStore(s.settings);
  const bits = useBits();
  const [menu, setMenu] = useState(false);
  const nav = ROUTES.filter((r) => r.nav).sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0));

  return (
    <header className="hud" data-testid="hud">
      <Link to="/" className="hud-brand display" aria-label="Loose Pixels home">
        loose pixels
      </Link>
      {identity.mode === "guest" && (
        <FriendCard view={identity.view} label={identity.loaner.label ?? `#${identity.loaner.appearance.tokenId}`} />
      )}
      {identity.mode === "owner" && <FriendCard view={identity.view} label={`#${identity.view.appearance.tokenId}`} />}
      <div className="hud-right">
        {identity.mode === "owner" && identity.balanceMicro !== null && (
          <span className="hud-rf" data-testid="hud-rf">
            <span className="num">{formatRf(identity.balanceMicro, 1)}</span>
            <SimulatedBadge mode={identity.economy} />
          </span>
        )}
        {identity.mode !== "none" && (
          <Link
            to="/shop"
            className="hud-bits mono"
            data-testid="hud-bits"
            title={
              bits.source === "server"
                ? "Bits: earned by playing, spent in the Seed Catalogue, never converts to RF"
                : "Bits on this device (guest): bring your own Friend to keep them on the server"
            }
          >
            <b className="num">{bits.bits ?? "…"}</b> bits{bits.source === "device" ? "*" : ""}
          </Link>
        )}
        {identity.mode === "owner" && (
          <Link to="/inbox" className="hud-icon" aria-label={`Inbox, ${identity.unread} unread`}>
            ✉{identity.unread > 0 && <span className="badge">{identity.unread > 99 ? "99+" : identity.unread}</span>}
          </Link>
        )}
        {identity.mode !== "owner" && current !== "connect" && (
          <Link to="/connect" className="hud-connect mono">
            use my friend
          </Link>
        )}
        <button
          type="button"
          className="hud-icon"
          aria-pressed={settings.muted}
          aria-label={settings.muted ? "Unmute sound (M)" : "Mute sound (M)"}
          onClick={() => s.settings.set((v) => ({ ...v, muted: !v.muted }))}
        >
          {settings.muted ? "♪̸" : "♪"}
        </button>
        <Link to="/settings" className="hud-icon" aria-label="Settings">
          ⚙
        </Link>
        <button
          type="button"
          className="hud-icon"
          aria-expanded={menu}
          aria-controls="hud-menu"
          aria-label="Menu"
          onClick={() => setMenu((m) => !m)}
        >
          ≡
        </button>
      </div>
      {menu && (
        <nav id="hud-menu" className="hud-menu" aria-label="Main">
          <ul>
            {nav.map((r) => (
              <li key={r.name}>
                <Link
                  to={r.path}
                  aria-current={current === r.name ? "page" : undefined}
                  onClick={() => setMenu(false)}
                  className="mono"
                >
                  {r.nav?.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
