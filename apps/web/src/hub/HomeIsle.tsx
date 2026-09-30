/**
 * `/sky?home=<tokenId>`: a Friend's home island (GDD §12.3, the "igloo"), visited from The Sky. Read-only: the
 * Friend in its real state (scars heal on the clock, gold, stitches, hat and belt) on its terraces with the placed
 * decor, from `GET /api/home/:tokenId` + the Friend's appearance and public state. Loading / error / retry states;
 * "back to the sky" returns to the room you left.
 */
import {
  effectiveLost,
  EMPTY_MASK,
  type FriendAppearance,
  type FriendPublic,
  type HomeView,
  type TokenIdStr,
} from "@pl/shared";
import { useServices } from "../app/services.js";
import { ApiRequestError, errorMessage } from "../api/client.js";
import { useAsync } from "../lib/use-async.js";
import { LiveStage } from "../stage/LiveStage.js";
import { ErrorState, FriendPortrait, LinkButton, Loading } from "../ui/index.js";
import { friendHref } from "./doors.js";
import { fetchHome, recordVisit } from "./home-api.js";

/** Public state of a Friend the server has never seen: whole, no gold, no streak. */
export function wholeFriend(tokenId: TokenIdStr, now: number): FriendPublic {
  return {
    tokenId,
    scars: { lost: EMPTY_MASK, updatedAt: now, version: 0 },
    goldHeld: 0,
    glowCracks: 0,
    streak: 0,
    lastSeen: now,
    economy: "sim",
  };
}

interface IsleData {
  home: HomeView;
  appearance: FriendAppearance;
  pub: FriendPublic;
}

/** The home island screen for `tokenId`. */
export function HomeIsle({ tokenId }: { tokenId: TokenIdStr }) {
  const { api, identity } = useServices();
  const data = useAsync<IsleData>(async () => {
    const [home, appearance, pub] = await Promise.all([
      fetchHome(tokenId),
      api.appearance(tokenId),
      // A Friend that never played has no public state yet: it is simply whole.
      api.publicFriend(tokenId).catch((e: unknown) => {
        if (e instanceof ApiRequestError && e.status === 404) return wholeFriend(tokenId, Date.now());
        throw e;
      }),
    ]);
    const me = identity.store.get().identity;
    if (me.mode === "owner" && me.view.appearance.tokenId !== tokenId) recordVisit(tokenId);
    return { home, appearance, pub };
  }, [tokenId]);

  const back = (
    <nav className="home-isle-nav">
      <LinkButton to="/sky">← back to the sky</LinkButton>
      <LinkButton to={friendHref(tokenId)}>#{tokenId}'s page</LinkButton>
    </nav>
  );

  if (data.status === "error")
    return (
      <div className="page">
        <ErrorState message={`Couldn't reach #${tokenId}'s island: ${errorMessage(data.error)}`} onRetry={data.retry} />
        {back}
      </div>
    );
  if (!data.data) return <Loading label={`flying to #${tokenId}'s island`} />;
  const { home, appearance, pub } = data.data;
  const view = { appearance, pub, loaned: false };
  return (
    <div className="sky home-isle" data-testid="home-isle">
      <LiveStage
        className="sky-stage"
        label={`#${tokenId}'s home island`}
        mount={(stage) => {
          let dispose: (() => void) | null = null;
          let gone = false;
          void import("@pl/game").then((game) => {
            if (gone) return;
            const scene = game.createHomeScene(
              stage,
              home.layout,
              {
                appearance,
                lost: effectiveLost(pub.scars, Date.now(), tokenId),
                gold: pub.goldHeld,
                ...(pub.stitched ? { stitched: pub.stitched } : {}),
                glowCracks: pub.glowCracks,
                hat: home.hat,
                belt: home.belt,
              },
              { terraces: home.terraces },
            );
            dispose = () => scene.dispose();
          });
          return () => {
            gone = true;
            dispose?.();
          };
        }}
        fallback={<FriendPortrait view={view} scale={8} />}
      />
      <div className="sky-top mono">
        <span className="display">#{tokenId}'s island</span>
        <span>{home.open ? "open isle" : "private isle"}</span>
      </div>
      {back}
    </div>
  );
}
