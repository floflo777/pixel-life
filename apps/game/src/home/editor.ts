import {
  HOME_GRID,
  moveItem,
  placeItem,
  placementAt,
  removeItem,
  rotateItem,
  type HomeLayout,
  type LayoutEdit,
  type LayoutError,
  type LayoutRules,
} from "@pl/shared";
import type { Tile } from "./grid";

/** Why an edit did nothing. */
export type EditRefusal = LayoutError | "not_editing" | "nothing_selected";

/** Outcome of one editor command. */
export type EditResult = { readonly ok: true } | { readonly ok: false; readonly error: EditRefusal };

/** What the editor tells its host (UI panel, save button, sounds). */
export type HomeEditEvent =
  | { readonly type: "change"; readonly layout: HomeLayout }
  | { readonly type: "select"; readonly index: number | null; readonly tile: Tile | null }
  | { readonly type: "armed"; readonly itemId: string | null }
  | { readonly type: "cursor"; readonly tile: Tile }
  | { readonly type: "rejected"; readonly error: EditRefusal; readonly tile: Tile | null };

/**
 * The home edit-mode state machine (GDD §12.3 wireframe), free of rendering so it is unit-tested and driven the same
 * way by taps, keys and DOM buttons:
 * - tap an item → select it (tap it again → deselect);
 * - with a shelf item armed, tap a free tile → place it there (then disarm, select it);
 * - with an item selected, tap a free tile → move it there;
 * - `rotate()` / `remove()` act on the selection.
 * Every layout change goes through the shared validators, so an accepted layout is always one the server accepts
 * (given the same ownership).
 */
export class HomeEditor {
  private listeners = new Set<(e: HomeEditEvent) => void>();
  private _layout: HomeLayout;
  private _rules: LayoutRules;
  private _selected: number | null = null;
  private _armed: string | null = null;
  private _active = false;
  private _cursor: Tile = { t: 0, x: 0, z: 0 };

  constructor(layout: HomeLayout, rules: LayoutRules) {
    this._layout = layout;
    this._rules = rules;
  }

  /** Current layout (updated by every accepted edit). */
  get layout(): HomeLayout {
    return this._layout;
  }
  /** Index of the selected placement, or null. */
  get selected(): number | null {
    return this._selected;
  }
  /** Shelf item that the next free-tile tap places, or null. */
  get armed(): string | null {
    return this._armed;
  }
  /** True between `begin()` and `end()`. */
  get active(): boolean {
    return this._active;
  }
  /** Keyboard cursor tile. */
  get cursor(): Tile {
    return this._cursor;
  }
  /** The rules edits are validated against (terraces, owned copies). */
  get rules(): LayoutRules {
    return this._rules;
  }

  /** Subscribes to editor events; returns an unsubscribe. */
  on(listener: (e: HomeEditEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: HomeEditEvent): void {
    for (const l of this.listeners) l(e);
  }

  private refuse(error: EditRefusal, tile: Tile | null = null): EditResult {
    this.emit({ type: "rejected", error, tile });
    return { ok: false, error };
  }

  private select(index: number | null, tile: Tile | null): void {
    this._selected = index;
    this.emit({ type: "select", index, tile });
  }

  private apply(edit: LayoutEdit, tile: Tile | null, select: number | null): EditResult {
    if (!edit.ok) return this.refuse(edit.error, tile);
    this._layout = edit.layout;
    this.emit({ type: "change", layout: edit.layout });
    this.select(select, tile);
    return { ok: true };
  }

  /** Enters edit mode. */
  begin(): void {
    this._active = true;
  }

  /** Leaves edit mode, clearing the selection and the armed item. */
  end(): void {
    this._active = false;
    if (this._armed !== null) this.arm(null);
    if (this._selected !== null) this.select(null, null);
  }

  /** Replaces the layout and rules (e.g. after a save or a purchase); drops a selection that no longer exists. */
  reset(layout: HomeLayout, rules: LayoutRules = this._rules): void {
    this._layout = layout;
    this._rules = rules;
    if (this._selected !== null && this._selected >= layout.items.length) this.select(null, null);
  }

  /** Arms a shelf item for placement (null disarms). Arming clears the selection. */
  arm(itemId: string | null): void {
    this._armed = itemId;
    if (itemId !== null && this._selected !== null) this.select(null, null);
    this.emit({ type: "armed", itemId });
  }

  /** Handles a tap on a tile (see the class doc for the rules). */
  tap(tile: Tile): EditResult {
    if (!this._active) return this.refuse("not_editing", tile);
    this._cursor = tile;
    const hit = placementAt(this._layout, tile.t, tile.x, tile.z);
    if (this._armed !== null) {
      if (hit >= 0) return this.refuse("overlap", tile);
      const itemId = this._armed;
      const result = this.apply(
        placeItem(this._layout, { item: itemId, t: tile.t, x: tile.x, z: tile.z, r: 0 }, this._rules),
        tile,
        this._layout.items.length,
      );
      if (result.ok) this.arm(null);
      return result;
    }
    if (hit >= 0) {
      this.select(this._selected === hit ? null : hit, tile);
      return { ok: true };
    }
    if (this._selected !== null)
      return this.apply(moveItem(this._layout, this._selected, tile, this._rules), tile, this._selected);
    this.select(null, tile);
    return { ok: true };
  }

  /** Rotates the selected item a quarter turn. */
  rotate(): EditResult {
    if (!this._active) return this.refuse("not_editing");
    if (this._selected === null) return this.refuse("nothing_selected");
    return this.apply(rotateItem(this._layout, this._selected, this._rules), null, this._selected);
  }

  /** Removes the selected item (back to the wardrobe; nothing is refunded or lost). */
  remove(): EditResult {
    if (!this._active) return this.refuse("not_editing");
    if (this._selected === null) return this.refuse("nothing_selected");
    this._layout = removeItem(this._layout, this._selected);
    this.emit({ type: "change", layout: this._layout });
    this.select(null, null);
    return { ok: true };
  }

  /** Moves the keyboard cursor by (dx, dz) cells, clamped to the grid; `dt` steps between terraces. */
  moveCursor(dx: number, dz: number, dt = 0): Tile {
    const terraces = Math.max(1, this._rules.terraces);
    const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
    this._cursor = {
      t: clamp(this._cursor.t + dt, terraces),
      x: clamp(this._cursor.x + dx, HOME_GRID),
      z: clamp(this._cursor.z + dz, HOME_GRID),
    };
    this.emit({ type: "cursor", tile: this._cursor });
    return this._cursor;
  }
}
