import { type EconomyAction, type EconomyReceipt, EMPTY_MASK, popcount, quote, type QuoteRes } from "@pl/shared";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureView } from "./__fixtures__/friend.js";
import { MendFlow, RegrowFlow } from "./SpendFlow.js";

afterEach(cleanup);

const NOW = 1_000_000; // the fixture's scar anchor: nothing has healed yet

function api() {
  const getQuote = vi.fn(async (a: EconomyAction): Promise<QuoteRes> => ({
    ...quote(a, "sim"),
    quoteId: "q1",
    lockedUntil: NOW + 15 * 60_000,
  }));
  const submit = vi.fn(async (req: { action: EconomyAction; quoteId?: string }): Promise<EconomyReceipt> => ({
    id: "rcpt-123456789",
    quote: quote(req.action, "sim"),
    scars: { lost: EMPTY_MASK, updatedAt: NOW, version: 2 },
    balanceMicro: 18_500_000,
  }));
  return { getQuote, submit };
}

describe("RegrowFlow", () => {
  it("select → quote → confirm with split → receipt", async () => {
    const { getQuote, submit } = api();
    const onDone = vi.fn();
    render(
      <RegrowFlow
        view={fixtureView({ lostCount: 3 })}
        mode="sim"
        balanceMicro={20_000_000}
        getQuote={getQuote}
        submit={submit}
        onDone={onDone}
        now={NOW}
      />,
    );

    expect(screen.getByText("SIMULATED")).toBeTruthy();
    const quoteBtn = screen.getByRole("button", { name: "regrow 0 px" });
    expect(quoteBtn).toHaveProperty("disabled", true);

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    await userEvent.click(boxes[0] as HTMLElement);
    await userEvent.click(boxes[1] as HTMLElement);
    expect(screen.getByText("2 × 0.50 RF = 1.00 RF")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "regrow 2 px" }));
    expect(getQuote).toHaveBeenCalledTimes(1);
    const action = getQuote.mock.calls[0]?.[0];
    expect(action?.kind).toBe("regrow");
    expect(popcount(action?.pixels ?? EMPTY_MASK)).toBe(2);

    // Confirm: price, split and the simulated note.
    await screen.findByRole("heading", { name: "confirm regrow" });
    expect(screen.getByText("2 px × 0.50 RF = 1.00 RF")).toBeTruthy();
    expect(screen.getAllByText("50 % · 0.50 RF")).toHaveLength(2);
    expect(screen.getByText("active-Friends stream")).toBeTruthy();
    expect(screen.getByText(/no transaction is sent/)).toBeTruthy();
    expect(screen.getByText("20.00 RF → 19.00 RF")).toBeTruthy();
    expect(screen.getByText("15:00")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /regrow · 1.00 RF/ }));
    expect(submit).toHaveBeenCalledWith({ action, quoteId: "q1" });

    await screen.findByRole("heading", { name: "regrow done" });
    expect(screen.getByRole("status").textContent).toMatch(/\+2 px/);
    expect(screen.getByText("18.50 RF")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows a server error inline and retries without losing the selection", async () => {
    const { getQuote, submit } = api();
    submit.mockRejectedValueOnce(new Error("Not enough simulated RF on this Friend."));
    render(
      <RegrowFlow
        view={fixtureView({ lostCount: 2 })}
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "all 2" }));
    await userEvent.click(screen.getByRole("button", { name: "regrow 2 px" }));
    await userEvent.click(await screen.findByRole("button", { name: /regrow · 1.00 RF/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Not enough simulated RF");
    await userEvent.click(screen.getByRole("button", { name: /retry · 1.00 RF/ }));
    await screen.findByRole("heading", { name: "regrow done" });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("keeps a quote failure on the select step with a retry", async () => {
    const { getQuote, submit } = api();
    getQuote.mockRejectedValueOnce(new Error("Can't reach the sky right now."));
    render(
      <RegrowFlow
        view={fixtureView({ lostCount: 2 })}
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "all 2" }));
    await userEvent.click(screen.getByRole("button", { name: "regrow 2 px" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Can't reach the sky");
    await userEvent.click(within(alert).getByRole("button", { name: "retry" }));
    await screen.findByRole("heading", { name: "confirm regrow" });
  });

  it("blocks confirming when the balance is short", async () => {
    const { getQuote, submit } = api();
    render(
      <RegrowFlow
        view={fixtureView({ lostCount: 3 })}
        mode="sim"
        balanceMicro={1_000_000}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "all 3" }));
    await userEvent.click(screen.getByRole("button", { name: "regrow 3 px" }));
    const pay = await screen.findByRole("button", { name: /regrow · 1.50 RF/ });
    expect(pay).toHaveProperty("disabled", true);
    expect(screen.getByText(/Not enough RF/)).toBeTruthy();
  });

  it("says whole when nothing is missing, and explains a blocked viewer", () => {
    const { getQuote, submit } = api();
    const { rerender } = render(
      <RegrowFlow view={fixtureView()} mode="sim" balanceMicro={null} getQuote={getQuote} submit={submit} now={NOW} />,
    );
    expect(screen.getByText("whole")).toBeTruthy();
    rerender(
      <RegrowFlow
        view={fixtureView({ lostCount: 2 })}
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
        blockedReason="Use your own Friend for this."
      />,
    );
    expect(screen.getByText("Use your own Friend for this.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("drops pixels that healed for free from the selection", () => {
    const { getQuote, submit } = api();
    const view = fixtureView({ lostCount: 2 });
    // 2 h per pixel: after 2 h one scar has healed on its own.
    render(
      <RegrowFlow
        view={view}
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        initialSelection={view.pub.scars.lost}
        now={NOW + 7_200_000}
      />,
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "regrow 1 px" })).toBeTruthy();
  });
});

describe("MendFlow", () => {
  it("quotes a mend paid by the viewer with the to-Friend split", async () => {
    const { getQuote, submit } = api();
    render(
      <MendFlow
        view={fixtureView({ lostCount: 5 })}
        payer="1969"
        mode="sim"
        balanceMicro={20_000_000}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    await userEvent.click(screen.getByRole("button", { name: "mend 3 px" }));
    expect(getQuote.mock.calls[0]?.[0]).toMatchObject({ kind: "mend", payer: "1969", target: "344030" });
    await screen.findByRole("heading", { name: "confirm mend" });
    expect(screen.getByText("to #344030's wallet")).toBeTruthy();
    expect(screen.getAllByText("50 % · 1.50 RF")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: /mend · 3.00 RF/ }));
    await screen.findByRole("heading", { name: "mend done" });
    expect(screen.getByText(/stitches show on its pixels for 7 days/)).toBeTruthy();
  });

  it("refuses to mend your own Friend", () => {
    const { getQuote, submit } = api();
    render(
      <MendFlow
        view={fixtureView({ lostCount: 2 })}
        payer="344030"
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    expect(screen.getByText(/Use Regrow for your own Friend/)).toBeTruthy();
  });

  it("caps the selection at the daily Mend limit", async () => {
    const { getQuote, submit } = api();
    render(
      <MendFlow
        view={fixtureView({ lostCount: 30 })}
        payer="1969"
        mode="sim"
        balanceMicro={null}
        getQuote={getQuote}
        submit={submit}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "all (24)" }));
    await waitFor(() => expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(24));
    const unchecked = screen.getAllByRole("checkbox", { checked: false })[0] as HTMLElement;
    expect(unchecked.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(unchecked);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(24);
  });
});
