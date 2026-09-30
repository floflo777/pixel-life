/**
 * Behaviour of patches/@rarefriends+friendsdk+0.1.4.patch (`ConnectedGameHost.previewClient`).
 * Runs the real patched SDK runtime (dist) in happy-dom with a mock read client; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  ConnectedGameHost,
  type ConnectedGameHostProps,
  type PreviewClientFactory,
} from "@rarefriends/friendsdk/runtime";
import { createGamePreview, parseChanceGame, RF, type GameClient } from "@rarefriends/friendsdk/game";
import type * as GameModule from "@rarefriends/friendsdk/game";
import gameJson from "../game.json";

vi.mock("@rarefriends/friendsdk/game", async (importOriginal) => {
  const actual = await importOriginal<typeof GameModule>();
  return { ...actual, createGamePreview: vi.fn(actual.createGamePreview) };
});

const OWNER = "0x00000000000000000000000000000000000000aa";
const STRANGER = "0x00000000000000000000000000000000000000cc";
const FRIEND_WALLET = "0x00000000000000000000000000000000000000bb";
const FRIEND = { id: 7730n, label: "Friend #7730", kind: "owned" as const };
const definition = parseChanceGame(gameJson);
const previewSpy = vi.mocked(createGamePreview);
// The "server" ledger stands in for ServerLedgerClient; built with the unspied preview so the spy only sees the SDK.
const actualGame = await vi.importActual<typeof GameModule>("@rarefriends/friendsdk/game");

type ReadArgs = { functionName: string };
function readClient({ owner = OWNER, generation = 1, fail = false } = {}) {
  const readContract = vi.fn(async ({ functionName }: ReadArgs) => {
    if (fail) throw new Error("RPC down");
    if (functionName === "ownerOf") return owner;
    if (functionName === "generation") return generation;
    if (functionName === "tokenBoundAccount") return FRIEND_WALLET;
    throw new Error(`unexpected read ${functionName}`);
  });
  const client = { getChainId: async () => 4663, getBlockNumber: async () => 123n, readContract };
  return { client: client as unknown as NonNullable<ConnectedGameHostProps["publicClient"]>, readContract };
}

function serverLedger(): GameClient {
  return actualGame.createGamePreview(definition, { friendId: FRIEND.id, stake: 1000n * RF, rfBalance: 7n * RF })
    .client;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  previewSpy.mockClear();
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function render(props: Partial<ConnectedGameHostProps> & Pick<ConnectedGameHostProps, "publicClient">) {
  flushSync(() =>
    root.render(
      <ConnectedGameHost
        definition={definition}
        frameUrl="about:blank"
        selectedFriend={FRIEND}
        account={OWNER}
        chainId={4663}
        {...props}
      />,
    ),
  );
}
const iframe = () => container.querySelector("iframe");
const text = () => container.textContent ?? "";

describe("ConnectedGameHost previewClient patch", () => {
  it("still blocks an account that does not own the Friend, without calling the factory", async () => {
    const { client } = readClient({ owner: STRANGER });
    const factory = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: client, previewClient: factory });
    await vi.waitFor(() => expect(text()).toContain("must own this hardwired Generations Friend"));
    expect(factory).not.toHaveBeenCalled();
    expect(previewSpy).not.toHaveBeenCalled();
    expect(iframe()).toBeNull();
  });

  it("still blocks a generation-0 (not hardwired) Friend", async () => {
    const { client } = readClient({ generation: 0 });
    const factory = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: client, previewClient: factory });
    await vi.waitFor(() => expect(text()).toContain("must own this hardwired Generations Friend"));
    expect(factory).not.toHaveBeenCalled();
    expect(iframe()).toBeNull();
  });

  it("still blocks the wrong chain and failed reads", async () => {
    const factory = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: readClient().client, previewClient: factory, chainId: 1 });
    await vi.waitFor(() => expect(text()).toContain("Switch your wallet to Robinhood mainnet"));
    render({ publicClient: readClient({ fail: true }).client, previewClient: factory });
    await vi.waitFor(() => expect(text()).toContain("Could not verify this Friend. RPC down"));
    expect(factory).not.toHaveBeenCalled();
    expect(iframe()).toBeNull();
  });

  it("uses the factory after the gate passes, with the verified context, instead of the local preview", async () => {
    const { client, readContract } = readClient();
    const factory = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: client, previewClient: factory });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({ friendId: 7730n, walletAddress: FRIEND_WALLET, chainId: 4663, definition });
    expect(previewSpy).not.toHaveBeenCalled();
    // Ownership, generation and canonical wallet were all read before the factory ran.
    const factoryOrder = factory.mock.invocationCallOrder[0] ?? 0;
    expect(readContract.mock.calls.map(([args]) => args.functionName).sort()).toEqual([
      "generation",
      "ownerOf",
      "tokenBoundAccount",
    ]);
    expect(Math.max(...readContract.mock.invocationCallOrder)).toBeLessThan(factoryOrder);
  });

  it("keeps one factory ledger per verified identity and starts fresh when the factory changes", async () => {
    const { client } = readClient();
    const factory = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: client, previewClient: factory, revision: 0 });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    // A revision bump re-runs the gate but reuses the ledger of the same verified identity.
    render({ publicClient: client, previewClient: factory, revision: 1 });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    expect(factory).toHaveBeenCalledTimes(1);
    const replacement = vi.fn<PreviewClientFactory>(serverLedger);
    render({ publicClient: client, previewClient: replacement, revision: 1 });
    await vi.waitFor(() => expect(replacement).toHaveBeenCalledTimes(1));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("falls back to the stock session-local preview ledger when no factory is given", async () => {
    render({ publicClient: readClient().client });
    await vi.waitFor(() => expect(iframe()).not.toBeNull());
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy).toHaveBeenCalledWith(definition, { friendId: 7730n, stake: 450n * RF, rfBalance: 20n * RF });
  });
});
