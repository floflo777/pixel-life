import type { TokenIdStr } from "@pl/shared";
import type { MemberProfile } from "./room.js";

/** A plausible joining Friend for tests. */
export function profile(tokenId: TokenIdStr = "344030", kind: "owner" | "guest" = "owner"): MemberProfile {
  return { kind, tokenId, loaned: kind === "guest", scarsHash: "h0", goldHeld: 0 };
}
