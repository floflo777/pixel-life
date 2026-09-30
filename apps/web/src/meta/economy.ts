/**
 * Host-confirmed economy (architecture §1b.2): quote → confirm (price, split, SIMULATED) → request → receipt. Used by the
 * Regrow and Mend screens and by native venues through `VenueHost.economy`. Nothing is deducted in the UI until the
 * server's receipt arrives (GDD §6.10).
 */
import {
  type EconomyAction,
  type EconomyMode,
  type EconomyQuote,
  type EconomyReceipt,
  popcount,
  quote as pureQuote,
} from "@pl/shared";
import { ApiRequestError } from "../api/client.js";
import type { Services } from "../app/services.js";
import { formatRf } from "../lib/format.js";

/** Why the shell refused an economy request before calling the server. */
export class EconomyRefused extends Error {
  readonly code: "guest_forbidden" | "cancelled";
  constructor(code: "guest_forbidden" | "cancelled") {
    super(code === "guest_forbidden" ? "Use your own Friend to spend RF." : "Cancelled. Nothing was spent.");
    this.name = "EconomyRefused";
    this.code = code;
  }
}

/** The server's quote, or the identical pure quote when the server is unreachable (it recomputes anyway). */
export async function getQuote(s: Services, action: EconomyAction, mode: EconomyMode): Promise<EconomyQuote> {
  try {
    return await s.api.quote(action);
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 0) return pureQuote(action, mode);
    throw e;
  }
}

/** Confirm-dialog lines for a quote: pixels, price, and where every RF goes. */
export function quoteLines(q: EconomyQuote): string[] {
  const px = popcount(q.action.pixels);
  const tag = q.mode === "sim" ? " (SIMULATED)" : "";
  if (q.action.kind === "regrow") {
    return [
      `Regrow ${px} px of #${q.action.tokenId}: ${formatRf(q.totalMicro)}${tag}.`,
      `${formatRf(q.burnMicro)} burned · ${formatRf(q.streamMicro)} to the active-Friends stream.`,
    ];
  }
  return [
    `Mend ${px} px of #${q.action.target}, paid by #${q.action.payer}: ${formatRf(q.totalMicro)}${tag}.`,
    `${formatRf(q.burnMicro)} burned · ${formatRf(q.toTargetMicro)} to #${q.action.target}'s wallet.`,
    "Your stitches show on its pixels for 7 days.",
  ];
}

/**
 * Quotes, confirms and executes `action` for the bound owner. Rejects with `EconomyRefused` for guests or on cancel,
 * or with `ApiRequestError` from the server (reason shown inline with a retry by the caller).
 */
export async function requestEconomy(s: Services, action: EconomyAction): Promise<EconomyReceipt> {
  const id = s.identity.store.get().identity;
  if (id.mode !== "owner") throw new EconomyRefused("guest_forbidden");
  const q = await getQuote(s, action, id.economy);
  const ok = await s.confirm({
    title: action.kind === "regrow" ? "Regrow pixels" : "Mend a Friend",
    lines: quoteLines(q),
    note:
      q.mode === "sim"
        ? "SIMULATED RF: no transaction is sent and no real tokens move."
        : "Live RF: your wallet will ask you to confirm a transaction.",
    confirmLabel: `${action.kind} · ${formatRf(q.totalMicro)}`,
  });
  if (!ok) throw new EconomyRefused("cancelled");
  const receipt = action.kind === "regrow" ? await s.api.regrow({ action }) : await s.api.mend({ action });
  if (action.kind === "regrow") {
    s.identity.updateOwner({
      scars: receipt.scars,
      ...(receipt.balanceMicro !== undefined ? { balanceMicro: receipt.balanceMicro } : {}),
    });
  } else if (receipt.balanceMicro !== undefined) {
    s.identity.updateOwner({ balanceMicro: receipt.balanceMicro });
  }
  s.audio.play(action.kind === "regrow" ? "regrow.sparkle" : "mend.chime");
  return receipt;
}
