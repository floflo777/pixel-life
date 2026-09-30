import { fromIndices, getBit, type InboxItem, popcount } from "@pl/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remote } from "../ui/index.js";
import { FIXTURE_FRONT, fixtureView } from "./__fixtures__/friend.js";
import { FriendPage, mendersFromInbox } from "./FriendPage.js";

afterEach(cleanup);

const NOW = 1_000_000;
const N0 = popcount(FIXTURE_FRONT);
const mended = (id: string, by: string, px: number, createdAt: number, readAt: number | null = null): InboxItem => ({
  id,
  tokenId: "344030",
  createdAt,
  readAt,
  kind: "mended",
  by,
  px,
  toTargetMicro: px * 500_000,
  mode: "sim",
  region: null,
  batched: 0,
});

describe("FriendPage", () => {
  it("shows loading, then an error with retry", async () => {
    const retry = vi.fn();
    const { rerender } = render(<FriendPage friend={remote.loading()} viewer="visitor" mode="sim" now={NOW} />);
    expect(screen.getByText("loading Friend…")).toBeTruthy();
    rerender(
      <FriendPage
        friend={remote.error("Can't reach the sky right now.")}
        onRetry={retry}
        viewer="visitor"
        mode="sim"
        now={NOW}
      />,
    );
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("shows pixels N/N0, heal timer, halo, gold and stitches", () => {
    const present = Array.from({ length: 256 }, (_, i) => i).filter((i) => getBit(FIXTURE_FRONT, i));
    const view = fixtureView({ lostCount: 3, goldHeld: 1, streak: 8, stitched: fromIndices(present.slice(-2)) });
    render(<FriendPage friend={remote.ready(view)} viewer="visitor" mode="sim" now={NOW} onMend={() => undefined} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("#344030 · Mask");
    expect(screen.getByRole("meter", { name: "pixels" }).getAttribute("aria-valuetext")).toBe(
      `${N0 - 3} of ${N0} pixels`,
    );
    // Gold: 2 h / 1.25 = 96 min per pixel → first pixel in 1:36:00, whole in 4h 48m.
    expect(screen.getByText("1:36:00")).toBeTruthy();
    expect(screen.getByText(/whole in 4h 48m/)).toBeTruthy();
    expect(screen.getByText(/coral · 8-day streak/)).toBeTruthy();
    expect(screen.getByText("1 gold pixel")).toBeTruthy();
    expect(screen.getByText("2 px stitched by other Friends")).toBeTruthy();
    expect(screen.getByText("SIMULATED")).toBeTruthy();
  });

  it("gives visitors a lime Mend and guests a disabled one", async () => {
    const onMend = vi.fn();
    const view = fixtureView({ lostCount: 2 });
    const { rerender } = render(
      <FriendPage friend={remote.ready(view)} viewer="visitor" mode="sim" now={NOW} onMend={onMend} />,
    );
    const mend = screen.getByRole("button", { name: "mend · 1.00 RF/px" });
    expect(mend.className).toContain("pl-btn--now");
    await userEvent.click(mend);
    expect(onMend).toHaveBeenCalled();
    rerender(<FriendPage friend={remote.ready(view)} viewer="guest" mode="sim" now={NOW} onMend={onMend} />);
    expect(screen.getByRole("button", { name: "mend · 1.00 RF/px" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Bring your own Friend/)).toBeTruthy();
  });

  it("gives the owner Regrow, the inbox and stitched-by from the inbox", async () => {
    const onRegrow = vi.fn();
    const onInboxRead = vi.fn();
    const items: InboxItem[] = [
      mended("m1", "1969", 3, NOW - 3600_000),
      { id: "w1", tokenId: "344030", createdAt: NOW - 60_000, readAt: NOW, kind: "whole" },
    ];
    render(
      <FriendPage
        friend={remote.ready(fixtureView({ lostCount: 4 }))}
        viewer="owner"
        mode="sim"
        balanceMicro={12_500_000}
        inbox={remote.ready(items)}
        onInboxRead={onInboxRead}
        onRegrow={onRegrow}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "regrow · 0.50 RF/px" }));
    expect(onRegrow).toHaveBeenCalled();
    expect(screen.getByText("balance 12.50 RF")).toBeTruthy();
    const inbox = screen.getByRole("region", { name: "inbox" });
    expect(within(inbox).getByText(/#1969 mended #344030's 3 pixels/)).toBeTruthy();
    expect(within(inbox).getByText("#344030 is whole again.")).toBeTruthy();
    await userEvent.click(within(inbox).getByRole("button", { name: /^mark read: #1969/ }));
    expect(onInboxRead).toHaveBeenCalledWith(["m1"]);
    await userEvent.click(within(inbox).getByRole("button", { name: "mark all read" }));
    expect(onInboxRead).toHaveBeenCalledWith("all");
    const stitched = screen.getByRole("region", { name: "stitched by" });
    expect(within(stitched).getByText("#1969")).toBeTruthy();
    expect(within(stitched).getByText("1 h ago")).toBeTruthy();
  });

  it("explains that loaned Friends can't be mended", () => {
    render(
      <FriendPage
        friend={remote.ready(fixtureView({ lostCount: 2, loaned: true, goldHeld: 2 }))}
        viewer="visitor"
        mode="sim"
        now={NOW}
        onMend={() => undefined}
      />,
    );
    expect(screen.getByText("on loan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mend/ })).toBeNull();
    expect(screen.getByText("none held")).toBeTruthy();
  });
});

describe("mendersFromInbox", () => {
  it("keeps only mends younger than 7 days, newest first", () => {
    const week = 7 * 24 * 3600_000;
    const items = [mended("a", "1", 1, 100), mended("b", "2", 2, 200)];
    expect(mendersFromInbox(items, 300).map((m) => m.by)).toEqual(["2", "1"]);
    expect(mendersFromInbox(items, 150 + week).map((m) => m.by)).toEqual(["2"]);
  });
});
