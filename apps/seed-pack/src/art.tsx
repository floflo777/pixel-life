import type { Rarity } from "./economy";

/** Palette keys used by the 16×16 sprites (art bible §1.1). Gold is reserved for the Gold Pixel. */
export const PALETTE: Readonly<Record<string, string>> = {
  k: "#111111", // ink
  p: "#EEEEEE", // paper
  g: "#B9D984", // meadow
  G: "#86B05A", // meadow tuft (stem)
  c: "#ED927E", // coral
  l: "#B3A0D8", // lilac
  s: "#F2CE68", // sun
  b: "#3A3140", // trunk / soil
  o: "#E8B530", // gold (Gold Pixel only)
  w: "#FFF8E4", // gold specular
  O: "#806524", // gold shade = gold × (0.55, 0.56, 0.76)
};

/** 16×16 pixel sprites; `.` is transparent. Every row is exactly 16 cells (unit-tested). */
export const SPRITES = {
  sprout: [
    "................",
    "................",
    "................",
    "................",
    ".....kk...kk....",
    "....kggk.kggk...",
    "....kgggkgggk...",
    ".....kgGkGgk....",
    "......kkGkk.....",
    "........G.......",
    "........G.......",
    "........G.......",
    ".....kkkkkkk....",
    "....kbbbbbbbk...",
    "....kkkkkkkkk...",
    "................",
  ],
  bloom: [
    "................",
    "......kkkk......",
    ".....kcccck.....",
    "...kkkcccckkk...",
    "..kcccksskccck..",
    "..kcccksskccck..",
    "...kkkcccckkk...",
    ".....kcccck.....",
    "......kkkk......",
    "........G.......",
    "....kk..G..kk...",
    "...kggk.G.kggk..",
    "....kggkGkggk...",
    ".....kkkGkkk....",
    ".....kbbbbbk....",
    ".....kkkkkkk....",
  ],
  fullBloom: [
    ".......kk.......",
    "....kkkllkkk....",
    "...kllksskllk...",
    "...kssssssssk...",
    "...kssccccssk...",
    "..klsscsscsslk..",
    ".klsscsssscsslk.",
    "..klsscsscsslk..",
    "...kssccccssk...",
    "...kssssssssk...",
    "...kllksskllk...",
    "....kkkGGkkk....",
    "....kggGGkk.....",
    ".....kkGGggk....",
    "......kGGkk.....",
    ".......kk.......",
  ],
  goldPixel: [
    "..............w.",
    ".............www",
    "..kkkkkkkkkkkkw.",
    "..kwwwwwwwwwOk..",
    "..kwwoooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kwooooooooOk..",
    "..kOOOOOOOOOOk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
  ],
  pack: [
    "...kkkkkkkkkk...",
    "...kpkpkpkpkk...",
    "...kkkkkkkkkk...",
    "...kppppppppk...",
    "...kpppkkpppk...",
    "...kppkggkppk...",
    "...kpppkGkppk...",
    "...kppppGpppk...",
    "...kpppkkkppk...",
    "...kppppppppk...",
    "...kssssssssk...",
    "...kskkskskkk...",
    "...kssssssssk...",
    "...kppppppppk...",
    "...kkkkkkkkkk...",
    "................",
  ],
} as const satisfies Record<string, readonly string[]>;

export type SpriteName = keyof typeof SPRITES;

/** Sprite for an outcome's rarity tier; the tier ranking lives in economy.ts. */
export function spriteForRarity(rarity: Rarity): SpriteName {
  return rarity === "legendary"
    ? "goldPixel"
    : rarity === "rare"
      ? "fullBloom"
      : rarity === "uncommon"
        ? "bloom"
        : "sprout";
}

/** Crisp multi-colour 16×16 sprite as one SVG; one path per colour keeps the DOM small. */
export function PixelArt({ name, className, title }: { name: SpriteName; className?: string; title?: string }) {
  const rows = SPRITES[name];
  const paths = new Map<string, string>();
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === ".") return;
      paths.set(cell, `${paths.get(cell) ?? ""}M${x} ${y}h1v1h-1z`);
    });
  });
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {[...paths].map(([cell, d]) => (
        <path key={cell} d={d} fill={PALETTE[cell] ?? "#111111"} />
      ))}
    </svg>
  );
}
