/**
 * A loopback stand-in for the edge Worker (workers/edge) between the web app's /api + /ws proxy and apps/server:
 * it strips any client-sent `x-pl-*` headers, then adds the origin key and a client IP, exactly the two headers the
 * real edge adds. This keeps the server in its production posture (origin-key guard on, edge IP trusted) while every
 * browser in the suite shares 127.0.0.1.
 *
 * Client IP: the `x-e2e-client-ip` request header when a test sets one (to exercise per-IP limits on purpose), else a
 * fresh documentation-range address per connection, so parallel tests don't trip the per-IP rate limits (guest 5/min,
 * SIWE 10/min, WebSocket 6/min) that a real crowd of visitors would each have to themselves.
 */
import { randomInt } from "node:crypto";
import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";

/** Header names the edge owns (never forwarded from the client). */
const EDGE_HEADERS = ["x-pl-origin-key", "x-pl-client-ip"];
const TEST_IP_HEADER = "x-e2e-client-ip";

/** Options of {@link startEdge}. */
export interface EdgeOptions {
  readonly port: number;
  /** apps/server port on 127.0.0.1. */
  readonly upstreamPort: number;
  readonly originKey: string;
}

/** A random address in 198.18.0.0/15 (benchmarking range: never a real client). */
const randomIp = (): string => `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`;

function edgeHeaders(headers: IncomingHttpHeaders, ip: string, originKey: string): IncomingHttpHeaders {
  const drop = new Set([...EDGE_HEADERS, TEST_IP_HEADER]);
  const out: IncomingHttpHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name)));
  out["x-pl-origin-key"] = originKey;
  out["x-pl-client-ip"] = ip;
  return out;
}

const clientIp = (headers: IncomingHttpHeaders): string => {
  const given = headers[TEST_IP_HEADER];
  return typeof given === "string" && given ? given : randomIp();
};

/** Starts the edge stand-in; resolves once it listens on 127.0.0.1:`port`. */
export async function startEdge(options: EdgeOptions): Promise<{ close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: options.upstreamPort,
        method: req.method,
        path: req.url,
        headers: edgeHeaders(req.headers, clientIp(req.headers), options.originKey),
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_gateway", message: "e2e edge: server unreachable" }));
    });
    req.pipe(upstream);
  });

  // WebSocket upgrades: replay the handshake with the edge headers, then splice the two sockets.
  server.on("upgrade", (req, socket, head) => {
    const up = connect(options.upstreamPort, "127.0.0.1", () => {
      const headers = edgeHeaders(req.headers, clientIp(req.headers), options.originKey);
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const destroy = () => {
      up.destroy();
      socket.destroy();
    };
    up.on("error", destroy);
    socket.on("error", destroy);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => resolve());
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
