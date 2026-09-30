import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loaner } from "../test/fixtures.js";
import { createCoach, emitCoachEvent } from "./coach.js";
import { Coachmarks } from "./Coachmarks.js";
import { demoView } from "./demo.js";
import { FirstVisit, pickStranger } from "./FirstVisit.js";
import { IntroCards } from "./IntroCards.js";
import { markIntroSeen, shouldShowIntro } from "./progress.js";
import { RfFlowExplainer } from "./RfFlowExplainer.js";
import { CONTRACTS_README_URL, WhyRealEconomy } from "./WhyRealEconomy.js";
import { LOANERS } from "../test/fixtures.js";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const you = demoView(loaner(0).appearance);
const stranger = demoView(loaner(1).appearance);

describe("IntroCards", () => {
  it("walks the three cards with the exact copy, then Play now marks the intro seen", async () => {
    const onPlay = vi.fn();
    const user = userEvent.setup();
    render(<IntroCards open you={you} stranger={stranger} onPlay={onPlay} onSkip={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Every hit knocks a pixel off your Friend. Grab it back.")).toBeTruthy();
    expect(within(dialog).getByText(/Step 1 of 3/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText(/Scars heal over time, or regrow now with RF/)).toBeTruthy();
    expect(screen.getByText("0.50 RF")).toBeTruthy();
    expect(screen.getAllByText("SIMULATED").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "next" }));
    expect(screen.getByText(/half paid into/)).toBeTruthy();
    expect(screen.getByText(`50 % burned · 50 % to #${stranger.appearance.tokenId}'s wallet`)).toBeTruthy();
    expect(shouldShowIntro()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Play now" }));
    expect(onPlay).toHaveBeenCalledOnce();
    expect(shouldShowIntro()).toBe(false);
  });

  it("skips from the first card and pages with arrow keys", async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(<IntroCards open you={you} stranger={stranger} onPlay={() => undefined} onSkip={onSkip} />);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "skip" }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(shouldShowIntro()).toBe(false);
  });

  it("uses the real Friend's portrait as the illustration", () => {
    render(<IntroCards open you={you} stranger={stranger} onPlay={() => undefined} onSkip={() => undefined} />);
    expect(screen.getByRole("img", { name: /five pixels fly off/ })).toBeTruthy();
  });
});

describe("FirstVisit", () => {
  it("opens once with loaners and stays closed after it was seen", async () => {
    const { unmount } = render(<FirstVisit onPlay={() => undefined} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    unmount();
    markIntroSeen();
    render(<FirstVisit onPlay={() => undefined} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("force re-opens it (a 'how it works' button)", async () => {
    markIntroSeen();
    render(<FirstVisit force onPlay={() => undefined} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("never picks the player's own Friend as the stranger", () => {
    for (const l of LOANERS)
      expect(pickStranger(LOANERS, l.appearance.tokenId)?.appearance.tokenId).not.toBe(l.appearance.tokenId);
    expect(pickStranger([], "1")).toBeNull();
    expect(pickStranger(LOANERS.slice(0, 1), LOANERS[0]?.appearance.tokenId ?? "")).toBeNull();
  });
});

describe("RfFlowExplainer", () => {
  it("shows every flow with live numbers and the SIMULATED label", async () => {
    const user = userEvent.setup();
    render(<RfFlowExplainer />);
    expect(screen.getByRole("heading", { name: "Where your RF goes" })).toBeTruthy();
    expect(screen.getAllByText("SIMULATED").length).toBeGreaterThan(0);
    expect(screen.getByText(/no real RF moves/)).toBeTruthy();
    // Regrow 10 px = 5 RF: 2.50 burned, 2.50 to the stream.
    expect(screen.getByText("5.00 RF")).toBeTruthy();
    expect(screen.getByText("every active Friend")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Mend" }));
    expect(screen.getByText("10.00 RF")).toBeTruthy();
    expect(screen.getByText("that Friend's wallet")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Market" }));
    expect(screen.getByText("royalty to the Friend that grew it")).toBeTruthy();
    expect(screen.getByText("game creator")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Seed Pack" }));
    expect(screen.getByText("back as rewards")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Gold Pixel")).toBeTruthy();
  });

  it("the slider changes the example amount", () => {
    render(<RfFlowExplainer />);
    const slider = screen.getByLabelText(/try another amount/);
    act(() => {
      // React listens to the native input event for range inputs.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "4");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(screen.getByText("4 px Regrow on your own Friend")).toBeTruthy();
    expect(screen.getByText("2.00 RF")).toBeTruthy();
  });

  it("locks to one exact payment for confirm dialogs (no tabs, no slider)", () => {
    render(<RfFlowExplainer only="mend" input={{ pixels: 3, targetName: "#7730" }} title={null} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByLabelText(/try another amount/)).toBeNull();
    expect(screen.getByText("3 px Mend on #7730")).toBeTruthy();
    expect(screen.getByText("#7730's wallet")).toBeTruthy();
    expect(screen.getAllByText(/1.50 RF/).length).toBe(2);
  });

  it("says LIVE and drops the simulated note in live mode", () => {
    render(<RfFlowExplainer mode="live" />);
    expect(screen.getAllByText("LIVE RF").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no real RF moves/)).toBeNull();
  });
});

describe("WhyRealEconomy", () => {
  it("states the six claims with numbers from the constants and links the contracts", () => {
    render(<WhyRealEconomy />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(6);
    expect(screen.getByText("No RF is minted")).toBeTruthy();
    expect(screen.getByText("No loser pays a winner")).toBeTruthy();
    expect(screen.getByText("Friends earn from Mend")).toBeTruthy();
    expect(screen.getByText(/2% to the Friend that grew the Gold/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /contracts\/README.md/ });
    expect(link.getAttribute("href")).toBe(CONTRACTS_README_URL);
    expect(screen.getByText(/every balance is SIMULATED/)).toBeTruthy();
    expect(screen.getByText(/Not deployed, not audited/)).toBeTruthy();
  });
});

describe("Coachmarks", () => {
  it("shows hints on game events, announces them, and 'got it' completes them", async () => {
    const user = userEvent.setup();
    const coach = createCoach({ persist: false });
    render(<Coachmarks coach={coach} />);
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    act(() => emitCoachEvent("run:start"));
    expect(within(live).getByText("Drag to fling")).toBeTruthy();
    act(() => coach.emit("fling"));
    expect(live.textContent).toBe("");
    act(() => emitCoachEvent("pixels:loose"));
    expect(within(live).getByText("Grab them back")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "got it" }));
    expect(live.textContent).toBe("");
    act(() => emitCoachEvent("pixels:loose"));
    await waitFor(() => expect(live.textContent).toBe(""));
  });
});
