/**
 * About / How to play: the one-sentence rule (GDD §1.2), the controls (§2.2), what happens to your Friend between runs
 * (§5), and the Sky hub (§11, D-09). Static copy; numbers come from `@pl/shared` so they never drift.
 */
import { BITS, ECON, regrowthMsPerPx, ROOMS, type RoomSlug } from "@pl/shared";
import { Button, Card, formatRf, Pill } from "../ui/index.js";

/** The rule, verbatim: it appears on the landing, loading screen, share card and README. */
export const ONE_SENTENCE_RULE = "Every hit knocks a pixel off your Friend. Grab it back — or regrow it.";

/** Props of {@link AboutPage}. */
export interface AboutPageProps {
  onPlay?: () => void;
  onOpenEconomy?: () => void;
}

const ROOM_COPY: Record<RoomSlug, string> = {
  plaza: "the square where everyone arrives: emote, wave, tap any Friend to see its card",
  "pixel-arena": "the Pixel Life door: quick runs, practice and the Daily Run",
  "seed-booth": "the Greenhouse: Regrow, Seed Packs, the Gold market",
  "sky-docks": "bridges to other islands and home isles",
  "daily-gate": "the Daily Stone: today's island, countdown and boards",
};

const CONTROLS: readonly { input: string; how: string }[] = [
  {
    input: "mouse / touch",
    how: "press anywhere and drag back; release to fling the opposite way. A tiny drag cancels.",
  },
  {
    input: "keyboard",
    how: "←/→ or A/D aim (Shift = fine), ↑/W snaps to a creature, hold Space to charge, release to fling, Esc cancels.",
  },
  { input: "gamepad", how: "left stick aims and sets power, A flings." },
  {
    input: "one switch",
    how: "the aim arrow turns by itself: first press locks it, second press fires at the swinging power.",
  },
  { input: "tap to target", how: "tap a spot on the island and your Friend flings exactly there." },
];

/** How to play. */
export function AboutPage({ onPlay, onOpenEconomy }: AboutPageProps) {
  const pxPerDay = Math.floor((24 * 3600_000) / regrowthMsPerPx(0));
  return (
    <div className="pl-page">
      <Card variant="hero" aria-label="the rule">
        <h1 className="pl-display pl-h1" style={{ marginBottom: 12 }}>
          pixel life
        </h1>
        <p className="pl-display" style={{ fontSize: 16, margin: 0, textTransform: "none" }}>
          {ONE_SENTENCE_RULE}
        </p>
        {onPlay && (
          <div className="pl-row" style={{ marginTop: 16 }}>
            <Button variant="now" size="big" onClick={onPlay}>
              ▶ play
            </Button>
          </div>
        )}
      </Card>

      <Card title="your friend is the body" aria-label="your friend is the body">
        <p style={{ marginTop: 0 }}>
          Your Rare Friend's own on-chain pixels are its health, its weight and its trophies. Fling it into the Munchies
          to pop them. When one bites you, pixels fly off: they blink with lime brackets for about two seconds. Sweep
          over them to grab them back. Pixels you don't grab become scars.
        </p>
        <p style={{ marginBottom: 0 }}>
          Scars show everywhere your Friend goes: as dotted slots, never black. The on-chain art is never changed: whole
          means exactly your sprite.
        </p>
      </Card>

      <Card title="controls" aria-label="controls">
        <div className="pl-table-wrap">
          <table className="pl-table">
            <tbody>
              {CONTROLS.map((c) => (
                <tr key={c.input}>
                  <th scope="row">{c.input}</th>
                  <td>{c.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pl-sub">
          Pause with <kbd className="pl-kbd">Esc</kbd> or <kbd className="pl-kbd">P</kbd>, mute with{" "}
          <kbd className="pl-kbd">M</kbd>. Reduced motion, no flashes, captions and a mirrored HUD are in settings.
        </p>
      </Card>

      <div className="pl-grid-2">
        <Card title="between runs" level={2}>
          <ul className="pl-list">
            <li>
              <strong>Scars heal for free</strong>: {pxPerDay} px a day, faster with a Gold Pixel. No chores, no decay.
            </li>
            <li>
              <strong>Regrow</strong> fills your own scars now: {formatRf(ECON.regrowMicroPerPx)}/px.
            </li>
            <li>
              <strong>Mend</strong> someone else's: {formatRf(ECON.mendMicroPerPx)}/px, half of it goes into their
              Friend's wallet, and your stitches show on them for a week.
            </li>
            <li>
              <strong>Daily Run</strong>: the same island for everyone, one ranked try a day. Your streak tints your
              halo: <Pill>paper</Pill> <Pill tone="sun">sun</Pill> <Pill tone="coral">coral</Pill>{" "}
              <Pill tone="lilac">lilac</Pill> <Pill tone="gold">gold</Pill>.
            </li>
            <li>
              <strong>Seed Packs</strong> are the one chance game, with published odds. A Gold Pixel speeds healing and
              never gives in-run power.
            </li>
          </ul>
          {onOpenEconomy && (
            <Button variant="quiet" onClick={onOpenEconomy}>
              every price and the odds →
            </Button>
          )}
        </Card>

        <Card title="the sky" level={2}>
          <p style={{ marginTop: 0 }}>
            The Sky is a shared hub, like a plaza in a park: walk (click or tap where to go), emote, and meet other
            Friends, scars, gold and stitches included. Rooms:
          </p>
          <ul className="pl-list">
            {ROOMS.map((r) => (
              <li key={r}>
                <strong className="pl-mono">{r}</strong>: {ROOM_COPY[r]}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="your isle, stamps & belts" level={2}>
        <ul className="pl-list">
          <li>
            <strong>Bits</strong> come from playing (capped at {BITS.dailyHardCap} a day). They buy decor, hats and
            island plots in the Seed Catalogue and never convert to RF.
          </li>
          <li>
            <strong>Your isle</strong> floats in the Sky: place what you buy, choose a hat, and open it for visits.
          </li>
          <li>
            <strong>Stamps</strong> (24 of them) mark what you did; <strong>Fling Belts</strong> are fixed-seed trials
            from white to Gulp Master. Both are status only: they unlock flex items, never Bits or RF.
          </li>
        </ul>
      </Card>

      <Card title="no wallet? play on loan" level={2}>
        <p style={{ margin: 0 }}>
          Guests play a real Friend on loan. Its scars stay on your device only. Bring your own Friend to make scars
          stick (and heal), mend others and climb the owners' board. Every RF amount is labelled SIMULATED until live
          mode is switched on.
        </p>
      </Card>
    </div>
  );
}
