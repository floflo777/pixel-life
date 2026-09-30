/**
 * The Club Penguin meta (GDD §12, tokenomics §7): the home island ("igloo") layout, the Bits / RF decor catalog,
 * accessories (hats), the Stamp Book and the Fling Belt ladder. Everything here is data plus pure functions:
 * the server validates and persists with them, the client edits and renders with them.
 *
 * Economy rules this module encodes (never changed here, only read): Bits prices sit inside `BITS.catalogMin..Max`;
 * RF decor uses `RF_DECOR_TIERS_MICRO` and splits 50 % burn / 50 % stream like Regrow; the 10 and 25 RF crafted
 * pieces also cost a Bits blueprint (`BITS.craftedBlueprints`); stamps and belts never pay Bits (tokenomics §7).
 */
import { z } from "zod";
import { BITS, BPS, ECON, RF_DECOR_TIERS_MICRO } from "./economy.js";
import { isTokenIdStr, type TokenIdStr } from "./ids.js";

// ── Catalog ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Quarter turns about +Y (0 = facing +Z, toward the default camera); same convention as the world kit's `Facing`. */
export type Rotation = 0 | 1 | 2 | 3;

/** RF decor tier index into `RF_DECOR_TIERS_MICRO` (2 / 5 / 10 / 25 RF). */
export type RfDecorTier = 0 | 1 | 2 | 3;

/** What an item costs: Bits only, or an RF tier (tiers 2 and 3 also take a Bits blueprint). */
export type ItemPrice = { readonly bits: number } | { readonly rfTier: RfDecorTier };

/** Who owns a bought item: Bits items sit in the account wardrobe, RF decor travels with the Friend (tokenomics §7). */
export type ItemOwner = "account" | "friend";

/** Gate on buying an item: a stamp or a belt already earned (the flex items, GDD §12.3). */
export type ItemUnlock = { readonly stamp: StampId } | { readonly belt: BeltId };

/** Which shelf of the Seed Catalogue lists the item (GDD §12.3). */
export type CatalogShelf = "basic" | "rotating" | "flex" | "premium";

interface ItemBase {
  readonly id: string;
  readonly name: string;
  readonly price: ItemPrice;
  readonly shelf: CatalogShelf;
  readonly unlock?: ItemUnlock;
  /** One line of shelf copy. */
  readonly blurb: string;
}

/** A placeable home-island prop; `w`×`d` grid cells at rotation 0; `model` names the client voxel builder. */
export interface DecorItem extends ItemBase {
  readonly kind: "decor";
  readonly w: number;
  readonly d: number;
  readonly model: DecorModel;
}

/** A worn head accessory (voxels above the top row; never over a canonical pixel). */
export interface HatItem extends ItemBase {
  readonly kind: "hat";
  readonly model: HatModel;
}

/** Any catalog item. */
export type CatalogItem = DecorItem | HatItem;

/** Voxel prop builders the client knows (world-kit props plus home-only pieces). */
export const DECOR_MODELS = [
  "tree-paper",
  "tree-meadow",
  "tree-sun",
  "flowerbed",
  "rock",
  "reeds",
  "bench",
  "lamp",
  "planter",
  "crate",
  "signpost",
  "crystal",
  "fountain",
  "plush-nib",
  "plush-pogo",
  "plush-clank",
  "gulp-tooth",
  "dojo-mat",
  "sun-lantern",
  "gilded-bench",
  "gold-arch",
  "cloud-falls",
] as const;
/** Name of a decor voxel builder. */
export type DecorModel = (typeof DECOR_MODELS)[number];

/** Hat voxel builders the client knows. */
export const HAT_MODELS = ["cap", "beanie", "flower-crown", "party", "sun-crown"] as const;
/** Name of a hat voxel builder. */
export type HatModel = (typeof HAT_MODELS)[number];

const decor = (
  id: string,
  name: string,
  price: ItemPrice,
  w: number,
  d: number,
  model: DecorModel,
  blurb: string,
  extra: { shelf?: CatalogShelf; unlock?: ItemUnlock } = {},
): DecorItem => ({
  kind: "decor",
  id,
  name,
  price,
  w,
  d,
  model,
  blurb,
  shelf: extra.shelf ?? ("rfTier" in price ? "premium" : "basic"),
  ...(extra.unlock ? { unlock: extra.unlock } : {}),
});

const hat = (
  id: string,
  name: string,
  bits: number,
  model: HatModel,
  blurb: string,
  extra: { shelf?: CatalogShelf; unlock?: ItemUnlock } = {},
): HatItem => ({
  kind: "hat",
  id,
  name,
  price: { bits },
  model,
  blurb,
  shelf: extra.shelf ?? "basic",
  ...(extra.unlock ? { unlock: extra.unlock } : {}),
});

/**
 * The launch catalog: 19 Bits decor pieces, 4 RF decor pieces (one per tier) and 5 hats. Cosmetic only, nothing
 * here touches runs, scars or odds. Ids are stable forever (they are stored in layouts); retire items, never rename.
 */
export const CATALOG: readonly CatalogItem[] = Object.freeze([
  decor("tree_paper", "Paper tree", { bits: 150 }, 2, 2, "tree-paper", "A quiet tree in paper white."),
  decor("tree_meadow", "Meadow tree", { bits: 150 }, 2, 2, "tree-meadow", "Leafy, green, a little shy."),
  decor("tree_sun", "Sun tree", { bits: 300 }, 2, 2, "tree-sun", "Catches the light all day."),
  decor("flowerbed", "Flower bed", { bits: 150 }, 1, 1, "flowerbed", "Four colours, zero weeds."),
  decor("rock", "Mossy rock", { bits: 150 }, 1, 1, "rock", "Good for sitting on. Or not."),
  decor("reeds", "Pond reeds", { bits: 200 }, 1, 1, "reeds", "Slurp approves."),
  decor("bench", "Bench", { bits: 400 }, 2, 1, "bench", "Room for two Friends."),
  decor("lamp", "Lamp post", { bits: 350 }, 1, 1, "lamp", "Warm light for late visitors."),
  decor("planter", "Planter", { bits: 250 }, 1, 1, "planter", "A tidy pot of sprouts."),
  decor("crate", "Crate", { bits: 200 }, 1, 1, "crate", "Probably full of Bits. Probably."),
  decor("signpost", "Signpost", { bits: 300 }, 1, 1, "signpost", "Points to your isle."),
  decor("crystal", "Crystal", { bits: 600 }, 1, 1, "crystal", "Hums softly in the sun.", { shelf: "rotating" }),
  decor("fountain", "Fountain", { bits: 1200 }, 2, 2, "fountain", "Every isle needs a splash.", { shelf: "rotating" }),
  decor("plush_nib", "Nib plush", { bits: 500 }, 1, 1, "plush-nib", "Polite, even as a toy.", { shelf: "rotating" }),
  decor("plush_pogo", "Pogo plush", { bits: 500 }, 1, 1, "plush-pogo", "Still giggling.", { shelf: "rotating" }),
  decor("plush_clank", "Clank plush", { bits: 700 }, 1, 1, "plush-clank", "Grumpy, but huggable.", {
    shelf: "rotating",
  }),
  decor("gulp_tooth", "Gulp tooth trophy", { bits: 1500 }, 1, 1, "gulp-tooth", "Proof you made Gulp burp 50 times.", {
    shelf: "flex",
    unlock: { stamp: "gulp_gourmet" },
  }),
  decor("dojo_mat", "Dojo mat", { bits: 800 }, 2, 2, "dojo-mat", "For Friends with a green belt or better.", {
    shelf: "flex",
    unlock: { belt: "green" },
  }),
  decor("cloud_swing", "Cloud bench", { bits: 2500 }, 2, 1, "bench", "The comfiest seat in the Sky.", {
    shelf: "rotating",
  }),
  decor("sun_lantern", "Sun lantern", { rfTier: 0 }, 1, 1, "sun-lantern", "A glowing lantern, lit by RF."),
  decor("gilded_bench", "Gilded bench", { rfTier: 1 }, 2, 1, "gilded-bench", "A bench with a gold trim."),
  decor("gold_arch", "Gold arch", { rfTier: 2 }, 3, 1, "gold-arch", "A crafted landmark. Needs a blueprint."),
  decor("cloud_falls", "Cloud falls", { rfTier: 3 }, 2, 2, "cloud-falls", "An animated waterfall. Needs a blueprint."),
  hat("hat_cap", "Paper cap", 200, "cap", "Keeps the sun out of your pixels."),
  hat("hat_beanie", "Coral beanie", 300, "beanie", "Warm, soft, coral."),
  hat("hat_flower", "Flower crown", 400, "flower-crown", "Fresh from the meadow.", { shelf: "rotating" }),
  hat("hat_party", "Party hat", 500, "party", "Every run is a party.", { shelf: "rotating" }),
  hat("hat_crown", "Sun crown", 2500, "sun-crown", "Only for black belts.", {
    shelf: "flex",
    unlock: { belt: "black" },
  }),
] satisfies CatalogItem[]);

const ITEM_BY_ID: ReadonlyMap<string, CatalogItem> = new Map(CATALOG.map((i) => [i.id, i]));

/** Looks up a catalog item by id (null for unknown or retired ids). */
export function catalogItem(id: string): CatalogItem | null {
  return ITEM_BY_ID.get(id) ?? null;
}

/** Looks up a placeable decor item by id (null for unknown ids and for hats). */
export function decorItem(id: string): DecorItem | null {
  const item = ITEM_BY_ID.get(id);
  return item?.kind === "decor" ? item : null;
}

/** Where a bought item is owned: RF decor on the Friend, everything else in the account wardrobe. */
export function itemOwner(item: CatalogItem): ItemOwner {
  return "rfTier" in item.price ? "friend" : "account";
}

/**
 * The full cost of one item. RF parts are micro-RF split like Regrow: stream = floor(50 %), burn = the rest, so
 * `burnMicro + streamMicro === rfMicro`. `bits` includes the crafted blueprint for the 10 and 25 RF tiers.
 */
export interface ItemCost {
  readonly bits: number;
  readonly rfMicro: number;
  readonly burnMicro: number;
  readonly streamMicro: number;
}

/** Prices an item (pure; the server always recomputes, never trusts a client price). */
export function itemCost(item: CatalogItem): ItemCost {
  if ("bits" in item.price) return { bits: item.price.bits, rfMicro: 0, burnMicro: 0, streamMicro: 0 };
  const tier = item.price.rfTier;
  const rfMicro = RF_DECOR_TIERS_MICRO[tier];
  const streamMicro = Math.floor((rfMicro * ECON.streamBps) / BPS);
  const bits = tier === 2 ? BITS.craftedBlueprints.rf10 : tier === 3 ? BITS.craftedBlueprints.rf25 : 0;
  return { bits, rfMicro, burnMicro: rfMicro - streamMicro, streamMicro };
}

// ── Island plots (tokenomics §7) ─────────────────────────────────────────────────────────────────────────────────

/** Extra terraces an account can buy for a Friend's isle (one per `BITS.islandPlots` price). */
export const MAX_PLOTS = BITS.islandPlots.length;

/** Bits price of the next plot after `owned` plots, or null when every plot is bought. */
export function nextPlotPrice(owned: number): number | null {
  if (!Number.isInteger(owned) || owned < 0) return null;
  return BITS.islandPlots[owned] ?? null;
}

// ── Home layout (GDD §12.3) ──────────────────────────────────────────────────────────────────────────────────────

/** Each terrace is a `HOME_GRID`×`HOME_GRID` grid of 1 u cells. */
export const HOME_GRID = 12;
/** The Friend idles on this 2×2 spot of terrace 0; nothing may be placed on it. */
export const FRIEND_SPOT = Object.freeze({ t: 0, x: 5, z: 5, w: 2, d: 2 });
/** Placement cap = `base + perTerrace × terraces` (GDD §12.3: 8 items + 4 per terrace). */
export const PLACEMENT_CAP = Object.freeze({ base: 8, perTerrace: 4 });

/**
 * Terraces granted by the on-chain generation (GDD §12.3: Gen-6 → 1 terrace … Gen-1 → 6). Anything outside 1..6
 * (unknown, Genesis/unhardwired) gets the single base terrace.
 */
export function baseTerraces(generation: number): number {
  return Number.isInteger(generation) && generation >= 1 && generation <= 6 ? 7 - generation : 1;
}

/** Total terraces of an isle: generation terraces plus bought plots (plots clamped to 0..MAX_PLOTS). */
export function homeTerraces(generation: number, plots: number): number {
  const p = Number.isInteger(plots) ? Math.min(MAX_PLOTS, Math.max(0, plots)) : 0;
  return baseTerraces(generation) + p;
}

/** Max placed items for an isle with `terraces` terraces. */
export function placementCap(terraces: number): number {
  return PLACEMENT_CAP.base + PLACEMENT_CAP.perTerrace * Math.max(1, Math.floor(terraces));
}

/** One placed decor item: min corner (x, z) on terrace t, rotated `r` quarter turns. */
export interface Placement {
  readonly item: string;
  readonly t: number;
  readonly x: number;
  readonly z: number;
  readonly r: Rotation;
}

/** A Friend's decorated isle. `v` is the layout format version. */
export interface HomeLayout {
  readonly v: 1;
  readonly items: readonly Placement[];
}

/** The empty layout every isle starts with. */
export const EMPTY_LAYOUT: HomeLayout = Object.freeze({ v: 1, items: Object.freeze([]) });

/** Why a layout (or one edit) is refused. */
export type LayoutError =
  "unknown_item" | "not_decor" | "bad_terrace" | "out_of_bounds" | "overlap" | "friend_spot" | "too_many" | "not_owned";

/** Result of validating a layout: the offending placement index on failure. */
export type LayoutCheck =
  { readonly ok: true } | { readonly ok: false; readonly error: LayoutError; readonly index: number };

/** What a layout is validated against. `owned` omitted = ownership not checked (e.g. a client preview). */
export interface LayoutRules {
  readonly terraces: number;
  /** Copies owned per item id; a layout may place at most that many of each. */
  readonly owned?: Readonly<Record<string, number>>;
}

/** Footprint in cells of an item at rotation `r` (odd turns swap width and depth). */
export function footprint(item: Pick<DecorItem, "w" | "d">, r: Rotation): { w: number; d: number } {
  return r % 2 === 1 ? { w: item.d, d: item.w } : { w: item.w, d: item.d };
}

/** Grid cells covered by a placement (`[x, z]` pairs), or null for an unknown/non-decor item. */
export function placementCells(p: Placement): [number, number][] | null {
  const item = decorItem(p.item);
  if (!item) return null;
  const { w, d } = footprint(item, p.r);
  const out: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([p.x + i, p.z + j]);
  return out;
}

const inFriendSpot = (t: number, x: number, z: number): boolean =>
  t === FRIEND_SPOT.t &&
  x >= FRIEND_SPOT.x &&
  x < FRIEND_SPOT.x + FRIEND_SPOT.w &&
  z >= FRIEND_SPOT.z &&
  z < FRIEND_SPOT.z + FRIEND_SPOT.d;

/**
 * Validates a whole layout: every item is known decor, on an existing terrace, inside the 12×12 grid, off the
 * Friend spot, not overlapping another item, within the placement cap and (when `owned` is given) owned in enough
 * copies. Reports the first failing placement in array order.
 */
export function validateLayout(layout: HomeLayout, rules: LayoutRules): LayoutCheck {
  const fail = (error: LayoutError, index: number): LayoutCheck => ({ ok: false, error, index });
  const terraces = Math.max(1, Math.floor(rules.terraces));
  const occupied = new Set<string>();
  const used = new Map<string, number>();
  const cap = placementCap(terraces);
  for (let index = 0; index < layout.items.length; index++) {
    const p = layout.items[index];
    if (!p) continue;
    if (index >= cap) return fail("too_many", index);
    const item = catalogItem(p.item);
    if (!item) return fail("unknown_item", index);
    if (item.kind !== "decor") return fail("not_decor", index);
    if (!Number.isInteger(p.t) || p.t < 0 || p.t >= terraces) return fail("bad_terrace", index);
    const cells = placementCells(p) ?? [];
    for (const [x, z] of cells) {
      if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= HOME_GRID || z >= HOME_GRID) {
        return fail("out_of_bounds", index);
      }
      if (inFriendSpot(p.t, x, z)) return fail("friend_spot", index);
      const key = `${p.t}:${x}:${z}`;
      if (occupied.has(key)) return fail("overlap", index);
      occupied.add(key);
    }
    if (rules.owned) {
      const n = (used.get(p.item) ?? 0) + 1;
      if (n > (rules.owned[p.item] ?? 0)) return fail("not_owned", index);
      used.set(p.item, n);
    }
  }
  return { ok: true };
}

/** Result of one edit: the new layout, or why the edit was refused (the old layout is unchanged). */
export type LayoutEdit =
  { readonly ok: true; readonly layout: HomeLayout } | { readonly ok: false; readonly error: LayoutError };

/** Index of the placement covering cell (x, z) of terrace t, or -1. */
export function placementAt(layout: HomeLayout, t: number, x: number, z: number): number {
  return layout.items.findIndex((p) => p.t === t && (placementCells(p) ?? []).some(([cx, cz]) => cx === x && cz === z));
}

const commit = (items: readonly Placement[], rules: LayoutRules): LayoutEdit => {
  const layout: HomeLayout = { v: 1, items };
  const check = validateLayout(layout, rules);
  return check.ok ? { ok: true, layout } : { ok: false, error: check.error };
};

/** Adds a placement (appended last) if the result is a valid layout. */
export function placeItem(layout: HomeLayout, p: Placement, rules: LayoutRules): LayoutEdit {
  return commit([...layout.items, p], rules);
}

/** Moves placement `index` to (t, x, z), keeping its rotation, if the result is valid. */
export function moveItem(
  layout: HomeLayout,
  index: number,
  to: { t: number; x: number; z: number },
  rules: LayoutRules,
): LayoutEdit {
  const p = layout.items[index];
  if (!p) return { ok: false, error: "unknown_item" };
  return commit(
    layout.items.map((q, i) => (i === index ? { ...q, ...to } : q)),
    rules,
  );
}

/** Rotates placement `index` a quarter turn clockwise (seen from above) about its min corner, if still valid. */
export function rotateItem(layout: HomeLayout, index: number, rules: LayoutRules): LayoutEdit {
  const p = layout.items[index];
  if (!p) return { ok: false, error: "unknown_item" };
  const r = ((p.r + 1) % 4) as Rotation;
  return commit(
    layout.items.map((q, i) => (i === index ? { ...q, r } : q)),
    rules,
  );
}

/** Removes placement `index` (always valid: removing never breaks a valid layout). */
export function removeItem(layout: HomeLayout, index: number): HomeLayout {
  return { v: 1, items: layout.items.filter((_, i) => i !== index) };
}

// ── Stamps (GDD §12.5) ───────────────────────────────────────────────────────────────────────────────────────────

/** Stamp difficulty colours: easy (meadow), medium (sun), hard (coral), extreme (lilac). */
export type StampColor = "easy" | "medium" | "hard" | "extreme";
/** XP a stamp awards by colour (GDD §12.5). Stamps never award Bits (tokenomics §7). */
export const STAMP_XP: Readonly<Record<StampColor, number>> = Object.freeze({
  easy: 25,
  medium: 75,
  hard: 150,
  extreme: 300,
});

/** Stamp Book pages. */
export type StampPage = "pixel-life" | "care" | "hub";

/**
 * Facts about one finished venue run, as the server's verified replay reports them. Only `venueId` and `score` are
 * required; any metric a venue cannot report is simply absent (and counts as 0 / false).
 */
export interface RunFacts {
  readonly venueId: string;
  readonly score: number;
  /** Island / arena id ("meadow", "pond", "dusk", "snow", "ink"). */
  readonly island?: string;
  readonly mode?: "quick" | "daily" | "practice" | "trial";
  /** The belt whose fixed-seed trial this run was (GDD §12.4). */
  readonly beltTrial?: BeltId;
  readonly grabbedBack?: number;
  readonly clutchGrabs?: number;
  readonly maxCombo?: number;
  readonly fizzBank?: number;
  readonly pops?: number;
  readonly traitTriggers?: number;
  /** Share of pixels kept at run end, in basis points (10 000 = none lost). */
  readonly keptBps?: number;
  readonly flawless?: boolean;
  readonly gulpBurped?: boolean;
}

/** Numeric run metrics a stamp or belt can threshold on. */
export type RunMetric =
  "score" | "grabbedBack" | "clutchGrabs" | "maxCombo" | "fizzBank" | "pops" | "traitTriggers" | "keptBps";

/** A requirement on a single run: every listed minimum and flag must hold in the same run. */
export interface RunRequirement {
  readonly venueId?: string;
  readonly island?: string;
  readonly min?: Readonly<Partial<Record<RunMetric, number>>>;
  readonly flawless?: true;
  readonly gulpBurped?: true;
}

/** Cumulative per-Friend meta counters the stamp rules read. */
export interface MetaStats {
  readonly runs: number;
  readonly pops: number;
  readonly gulpBurps: number;
  readonly bestScore: number;
  readonly mendsGiven: number;
  readonly mendPxGiven: number;
  /** Distinct Friends this Friend mended (capped at `DISTINCT_CAP`). */
  readonly mendTargets: readonly TokenIdStr[];
  /** Distinct Friends that mended this Friend (capped). */
  readonly menders: readonly TokenIdStr[];
  readonly goldKept: number;
  /** Longest whole streak in days. */
  readonly wholeDays: number;
  /** Most items ever saved on the isle at once. */
  readonly homeItems: number;
  /** Distinct open isles visited (capped). */
  readonly islesVisited: readonly TokenIdStr[];
  readonly itemsBought: number;
  /** Rank of the current Fling Belt (0 = none, 1 = white … 10 = Gulp Master). */
  readonly beltRank: number;
}

/** Numeric stats a stamp can threshold on (distinct lists count their length). */
export type StatKey = keyof MetaStats;

/** Distinct-id lists stop growing here; every rule threshold is far below it. */
export const DISTINCT_CAP = 32;

/** Fresh counters for a Friend that has done nothing yet. */
export const EMPTY_STATS: MetaStats = Object.freeze({
  runs: 0,
  pops: 0,
  gulpBurps: 0,
  bestScore: 0,
  mendsGiven: 0,
  mendPxGiven: 0,
  mendTargets: [],
  menders: [],
  goldKept: 0,
  wholeDays: 0,
  homeItems: 0,
  islesVisited: [],
  itemsBought: 0,
  beltRank: 0,
});

/** How a stamp is earned: in a single run, or once a cumulative stat reaches a threshold. */
export type StampRule = { readonly run: RunRequirement } | { readonly stat: StatKey; readonly atLeast: number };

/** One stamp of the book. */
export interface StampDef {
  readonly id: string;
  readonly name: string;
  readonly page: StampPage;
  readonly color: StampColor;
  /** Player-facing condition, one short line. */
  readonly hint: string;
  readonly rule: StampRule;
}

const PL = "pixel-life";
const stamp = (id: string, name: string, page: StampPage, color: StampColor, hint: string, rule: StampRule) =>
  ({ id, name, page, color, hint, rule }) as const;

/** The 24 launch stamps: 16 Pixel Life, 6 Care, 2 Hub. Ids are stable forever. */
export const STAMPS = Object.freeze([
  stamp("first_flight", "First Flight", PL, "easy", "Finish a run.", { stat: "runs", atLeast: 1 }),
  stamp("first_grab", "First Grab", PL, "easy", "Grab back a pixel.", {
    run: { venueId: PL, min: { grabbedBack: 1 } },
  }),
  stamp("warm_up", "Warm Up", PL, "easy", "Score 1,000 in a run.", { run: { venueId: PL, min: { score: 1000 } } }),
  stamp("triple", "Triple", PL, "easy", "Chain a ×3 combo.", { run: { venueId: PL, min: { maxCombo: 3 } } }),
  stamp("snack_time", "Snack Time", PL, "easy", "Pop 100 Munchies.", { stat: "pops", atLeast: 100 }),
  stamp("regular", "Regular", PL, "easy", "Finish 10 runs.", { stat: "runs", atLeast: 10 }),
  stamp("clutch", "Clutch", PL, "medium", "3 clutch grabs in one run.", {
    run: { venueId: PL, min: { clutchGrabs: 3 } },
  }),
  stamp("combo_8", "8× Combo", PL, "medium", "Chain a ×8 combo.", { run: { venueId: PL, min: { maxCombo: 8 } } }),
  stamp("high_four", "High Four", PL, "medium", "Score 4,000 in a run.", {
    run: { venueId: PL, min: { score: 4000 } },
  }),
  stamp("burp", "Burp!", PL, "medium", "Make Old Gulp burp.", { run: { venueId: PL, gulpBurped: true } }),
  stamp("flawless", "Flawless", PL, "medium", "Finish a run without losing a pixel.", {
    run: { venueId: PL, flawless: true },
  }),
  stamp("fizz_bank", "Fizz Bank ×3", PL, "hard", "Bank 3 Fizz blasts in one run.", {
    run: { venueId: PL, min: { fizzBank: 3 } },
  }),
  stamp("gulp_gourmet", "Gulp Gourmet", PL, "hard", "Make Gulp burp 50 times.", { stat: "gulpBurps", atLeast: 50 }),
  stamp("high_flyer", "High Flyer", PL, "hard", "Score 8,000 in a run.", {
    run: { venueId: PL, min: { score: 8000 } },
  }),
  stamp("untouchable", "Untouchable", PL, "extreme", "Flawless on Ink island.", {
    run: { venueId: PL, island: "ink", flawless: true },
  }),
  stamp("gulp_master", "Gulp Master", PL, "extreme", "Earn the Gulp Master belt.", { stat: "beltRank", atLeast: 10 }),
  stamp("first_stitch", "First Stitch", "care", "easy", "Mend another Friend.", { stat: "mendsGiven", atLeast: 1 }),
  stamp("gold_keeper", "Gold Keeper", "care", "medium", "Keep a Gold Pixel.", { stat: "goldKept", atLeast: 1 }),
  stamp("well_loved", "Well Loved", "care", "medium", "Be mended by 5 different Friends.", {
    stat: "menders",
    atLeast: 5,
  }),
  stamp("whole_week", "Whole Week", "care", "medium", "Stay whole for 7 days.", { stat: "wholeDays", atLeast: 7 }),
  stamp("kind_stranger", "Kind Stranger", "care", "hard", "Mend 10 different Friends.", {
    stat: "mendTargets",
    atLeast: 10,
  }),
  stamp("whole_moon", "Whole Moon", "care", "extreme", "Stay whole for 30 days.", { stat: "wholeDays", atLeast: 30 }),
  stamp("decorator", "Decorator", "hub", "easy", "Place 5 items on your isle.", { stat: "homeItems", atLeast: 5 }),
  stamp("isle_hopper", "Isle Hopper", "hub", "medium", "Visit 5 open isles.", { stat: "islesVisited", atLeast: 5 }),
] as const satisfies readonly StampDef[]);

/** Id of a launch stamp. */
export type StampId = (typeof STAMPS)[number]["id"];

const STAMP_BY_ID: ReadonlyMap<string, StampDef> = new Map(STAMPS.map((s) => [s.id, s]));

/** Looks up a stamp by id (null for unknown ids). */
export function stampDef(id: string): StampDef | null {
  return STAMP_BY_ID.get(id) ?? null;
}

/** True if `run` meets every part of `req` (absent metrics count as 0 / false). */
export function runMeets(run: RunFacts, req: RunRequirement): boolean {
  if (req.venueId !== undefined && run.venueId !== req.venueId) return false;
  if (req.island !== undefined && run.island !== req.island) return false;
  if (req.flawless && run.flawless !== true) return false;
  if (req.gulpBurped && run.gulpBurped !== true) return false;
  for (const [metric, min] of Object.entries(req.min ?? {}) as [RunMetric, number][]) {
    const v = run[metric] ?? 0;
    if (!(Number.isFinite(v) && v >= min)) return false;
  }
  return true;
}

const statValue = (stats: MetaStats, key: StatKey): number => {
  const v = stats[key];
  return Array.isArray(v) ? v.length : (v as number);
};

/** True if the rule holds for this event (run rules only look at `run_finished` events). */
export function ruleHolds(rule: StampRule, stats: MetaStats, event: MetaEvent): boolean {
  if ("stat" in rule) return statValue(stats, rule.stat) >= rule.atLeast;
  return event.kind === "run_finished" && runMeets(event.run, rule.run);
}

// ── Meta events and counters ─────────────────────────────────────────────────────────────────────────────────────

/** Something that happened to a Friend that the meta layer reacts to (stamps, belts, counters). */
export type MetaEvent =
  | { readonly kind: "run_finished"; readonly run: RunFacts }
  | { readonly kind: "mend_given"; readonly target: TokenIdStr; readonly px: number }
  | { readonly kind: "mend_received"; readonly from: TokenIdStr; readonly px: number }
  | { readonly kind: "gold_kept"; readonly count?: number }
  | { readonly kind: "whole"; readonly days: number }
  | { readonly kind: "home_saved"; readonly items: number }
  | { readonly kind: "isle_visited"; readonly owner: TokenIdStr }
  | { readonly kind: "item_bought"; readonly item: string }
  | { readonly kind: "belt_earned"; readonly belt: BeltId };

const nat = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

const addDistinct = (list: readonly TokenIdStr[], id: TokenIdStr): readonly TokenIdStr[] =>
  !isTokenIdStr(id) || list.includes(id) || list.length >= DISTINCT_CAP ? list : [...list, id];

/**
 * Applies one event to the counters (pure; returns a new object). Monotone: no counter ever decreases, distinct lists
 * never hold duplicates and stop at `DISTINCT_CAP`. Malformed numbers count as 0.
 */
export function applyMetaEvent(stats: MetaStats, event: MetaEvent): MetaStats {
  switch (event.kind) {
    case "run_finished": {
      const r = event.run;
      return {
        ...stats,
        runs: stats.runs + 1,
        pops: stats.pops + nat(r.pops),
        gulpBurps: stats.gulpBurps + (r.gulpBurped === true ? 1 : 0),
        bestScore: Math.max(stats.bestScore, nat(r.score)),
      };
    }
    case "mend_given":
      return {
        ...stats,
        mendsGiven: stats.mendsGiven + 1,
        mendPxGiven: stats.mendPxGiven + nat(event.px),
        mendTargets: addDistinct(stats.mendTargets, event.target),
      };
    case "mend_received":
      return { ...stats, menders: addDistinct(stats.menders, event.from) };
    case "gold_kept":
      return { ...stats, goldKept: stats.goldKept + (event.count === undefined ? 1 : nat(event.count)) };
    case "whole":
      return { ...stats, wholeDays: Math.max(stats.wholeDays, nat(event.days)) };
    case "home_saved":
      return { ...stats, homeItems: Math.max(stats.homeItems, nat(event.items)) };
    case "isle_visited":
      return { ...stats, islesVisited: addDistinct(stats.islesVisited, event.owner) };
    case "item_bought":
      return { ...stats, itemsBought: stats.itemsBought + 1 };
    case "belt_earned":
      return { ...stats, beltRank: Math.max(stats.beltRank, beltRank(event.belt)) };
  }
}

/** Normalises stored counters (e.g. JSON from the DB, possibly from an older version) into a full `MetaStats`. */
export function parseMetaStats(raw: unknown): MetaStats {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown): readonly TokenIdStr[] =>
    Array.isArray(v) ? [...new Set(v.filter(isTokenIdStr))].slice(0, DISTINCT_CAP) : [];
  return {
    runs: nat(o["runs"]),
    pops: nat(o["pops"]),
    gulpBurps: nat(o["gulpBurps"]),
    bestScore: nat(o["bestScore"]),
    mendsGiven: nat(o["mendsGiven"]),
    mendPxGiven: nat(o["mendPxGiven"]),
    mendTargets: list(o["mendTargets"]),
    menders: list(o["menders"]),
    goldKept: nat(o["goldKept"]),
    wholeDays: nat(o["wholeDays"]),
    homeItems: nat(o["homeItems"]),
    islesVisited: list(o["islesVisited"]),
    itemsBought: nat(o["itemsBought"]),
    beltRank: Math.min(BELTS.length, nat(o["beltRank"])),
  };
}

/**
 * Stamps newly earned by `event`, given the counters *after* applying it and the stamps already held. Returned in
 * book order, never including a stamp already held.
 */
export function newStamps(stats: MetaStats, event: MetaEvent, held: ReadonlySet<string>): StampId[] {
  return STAMPS.filter((s) => !held.has(s.id) && ruleHolds(s.rule, stats, event)).map((s) => s.id);
}

/** XP for a set of stamp ids (unknown ids count 0). */
export function stampsXp(ids: readonly string[]): number {
  let xp = 0;
  for (const id of ids) {
    const def = STAMP_BY_ID.get(id);
    if (def) xp += STAMP_XP[def.color];
  }
  return xp;
}

// ── Fling Belts (GDD §12.4) ──────────────────────────────────────────────────────────────────────────────────────

/** One rung of the Fling Belt ladder; `trial` false = earned by any finished Pixel Life run (white). */
export interface BeltDef {
  readonly id: string;
  readonly name: string;
  /** Band colour (sRGB hex). */
  readonly color: number;
  readonly trial: boolean;
  readonly requirement: RunRequirement;
  readonly hint: string;
}

const belt = (id: string, name: string, color: number, hint: string, requirement: RunRequirement, trial = true) =>
  ({ id, name, color, hint, requirement: { venueId: PL, ...requirement }, trial }) as const;

/** The ladder, lowest first. Each belt needs the one before it (Card-Jitsu order). */
export const BELTS = Object.freeze([
  belt("white", "White", 0xeeeeee, "Finish any run.", {}, false),
  belt("yellow", "Yellow", 0xf2ce68, "Score 2,000.", { island: "meadow", min: { score: 2000 } }),
  belt("orange", "Orange", 0xf0a050, "Combo ×4 in one fling.", { island: "meadow", min: { maxCombo: 4 } }),
  belt("green", "Green", 0x9cc56c, "Keep 90 % of your pixels.", { island: "meadow", min: { keptBps: 9000 } }),
  belt("blue", "Blue", 0x7db4db, "Burp Gulp.", { island: "meadow", gulpBurped: true }),
  belt("red", "Red", 0xd65a4a, "Dusk island, score 4,000.", { island: "dusk", min: { score: 4000 } }),
  belt("brown", "Brown", 0x8a5a3c, "5 family-trait triggers in one run.", {
    island: "meadow",
    min: { traitTriggers: 5 },
  }),
  belt("purple", "Purple", 0x8f7bbd, "Snow island, Flawless.", { island: "snow", flawless: true }),
  belt("black", "Black", 0x111111, "Ink island, score 6,000 and burp Gulp.", {
    island: "ink",
    min: { score: 6000 },
    gulpBurped: true,
  }),
  belt("gulp_master", "Gulp Master", 0xf7f7f2, "The Ancient Gulp trial: burp it.", {
    island: "ancient",
    gulpBurped: true,
  }),
] as const satisfies readonly BeltDef[]);

/** Id of a Fling Belt. */
export type BeltId = (typeof BELTS)[number]["id"];

/** 1-based rank of a belt (white = 1), 0 for unknown ids. */
export function beltRank(id: string): number {
  return BELTS.findIndex((b) => b.id === id) + 1;
}

/** Looks up a belt by id (null for unknown ids). */
export function beltDef(id: string): BeltDef | null {
  return BELTS.find((b) => b.id === id) ?? null;
}

/** The belt worn: the highest rung reached without a gap from white (order matters), or null. */
export function currentBelt(passed: Iterable<string>): BeltId | null {
  const set = new Set(passed);
  let worn: BeltId | null = null;
  for (const b of BELTS) {
    if (!set.has(b.id)) break;
    worn = b.id;
  }
  return worn;
}

/** The next belt to earn after `current` (null current = white), or null at the top. */
export function nextBelt(current: BeltId | null): BeltId | null {
  return BELTS[current === null ? 0 : beltRank(current)]?.id ?? null;
}

/**
 * The belt a finished run earns, if any: only the next rung can be earned; trial belts need the run to be that belt's
 * fixed-seed trial (`run.beltTrial`) and to meet its requirement; white needs any finished Pixel Life run.
 */
export function beltEarnedBy(passed: Iterable<string>, run: RunFacts): BeltId | null {
  const next = nextBelt(currentBelt(passed));
  if (next === null) return null;
  const def = BELTS[beltRank(next) - 1];
  if (!def) return null;
  if (def.trial && run.beltTrial !== def.id) return null;
  return runMeets(run, def.requirement) ? next : null;
}

// ── Wire DTOs and validation ─────────────────────────────────────────────────────────────────────────────────────

/** A stamp held by a Friend. */
export interface HeldStamp {
  readonly id: StampId;
  /** When it was earned (epoch ms). */
  readonly at: number;
}

/** `GET /api/home/:tokenId`: the public view of a Friend's isle, belt and stamp book. */
export interface HomeView {
  readonly tokenId: TokenIdStr;
  /** Generation used for the terrace count (null until the owner first saved the isle). */
  readonly generation: number | null;
  readonly plots: number;
  readonly terraces: number;
  readonly layout: HomeLayout;
  readonly hat: string | null;
  readonly open: boolean;
  readonly belt: BeltId | null;
  readonly stamps: readonly HeldStamp[];
  readonly stampXp: number;
}

/** `GET /api/meta/me`: the owner's view (their isle plus wallet and wardrobe). */
export interface MetaMeRes {
  readonly home: HomeView;
  readonly bits: number;
  /** Copies owned per item id (account wardrobe + this Friend's RF decor). */
  readonly owned: Readonly<Record<string, number>>;
  readonly stats: MetaStats;
  readonly economy: "sim" | "live";
  /** Simulated RF balance (sim mode only). */
  readonly simRfMicro?: number;
}

/** `POST /api/meta/buy` result. */
export interface BuyRes {
  readonly item: string;
  readonly owned: number;
  readonly bits: number;
  readonly simRfMicro?: number;
  /** The RF split recorded in the ledger (RF decor only). */
  readonly receipt?: {
    readonly id: string;
    readonly totalMicro: number;
    readonly burnMicro: number;
    readonly streamMicro: number;
  };
  readonly stamps: readonly StampId[];
}

/** `POST /api/meta/plot` result. */
export interface PlotRes {
  readonly plots: number;
  readonly terraces: number;
  readonly bits: number;
}

const placementSchema = z.object({
  item: z.string().min(1).max(32),
  t: z.number().int().min(0).max(31),
  x: z
    .number()
    .int()
    .min(0)
    .max(HOME_GRID - 1),
  z: z
    .number()
    .int()
    .min(0)
    .max(HOME_GRID - 1),
  r: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

/** Shape check of a layout (structure only; `validateLayout` checks the rules). */
export const homeLayoutSchema = z.object({
  v: z.literal(1),
  items: z.array(placementSchema).max(64),
});

/** `PUT /api/home` body: the new layout, and optionally the worn hat and the open-isle toggle. */
export const homeSaveSchema = z.object({
  layout: homeLayoutSchema,
  hat: z.string().min(1).max(32).nullable().optional(),
  open: z.boolean().optional(),
});
/** `PUT /api/home` body type. */
export type HomeSaveReq = z.infer<typeof homeSaveSchema>;

/** `POST /api/meta/buy` body. */
export const buySchema = z.object({ itemId: z.string().min(1).max(32) });
/** `POST /api/meta/buy` body type. */
export type BuyReq = z.infer<typeof buySchema>;

// Catalog invariants tokenomics depends on; checked once at module load so a bad edit fails loudly.
{
  const ids = new Set<string>();
  for (const item of CATALOG) {
    if (ids.has(item.id)) throw new Error(`Duplicate catalog id ${item.id}.`);
    ids.add(item.id);
    if ("bits" in item.price && (item.price.bits < BITS.catalogMin || item.price.bits > BITS.catalogMax)) {
      throw new Error(`${item.id}: Bits price outside the catalog band.`);
    }
    if (item.kind === "decor" && (item.w < 1 || item.d < 1 || item.w > 4 || item.d > 4)) {
      throw new Error(`${item.id}: bad footprint.`);
    }
    if (item.unlock && "stamp" in item.unlock && !STAMP_BY_ID.has(item.unlock.stamp)) {
      throw new Error(`${item.id}: unknown unlock stamp.`);
    }
  }
}
