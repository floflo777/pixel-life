/**
 * `/sky`: the hub mount point (GDD §6.5). Mounts `hubSceneFactory` (placeholder until `createHubScene` lands) on the
 * shared stage with a `HubNet` connection to the plaza room, shows the room population, resting Friends from
 * `/api/sky`, and the doors. If the server is down the hub stays a single-player plaza with a foggy-sky banner.
 */
import type { FriendView, RoomSlug } from "@pl/shared";
import type { VenueIdentity } from "@pl/venue-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { ensureGuest } from "../identity/bootstrap.js";
import { useStore } from "../lib/store.js";
import { createHubNet, type HubNetState } from "../net/hub-net.js";
import { LiveStage } from "../stage/LiveStage.js";
import { FriendSprite } from "../ui/FriendSprite.js";
import { Loading, LinkButton } from "../ui/kit.js";
import { hubSceneFactory, type HubScene } from "./hub-scene.js";

const ROOM: RoomSlug = "plaza";

/** Resting Friends of a room with their appearance (skips any that fail to load). */
async function loadResting(api: ReturnType<typeof useServices>["api"]): Promise<FriendView[]> {
  const sky = await api.sky(ROOM);
  const views = await Promise.all(
    sky.friends.slice(0, 5).map(async (f): Promise<FriendView | null> => {
      try {
        return { appearance: await api.appearance(f.tokenId), pub: f.pub, loaned: false };
      } catch {
        return null;
      }
    }),
  );
  return views.filter((v): v is FriendView => v !== null);
}

/** The hub screen. */
export default function SkyScreen(_props: PageProps) {
  const s = useServices();
  const { identity, revision } = useStore(s.identity.store);
  const net = useMemo(() => createHubNet(), []);
  const [netState, setNetState] = useState<HubNetState>("idle");
  const [here, setHere] = useState<number | null>(null);
  const scene = useRef<HubScene | null>(null);
  const [resting, setResting] = useState<FriendView[]>([]);

  useEffect(() => {
    if (identity.mode === "none") void ensureGuest(s).catch(() => undefined);
  }, [identity.mode, s]);

  // Presence: connect once someone is playing; reconnect on identity changes (the socket carries the cookie identity).
  useEffect(() => {
    if (identity.mode === "none") return;
    const roster = new Set<string>();
    const offState = net.onState(setNetState);
    const offMsg = net.on((m) => {
      if (m[0] === "welcome") {
        roster.clear();
        for (const e of m[2]) roster.add(e.id);
      } else if (m[0] === "join") roster.add(m[1].id);
      else if (m[0] === "leave") roster.delete(m[1]);
      else return;
      setHere(roster.size);
    });
    void net.connect(ROOM).catch(() => setNetState("closed"));
    return () => {
      offState();
      offMsg();
      net.close();
    };
  }, [net, revision, identity.mode]);

  useEffect(() => {
    let live = true;
    loadResting(s.api).then(
      (v) => live && setResting(v),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [s.api]);

  const vid = useMemo<VenueIdentity | null>(
    () =>
      identity.mode === "none"
        ? null
        : { mode: identity.mode, friend: identity.view, loaned: identity.mode === "guest" },
    [identity],
  );
  const vidRef = useRef(vid);
  vidRef.current = vid;
  useEffect(() => {
    if (vid) scene.current?.setIdentity(vid);
  }, [vid]);
  useEffect(() => {
    scene.current?.setResting(resting);
  }, [resting]);

  if (!vid) return <Loading label="your Friend is on its way" />;
  const foggy = netState === "closed";
  return (
    <div className="sky" data-testid="sky">
      <LiveStage
        className="sky-stage"
        label="The Sky plaza"
        mount={(stage, rt) => {
          const hub = hubSceneFactory(stage, net, () => vidRef.current ?? vid, rt);
          scene.current = hub;
          hub.setResting(resting);
          return () => {
            scene.current = null;
            hub.dispose();
          };
        }}
        fallback={<FriendSprite view={vid.friend} scale={8} />}
      />
      <div className="sky-top mono">
        <span className="display">the sky · plaza</span>
        <span role="status">
          {netState === "open" ? `● ${here ?? 1} here` : netState === "connecting" ? "joining…" : foggy ? "" : ""}
        </span>
      </div>
      {foggy && (
        <p className="notice sky-fog" role="status">
          The sky is foggy: other Friends will be back soon. You can still play.
        </p>
      )}
      <nav className="doors" aria-label="Doors">
        <LinkButton to="/play" variant="now" big>
          ▶ play
        </LinkButton>
        <LinkButton to="/shop">greenhouse</LinkButton>
        <LinkButton to="/venue/seed-pack">seed pack booth</LinkButton>
        <LinkButton to="/board">daily stone</LinkButton>
        <LinkButton to="/mend">mend well</LinkButton>
      </nav>
    </div>
  );
}
