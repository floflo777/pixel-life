import type { DailyBoardRes } from "@pl/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remote } from "../ui/index.js";
import { fixtureView } from "./__fixtures__/friend.js";
import { DailyBoard } from "./DailyBoard.js";
import { MendBoard, type MendCandidate, mendRows } from "./MendBoard.js";

afterEach(cleanup);
const NOW = 1_000_000;

function candidate(tokenId: string, lostCount: number, withAppearance = true): MendCandidate {
  const v = fixtureView({ tokenId, lostCount });
  return { tokenId, familyId: 1, pub: v.pub, ...(withAppearance ? { appearance: v.appearance } : {}) };
}

describe("MendBoard", () => {
  it("lists scarred Friends, most missing first, without the viewer or whole Friends", async () => {
    const onMend = vi.fn();
    const list = [
      candidate("10", 2),
      candidate("20", 6),
      candidate("30", 0),
      candidate("40", 4, false),
      candidate("99", 9),
    ];
    render(<MendBoard friends={remote.ready(list)} mode="sim" viewerTokenId="99" onMend={onMend} now={NOW} />);
    const items = within(screen.getByRole("list", { name: "3 Friends to mend" })).getAllByRole("heading");
    expect(items.map((h) => h.textContent)).toEqual(["#20", "#40", "#10"]);
    await userEvent.click(screen.getByRole("button", { name: "mend #20" }));
    expect(onMend).toHaveBeenCalledWith("20");
    expect(screen.getByText(/half goes into that Friend's own wallet/)).toBeTruthy();
  });

  it("disables mending for guests and shows an empty state when everyone is whole", () => {
    const { rerender } = render(
      <MendBoard
        friends={remote.ready([candidate("10", 2)])}
        mode="sim"
        viewerTokenId={null}
        onMend={() => undefined}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: "mend #10" })).toHaveProperty("disabled", true);
    rerender(<MendBoard friends={remote.ready([candidate("10", 0)])} mode="sim" viewerTokenId={null} now={NOW} />);
    expect(screen.getByText("everyone is whole")).toBeTruthy();
  });

  it("uses live scars: a Friend that healed meanwhile drops off", () => {
    expect(mendRows([candidate("10", 1)], NOW, null)).toHaveLength(1);
    expect(mendRows([candidate("10", 1)], NOW + 7_200_000, null)).toHaveLength(0);
  });
});

describe("DailyBoard", () => {
  const res = (board: "owners" | "visitors"): DailyBoardRes => ({
    day: "2026-09-30",
    board,
    entries: [
      { rank: 1, entrant: "0xabc", tokenId: "344030", score: 3410, runId: "r1", verified: "ok" },
      { rank: 2, entrant: "guest-1", tokenId: null, score: 2100, runId: "r2", verified: "pending" },
    ],
    me: { rank: 57, entrant: "0xme", tokenId: "1969", score: 900, runId: "r57", verified: "mismatch" },
  });

  function Harness({ onPlay }: { onPlay: () => void }) {
    const [board, setBoard] = useState<"owners" | "visitors">("owners");
    return (
      <DailyBoard
        seed={{ day: "2026-09-30", seed: 1, endsAt: NOW + 4 * 3600_000 + 12 * 60_000 + 55_000 }}
        board={board}
        onBoardChange={setBoard}
        data={remote.ready(res(board))}
        onPlay={onPlay}
        now={NOW}
      />
    );
  }

  it("shows the countdown, rows, replay status and the viewer's own row", async () => {
    const onPlay = vi.fn();
    render(<Harness onPlay={onPlay} />);
    expect(screen.getByRole("timer").textContent).toBe("4:12:55");
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 2 + me
    expect(within(rows[1] as HTMLElement).getByText("3 410")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("verified")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("guest-1")).toBeTruthy();
    expect(rows[3]?.getAttribute("aria-current")).toBe("true");
    expect(within(rows[3] as HTMLElement).getByText("unverified")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "visitors" }));
    expect(screen.getByText(/guest board · unverified · top 100/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /play today's island/ }));
    expect(onPlay).toHaveBeenCalled();
  });

  it("shows an empty board", () => {
    render(
      <DailyBoard
        seed={null}
        board="owners"
        onBoardChange={() => undefined}
        data={remote.ready({ day: "d", board: "owners", entries: [], me: null })}
        now={NOW}
      />,
    );
    expect(screen.getByText("no runs yet today")).toBeTruthy();
  });
});
