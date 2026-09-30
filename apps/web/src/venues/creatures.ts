/**
 * Adapter from the creatures module (`createCreatureView`, pillowed voxel Munchies, art bible §5) to the Loose Pixels
 * venue's `CreatureFactory` seam: the venue hands each visual the interpolated sim creature every frame, and the
 * adapter turns it into view state, heading and one-shot hit reactions.
 */
import type { CreatureFactory, CreatureVisual } from "@pl/game";
import * as game from "@pl/game";

/** The sim creature the venue passes to `CreatureVisual.update`. */
export type SimCreature = Parameters<CreatureVisual["update"]>[0];

/** The run scene's world units per sim unit (the Friend's voxel). */
const RUN_UNIT = 0.15;
/** Style frame 1 puts 0.10 u creature voxels next to a 0.13 u Friend: keep that ratio at the run scale. */
export const RUN_CREATURE_VOXEL = (RUN_UNIT * 0.1) / 0.13;

/** Heading (x, z) on the ground for a sim `facing` (0..4095, 0 = +x, 1024 = +z). */
export function headingOf(facing: number): readonly [number, number] {
  const a = (facing / 4096) * 2 * Math.PI;
  return [Math.cos(a), Math.sin(a)];
}

/** True when a creature just took damage (hp went down, or it was freshly stunned), so the view plays a hit flash. */
export function tookHit(prev: SimCreature | null, cur: SimCreature): boolean {
  if (!prev) return false;
  return cur.hp < prev.hp || (cur.stun > 0 && prev.stun <= 0);
}

/** Builds a `CreatureFactory` over the real creature views (`@pl/game` creatures). */
export function realCreatureFactory(
  mod: Pick<typeof game, "createCreatureView" | "kindOf" | "viewStateFromSim"> = game,
): CreatureFactory {
  let seed = 0;
  return (kind: number): CreatureVisual => {
    const view = mod.createCreatureView(mod.kindOf(kind), { voxel: RUN_CREATURE_VOXEL, seed: ++seed });
    let prev: SimCreature | null = null;
    return {
      object: view.object,
      update(c, t) {
        view.setState(
          mod.viewStateFromSim({ kind: c.kind, state: c.state, stun: c.stun, spawn: c.spawning, dead: false }),
        );
        const [dx, dz] = headingOf(c.facing);
        view.setFacing(dx, dz);
        if (tookHit(prev, c)) view.playHit();
        prev = c;
        view.update(t.dt);
      },
      dispose() {
        view.dispose();
      },
    };
  };
}
