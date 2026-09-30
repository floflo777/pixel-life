/**
 * `/mend`: the Mend Well. Resting Friends come from `GET /api/sky` for every room (merged, deduplicated); appearances
 * load in the background for the ones that need mending, so the list shows before the portraits do.
 */
import { type FriendAppearance, ROOMS, type SkyFriend } from "@pl/shared";
import { useEffect, useState } from "react";
import { type PageProps, useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { navigate } from "../../lib/router.js";
import { MendBoard, type MendCandidate, mendRows } from "../MendBoard.js";

/** Most portraits fetched for one board (the rest show a placeholder until opened). */
const PORTRAITS = 24;

/** Every resting Friend in the Sky, one entry per token (the freshest `pub` wins). */
export function mergeSky(rooms: readonly (readonly SkyFriend[])[]): SkyFriend[] {
  const byId = new Map<string, SkyFriend>();
  for (const list of rooms)
    for (const f of list) {
      const prev = byId.get(f.tokenId);
      if (!prev || f.pub.scars.updatedAt > prev.pub.scars.updatedAt) byId.set(f.tokenId, f);
    }
  return [...byId.values()];
}

/** `/mend` */
export default function MendBoardRoute(_props: PageProps) {
  const { api } = useServices();
  const id = useIdentity();
  const viewer = id.mode === "owner" ? id.view.appearance.tokenId : null;
  const sky = useRemote(async () => {
    const got = await Promise.allSettled(ROOMS.map((room) => api.sky(room)));
    const ok = got.flatMap((r) => (r.status === "fulfilled" ? [r.value.friends] : []));
    if (ok.length === 0) {
      const first = got.find((r) => r.status === "rejected");
      throw first?.status === "rejected" ? first.reason : new Error("The Sky is empty.");
    }
    return mergeSky(ok);
  }, []);
  const [looks, setLooks] = useState<ReadonlyMap<string, FriendAppearance>>(new Map());

  const list = sky.value.status === "ready" ? sky.value.data : null;
  useEffect(() => {
    if (!list) return;
    let live = true;
    const rows = mendRows(list, Date.now(), viewer).slice(0, PORTRAITS);
    for (const { c } of rows) {
      if (looks.has(c.tokenId)) continue;
      api.appearance(c.tokenId).then(
        (a) => live && setLooks((m) => new Map(m).set(c.tokenId, a)),
        () => undefined, // A missing portrait keeps its placeholder; the row still works.
      );
    }
    return () => {
      live = false;
    };
    // `looks` is read to skip known portraits, not to refetch when it grows.
  }, [list, viewer, api]);

  const friends =
    sky.value.status === "ready"
      ? {
          status: "ready" as const,
          data: sky.value.data.map((f): MendCandidate => {
            const a = looks.get(f.tokenId);
            return { ...f, ...(a ? { appearance: a } : {}) };
          }),
        }
      : sky.value;

  return (
    <MendBoard
      friends={friends}
      onRetry={sky.retry}
      mode={id.mode === "owner" ? id.economy : "sim"}
      viewerTokenId={viewer}
      onMend={(t) => navigate(`/mend/${t}`)}
      onOpen={(t) => navigate(`/f/${t}`)}
    />
  );
}
