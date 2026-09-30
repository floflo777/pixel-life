/**
 * Dev-only gallery for the onboarding components (not part of the build: Vite builds only apps/web/index.html).
 * Open `/src/onboarding/preview/index.html?scene=<name>` on the dev server; used for the PR screenshots.
 * Scenes: intro1..intro3, explainer, market, seed, confirm, why, coach-fling, coach-sweep.
 */
import { type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../styles/app.css";
import { type LoanerFriend, loadLoaners } from "../../identity/loaners.js";
import { Button, Modal } from "../../ui/index.js";
import { demoView } from "../demo.js";
import { Coachmarks, createCoach, type FlowKind, IntroCards, RfFlowExplainer, WhyRealEconomy } from "../index.js";

const scene = new URLSearchParams(location.search).get("scene") ?? "intro1";

function Intro({ step }: { step: number }) {
  const [loaners, setLoaners] = useState<LoanerFriend[] | null>(null);
  useEffect(() => {
    void loadLoaners().then(setLoaners);
  }, []);
  useEffect(() => {
    if (!loaners) return;
    // Page to the requested card through the public keyboard behaviour.
    for (let i = 1; i < step; i++) window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  }, [loaners, step]);
  const a = loaners?.[0];
  const b = loaners?.[3];
  if (!a || !b) return null;
  return (
    <IntroCards
      open
      you={demoView(a.appearance)}
      stranger={demoView(b.appearance)}
      onPlay={() => undefined}
      onSkip={() => undefined}
    />
  );
}

function Coach({ event }: { event: string }) {
  const [coach] = useState(() => createCoach({ persist: false }));
  useEffect(() => coach.emit(event), [coach, event]);
  return (
    <div className="pl-onb-fakegame" style={{ position: "relative", height: "100dvh", background: "#c5deea" }}>
      <Coachmarks coach={coach} listenWindow={false} />
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="pl-root pl-construction" style={{ minHeight: "100dvh" }}>
      <div className="pl-page">
        <div className="pl-card">{children}</div>
      </div>
    </div>
  );
}

function Scene() {
  switch (scene) {
    case "intro1":
    case "intro2":
    case "intro3":
      return (
        <div className="pl-construction" style={{ minHeight: "100dvh" }}>
          <Intro step={Number(scene.slice(-1))} />
        </div>
      );
    case "explainer":
    case "market":
    case "seed":
      return (
        <Page>
          <RfFlowExplainer initial={(scene === "explainer" ? "regrow" : scene) as FlowKind} />
        </Page>
      );
    case "confirm":
      return (
        <div className="pl-construction" style={{ minHeight: "100dvh" }}>
          <Modal
            open
            title="Mend 6 px?"
            onClose={() => undefined}
            footer={
              <>
                <Button variant="quiet">cancel</Button>
                <Button variant="now">Mend for 6.00 RF</Button>
              </>
            }
          >
            <RfFlowExplainer only="mend" input={{ pixels: 6, targetName: "#7730" }} title={null} />
          </Modal>
        </div>
      );
    case "why":
      return (
        <Page>
          <WhyRealEconomy />
        </Page>
      );
    case "coach-fling":
      return <Coach event="run:start" />;
    case "coach-sweep":
      return <Coach event="pixels:loose" />;
    default:
      return <p>unknown scene</p>;
  }
}

const root = document.getElementById("root");
if (root)
  // No StrictMode here: the intro scenes page by dispatching key events once, from an effect.
  createRoot(root).render(<Scene />);
