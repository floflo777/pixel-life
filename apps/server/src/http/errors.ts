import type { ApiEndpoints, ApiError, ApiErrorCode, ValidatedRoute } from "@pl/shared";
import { parseBody } from "@pl/shared";
import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Finer, server-local detail for an `ApiErrorCode` (sent as `reason`). Clients branch on `error` (the shared
 * contract); `reason` exists for logs, support and better copy. E.g. SIWE failures are all `unauthorized`.
 */
export type ErrorReason =
  | "invalid_message"
  | "invalid_nonce"
  | "wrong_domain"
  | "wrong_chain"
  | "expired"
  | "bad_signature"
  | "no_session"
  | "no_binding"
  | "not_hardwired"
  | "rpc_error"
  | "bad_origin"
  | "origin_key"
  | "shutting_down"
  | "payload_too_large"
  | "unsupported_media_type";

/** Error body of every non-2xx response: the shared `ApiError` plus `reason` and the request id. */
export interface ErrorBody extends ApiError {
  reason?: ErrorReason;
  requestId: string;
}

/** Options for {@link HttpError}. */
export interface HttpErrorOptions {
  readonly reason?: ErrorReason;
  readonly retryAfterMs?: number;
}

/** An error that maps 1:1 to an HTTP response; anything else becomes a logged 500. */
export class HttpError extends Error {
  readonly reason: ErrorReason | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    options: HttpErrorOptions = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.reason = options.reason;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** Response headers implied by the error (Retry-After for 429/503 with a delay). */
  headers(): Record<string, string> {
    return this.retryAfterMs === undefined
      ? {}
      : { "retry-after": String(Math.max(1, Math.ceil(this.retryAfterMs / 1000))) };
  }

  /** JSON body for this error. */
  body(requestId: string): ErrorBody {
    return {
      error: this.code,
      message: this.message,
      ...(this.reason === undefined ? {} : { reason: this.reason }),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
      requestId,
    };
  }
}

/** Validates an untrusted body/query with the shared zod schema for `route`, or throws 400 `bad_request`. */
export function validated<R extends ValidatedRoute>(route: R, raw: unknown): ApiEndpoints[R]["req"] {
  const result = parseBody(route, raw);
  if (!result.ok) throw new HttpError(400, "bad_request", result.error);
  return result.value;
}

const FASTIFY_ERRORS: Record<number, { code: ApiErrorCode; reason?: ErrorReason }> = {
  404: { code: "not_found" },
  413: { code: "bad_request", reason: "payload_too_large" },
  415: { code: "bad_request", reason: "unsupported_media_type" },
  429: { code: "rate_limited" },
};

/** Installs the not-found and error handlers: stable JSON errors, 5xx logged with stack, no internals leaked. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorBody = { error: "not_found", message: "Route not found.", requestId: request.id };
    return reply.status(404).send(body);
  });

  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      if (error.status >= 500) request.log.error({ err: error, reason: error.reason }, error.message);
      return reply.status(error.status).headers(error.headers()).send(error.body(request.id));
    }
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (status < 500) {
      const mapped = FASTIFY_ERRORS[status] ?? { code: "bad_request" as const };
      const body: ErrorBody = {
        error: mapped.code,
        message: error.message,
        ...(mapped.reason ? { reason: mapped.reason } : {}),
        requestId: request.id,
      };
      return reply.status(status).send(body);
    }
    request.log.error({ err: error }, "unhandled error");
    const body: ErrorBody = { error: "internal", message: "Internal server error.", requestId: request.id };
    return reply.status(500).send(body);
  });
}
