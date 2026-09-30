import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatBps,
  formatClock,
  formatDuration,
  formatRf,
  Modal,
  PixelNumber,
  ProgressBlocks,
  remote,
  RemoteView,
  SimulatedBadge,
  Skeleton,
  SplitBar,
  streakTier,
  Tabs,
  ToastRegion,
  useToasts,
} from "./index.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete document.documentElement.dataset["reducedMotion"];
});

describe("format", () => {
  it("formats RF, durations, clocks and percentages", () => {
    expect(formatRf(1_500_000)).toBe("1.50 RF");
    expect(formatDuration(3 * 3600_000 + 10 * 60_000)).toBe("3h 10m");
    expect(formatDuration(26 * 3600_000)).toBe("1d 2h");
    expect(formatClock(12 * 60_000 + 4_000)).toBe("12:04");
    expect(formatClock(3723_000)).toBe("1:02:03");
    expect(formatBps(5600)).toBe("56 %");
    expect(formatBps(1040)).toBe("10.4 %");
  });
});

describe("streakTier", () => {
  it("maps days to the GDD §5.6 halo tiers", () => {
    expect([0, 2, 3, 6, 7, 13, 14, 29, 30, 400, -5].map((d) => streakTier(d).name)).toEqual([
      "paper",
      "paper",
      "sun",
      "sun",
      "coral",
      "coral",
      "lilac",
      "lilac",
      "gold-white",
      "gold-white",
      "paper",
    ]);
  });
});

describe("Card and Button", () => {
  it("renders a titled region and a 'now' button that fires once per click", async () => {
    const onClick = vi.fn();
    render(
      <Card title="regrow" aria-label="regrow card">
        <Button variant="now" onClick={onClick}>
          go
        </Button>
      </Card>,
    );
    expect(screen.getByRole("heading", { name: "regrow" })).toBeTruthy();
    const btn = screen.getByRole("button", { name: "go" });
    expect(btn.className).toContain("pl-btn--now");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables a busy button and marks it aria-busy", () => {
    render(<Button busy>pay</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveProperty("disabled", true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });
});

describe("SimulatedBadge", () => {
  it("labels simulated RF by default and live RF otherwise", () => {
    const { rerender } = render(<SimulatedBadge />);
    expect(screen.getByText("SIMULATED")).toBeTruthy();
    expect(screen.getByText(/no real tokens move/)).toBeTruthy();
    rerender(<SimulatedBadge mode="live" />);
    expect(screen.getByText("LIVE RF")).toBeTruthy();
  });
});

describe("Modal", () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        <Modal
          open={open}
          title="confirm"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<Button>ok</Button>}
        >
          <p>body</p>
        </Modal>
      </>
    );
  }

  it("moves focus in, traps Tab, closes on Escape and restores focus", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "open" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "confirm" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const close = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ok" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(close);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("ignores Escape when not dismissible", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="paying" onClose={onClose} dismissible={false}>
        <p>wait</p>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Tabs", () => {
  function Harness() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return (
      <Tabs
        label="boards"
        value={v}
        onChange={setV}
        tabs={[
          { id: "a", label: "owners" },
          { id: "b", label: "visitors" },
          { id: "c", label: "friends" },
        ]}
      >
        <p>panel {v}</p>
      </Tabs>
    );
  }
  it("uses a roving tabindex with arrow keys, Home and End", async () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole("tab");
    expect(a?.getAttribute("aria-selected")).toBe("true");
    expect(b?.tabIndex).toBe(-1);
    a?.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("panel b")).toBeTruthy();
    expect(document.activeElement).toBe(b);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(c);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(a);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(a?.id);
  });
});

describe("PixelNumber", () => {
  it("counts to a new value in 4 steps and exposes only the final value", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<PixelNumber value={0} />);
    rerender(<PixelNumber value={8} />);
    const shown = () => container.querySelector("[aria-hidden='true']")?.textContent;
    expect(screen.getByText("8")).toBeTruthy(); // sr-only final value
    expect(shown()).toBe("0");
    act(() => vi.advanceTimersByTime(60));
    expect(shown()).toBe("2");
    act(() => vi.advanceTimersByTime(180));
    expect(shown()).toBe("8");
  });

  it("jumps instantly under reduced motion", () => {
    document.documentElement.dataset["reducedMotion"] = "true";
    const { rerender, container } = render(<PixelNumber value={0} />);
    rerender(<PixelNumber value={8} />);
    expect(container.querySelector("[aria-hidden='true']")?.textContent).toBe("8");
  });
});

describe("ProgressBlocks", () => {
  it("is a meter that fills whole blocks", () => {
    const { container } = render(
      <ProgressBlocks value={76} max={82} blocks={10} label="pixels" valueText="76 of 82 px" />,
    );
    const m = screen.getByRole("meter", { name: "pixels" });
    expect(m.getAttribute("aria-valuenow")).toBe("76");
    expect(m.getAttribute("aria-valuetext")).toBe("76 of 82 px");
    expect(container.querySelectorAll(".pl-block--on")).toHaveLength(9);
  });
});

describe("SplitBar", () => {
  it("lists every part with percentages and exact amounts", () => {
    render(
      <SplitBar
        label="where it goes"
        parts={[
          { label: "burned", kind: "burn", bps: 5000, micro: 750_000 },
          { label: "stream", kind: "stream", bps: 5000, micro: 750_000 },
        ]}
      />,
    );
    expect(screen.getAllByText("50 % · 0.75 RF")).toHaveLength(2);
    expect(screen.queryByText(/does not total/)).toBeNull();
  });
  it("flags a split that does not total 100 %", () => {
    render(<SplitBar label="bad" parts={[{ label: "burned", kind: "burn", bps: 4000 }]} />);
    expect(screen.getByText(/does not total/)).toBeTruthy();
  });
});

describe("states", () => {
  it("RemoteView shows loading, error with retry, then data", async () => {
    const retry = vi.fn();
    const { rerender } = render(<RemoteView value={remote.loading<string>()}>{(d) => <p>{d}</p>}</RemoteView>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(
      <RemoteView value={remote.error<string>("offline")} onRetry={retry}>
        {(d) => <p>{d}</p>}
      </RemoteView>,
    );
    expect(screen.getByRole("alert").textContent).toContain("offline");
    await userEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(retry).toHaveBeenCalled();
    rerender(<RemoteView value={remote.ready("hello")}>{(d) => <p>{d}</p>}</RemoteView>);
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("EmptyState, ErrorState and Skeleton render accessibly", () => {
    const { container } = render(
      <>
        <EmptyState title="nobody here" />
        <ErrorState message="boom" />
        <Skeleton />
      </>,
    );
    expect(screen.getByText("nobody here")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "retry" })).toBeNull();
    expect(container.querySelector(".pl-skeleton")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("toasts", () => {
  function Harness() {
    const t = useToasts(1000);
    return (
      <>
        <button onClick={() => t.push("saved", "good")}>push</button>
        <ToastRegion toasts={t.toasts} onDismiss={t.dismiss} />
      </>
    );
  }
  it("shows, dismisses and expires toasts", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    expect(screen.getByText("saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("saved")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "push" }));
    act(() => vi.advanceTimersByTime(1001));
    expect(screen.queryByText("saved")).toBeNull();
  });
});
