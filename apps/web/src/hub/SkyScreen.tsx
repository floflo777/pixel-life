/**
 * `/sky`: The Sky, the Club Penguin-like hub (GDD §11–12), with the real `createHubScene` from `@pl/game`.
 * - Every door works: venue doormats open the venue card (GDD §11.5: name, one-line rule, [enter]), the Greenhouse,
 *   Daily Stone and Mend board doormats open their pages, bridges change room, Mend Well bubbles and scarred Friends
 *   open the Mend flow, and any other Friend opens a mini card (visit its home island, its page, mute).
 * - Coming back from a venue or a page lands in the room you left.
 * - Loading / offline / error states: joining is a small status line; a room that refuses us or does not answer
 *   leaves you on the offline single-player plaza with a retry (GDD §6.10); a broken scene shows an error with retry.
 * - `/sky?home=<tokenId>` shows that Friend's home island instead.
 */
import { isTokenIdStr, QUICK_CHAT_PHRASES, type EmoteName, type RoomSlug, type TokenIdStr } from "@pl/shared";
import type { VenueIdentity } from "@pl/venue-kit";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { ensureGuest } from "../identity/bootstrap.js";
import { loadLoaners } from "../identity/loaners.js";
import { navigate } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { LiveStage } from "../stage/LiveStage.js";
import { Button, ErrorState, FriendPortrait, LinkButton, Loading } from "../ui/index.js";
import { venueIds } from "../venues/registry.js";
import { doorAction, friendHref, homeHref, lastRoom, mendHref, rememberRoom, type DoorAction } from "./doors.js";
import { fetchBelt } from "./home-api.js";
import { HomeIsle } from "./HomeIsle.js";
import { mountSky, type SkyHandle, type SkyStatus } from "./hub-scene.js";
import "./sky.css";

/** Display names of the rooms for the top bar. */
const ROOM_TITLE: Readonly<Record<RoomSlug, string>> = {
  plaza: "plaza",
  "pixel-arena": "the arena",
  "seed-booth": "greenhouse isle",
  "sky-docks": "sky docks",
  "daily-gate": "daily gate",
};

/** Quick-chat phrases offered in the wheel (ids into the shared phrase table). */
const QUICK_CHAT: readonly { id: number; text: string }[] = [
  { id: 0, text: "hi!" },
  { id: 1, text: "gg" },
  { id: 3, text: "help me mend?" },
  { id: 5, text: "daily?" },
  { id: 6, text: "follow me" },
  { id: 15, text: "bye!" },
].filter((p) => p.id < QUICK_CHAT_PHRASES);

const EMOTE_LABEL: Readonly<Record<EmoteName, string>> = {
  wave: "wave",
  hop: "hop",
  spin: "spin",
  heart: "♥",
  "pixel-burst": "burst",
  sit: "sit",
  flex: "flex",
  stomp: "stomp",
};

type Card = { kind: "door"; action: Extract<DoorAction, { kind: "venue" }> } | { kind: "friend"; tokenId: TokenIdStr };

/** The hub screen (or a home island with `?home=`). */
export default function SkyScreen({ search }: PageProps) {
  const home = search.get("home");
  if (home && isTokenIdStr(home)) return <HomeIsle tokenId={home} />;
  return <Sky />;
}

function Sky() {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const [status, setStatus] = useState<SkyStatus>({ kind: "joining" });
  const [room, setRoom] = useState<RoomSlug>(() => lastRoom());
  const [card, setCard] = useState<Card | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [emotes, setEmotes] = useState<readonly EmoteName[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [muted, setMuted] = useState<ReadonlySet<TokenIdStr>>(() => new Set());
  const handle = useRef<SkyHandle | null>(null);

  useEffect(() => {
    if (identity.mode === "none") void ensureGuest(s).catch(() => undefined);
  }, [identity.mode, s]);

  const player = identity.mode === "none" ? null : `${identity.mode}:${identity.view.appearance.tokenId}`;
  const vid = useMemo<VenueIdentity | null>(
    () =>
      identity.mode === "none"
        ? null
        : { mode: identity.mode, friend: identity.view, loaned: identity.mode === "guest" },
    [identity],
  );
  const vidRef = useRef(vid);
  vidRef.current = vid;

  if (!vid || !player) return <Loading label="your Friend is on its way" />;

  const closeCard = (): void => {
    if (card?.kind === "door") handle.current?.scene.exitVenue();
    setCard(null);
  };

  return (
    <div className="sky" data-testid="sky" data-status={status.kind} data-room={room}>
      <LiveStage
        key={`${player}:${attempt}`}
        className="sky-stage"
        label={`The Sky, ${ROOM_TITLE[room]}: walk with arrows or WASD, tap to walk, walk into a door to enter`}
        mount={(stage) => {
          let gone = false;
          let sky: SkyHandle | null = null;
          setStatus({ kind: "joining" });
          void (async () => {
            const loaners = await loadLoaners().catch(() => []);
            if (gone) return;
            sky = await mountSky({
              stage,
              identity: () => vidRef.current ?? vid,
              api: s.api,
              audio: s.audio,
              room: lastRoom(),
              venues: venueIds(),
              loaners,
              belt: fetchBelt,
              onStatus: (st) => !gone && setStatus(st),
              onEnterVenue: (e) => {
                rememberRoom(e.room);
                const action = doorAction(e.venueId, e.mode);
                if (action.kind === "page") navigate(action.href);
                else if (action.kind === "venue") setCard({ kind: "door", action });
                else sky?.scene.exitVenue();
              },
              onRoomChange: (r) => {
                rememberRoom(r);
                if (!gone) setRoom(r);
              },
              onMendRequest: (tokenId) => navigate(mendHref(tokenId)),
              onFriendTap: (tokenId) => setCard({ kind: "friend", tokenId }),
            }).catch((e: unknown) => {
              if (!gone) setStatus({ kind: "error", why: e instanceof Error ? e.message : String(e) });
              return null;
            });
            if (!sky) return;
            if (gone) return sky.dispose();
            handle.current = sky;
            setEmotes(sky.emotes);
          })();
          return () => {
            gone = true;
            handle.current = null;
            sky?.dispose();
          };
        }}
        fallback={
          <div className="stage-fallback-card">
            <FriendPortrait view={vid.friend} scale={8} />
            <p>This device can't draw The Sky (WebGL2). Every door is still here:</p>
            <nav className="sky-fallback-doors" aria-label="Doors">
              <LinkButton to="/play" variant="now">
                ▶ loose pixels
              </LinkButton>
              <LinkButton to="/venue/seed-pack">seed pack booth</LinkButton>
              <LinkButton to="/regrow">greenhouse</LinkButton>
              <LinkButton to="/board">daily stone</LinkButton>
              <LinkButton to="/mend">mend board</LinkButton>
            </nav>
          </div>
        }
      />

      <div className="sky-top mono">
        <span className="display">the sky · {ROOM_TITLE[room]}</span>
        <span role="status" aria-live="polite">
          {status.kind === "joining"
            ? "joining…"
            : status.kind === "online"
              ? "● live"
              : status.kind === "offline"
                ? "offline"
                : ""}
        </span>
      </div>

      {status.kind === "offline" && (
        <div className="notice sky-fog" role="status">
          <span>The sky is foggy: you're on your own island for now. Every door still works.</span>
          <Button variant="now" onClick={() => handle.current?.retry()}>
            retry
          </Button>
        </div>
      )}
      {status.kind === "error" && (
        <div className="sky-error">
          <ErrorState message={`The Sky couldn't open: ${status.why}`} onRetry={() => setAttempt((a) => a + 1)} />
        </div>
      )}

      <div className="sky-hud">
        <LinkButton to="/play" variant="now" size="big" aria-label="play Loose Pixels now">
          ▶ play
        </LinkButton>
        <div className="sky-emotes" role="group" aria-label="Emotes">
          {emotes.map((e, i) => (
            <Button
              key={e}
              className="sky-emote"
              aria-label={`${e} (key ${i + 1})`}
              onClick={() => handle.current?.scene.emote(e)}
            >
              {EMOTE_LABEL[e]}
            </Button>
          ))}
          <Button
            className="sky-emote"
            aria-expanded={chatOpen}
            aria-controls="sky-chat"
            onClick={() => setChatOpen((o) => !o)}
          >
            say…
          </Button>
        </div>
        {chatOpen && (
          <div id="sky-chat" className="sky-chat" role="menu" aria-label="Quick chat">
            {QUICK_CHAT.map((p) => (
              <Button
                key={p.id}
                role="menuitem"
                onClick={() => {
                  handle.current?.scene.say(p.id);
                  setChatOpen(false);
                }}
              >
                {p.text}
              </Button>
            ))}
          </div>
        )}
      </div>

      {card && (
        <SkyCard
          card={card}
          muted={card.kind === "friend" && muted.has(card.tokenId)}
          onClose={closeCard}
          onEnter={(href) => {
            setCard(null);
            navigate(href);
          }}
          onToggleMute={(tokenId) => {
            const next = new Set(muted);
            const on = !next.has(tokenId);
            if (on) next.add(tokenId);
            else next.delete(tokenId);
            handle.current?.scene.setMuted(tokenId, on);
            setMuted(next);
          }}
        />
      )}
    </div>
  );
}

/** The venue card (GDD §11.5) or a Friend's mini card, pinned over the stage. Esc or "stay" closes it. */
function SkyCard({
  card,
  muted,
  onClose,
  onEnter,
  onToggleMute,
}: {
  card: Card;
  muted: boolean;
  onClose(): void;
  onEnter(href: string): void;
  onToggleMute(tokenId: TokenIdStr): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus the primary action so Enter enters and Esc stays (keyboard players never lose their place).
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [card]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };
  if (card.kind === "door") {
    const a = card.action;
    return (
      <div
        ref={panel}
        className="sky-card"
        role="dialog"
        aria-labelledby="sky-card-title"
        onKeyDown={onKeyDown}
        data-testid="venue-card"
      >
        <h2 className="display" id="sky-card-title">
          {a.name}
        </h2>
        <p>{a.rule}</p>
        <div className="sky-card-actions">
          <Button variant="now" onClick={() => onEnter(a.href)}>
            enter
          </Button>
          <Button onClick={onClose}>stay in the sky</Button>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={panel}
      className="sky-card"
      role="dialog"
      aria-labelledby="sky-card-title"
      onKeyDown={onKeyDown}
      data-testid="friend-card"
    >
      <h2 className="display" id="sky-card-title">
        #{card.tokenId}
      </h2>
      <div className="sky-card-actions">
        <Button variant="now" onClick={() => onEnter(homeHref(card.tokenId))}>
          visit island
        </Button>
        <Button onClick={() => onEnter(friendHref(card.tokenId))}>friend page</Button>
        <Button onClick={() => onToggleMute(card.tokenId)} aria-pressed={muted}>
          {muted ? "unmute" : "mute"}
        </Button>
        <Button onClick={onClose}>close</Button>
      </div>
    </div>
  );
}
