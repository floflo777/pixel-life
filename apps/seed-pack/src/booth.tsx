import { useCallback, useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "@rarefriends/friendsdk/runtime";
import type { GameSnapshot } from "@rarefriends/friendsdk/game";
import type { RewardRevealPhase } from "@rarefriends/friendsdk/reveal";
import { createFriendSoundKit, type FriendSoundCue, type FriendSoundKit } from "@rarefriends/friendsdk/sounds";
import { PixelArt } from "./art";
import { economyTerms, formatRf, oddsTable, pendingPlay, purchaseBlocker, type OddsRow } from "./economy";
import { InventoryPanel, OddsPanel, Sim } from "./panels";
import { RevealOverlay, type RevealResult } from "./reveal";
import { Booth, PaperSky } from "./scenery";

type Panel = "booth" | "odds" | "inventory";
const CANCELLED = "Game action cancelled.";
const REVEAL_CUE: Record<OddsRow["rarity"], FriendSoundCue> = {
  common: "reveal-common",
  uncommon: "reveal-common",
  rare: "reveal-rare",
  legendary: "reveal-legendary",
};

/** Live `matchMedia` flag (the sandboxed child's viewport is the frame, so this tracks the frame size). */
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * Seed Pack Booth. The SDK runtime supplies the verified Friend, the fixed action client and `paused`;
 * this component only presents buy → open (play + settle) → reveal → keep or redeem.
 */
export function SeedPackBooth({ friendId, client, paused }: GameComponentProps) {
  const definition = client.definition;
  const simulated = client.mode === "preview";
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [panel, setPanel] = useState<Panel>("booth");
  const [reveal, setReveal] = useState<RevealResult | null>(null);
  const [muted, setMuted] = useState(false);
  const systemReduced = useMedia("(prefers-reduced-motion: reduce)");
  const wide = useMedia("(min-width: 720px)");
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const reducedMotion = motionOverride ?? systemReduced;
  const sound = useRef<FriendSoundKit | null>(null);
  const locked = useRef(false);
  const epoch = useRef(0);

  const load = useCallback(() => {
    const version = epoch.current;
    setLoadError("");
    client
      .read()
      .then((value) => {
        if (version === epoch.current) setSnapshot(value);
      })
      .catch((cause: unknown) => {
        if (version === epoch.current)
          setLoadError(cause instanceof Error ? cause.message : "Could not load the Seed Pack Booth.");
      });
  }, [client]);

  // A new client or Friend is a new session: drop every piece of state from the old one.
  useEffect(() => {
    epoch.current++;
    sound.current = createFriendSoundKit({ muted: false });
    setSnapshot(null);
    setReveal(null);
    setError("");
    setMessage("");
    setBusy(false);
    locked.current = false;
    load();
    return () => {
      epoch.current++;
      sound.current?.dispose();
      sound.current = null;
    };
  }, [client, friendId, load]);

  const play = useCallback((cue: FriendSoundCue, delay?: number) => {
    sound.current?.play(cue, delay === undefined ? undefined : { delay });
  }, []);

  /** Serialises actions, refreshes the snapshot afterwards and turns failures into a visible status. */
  const act = useCallback(
    async (work: () => Promise<void>, after?: () => void) => {
      if (locked.current || paused) return;
      const version = epoch.current;
      locked.current = true;
      setBusy(true);
      setError("");
      setMessage("");
      void sound.current?.unlock();
      try {
        await work();
        if (version === epoch.current) after?.();
      } catch (cause) {
        if (version !== epoch.current) return;
        const text = cause instanceof Error ? cause.message : "The action failed.";
        if (text === CANCELLED) setMessage("Cancelled. Nothing changed.");
        else setError(text);
      } finally {
        if (version === epoch.current) {
          try {
            setSnapshot(await client.read());
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not refresh the booth.");
          }
          locked.current = false;
          setBusy(false);
        }
      }
    },
    [client, paused],
  );

  const rows = oddsTable(definition);
  const terms = economyTerms(definition);
  const sim = simulated ? " sim" : "";
  const pending = snapshot ? pendingPlay(snapshot) : null;
  const blocker = snapshot ? purchaseBlocker(definition, snapshot) : "funds";
  const packs = snapshot?.consumables ?? 0n;
  const canOpen = Boolean(pending) || packs > 0n;
  const disabled = busy || paused;

  const buy = () =>
    act(
      () => client.buy(1n),
      () => {
        play("purchase");
        setMessage(`One seed pack added to your Friend${simulated ? " (simulated)" : ""}.`);
      },
    );

  const open = () =>
    act(async () => {
      const version = epoch.current;
      const committed = pending ?? (await client.play(1n))[0];
      if (!committed) throw new Error("No pack was opened.");
      play("action-start");
      const settled = await client.settle(committed.id);
      if (version !== epoch.current) return;
      const row = settled.outcomeId === null ? undefined : rows[settled.outcomeId - 1];
      if (!row) {
        setMessage("The result is still pending. Choose “Finish opening” to resume it; no new pack is used.");
        return;
      }
      setReveal({ playId: settled.id, row });
    });

  const redeem = (outcomeId: number) => {
    const row = rows[outcomeId - 1];
    if (!row) return;
    return act(
      () => client.redeem(outcomeId, 1n),
      () => {
        play("reward");
        setReveal(null);
        setMessage(`Redeemed ${row.name}: ${formatRf(row.reward)} RF${sim} returned to your Friend.`);
      },
    );
  };

  const keep = () => {
    if (!reveal || paused) return;
    play("select");
    setMessage(`${reveal.row.name} kept in your Friend's inventory.`);
    setReveal(null);
  };

  const onRevealPhase = useCallback(
    (phase: RewardRevealPhase, row: OddsRow) => {
      if (phase === "anticipation") play("anticipation");
      if (phase === "reveal" || (phase === "complete" && reducedMotion)) {
        play(REVEAL_CUE[row.rarity]);
        // Gold Pixel: legendary sting plus a small bell cluster (GDD §8).
        if (row.rarity === "legendary") [0.45, 0.62, 0.8].forEach((delay) => play("reward", delay));
      }
    },
    [play, reducedMotion],
  );

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    sound.current?.setMuted(next);
    if (!next) void sound.current?.unlock();
  };
  const toggleMotion = () => setMotionOverride(!reducedMotion);

  // Global shortcuts: B buy, O open, M mute. Ignored while paused, busy or during a reveal (it has its own keys).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || reveal || paused) return;
      const key = event.key.toLowerCase();
      if (key === "m") toggleMute();
      else if (key === "b" && !busy && !blocker && !pending) void buy();
      else if (key === "o" && !busy && canOpen) void open();
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!snapshot) {
    return (
      <div className="sp-game sp-loading" role={loadError ? "alert" : "status"}>
        <PaperSky />
        <div className="sp-card">
          <p>{loadError || "Opening the Seed Pack Booth…"}</p>
          {loadError && (
            <button type="button" className="sp-btn" onClick={load}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }
  if (snapshot.friendId !== friendId) {
    return (
      <p className="sp-game sp-loading" role="alert">
        This session does not match the selected Friend.
      </p>
    );
  }

  const friendLabel = `#${friendId.toString()}`;
  // Wide frames always show the stage, so "booth" maps to the odds side panel there.
  const view: Panel = wide && panel === "booth" ? "odds" : panel;
  const tabs: readonly Panel[] = wide ? ["odds", "inventory"] : ["booth", "odds", "inventory"];
  const primary: "buy" | "open" = canOpen ? "open" : "buy";
  const blockerText =
    blocker === "funds"
      ? `Not enough${simulated ? " simulated" : ""} RF for a pack.`
      : blocker === "backing"
        ? "New packs are paused until the prize stake can back another max prize."
        : "";

  return (
    <section
      className="sp-game"
      aria-label={definition.name}
      aria-busy={busy}
      data-panel={view}
      data-reduced-motion={reducedMotion || undefined}
    >
      <PaperSky />
      <div className="sp-shell" inert={Boolean(reveal) || paused || undefined}>
        <header className="sp-header">
          <h1 className="sp-title">Seed Pack Booth</h1>
          <span className="sp-chip" title="Selected Friend">
            {friendLabel}
          </span>
          <span className="sp-balance" aria-label={`Friend balance ${formatRf(snapshot.rfBalance)} RF${sim}`}>
            <span className="sp-num">{formatRf(snapshot.rfBalance)}</span> RF
            <Sim on={simulated} />
          </span>
          <button type="button" className="sp-btn sp-icon-btn" onClick={toggleMute} title="Sound (M)">
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button type="button" className="sp-btn sp-icon-btn" onClick={toggleMotion}>
            {reducedMotion ? "Motion off" : "Motion on"}
          </button>
        </header>
        {simulated && <p className="sp-banner">Simulated economy · no real RF moves</p>}
        <div className="sp-tabs" role="tablist" aria-label="Booth panels">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              className={`sp-tab sp-tab-${name}`}
              aria-selected={view === name}
              onClick={() => {
                play("select");
                setPanel(name);
              }}
            >
              {name === "inventory"
                ? `Inventory ${snapshot.inventory.reduce((sum, value) => sum + value, 0n).toString()}`
                : name === "odds"
                  ? "Odds"
                  : "Booth"}
            </button>
          ))}
        </div>
        <div className="sp-body">
          <section className="sp-stage" aria-label="Booth">
            <Booth label="seed packs">
              <PixelArt name="pack" className="sp-pack-art" title="Seed pack" />
              <p className="sp-pack-count">
                <span className="sp-num">×{packs.toString()}</span> {packs === 1n ? "pack" : "packs"} ready
              </p>
            </Booth>
            <div className="sp-actions">
              <button
                type="button"
                className={`sp-btn${primary === "buy" ? " sp-primary" : ""}`}
                disabled={disabled || Boolean(blocker) || Boolean(pending)}
                onClick={() => void buy()}
              >
                Buy 1 · {formatRf(definition.price)} RF{sim} <kbd>B</kbd>
              </button>
              <button
                type="button"
                className={`sp-btn${primary === "open" ? " sp-primary" : ""}`}
                disabled={disabled || !canOpen}
                onClick={() => void open()}
              >
                {pending ? "Finish opening" : "Open a pack"} <kbd>O</kbd>
              </button>
            </div>
            <p className="sp-odds-line">
              EV {formatRf(terms.expected, 2)} RF per {formatRf(terms.price)} RF pack · max prize{" "}
              {formatRf(terms.maxPrize)} RF reserved
              <Sim on={simulated} />
            </p>
            {blocker && !canOpen && <p className="sp-note">{blockerText}</p>}
          </section>
          <div className="sp-side">
            <OddsPanel definition={definition} snapshot={snapshot} simulated={simulated} />
            <InventoryPanel
              definition={definition}
              snapshot={snapshot}
              simulated={simulated}
              disabled={disabled}
              onRedeem={(outcomeId) => void redeem(outcomeId)}
            />
          </div>
        </div>
        <p className="sp-status" role={error ? "alert" : "status"}>
          {error || message || (busy ? "Waiting for confirmation…" : paused ? "Paused." : " ")}
        </p>
      </div>
      {reveal && (
        <RevealOverlay
          result={reveal}
          reducedMotion={reducedMotion}
          disabled={disabled}
          simulated={simulated}
          friendLabel={friendLabel}
          onPhase={onRevealPhase}
          onKeep={keep}
          onRedeem={() => void redeem(reveal.row.outcomeId)}
        />
      )}
    </section>
  );
}
