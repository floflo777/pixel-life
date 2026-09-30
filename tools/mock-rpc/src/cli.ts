#!/usr/bin/env -S npx tsx
/**
 * pl-mock-rpc: run the fixture Robinhood Chain RPC for local dev.
 *
 *   npm start -w @pl/mock-rpc -- [--port 8545] [--host 127.0.0.1] [--owner 0xYourAddr[:id,id]]... [--admin]
 *
 * Without --owner, the default world is used (alice/bob fixture owners hold all design Friends).
 * Each --owner gives that address the listed design token ids (or 2 unclaimed ones if none listed).
 * --admin serves `POST /__admin` (mint/transfer/mine/fund/fault) for the e2e stack; never use it on a shared host.
 */
import { parseArgs } from "node:util";
import { isAddress } from "viem";
import { loadDesignFriends } from "./design-friends.js";
import { startMockRpc } from "./server.js";
import { defaultWorldSpec, FIXTURE_OWNERS } from "./world.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8545" },
    host: { type: "string", default: "127.0.0.1" },
    owner: { type: "string", multiple: true, default: [] },
    admin: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log("Usage: pl-mock-rpc [--port 8545] [--host 127.0.0.1] [--owner 0xAddr[:tokenId,tokenId]]... [--admin]");
  process.exit(0);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port ${values.port}`);

const design = loadDesignFriends().map((f) => f.tokenId.toString());
const owners: Record<string, string[]> = {};
let next = 0;
for (const entry of values.owner) {
  const [address = "", list] = entry.split(":");
  if (!isAddress(address)) throw new Error(`Invalid --owner address ${address}`);
  const ids = list ? list.split(",").filter(Boolean) : design.slice(next, (next += 2));
  for (const id of ids)
    if (!design.includes(id)) throw new Error(`Token ${id} is not in docs/design/data/friends.json`);
  owners[address] = ids;
}

const server = await startMockRpc({ port, host: values.host, world: defaultWorldSpec(owners), admin: values.admin });
const { world } = server;
console.log(
  `pl-mock-rpc listening on ${server.url} (chain ${world.chainId}, head ${world.head})${values.admin ? " [admin on]" : ""}`,
);
const byOwner = new Map<string, string[]>();
for (const id of world.friends.keys()) {
  const owner = world.ownerOf(id) ?? "none";
  const gen = world.friends.get(id)?.generation === 0 ? " (gen-0)" : "";
  byOwner.set(owner, [...(byOwner.get(owner) ?? []), `#${id}${gen}`]);
}
const names = new Map<string, string>(Object.entries(FIXTURE_OWNERS).map(([name, a]) => [a.toLowerCase(), name]));
for (const [owner, ids] of byOwner)
  console.log(
    `  ${owner}${names.has(owner.toLowerCase()) ? ` (${names.get(owner.toLowerCase())})` : ""}: ${ids.join(" ")}`,
  );

const shutdown = () => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
