/**
 * Door triggering (pure): walking onto a door zone fires once; you must step off it before it can fire again (so
 * arriving on a bridge stub or returning from a venue never bounces you straight back).
 */
import { pointInPolygon, type Polygon, type Vec2 } from "@pl/realtime";

/** A door zone in wire units: a room bridge, a venue doormat. */
export interface DoorZone {
  readonly id: string;
  readonly kind: "room" | "venue";
  /** Room slug or venue id. */
  readonly target: string;
  readonly mode?: string;
  readonly area: Polygon;
}

/** Edge-triggered door detector for the local Friend. */
export class DoorTracker {
  #inside: string | null = null;
  #armed = false;

  /** Zones of the current room. Starts disarmed until the Friend has stood outside every zone once. */
  constructor(private zones: readonly DoorZone[] = []) {}

  /** Switches room: new zones, disarmed. */
  reset(zones: readonly DoorZone[]): void {
    this.zones = zones;
    this.#inside = null;
    this.#armed = false;
  }

  /** The zone containing `p`, if any. */
  zoneAt(p: Vec2): DoorZone | undefined {
    return this.zones.find((z) => pointInPolygon(p, z.area));
  }

  /** Feeds the Friend's position; returns the door just entered (once per entry), else null. */
  update(p: Vec2): DoorZone | null {
    const z = this.zoneAt(p);
    if (!z) {
      this.#inside = null;
      this.#armed = true;
      return null;
    }
    if (this.#inside === z.id) return null;
    this.#inside = z.id;
    return this.#armed ? z : null;
  }
}
