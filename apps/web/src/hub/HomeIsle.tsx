/**
 * `/sky?home=<tokenId>`: a Friend's home island (GDD §12.3, the "igloo"), visited from The Sky. Read-only: the
 * Friend in its real state (scars heal on the clock, gold, stitches, hat and belt) on its terraces with the placed
 * decor, from `GET /api/home/:tokenId` + the Friend's appearance and public state. Loading / error / retry states;
 * "back to the sky" returns to the room you left.
 */
import { effectiveLost, type FriendAppearance, type FriendPublic, type HomeView, type TokenIdStr } from "@pl/shared";
import { useServices } from "../app/services.js";
import { errorMessage } from "../api/client.js";
import { useAsync } from "../lib/use-async.js";
import { LiveStage } from "../stage/LiveStage.js";
import { FriendSprite } from "../ui/FriendSprite.js";
import { ErrorBox, LinkButton, Loading } from "../ui/kit.js";
import { friendHref } from "./doors.js";
import { fetchHome, recordVisit } from "./home-api.js";

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
      api.publicFriend(tokenId),
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
        <ErrorBox message={`Couldn't reach #${tokenId}'s island: ${errorMessage(data.error)}`} onRetry={data.retry} />
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
        fallback={<FriendSprite view={view} scale={8} />}
      />
      <div className="sky-top mono">
        <span className="display">#{tokenId}'s island</span>
        <span>{home.open ? "open isle" : "private isle"}</span>
      </div>
      {back}
    </div>
  );
}
