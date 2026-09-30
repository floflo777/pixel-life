/**
 * Shared wiring for the routed pages: loading a Friend's live view, the owner gate and sharing. Route modules in this
 * folder default-export a screen taking `PageProps`; the views they render stay prop-driven and testable.
 */
import { type FriendView, isTokenIdStr, type TokenIdStr } from "@pl/shared";
import type { ReactNode } from "react";
import { useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { Card, EmptyState, LinkButton, type Remote } from "../../ui/index.js";

/** A Friend's view: the player's own live identity view when it is theirs, else appearance + public from the API. */
export function useFriendView(tokenId: string): { value: Remote<FriendView>; retry(): void; mine: boolean } {
  const { api } = useServices();
  const id = useIdentity();
  const mine = id.mode !== "none" && id.view.appearance.tokenId === tokenId;
  const valid = isTokenIdStr(tokenId);
  const remote = useRemote(async (): Promise<FriendView | null> => {
    if (mine) return null;
    if (!valid) throw new Error(`"${tokenId}" is not a Friend number.`);
    const [appearance, pub] = await Promise.all([api.appearance(tokenId), api.publicFriend(tokenId)]);
    return { appearance, pub, loaned: false };
  }, [tokenId, mine, valid]);
  if (id.mode !== "none" && id.view.appearance.tokenId === tokenId)
    return { value: { status: "ready", data: id.view }, retry: remote.retry, mine };
  const v = remote.value;
  return {
    // Never show the previous Friend while the next one loads.
    value:
      v.status === "ready"
        ? v.data && v.data.appearance.tokenId === tokenId
          ? { status: "ready", data: v.data }
          : { status: "loading" }
        : v,
    retry: remote.retry,
    mine,
  };
}

/** The owner's own token id, or null for guests and nobody. */
export function useOwnerToken(): TokenIdStr | null {
  const id = useIdentity();
  return id.mode === "owner" ? id.view.appearance.tokenId : null;
}

/** Shown instead of an owner-only page to guests: why, and the way in. */
export function OwnerGate({ title, children }: { title: string; children: ReactNode }) {
  const id = useIdentity();
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">{title}</h1>
      </header>
      <Card>
        <EmptyState
          glyph="✋"
          title="bring your own Friend"
          action={
            <div className="pl-row">
              <LinkButton to="/connect" variant="now">
                use my friend
              </LinkButton>
              {id.mode === "none" && <LinkButton to="/play">play on loan</LinkButton>}
            </div>
          }
        >
          {children}
        </EmptyState>
      </Card>
    </div>
  );
}

/** Shares a Friend page: the native share sheet when there is one, else the clipboard. Resolves to a status line. */
export async function shareFriend(tokenId: string, missing: boolean): Promise<string> {
  const url = `${location.origin}/f/${tokenId}`;
  const text = missing ? `#${tokenId} lost some pixels. Help me mend it in Loose Pixels.` : `Meet #${tokenId}.`;
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: "Loose Pixels", text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "link copied";
  } catch {
    return "sharing is not available here";
  }
}
