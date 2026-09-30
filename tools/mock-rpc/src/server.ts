import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { handleRequest, type JsonRpcRequest, type JsonRpcResponse } from "./rpc.js";
import { MockWorld, type WorldSpec } from "./world.js";

/** Options for {@link startMockRpc}. */
export interface MockRpcOptions {
  /** Port to bind; 0 (default) picks a free port. */
  readonly port?: number;
  /** Interface to bind; defaults to 127.0.0.1 so the mock is never exposed. */
  readonly host?: string;
  /** An existing world (shared, mutable) or a spec to build one from. */
  readonly world?: MockWorld | WorldSpec;
}

/** A running mock RPC. `close()` resolves once all sockets are gone. */
export interface MockRpcServer {
  readonly url: string;
  readonly port: number;
  readonly world: MockWorld;
  close(): Promise<void>;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
} as const;

/** 1 MiB request cap: fixture traffic is tiny, this only guards against runaway clients. */
const MAX_BODY_BYTES = 1 << 20;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS_HEADERS, "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const parseError = (message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: null,
  error: { code: -32700, message },
});

/** Handles one HTTP exchange: CORS preflight, GET health, POST single or batch JSON-RPC. */
async function onRequest(world: MockWorld, req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === "GET") {
    send(res, 200, { ok: true, chainId: world.chainId, head: world.head.toString(), friends: world.friends.size });
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, parseError("method not allowed"));
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    send(res, 400, parseError(error instanceof Error ? error.message : "parse error"));
    return;
  }
  const requests = (Array.isArray(payload) ? payload : [payload]) as JsonRpcRequest[];
  const fault = world.fault;
  if (fault?.kind === "http-error" && requests.some((r) => !fault.methods || fault.methods.includes(r.method))) {
    for (const r of requests) world.requests.push(String(r.method));
    send(res, fault.status, { error: "mock RPC HTTP fault" });
    return;
  }
  // Sequential on purpose: world mutations (sendRawTransaction) stay ordered within a batch.
  const responses: JsonRpcResponse[] = [];
  for (const request of requests) responses.push(await handleRequest(world, request));
  send(res, 200, Array.isArray(payload) ? responses : responses[0]);
}

/** Starts the mock Robinhood Chain RPC on 127.0.0.1 (by default) and resolves once listening. */
export async function startMockRpc(options: MockRpcOptions = {}): Promise<MockRpcServer> {
  const world = options.world instanceof MockWorld ? options.world : new MockWorld(options.world);
  const server = createServer((req, res) => {
    onRequest(world, req, res).catch((error: unknown) => {
      if (!res.headersSent) send(res, 500, parseError(error instanceof Error ? error.message : String(error)));
      else res.destroy();
    });
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${urlHost}:${port}`,
    port,
    world,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
