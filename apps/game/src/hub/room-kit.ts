/**
 * Hub-only voxel pieces the world kit doesn't have (fountain, wide cloud bridges, gate arches, stages, statues,
 * planters, the Mend Well). They are written into one VoxelMesher per room so the extras cost a single draw call.
 * Same palette and styles as the kit; positions in room world units, y = 0 is the walking surface.
 */
import { Euler } from "three";
import { PALETTE } from "../stage/palette";
import { DECOR, SOFT, TERRAIN, type VoxelMesher } from "../world/voxel-mesher";
import { hash3 } from "../world/noise";

/** A fountain (plaza centre): sun rim, pond basin, paper jets. `r` = outer radius in world units. */
export function fountain(m: VoxelMesher, x: number, z: number, r: number): void {
  const c = 0.2;
  const g = m.grid(c, [x, c / 2, z]);
  const n = Math.ceil(r / c);
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      const d = Math.sqrt(i * i + k * k) * c;
      if (d > r) continue;
      if (d > r - 0.45) {
        g.set(i, 0, k, PALETTE.sun, TERRAIN);
        g.set(i, 1, k, d > r - 0.25 ? PALETTE.sun : PALETTE.paper, TERRAIN);
      } else {
        g.set(i, -1, k, PALETTE.pondLight, TERRAIN);
        g.set(i, 0, k, hash3(i, k, 3) > 0.86 ? PALETTE.pondGlint : PALETTE.pond, TERRAIN);
      }
    }
  // Centre column + stepped paper jets (static: the plaza is calm, the Friends are the motion).
  for (let k = 1; k <= 5; k++) g.set(0, k, 0, k < 4 ? PALETTE.stone : PALETTE.paper, TERRAIN);
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    g.set(dx, 5, dz, PALETTE.paper, SOFT);
    g.set(dx * 2, 4, dz * 2, PALETTE.pondGlint, SOFT);
    g.set(dx * 3, 2, dz * 3, PALETTE.pondGlint, SOFT);
  }
}

/**
 * A wide plank bridge between two ground points (world units), `half` = half width. Alternating coral planks with
 * ink posts every third plank and a gentle sag (art bible §4.1).
 */
export function wideBridge(
  m: VoxelMesher,
  from: { x: number; z: number },
  to: { x: number; z: number },
  half: number,
): void {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.1) return;
  const ux = dx / len;
  const uz = dz / len;
  const yaw = Math.atan2(ux, uz);
  const n = Math.max(2, Math.ceil(len / 0.26));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const sag = Math.sin(t * Math.PI) * 0.14;
    const cx = from.x + dx * t;
    const cz = from.z + dz * t;
    m.box([cx, -0.05 - sag, cz], [half * 2, 0.1, 0.22], i % 2 ? PALETTE.coral : PALETTE.coralDark, TERRAIN, {
      rotation: new Euler(0, yaw, 0),
    });
    if (i % 3 === 0)
      for (const s of [-1, 1]) {
        const px = cx + s * uz * (half + 0.05);
        const pz = cz - s * ux * (half + 0.05);
        m.box([px, 0.15 - sag, pz], [0.07, 0.42, 0.07], PALETTE.ink, TERRAIN);
      }
  }
  // Rope rails: thin ink runs between posts, stepped (no curves).
  for (const s of [-1, 1])
    for (let i = 0; i < n - 1; i++) {
      const t = (i + 1) / n;
      const sag = Math.sin(t * Math.PI) * 0.14;
      m.box(
        [from.x + dx * t + s * uz * (half + 0.05), 0.3 - sag, from.z + dz * t - s * ux * (half + 0.05)],
        [0.04, 0.04, 0.26],
        PALETTE.ink,
        DECOR,
        { rotation: new Euler(0, yaw, 0) },
      );
    }
}

/** A gate arch over a room door: two paper posts on ink plinths, a coral lintel. `yaw` faces the arch. */
export function gateArch(
  m: VoxelMesher,
  x: number,
  z: number,
  half: number,
  yaw: number,
  lintel = PALETTE.coral,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (lx: number): [number, number] => [x + lx * c, z - lx * s];
  for (const side of [-1, 1]) {
    const [px, pz] = at(side * half);
    for (let k = 0; k < 8; k++) m.box([px, 0.1 + k * 0.2, pz], [0.2, 0.2, 0.2], k === 0 ? PALETTE.ink : PALETTE.paper);
  }
  for (let i = -Math.round(half / 0.2) - 1; i <= Math.round(half / 0.2) + 1; i++) {
    const [px, pz] = at(i * 0.2);
    m.box([px, 1.7, pz], [0.2, 0.2, 0.2], lintel);
    if (Math.abs(i) <= 1) m.box([px, 1.9, pz], [0.2, 0.2, 0.2], PALETTE.coralDark);
  }
}

/** A flush emote stage: a sun-rimmed paper/tile checker disc 3 cm proud of the ground. */
export function stageDisc(m: VoxelMesher, x: number, z: number, r: number): void {
  const c = 0.24;
  const n = Math.ceil(r / c);
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      const d = Math.sqrt(i * i + k * k) * c;
      if (d > r) continue;
      const rim = d > r - c;
      const chk = ((Math.floor(i / 2) + Math.floor(k / 2)) & 1) === 1;
      m.box(
        [x + i * c, 0.015, z + k * c],
        [c, 0.03, c],
        rim ? PALETTE.sun : chk ? PALETTE.lilac : PALETTE.paper,
        DECOR,
        {
          skipBottom: true,
        },
      );
    }
}

/** A statue: a stone plinth with a 16×16 ink icon extruded on top (the fling statue, the seed planter sign). */
export function statue(m: VoxelMesher, x: number, z: number, icon: readonly string[], px = 0.11): void {
  const c = 0.2;
  for (let i = -3; i <= 3; i++)
    for (let k = -3; k <= 3; k++)
      for (let y = 0; y < 2; y++)
        if (Math.abs(i) + Math.abs(k) < 6) m.box([x + i * c, 0.1 + y * c, z + k * c], [c, c, c], PALETTE.stone);
  const g = m.grid(px, [x - 7.5 * px, 0.4 + px / 2, z]);
  let bottom = 0;
  icon.forEach((row, r) => {
    if (row.includes("#")) bottom = r;
  });
  icon.forEach((row, r) =>
    [...row].forEach((ch, col) => {
      if (ch === "#") g.set(col, bottom - r, 0, PALETTE.body, TERRAIN);
    }),
  );
}

/** A planter box with meadow top and flowers. */
export function planter(m: VoxelMesher, x: number, z: number, r: number): void {
  const c = 0.2;
  const n = Math.round(r / c);
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      if (i * i + k * k > n * n) continue;
      const edge = i * i + k * k > (n - 1) * (n - 1);
      m.box([x + i * c, 0.1, z + k * c], [c, c, c], edge ? PALETTE.coral : PALETTE.meadow);
      if (!edge && hash3(i, k, 11) > 0.72)
        m.box(
          [x + i * c, 0.26, z + k * c],
          [0.1, 0.12, 0.1],
          [PALETTE.sun, PALETTE.lilac, PALETTE.paperWarm][(i + k + 9) % 3] ?? PALETTE.sun,
          DECOR,
        );
    }
}

/** The Mend Well: a pond ring with a paper/coral rim (bubbles are DOM, tappable). */
export function mendWell(m: VoxelMesher, x: number, z: number, r: number): void {
  const c = 0.2;
  const g = m.grid(c, [x, c / 2, z]);
  const n = Math.ceil(r / c);
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      const d = Math.sqrt(i * i + k * k) * c;
      if (d > r) continue;
      if (d > r - 0.3) {
        g.set(i, 0, k, (i + k) % 2 ? PALETTE.coral : PALETTE.paper);
        g.set(i, 1, k, PALETTE.coral);
      } else g.set(i, -1, k, hash3(i, k, 5) > 0.88 ? PALETTE.pondGlint : PALETTE.pond);
    }
}
