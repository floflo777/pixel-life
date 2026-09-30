/**
 * The Regrow / Mend transport for the spend flows: quote, then request, then fold the receipt into the owner's identity
 * (scars and simulated balance) and play the cue. Nothing is deducted locally before the server's receipt (GDD §6.10).
 */
import type { EconomyAction, EconomyReceipt, EconomyRequestReq, QuoteRes } from "@pl/shared";
import type { Services } from "../../app/services.js";

/** The two callbacks `RegrowFlow` / `MendFlow` need. */
export interface SpendTransport {
  getQuote(action: EconomyAction): Promise<QuoteRes>;
  submit(req: EconomyRequestReq): Promise<EconomyReceipt>;
}

/** Builds the transport over the services (`kind` picks the endpoint). */
export function spendTransport(s: Services, kind: "regrow" | "mend"): SpendTransport {
  return {
    getQuote: (action) => s.api.quote(action),
    async submit(req) {
      const receipt = kind === "regrow" ? await s.api.regrow(req) : await s.api.mend(req);
      if (kind === "regrow") {
        s.identity.updateOwner({
          scars: receipt.scars,
          ...(receipt.balanceMicro !== undefined ? { balanceMicro: receipt.balanceMicro } : {}),
        });
      } else if (receipt.balanceMicro !== undefined) {
        s.identity.updateOwner({ balanceMicro: receipt.balanceMicro });
      }
      s.audio.play(kind === "regrow" ? "regrow.sparkle" : "mend.chime");
      return receipt;
    },
  };
}

/** Why spending is blocked right now, or null. Live RF needs the wallet transaction flow, which this build lacks. */
export function spendBlockedReason(mode: "sim" | "live"): string | null {
  return mode === "live"
    ? "Live RF spending needs a wallet transaction, which this build does not send yet. Nothing was charged."
    : null;
}
