/**
 * The Munchies as 1-bit-sized sprites (art bible §5): one character = one voxel. Bodies are pastel with ink features
 * (the inverse of a Friend). Every pose is its own sprite so squash, crouch, puff and jaw moves stay on the voxel grid.
 *
 * Legend (see CELL_KINDS): lower-case body colours, upper-case dark variants. `w`/`k`/`T` are face features drawn on the
 * front shell only; `P`/`R` are raised one voxel proud of the front (Clank's plate); `M` is a recessed ink cavity.
 */
import { PALETTE } from "../stage/palette";

/** Sim creature kinds, in the sim's index order (`packages/shared/src/sim/tuning.ts`: NIB = 0 … FIZZ = 5). */
export const CREATURE_KINDS = ["nib", "pogo", "clank", "snatch", "slurp", "fizz"] as const;
/** One of the six regular Munchies. */
export type CreatureKind = (typeof CREATURE_KINDS)[number];

/** How a sprite cell is extruded. */
export type CellRole = "body" | "thin" | "feature" | "raised" | "cavity";

/** Colour and extrusion role of each sprite character. */
export const CELL_KINDS: Readonly<Record<string, { readonly color: number; readonly role: CellRole }>> = {
  c: { color: PALETTE.coral, role: "body" },
  C: { color: PALETTE.coralDark, role: "body" },
  l: { color: PALETTE.lilac, role: "body" },
  L: { color: PALETTE.lilacDark, role: "body" },
  v: { color: PALETTE.lilac, role: "thin" },
  y: { color: PALETTE.sun, role: "body" },
  Y: { color: 0xd9a444, role: "body" },
  b: { color: PALETTE.pond, role: "body" },
  B: { color: 0x5f95bf, role: "body" },
  p: { color: PALETTE.paperWarm, role: "body" },
  q: { color: PALETTE.cloud, role: "body" },
  e: { color: PALETTE.tile, role: "body" },
  K: { color: PALETTE.ink, role: "thin" },
  w: { color: PALETTE.paperWarm, role: "feature" },
  k: { color: PALETTE.ink, role: "feature" },
  T: { color: PALETTE.lilac, role: "feature" },
  P: { color: PALETTE.pond, role: "raised" },
  R: { color: PALETTE.paperWarm, role: "raised" },
  M: { color: PALETTE.ink, role: "cavity" },
};

/** Per-kind sprite set and extrusion settings. */
export interface CreatureSpriteSet {
  /** Body colour behind face features (the pillow's core). */
  readonly skin: string;
  /** Pillow cap: depth = 1 + 2·(min(d, maxD) − 1) voxels, d = distance to the sprite edge (bible §5). */
  readonly maxD: number;
  /** Silhouette category (GDD §3): each kind has its own so 1-bit mode still reads. */
  readonly silhouette: "round" | "legs" | "dome" | "wings" | "wide" | "spiky";
  /** Pose frames by name; `idle0` always exists. */
  readonly frames: Readonly<Record<string, readonly string[]>>;
}

const NIB_TOP = ["...cccccc...", "..cccccccc..", ".cccccccccc."];
const NIB_FEET = ["..cc....cc..", ".KK......KK."];
const NIB_FEET_B = ["..cc....cc..", "..KK....KK.."];

const POGO_HEAD = ["..K..K..", "...K.K..", "..yyyyy.", ".yyyyyyy", ".yywwyyy", ".yywkyyy"];

const CLANK_SHELL = ["....llll....", "..llLllLll..", ".llkkllkkll.", ".lwkllllkwl."];
const CLANK_PLATE = ["PPPPPPPPPPPP", "PRPPRPPRPPRP", "PPPPPPPPPPPP"];

const SLURP_BODY = ["bbbbbbbbbbbbbbbbbb", "bbbbbbbbbbbbbbbbbb", "bkkkkkkkkkkkkkkkkb"];

/** Sprite sets for the six Munchies (sizes from art bible §5: Nib 12×11, Pogo 8×12, Clank 12×9, Snatch 16×9, Slurp 18×9, Fizz 8×8). */
export const CREATURE_SPRITES: Readonly<Record<CreatureKind, CreatureSpriteSet>> = {
  nib: {
    skin: "c",
    maxD: 3,
    silhouette: "round",
    frames: {
      idle0: [
        ...NIB_TOP,
        "ccwwccccwwcc",
        "ccwkccccwkcc",
        "cccccccccccc",
        "cckkkkkkkkcc",
        "cckwkkkkwkcc",
        ".cccccccccc.",
        ...NIB_FEET,
      ],
      idle1: [
        ...NIB_TOP,
        "ccwwccccwwcc",
        "cckwcccckwcc",
        "cccccccccccc",
        "cckkkkkkkkcc",
        "cckwkkkkwkcc",
        ".cccccccccc.",
        ...NIB_FEET_B,
      ],
      // The polite bow: eyes shut into two ink dashes.
      bow: [
        ...NIB_TOP,
        "cccccccccccc",
        "cckkcccckkcc",
        "cccccccccccc",
        "ccckkkkkkccc",
        "ccckwkkwkccc",
        ".cccccccccc.",
        ...NIB_FEET,
      ],
      // "nom": the mouth opens three rows deep.
      bite: [
        ...NIB_TOP,
        "ccwwccccwwcc",
        "cckwcccckwcc",
        "cckkkkkkkkcc",
        "cckwkkkkwkcc",
        "cckkkkkkkkcc",
        ".cckkkkkkcc.",
        ...NIB_FEET,
      ],
      stun: [
        ...NIB_TOP,
        "cckwcccckwcc",
        "ccwkccccwkcc",
        "cccccccccccc",
        "ccckkcckkccc",
        "cckcckkcckcc",
        ".cccccccccc.",
        ...NIB_FEET_B,
      ],
    },
  },
  pogo: {
    skin: "y",
    maxD: 3,
    silhouette: "legs",
    frames: {
      idle0: [...POGO_HEAD, ".yyykkyy", "..yyyyy.", "..y...y.", ".K...K..", ".y...y..", "YY..YY.."],
      idle1: [
        ".K...K..",
        "..K.K...",
        ...POGO_HEAD.slice(2),
        ".yyykkyy",
        "..yyyyy.",
        "..y...y.",
        ".K...K..",
        ".y...y..",
        "YY..YY..",
      ],
      // Crouch: the legs compress 3 → 1 voxel.
      crouch: [...POGO_HEAD.slice(0, 4), ".yykkyyy", ".yyyyyyy", ".yyykkyy", "..yyyyy.", ".K...K..", "YY..YY.."],
      // In the air: legs straight, giggling mouth open.
      hop: [...POGO_HEAD, ".yykkkyy", "..yyyyy.", "..y...y.", "..y...y.", "..y...y.", "..Y...Y."],
      stun: [
        "..K..K..",
        "...K.K..",
        "..yyyyy.",
        ".yyyyyyy",
        ".yykwyyy",
        ".yywkyyy",
        ".yykkyyy",
        "..yyyyy.",
        "..y...y.",
        ".K...K..",
        ".y...y..",
        "YY..YY..",
      ],
    },
  },
  clank: {
    skin: "l",
    maxD: 3,
    silhouette: "dome",
    frames: {
      idle0: [...CLANK_SHELL, ...CLANK_PLATE, ".llllllllll.", "K.K.K..K.K.K"],
      idle1: [...CLANK_SHELL, ...CLANK_PLATE, ".llllllllll.", ".K.K.KK.K.K."],
      // Jaw open: the plate splits 2 voxels around a dark maw.
      jaws: [
        ...CLANK_SHELL,
        "PRPPRPPRPPRP",
        "PPPPPPPPPPPP",
        "MMMMMMMMMMMM",
        "MMMMMMMMMMMM",
        "PPPPPPPPPPPP",
        ".llllllllll.",
        "K.K.K..K.K.K",
      ],
      stun: [
        "....llll....",
        "..llLllLll..",
        ".llllllllll.",
        ".lkwllllwkl.",
        ...CLANK_PLATE,
        ".llllllllll.",
        ".K.K.KK.K.K.",
      ],
    },
  },
  snatch: {
    skin: "L",
    maxD: 3,
    silhouette: "wings",
    frames: {
      up: [
        "vv............vv",
        "vvv..........vvv",
        "vvvv...LL...vvvv",
        "vvvvv.LLLL.vvvvv",
        ".vvvvLwkkwLvvvv.",
        "..vvvLLccLLvvv..",
        "...vvLLccLLvv...",
        "......LLLL......",
        ".....K....K.....",
      ],
      down: [
        "................",
        "................",
        ".......LL.......",
        "......LLLL......",
        "..vvvLwkkwLvvv..",
        ".vvvvLLccLLvvvv.",
        "vvvvvLLccLLvvvvv",
        "vvv...LLLL...vvv",
        "vv...K....K...vv",
      ],
      // Swoop: wings fold into a dart.
      dart: [
        "......LLLL......",
        ".....vwkkwv.....",
        "....vvLccLvv....",
        "...vvvLccLvvv...",
        "....vvvLLvvv....",
        "......LLLL......",
        ".......KK.......",
      ],
      // Carrying a pixel: beak open (cackling "MINE!").
      carryUp: [
        "vv............vv",
        "vvv..........vvv",
        "vvvv...LL...vvvv",
        "vvvvv.LLLL.vvvvv",
        ".vvvvLwkkwLvvvv.",
        "..vvvLLccLLvvv..",
        "...vvLLkkLLvv...",
        "......LccL......",
        ".....KK..KK.....",
      ],
      carryDown: [
        "................",
        "................",
        ".......LL.......",
        "......LLLL......",
        "..vvvLwkkwLvvv..",
        ".vvvvLLccLLvvvv.",
        "vvvvvLLkkLLvvvvv",
        "vvv...LccL...vvv",
        "vv...KK..KK...vv",
      ],
      stun: [
        "................",
        "v..............v",
        "vv.....LL.....vv",
        "vvv...LLLL...vvv",
        ".vvvvLkwwkLvvvv.",
        "..vvvLLccLLvvv..",
        "...vvLLccLLvv...",
        "......LLLL......",
        ".....K....K.....",
      ],
    },
  },
  slurp: {
    skin: "b",
    maxD: 2,
    silhouette: "wide",
    frames: {
      // Half-lidded (the lid is pond-dark over the top half of each eye).
      idle0: [
        "..bbbbb....bbbbb..",
        ".bbBBBbb..bbBBBbb.",
        ".bbwkkbbbbbbwkkbb.",
        ...SLURP_BODY,
        "bbbbbbkTTTTkbbbbbb",
        "bbbbbbbTTTTbbbbbbb",
        ".BBB..........BBB.",
      ],
      awake: [
        "..bbbbb....bbbbb..",
        ".bbwwwbb..bbwwwbb.",
        ".bbwkkbbbbbbwkkbb.",
        ...SLURP_BODY,
        "bbbbbbkTTTTkbbbbbb",
        "bbbbbbbTTTTbbbbbbb",
        ".BBB..........BBB.",
      ],
      sleep: [
        "..bbbbb....bbbbb..",
        ".bbbbbbb..bbbbbbb.",
        ".bbkkkbbbbbbkkkbb.",
        ...SLURP_BODY,
        "bbbbbbbbbbbbbbbbbb",
        "bbbbbbbbbbbbbbbbbb",
        ".BBB..........BBB.",
      ],
      // Cheek puff: +2 voxels each side, mouth sealed.
      puff: [
        "....bbbbb....bbbbb....",
        "...bbwwwbb..bbwwwbb...",
        "...bbwkkbbbbbbwkkbb...",
        ".bbbbbbbbbbbbbbbbbbbb.",
        "bbbbbbbbbbbbbbbbbbbbbb",
        "bbbkkkkkkkkkkkkkkkkbbb",
        ".bbbbbbbbbbbbbbbbbbbb.",
        "..bbbbbbbbbbbbbbbbbb..",
        "...BBB..........BBB...",
      ],
      // Tongue out: the mouth gapes, the ribbon is a separate mesh.
      open: [
        "..bbbbb....bbbbb..",
        ".bbwwwbb..bbwwwbb.",
        ".bbwkkbbbbbbwkkbb.",
        "bbbbbbbbbbbbbbbbbb",
        "bbbkkkkkkkkkkkkbbb",
        "bkkkkkkTTTTkkkkkkb",
        "bbbkkkkTTTTkkkkbbb",
        "bbbbbbbbbbbbbbbbbb",
        ".BBB..........BBB.",
      ],
      // Sulk after the first hit: lids fully down, mouth a wobbly line.
      sulk: [
        "..bbbbb....bbbbb..",
        ".bbBBBbb..bbBBBbb.",
        ".bbBkkbbbbbbkkBbb.",
        "bbbbbbbbbbbbbbbbbb",
        "bbbbbbbbbbbbbbbbbb",
        "bbbbbkkkbbbbkkkbbb",
        "bbbbkbbbkkkkbbbkbb",
        "bbbbbbbbbbbbbbbbbb",
        ".BBB..........BBB.",
      ],
    },
  },
  fizz: {
    skin: "p",
    maxD: 2,
    silhouette: "spiky",
    frames: {
      idle0: ["....K...", ".p..K.p.", ".pppppp.", "ppkppkpp", ".pppppp.", "pppkkppp", ".pppppp.", ".p.pp.p."],
      idle1: ["...K....", ".p..K.p.", ".pppppp.", "ppkppkpp", ".pppppp.", "pppppppp", ".pppppp.", ".p.pp.p."],
      // Fused: eyes wide, teeth-gritting grin.
      fused: ["....K...", ".p..K.p.", ".pppppp.", "pkkppkkp", ".pppppp.", "ppkkkkpp", ".pppppp.", ".p.pp.p."],
      stun: ["....K...", ".p..K.p.", ".pppppp.", "pkpppkpp", ".pppppp.", "ppkpkkpp", ".pppppp.", ".p.pp.p."],
    },
  },
};

/** Width and height (voxels) of a sprite frame. */
export function spriteSize(rows: readonly string[]): { w: number; h: number } {
  return { w: Math.max(0, ...rows.map((r) => r.length)), h: rows.length };
}
