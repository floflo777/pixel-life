import type { ApiErrorCode, MarketErrorReason } from "@pl/shared";
import { HttpError, type ErrorBody } from "../http/errors.js";

/** Body of a market error: the standard error body plus the market's own machine-readable reason. */
export interface MarketErrorBody extends ErrorBody {
  marketError: MarketErrorReason;
}

const STATUS: Readonly<Record<MarketErrorReason, { status: number; code: ApiErrorCode }>> = {
  sim_only: { status: 503, code: "internal" },
  bad_price: { status: 400, code: "bad_request" },
  no_gold: { status: 409, code: "bad_request" },
  not_holder: { status: 409, code: "bad_request" },
  not_listed: { status: 404, code: "not_found" },
  not_seller: { status: 403, code: "forbidden" },
  // The ask the buyer saw is stale (cancel + relist in front of it): the client refreshes and asks again.
  price_changed: { status: 409, code: "quote_expired" },
  self_trade: { status: 403, code: "forbidden" },
  no_friend: { status: 409, code: "bad_request" },
  insufficient_funds: { status: 402, code: "insufficient_funds" },
  conflict: { status: 409, code: "scar_conflict" },
};

/** A refused market operation: maps to a status + shared `ApiErrorCode`, and carries `marketError` for clients. */
export class MarketError extends HttpError {
  constructor(
    readonly marketError: MarketErrorReason,
    message: string,
  ) {
    const { status, code } = STATUS[marketError];
    super(status, code, message);
    this.name = "MarketError";
  }

  override body(requestId: string): MarketErrorBody {
    return { ...super.body(requestId), marketError: this.marketError };
  }
}
