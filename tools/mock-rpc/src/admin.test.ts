import { afterEach, describe, expect, it } from "vitest";
import { AdminError, applyAdminOp } from "./admin.js";
import { startMockRpc, type MockRpcServer } from "./server.js";
import { MockWorld } from "./world.js";

const OWNER = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";

describe("applyAdminOp", () => {
  it("mints, transfers and reports ownership in new blocks", () => {
    const world = new MockWorld();
    const start = world.head;
    applyAdminOp(world, { op: "mint", tokenId: "900001", owner: OWNER });
    expect(world.head).toBe(start + 1n);
    expect(applyAdminOp(world, { op: "owner", tokenId: "900001" }).owner?.toLowerCase()).toBe(OWNER);
    applyAdminOp(world, { op: "transfer", tokenId: "900001", to: OTHER });
    expect(world.ownerOf(900001n)?.toLowerCase()).toBe(OTHER);
    expect(world.friends.get(900001n)?.frames).toHaveLength(64);
  });

  it("funds balances cumulatively and mines on demand", () => {
    const world = new MockWorld();
    applyAdminOp(world, { op: "fund", address: OWNER, wei: "5" });
    expect(applyAdminOp(world, { op: "fund", address: OWNER, wei: "7" }).balance).toBe("12");
    const head = world.head;
    expect(applyAdminOp(world, { op: "mine", blocks: "3" }).head).toBe((head + 3n).toString());
  });

  it("sets and clears faults", () => {
    const world = new MockWorld();
    applyAdminOp(world, { op: "fault", fault: { kind: "rpc-error" } });
    expect(world.fault).toEqual({ kind: "rpc-error" });
    applyAdminOp(world, { op: "fault", fault: null });
    expect(world.fault).toBeNull();
  });

  it.each([
    [null, /object/],
    [{ op: "nope" }, /unknown op/],
    [{ op: "mint", tokenId: "-1", owner: OWNER }, /decimal/],
    [{ op: "mint", tokenId: "1", owner: "0xzz" }, /address/],
    [{ op: "mint", tokenId: "1", owner: OWNER, generation: 1.5 }, /integer/],
    [{ op: "transfer", tokenId: "77", to: OWNER }, /not minted/],
  ])("rejects %j", (input, message) => {
    expect(() => applyAdminOp(new MockWorld(), input)).toThrow(AdminError);
    expect(() => applyAdminOp(new MockWorld(), input)).toThrow(message);
  });

  it("refuses to mint an existing Friend", () => {
    const world = new MockWorld();
    applyAdminOp(world, { op: "mint", tokenId: "5", owner: OWNER });
    expect(() => applyAdminOp(world, { op: "mint", tokenId: "5", owner: OWNER })).toThrow(/already exists/);
  });
});

describe("admin over HTTP", () => {
  let server: MockRpcServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });
  const post = (url: string, body: unknown) =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("is off by default (the path is plain JSON-RPC)", async () => {
    server = await startMockRpc();
    const res = await post(`${server.url}/__admin`, { op: "state" });
    expect(await res.json()).toMatchObject({ error: { code: expect.any(Number) as number } });
  });

  it("answers ops and 400s on bad input when enabled", async () => {
    server = await startMockRpc({ admin: true });
    const ok = await post(`${server.url}/__admin`, { op: "mint", tokenId: "42", owner: OWNER });
    expect(ok.status).toBe(200);
    expect(server.world.ownerOf(42n)?.toLowerCase()).toBe(OWNER);
    const bad = await post(`${server.url}/__admin`, { op: "nope" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown op nope" });
  });
});
