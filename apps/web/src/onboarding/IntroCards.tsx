/**
 * The first-visit flow: three illustrated cards (lose pixels, heal or regrow, mend a stranger) and "Play now".
 * Built on the kit's `Modal` (focus trap, Esc, focus restore). Skippable at every step; arrow keys page. Reading all
 * three takes about 15 s. Each card shows a real Friend's sprite running a short loop computed from its own pixels.
 */
import { ECON, type EconomyMode, type FriendView } from "@pl/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button, formatRf, Modal, SimulatedBadge } from "../ui/index.js";
import { healFrames, hitFrames, mendFrames } from "./demo.js";
import { DemoFriend } from "./DemoFriend.js";
import { markIntroSeen } from "./progress.js";

/** Props of {@link IntroCards}. */
export interface IntroCardsProps {
  open: boolean;
  /** The player's Friend (or today's loaner). */
  you: FriendView;
  /** Another real Friend, shown as the stranger on card 3. */
  stranger: FriendView;
  /** "Play now": the shell starts a run. The intro is marked seen first. */
  onPlay: () => void;
  /** Skip / close. The intro is marked seen first. */
  onSkip: () => void;
  /** Economy mode for the RF label (default sim). */
  mode?: EconomyMode;
}

/** Number of cards. */
const STEP_COUNT = 3;

interface Step {
  title: string;
  body: ReactNode;
  art: ReactNode;
}

/** A price chip: "0.50 RF / px" + the split in words. */
function Price({ micro, split, mode }: { micro: number; split: string; mode: EconomyMode }) {
  return (
    <p className="pl-onb-price">
      <span className="pl-num">{formatRf(micro)}</span>
      <span className="pl-label">/ px</span>
      <span className="pl-sub">{split}</span>
      <SimulatedBadge mode={mode} />
    </p>
  );
}

/** Three-card first-visit explainer. */
export function IntroCards({ open, you, stranger, onPlay, onSkip, mode = "sim" }: IntroCardsProps) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // Arrow keys page through the cards wherever focus is inside the dialog (buttons do not use arrows).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hit = useMemo(() => hitFrames(you.appearance), [you.appearance]);
  const heal = useMemo(() => healFrames(you.appearance), [you.appearance]);
  const mend = useMemo(() => mendFrames(stranger.appearance), [stranger.appearance]);
  const strangerName = `#${stranger.appearance.tokenId}`;

  const steps: Step[] = [
    {
      title: "Pixels are life",
      body: (
        <>
          <p className="pl-onb-lead">Every hit knocks a pixel off your Friend. Grab it back.</p>
          <p className="pl-sub">Pixels you miss stay as scars, everywhere your Friend goes.</p>
        </>
      ),
      art: (
        <DemoFriend
          view={you}
          frames={hit}
          still={1}
          label="Your Friend is hit: five pixels fly off, three are grabbed back, two stay as scars."
        />
      ),
    },
    {
      title: "Scars heal",
      body: (
        <>
          <p className="pl-onb-lead">
            Scars heal over time, or regrow now with RF (half burned, half to every active Friend).
          </p>
          <Price micro={ECON.regrowMicroPerPx} split="50 % burned · 50 % to every active Friend" mode={mode} />
        </>
      ),
      art: (
        <DemoFriend
          view={you}
          frames={heal}
          still={3}
          label="Scars heal one pixel at a time for free; the rest can be regrown at once with RF."
        />
      ),
    },
    {
      title: "Mend a stranger",
      body: (
        <>
          <p className="pl-onb-lead">
            Mend a stranger's Friend: half burned, half paid into <strong className="pl-onb-em">that</strong> Friend's
            own wallet.
          </p>
          <Price micro={ECON.mendMicroPerPx} split={`50 % burned · 50 % to ${strangerName}'s wallet`} mode={mode} />
        </>
      ),
      art: (
        <DemoFriend
          view={stranger}
          frames={mend}
          still={2}
          label={`Friend ${strangerName} has scars; you mend them and they show stitches.`}
        />
      ),
    },
  ];

  const last = steps.length - 1;
  const cur = steps[Math.min(step, last)] ?? steps[0];
  if (!cur) return null;

  const skip = (): void => {
    markIntroSeen();
    onSkip();
  };
  const play = (): void => {
    markIntroSeen();
    onPlay();
  };
  return (
    <Modal
      open={open}
      onClose={skip}
      title={
        <span>
          <span className="pl-sr-only">
            Step {step + 1} of {steps.length}:{" "}
          </span>
          {cur.title}
        </span>
      }
      footer={
        <>
          <ol className="pl-onb-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <li key={s.title} className={i === step ? "is-on" : undefined} />
            ))}
          </ol>
          <Button variant="quiet" onClick={skip}>
            skip
          </Button>
          {step < last ? (
            <Button variant="ink" onClick={() => setStep(step + 1)}>
              next
            </Button>
          ) : (
            <Button variant="now" size="big" onClick={play}>
              Play now
            </Button>
          )}
        </>
      }
    >
      <div className="pl-onb-card" aria-live="polite">
        <div className="pl-onb-art">{cur.art}</div>
        <div className="pl-onb-copy">{cur.body}</div>
      </div>
    </Modal>
  );
}
