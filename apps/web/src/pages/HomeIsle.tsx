/**
 * A Friend's home isle on the shared three.js stage (`createHomeScene` from @pl/game), with the owner's edit mode:
 * a shelf of owned decor to place, rotate / remove, terrace switching, hat and open-isle settings, and Save through
 * `PUT /api/home`. The scene checks placements with the same shared rules the server applies; the server has the last
 * word, and a refused save keeps the editor open with the reason. Without WebGL2 the isle is listed in 2D.
 */
import {
  and,
  catalogItem,
  CATALOG,
  decorItem,
  effectiveLost,
  type FriendView,
  frontMask,
  type HomeLayout,
  type HomeView,
  MAX_PLOTS,
  nextPlotPrice,
  placementCap,
} from "@pl/shared";
import { createHomeScene, type HomeFriend, type HomeScene } from "@pl/game";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LiveStage } from "../stage/LiveStage.js";
import { Badge, Button, Card, formatInt } from "../ui/index.js";
import { unplaced } from "./meta-view.js";

/** The Friend as the isle shows it: scars at `now`, gold, stitches, `hat` and the belt it wears. */
export function homeFriend(
  view: FriendView,
  home: Pick<HomeView, "belt">,
  hat: string | null,
  now: number,
): HomeFriend {
  const tokenId = view.appearance.tokenId;
  const goldHeld = view.loaned ? 0 : view.pub.goldHeld;
  return {
    appearance: view.appearance,
    lost: and(effectiveLost(view.pub.scars, now, tokenId, { goldHeld }), frontMask(view.appearance)),
    gold: goldHeld,
    ...(view.pub.stitched ? { stitched: view.pub.stitched } : {}),
    glowCracks: view.pub.glowCracks,
    hat,
    belt: home.belt,
  };
}

/** Props of {@link HomeIsle}. */
export interface HomeIsleProps {
  home: HomeView;
  /** The Friend living on the isle (its live view). */
  view: FriendView;
  /** The owner's copies per item; absent for visitors (read-only isle). */
  owned?: Readonly<Record<string, number>>;
  /** The owner's Bits (plot purchases). */
  bits?: number | null;
  /** Saves layout / hat / open; resolves with the saved view. Absent = read-only. */
  onSave?: (req: { layout: HomeLayout; hat: string | null; open: boolean }) => Promise<HomeView>;
  onBuyPlot?: () => Promise<void>;
  errorMessage?: (e: unknown) => string;
}

const EDIT_ERRORS: Record<string, string> = {
  occupied: "Something is already there.",
  out_of_bounds: "That doesn't fit on the terrace.",
  friend_spot: "That's your Friend's spot.",
  cap: "Your isle is full: buy a plot for more room.",
  not_owned: "You have no copy of that left to place.",
  unknown_item: "That item is not in the catalogue.",
  not_editing: "Tap edit first.",
  nothing_selected: "Select an item first.",
};

const defaultError = (e: unknown): string => (e instanceof Error && e.message ? e.message : "Something went wrong.");

/** The isle and, for the owner, its editor. */
export function HomeIsle({
  home,
  view,
  owned,
  bits = null,
  onSave,
  onBuyPlot,
  errorMessage = defaultError,
}: HomeIsleProps) {
  const sceneRef = useRef<HomeScene | null>(null);
  const [live, setLive] = useState(false);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<HomeLayout>(home.layout);
  const [selected, setSelected] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [hat, setHat] = useState<string | null>(home.hat);
  const [open, setOpen] = useState(home.open);
  const [terrace, setTerrace] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openId = useId();
  const hatId = useId();

  // Saved state from the server wins whenever it changes (a save, a plot, a background refresh), except mid-edit:
  // the player's unsaved work is never thrown away by a refresh.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => {
    if (editingRef.current) return;
    setLayout(home.layout);
    setHat(home.hat);
    setOpen(home.open);
    sceneRef.current?.setLayout(home.layout, owned);
  }, [home, owned]);

  // Rebuilt only when the Friend, its scars, hat or belt change (not on every render).
  const friend = useMemo(() => homeFriend(view, home, hat, Date.now()), [view, home, hat]);
  const friendRef = useRef(friend);
  friendRef.current = friend;
  useEffect(() => {
    sceneRef.current?.setFriend(friend);
  }, [friend]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const mount = useCallback(
    (stage: Parameters<typeof createHomeScene>[0]) => {
      const scene = createHomeScene(stage, layoutRef.current, friendRef.current, {
        terraces: home.terraces,
        ...(owned ? { owned } : {}),
      });
      sceneRef.current = scene;
      const off = scene.editor.on((e) => {
        if (e.type === "change") setLayout(e.layout);
        else if (e.type === "select") setSelected(e.index);
        else if (e.type === "armed") setArmed(e.itemId);
        else if (e.type === "rejected") setStatus(EDIT_ERRORS[e.error] ?? `Can't: ${e.error}.`);
        if (e.type === "change") setStatus(`${e.layout.items.length} items · unsaved`);
      });
      setLive(true);
      return () => {
        off();
        scene.dispose();
        sceneRef.current = null;
        setLive(false);
      };
    },
    // The scene is rebuilt only when the isle's size changes (a bought plot); layout and Friend are pushed live.
    [home.terraces],
  );

  const begin = (): void => {
    sceneRef.current?.beginEdit();
    setEditing(true);
    setError(null);
    setStatus("Pick an item from the shelf, then tap a free tile. Tap an item to select it.");
  };
  const discard = (): void => {
    sceneRef.current?.endEdit();
    sceneRef.current?.setLayout(home.layout, owned);
    setLayout(home.layout);
    setHat(home.hat);
    setOpen(home.open);
    setEditing(false);
    setArmed(null);
    setStatus("");
  };
  const save = async (): Promise<void> => {
    const scene = sceneRef.current;
    if (!onSave) return;
    const next = scene ? scene.endEdit() : layout;
    setBusy(true);
    setError(null);
    try {
      const saved = await onSave({ layout: next, hat, open });
      scene?.setLayout(saved.layout, owned);
      setLayout(saved.layout);
      setEditing(false);
      setArmed(null);
      setStatus("Saved.");
    } catch (e) {
      setError(errorMessage(e));
      scene?.beginEdit();
    } finally {
      setBusy(false);
    }
  };
  const goTerrace = (t: number): void => {
    const clamped = Math.max(0, Math.min(home.terraces - 1, t));
    setTerrace(clamped);
    sceneRef.current?.focusTerrace(clamped);
  };

  const left = owned ? unplaced(owned, layout) : {};
  const shelf = owned ? CATALOG.filter((i) => i.kind === "decor" && (owned[i.id] ?? 0) > 0) : [];
  const hats = owned ? CATALOG.filter((i) => i.kind === "hat" && (owned[i.id] ?? 0) > 0) : [];
  const cap = placementCap(home.terraces);
  const plotPrice = nextPlotPrice(home.plots);
  const dirty = editing || hat !== home.hat || open !== home.open;

  return (
    <div className="pl-stack">
      <div className="pl-isle">
        <LiveStage
          key={home.terraces}
          mount={mount}
          label={`#${home.tokenId}'s isle: ${layout.items.length} items on ${home.terraces} terrace${home.terraces === 1 ? "" : "s"}`}
          fallback={<IsleList layout={layout} />}
        />
      </div>
      <p className="pl-label" role="status" aria-live="polite" style={{ margin: 0 }}>
        {status || `${layout.items.length}/${cap} items · ${home.terraces} terrace${home.terraces === 1 ? "" : "s"}`}
      </p>

      {home.terraces > 1 && (
        <div className="pl-row" role="group" aria-label="terrace">
          <Button size="small" onClick={() => goTerrace(terrace - 1)} disabled={terrace === 0}>
            ▼ terrace
          </Button>
          <span className="pl-label">
            terrace {terrace + 1}/{home.terraces}
          </span>
          <Button size="small" onClick={() => goTerrace(terrace + 1)} disabled={terrace >= home.terraces - 1}>
            ▲ terrace
          </Button>
        </div>
      )}

      {onSave && owned && (
        <Card title={editing ? "editing" : "your isle"} variant={editing ? "hero" : "paper"}>
          <div className="pl-stack">
            {!editing ? (
              <div className="pl-row">
                <Button variant="now" onClick={begin} disabled={!live}>
                  edit isle
                </Button>
                {!live && <span className="pl-sub">Editing needs the 3D stage.</span>}
              </div>
            ) : (
              <>
                <div className="pl-shelf" role="group" aria-label="place an item">
                  {shelf.length === 0 && <span className="pl-sub">Nothing to place yet: buy decor below.</span>}
                  {shelf.map((i) => (
                    <Button
                      key={i.id}
                      size="small"
                      aria-pressed={armed === i.id}
                      disabled={(left[i.id] ?? 0) === 0}
                      onClick={() => sceneRef.current?.editor.arm(armed === i.id ? null : i.id)}
                    >
                      {i.name} ×{left[i.id] ?? 0}
                    </Button>
                  ))}
                </div>
                <div className="pl-row">
                  <Button size="small" disabled={selected === null} onClick={() => sceneRef.current?.editor.rotate()}>
                    rotate (R)
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    disabled={selected === null}
                    onClick={() => sceneRef.current?.editor.remove()}
                  >
                    remove (Del)
                  </Button>
                  {selected !== null && layout.items[selected] && (
                    <Badge>{catalogItem(layout.items[selected].item)?.name ?? layout.items[selected].item}</Badge>
                  )}
                </div>
                <p className="pl-sub" style={{ margin: 0 }}>
                  Keyboard: arrows move the cursor, Enter places or picks up, R rotates, Delete removes, PageUp/PageDown
                  change terrace, Esc puts the item back.
                </p>
              </>
            )}

            <div className="pl-row">
              <label htmlFor={hatId} className="pl-label">
                hat
              </label>
              <select
                id={hatId}
                className="pl-input"
                style={{ maxWidth: 200 }}
                value={hat ?? ""}
                onChange={(e) => setHat(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">no hat</option>
                {hats.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <label htmlFor={openId} className="pl-row" style={{ gap: 6 }}>
                <input id={openId} type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
                open for visits
              </label>
            </div>

            {error && (
              <p className="pl-inline-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            {dirty && (
              <div className="pl-row">
                <Button onClick={discard} disabled={busy}>
                  discard
                </Button>
                <Button variant="now" busy={busy} onClick={() => void save()}>
                  save isle
                </Button>
              </div>
            )}

            {onBuyPlot && (
              <p className="pl-row" style={{ margin: 0 }}>
                {plotPrice === null ? (
                  <span className="pl-sub">
                    Every plot bought ({MAX_PLOTS}/{MAX_PLOTS}).
                  </span>
                ) : (
                  <>
                    <Button
                      size="small"
                      disabled={bits === null || bits < plotPrice || editing}
                      onClick={() => {
                        setError(null);
                        onBuyPlot().catch((e: unknown) => setError(errorMessage(e)));
                      }}
                    >
                      buy a plot · {formatInt(plotPrice)} bits
                    </Button>
                    <span className="pl-sub">+1 terrace, +4 item slots.</span>
                  </>
                )}
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/** 2D fallback: what is placed where. */
function IsleList({ layout }: { layout: HomeLayout }) {
  if (layout.items.length === 0) return <p className="pl-sub">An empty isle, waiting for its first tree.</p>;
  return (
    <ul className="pl-list" aria-label="placed items">
      {layout.items.map((p, i) => (
        <li key={i}>
          {decorItem(p.item)?.name ?? p.item} · terrace {p.t + 1}, tile {p.x + 1},{p.z + 1}
        </li>
      ))}
    </ul>
  );
}
