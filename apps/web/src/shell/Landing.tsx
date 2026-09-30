/**
 * Landing (GDD §6.2): the hero is the live Sky plaza with real voxel Friends; a giant "Play now" starts guest mode
 * instantly with a loaned Friend (no wallet wall, zero wallet or chain calls), "Use my Friend" is secondary. The loaner
 * chip swaps among the baked loaners.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServices } from "../app/services.js";
import { ensureGuest, preferredLoaner } from "../identity/bootstrap.js";
import { guestFriendView, loadGuestProfile } from "../identity/guest.js";
import { loadLoaners, loanerName, type LoanerFriend } from "../identity/loaners.js";
import { navigate } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import type { PlazaScene } from "../stage/runtime.js";
import { LiveStage } from "../stage/LiveStage.js";
import { FriendSprite } from "../ui/FriendSprite.js";
import { Button, LinkButton } from "../ui/kit.js";

/** The landing screen. */
export default function Landing() {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const [loaners, setLoaners] = useState<LoanerFriend[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scene = useRef<PlazaScene | null>(null);

  useEffect(() => {
    let live = true;
    loadLoaners().then(
      (l) => {
        if (!live) return;
        setLoaners(l);
        setPick((p) => p ?? preferredLoaner(l).appearance.tokenId);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const now = useMemo(() => Date.now(), []);
  const profile = useMemo(() => loadGuestProfile(), []);
  const loaner = loaners?.find((l) => l.appearance.tokenId === pick) ?? null;
  const you = useMemo(
    () => (identity.mode === "owner" ? identity.view : loaner ? guestFriendView(loaner, profile, now) : null),
    [identity, loaner, profile, now],
  );
  const crowd = useMemo(
    () =>
      (loaners ?? [])
        .filter((l) => l.appearance.tokenId !== pick)
        .slice(0, 5)
        .map((l) => guestFriendView(l, { v: 1, loaner: null, scars: {} }, now)),
    [loaners, pick, now],
  );

  useEffect(() => {
    scene.current?.setYou(you);
  }, [you]);
  useEffect(() => {
    scene.current?.setCrowd(crowd);
  }, [crowd]);

  const play = async (): Promise<void> => {
    setStarting(true);
    void s.audio.unlock();
    s.audio.play("ui.confirm");
    try {
      if (identity.mode !== "owner") await ensureGuest(s, pick ?? undefined);
      navigate("/play");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="landing">
      <LiveStage
        className="landing-stage"
        label="The Sky plaza: floating islands with Friends standing on them"
        mount={(stage, rt) => {
          const plaza = rt.buildPlazaScene(stage);
          scene.current = plaza;
          plaza.setYou(you);
          plaza.setCrowd(crowd);
          return () => {
            scene.current = null;
            plaza.dispose();
          };
        }}
        fallback={you ? <FriendSprite view={you} scale={10} /> : null}
      />
      <div className="landing-copy">
        <h1 className="display landing-title">Pixel Life</h1>
        <p className="landing-rule">
          every hit knocks a pixel off.
          <br />
          grab it back, or regrow it.
        </p>
        <div className="landing-cta">
          <Button
            variant="now"
            big
            onClick={() => void play()}
            disabled={starting}
            data-testid="play-now"
            aria-describedby="play-now-hint"
          >
            {starting ? "starting…" : "▶ Play now"}
          </Button>
          <p id="play-now-hint" className="mono landing-hint">
            no wallet needed · you play a loaned Friend
          </p>
          {identity.mode === "owner" ? (
            <LinkButton to="/sky">enter the sky as #{identity.view.appearance.tokenId}</LinkButton>
          ) : (
            <LinkButton to="/connect">Use my Friend</LinkButton>
          )}
        </div>
        {identity.mode !== "owner" && loaners && (
          <label className="loaner-chip mono">
            <span>on loan ·</span>
            <select
              value={pick ?? ""}
              onChange={(e) => setPick(e.target.value)}
              aria-label="Choose the loaned Friend you play"
            >
              {loaners.map((l) => (
                <option key={l.appearance.tokenId} value={l.appearance.tokenId}>
                  {l.label ? `${l.label} #${l.appearance.tokenId}` : loanerName(l)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
