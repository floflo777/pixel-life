/**
 * Adapter from the sim's creature view (`SimCreatureView`) to the creatures module (`createCreatureView`): sim state →
 * `setState`, heading → `setFacing`, hits → `playHit`, smashes → `playSmash` (the scene keeps the view until the
 * shatter has played). This is the venue's default creature factory; tests and dev pages can still inject their own.
 */
import type { Vector3 } from "three";
import type { SimCreatureView } from "@pl/shared";
import { createCreatureView, kindOf, viewStateFromSim, type CreatureState } from "../../creatures";
import type { CreatureFactory, CreatureVisual } from "./scene";

/** Creature voxel edge in the run scene (world units): Munchies read about as big as the 16-voxel Friend (frame 1). */
export const RUN_CREATURE_VOXEL = 0.11;

/** Sim heading (0..4095, 0 = +x, 1024 = +z) as a ground-plane direction. */
export function facingDir(facing: number): { dx: number; dz: number } {
  const a = (facing / 4096) * Math.PI * 2;
  return { dx: Math.cos(a), dz: Math.sin(a) };
}

/** Widest turn away from the camera (radians): faces stay readable (frame 1 shows Munchies in three-quarter view). */
export const MAX_TURN = (35 * Math.PI) / 180;

/**
 * A heading turned toward the camera (+z): keeps the side the creature moves to, but never more than `MAX_TURN` from
 * facing the viewer, so a creature running sideways shows a three-quarter face instead of its pillowed flank.
 */
export function cameraFacing(dx: number, dz: number): { dx: number; dz: number } {
  const yaw = Math.max(-MAX_TURN, Math.min(MAX_TURN, Math.atan2(dx, Math.abs(dz) < 1e-9 ? 0 : Math.max(dz, 0))));
  return { dx: Math.sin(yaw), dz: Math.cos(yaw) };
}

/** The view state for a live sim creature (never "smashed": smashes arrive as events, see `CreatureVisual.smash`). */
export function runCreatureState(c: SimCreatureView): CreatureState {
  return viewStateFromSim({ kind: c.kind, state: c.state, stun: c.stun, spawn: c.spawning, dead: false });
}

/** Builds real Munchie visuals (pillowed voxels, stepped poses, speech lines). */
export function createRealCreatureFactory(voxel = RUN_CREATURE_VOXEL): CreatureFactory {
  return (kind: number, id = 0): CreatureVisual => {
    const view = createCreatureView(kindOf(kind), { voxel, seed: id });
    let smashing = false;
    return {
      object: view.object,
      speaks: true,
      get finished() {
        return smashing && view.finished;
      },
      update(c, t) {
        if (!smashing) {
          view.setState(runCreatureState(c));
          const d = facingDir(c.facing);
          const f = cameraFacing(d.dx, d.dz);
          view.setFacing(f.dx, f.dz);
        }
        view.update(t.dt);
      },
      tick(dt) {
        view.update(dt);
      },
      hit() {
        if (!smashing) view.playHit();
      },
      smash() {
        smashing = true;
        view.playSmash();
      },
      attack(target: Vector3 | null) {
        view.setTarget(target);
        view.playAttack();
      },
      onSpeak(cb) {
        return view.onSpeak((line) => cb(line.text, line.duration));
      },
      dispose() {
        view.dispose();
      },
    };
  };
}
