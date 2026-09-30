/** The booth component against the SDK's own preview ledger (the same client shape the bridge hands the child). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createGamePreview, parseChanceGame, RF, type GameClient } from "@rarefriends/friendsdk/game";
import gameJson from "../game.json";
import { SeedPackBooth } from "../src/booth";

const definition = parseChanceGame(gameJson);
const GOLD_ROLL = 9_999; // last bucket: Gold Pixel
const SPROUT_ROLL = 0;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function mount(client: GameClient, paused = false) {
  flushSync(() => root.render(<SeedPackBooth friendId={7730n} client={client} paused={paused} />));
}
function button(label: RegExp) {
  const found = [...container.querySelectorAll("button")].find((node) => label.test(node.textContent ?? ""));
  if (!found) throw new Error(`No button ${label}`);
  return found;
}
const click = (label: RegExp) => flushSync(() => button(label).click());
const text = () => container.textContent ?? "";

function ledger(roll: number) {
  return createGamePreview(definition, { friendId: 7730n, stake: 450n * RF, rfBalance: 20n * RF, draw: () => roll })
    .client;
}

describe("Seed Pack Booth", () => {
  it("labels every amount as simulated and publishes the odds", async () => {
    mount(ledger(SPROUT_ROLL));
    await vi.waitFor(() => expect(container.querySelector(".sp-title")).not.toBeNull());
    expect(text()).toContain("Simulated economy");
    expect(container.querySelector(".sp-balance")?.textContent).toMatch(/20\s*RF\s*simulated/);
    expect(button(/^Buy 1/).textContent).toContain("5 RF sim");
    const odds = container.querySelector(".sp-odds")?.textContent ?? "";
    for (const expected of [
      "56.00 %",
      "30.00 %",
      "12.00 %",
      "2.00 %",
      "45 RF",
      "4.48 RF per pack",
      "RTP 89.60 %",
      "reserved",
    ]) {
      expect(odds).toContain(expected);
    }
  });

  it("buys, opens and reveals a Gold Pixel, then keeps it in the inventory", async () => {
    const client = ledger(GOLD_ROLL);
    mount(client);
    await vi.waitFor(() => expect(container.querySelector(".sp-title")).not.toBeNull());
    click(/^Motion on/); // reduced motion: the reveal completes immediately
    click(/^Buy 1/);
    await vi.waitFor(() => expect(text()).toContain("×1 pack ready"));
    click(/^Open a pack/);
    await vi.waitFor(() => expect(container.querySelector(".sp-reveal[data-rarity='legendary']")).not.toBeNull());
    await vi.waitFor(() => expect(container.querySelector(".sp-result")?.hasAttribute("hidden")).toBe(false));
    expect(container.querySelector("#sp-reveal-title")?.textContent).toBe("Gold Pixel");
    expect(text()).toContain("1 in 50");
    click(/^Keep/);
    await vi.waitFor(() => expect(container.querySelector(".sp-reveal")).toBeNull());
    expect(button(/^Inventory/).textContent).toBe("Inventory 1");
    const snapshot = await client.read();
    expect(snapshot.inventory).toEqual([0n, 0n, 0n, 1n]);
    expect(snapshot.rfBalance).toBe(15n * RF);
  });

  it("redeems from the reveal at the fixed value", async () => {
    const client = ledger(SPROUT_ROLL);
    mount(client);
    await vi.waitFor(() => expect(container.querySelector(".sp-title")).not.toBeNull());
    click(/^Motion on/);
    click(/^Buy 1/);
    await vi.waitFor(() => expect(text()).toContain("×1 pack ready"));
    click(/^Open a pack/);
    await vi.waitFor(() => expect(container.querySelector("#sp-reveal-title")?.textContent).toBe("Sprout"));
    click(/^Redeem · 2 RF sim/);
    await vi.waitFor(() => expect(text()).toContain("Redeemed Sprout: 2 RF sim"));
    expect((await client.read()).rfBalance).toBe(17n * RF);
  });

  it("resumes a pending opening without using another pack", async () => {
    const client = ledger(SPROUT_ROLL);
    await client.buy(2n);
    await client.play(1n);
    mount(client);
    await vi.waitFor(() => expect(button(/^Finish opening/)).toBeTruthy());
    click(/^Motion on/);
    click(/^Finish opening/);
    await vi.waitFor(() => expect(container.querySelector("#sp-reveal-title")?.textContent).toBe("Sprout"));
    expect((await client.read()).consumables).toBe(1n);
  });

  it("disables every action while the runtime is paused", async () => {
    mount(ledger(SPROUT_ROLL), true);
    await vi.waitFor(() => expect(text()).toContain("Paused."));
    expect(button(/^Buy 1/).disabled).toBe(true);
    expect(button(/^Open a pack/).disabled).toBe(true);
  });

  it("shows a retryable error when the first read fails", async () => {
    const good = ledger(SPROUT_ROLL);
    let fail = true;
    const flaky: GameClient = {
      ...good,
      read: () => (fail ? Promise.reject(new Error("bridge closed")) : good.read()),
    };
    mount(flaky);
    await vi.waitFor(() => expect(text()).toContain("bridge closed"));
    fail = false;
    click(/^Retry/);
    await vi.waitFor(() => expect(container.querySelector(".sp-title")).not.toBeNull());
  });
});
