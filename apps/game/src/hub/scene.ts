/**
 * `createHubScene` (architecture §2.1, GDD §11–12): the Club Penguin-like hub, The Sky (D-14). Rooms from the world kit, your
 * Friend on click-to-move / stick / keys, everyone else interpolated from the room's `moved` segments, voxel Friends
 * near you and one instanced impostor crowd beyond, name tags under feet, emote and quick-chat bubbles, venue and room
 * doors, resting offline Friends, Mend taps and sparkles, hub music and footsteps. Rendering and IO live here; the
 * decisions (intents, bubbles, LOD, camera, doors, walking) are the pure modules next to it.
 */
import { BoxGeometry, Mesh, Plane, Raycaster, Vector2, Vector3, type MeshLambertMaterial } from "three";
import { createBandMaterial } from "../post/band-material";
import {
  EMOTES,
  EMPTY_MASK,
  effectiveLost,
  frontMask,
  popcount,
  wholeAt,
  type ClientMsg,
  type EmoteName,
  type Facing,
  type FriendAppearance,
  type FriendPublic,
  type Hex64,
  type RoomSlug,
  type ServerMsg,
  type SkyFriend,
  type TokenIdStr,
} from "@pl/shared";
import { PresenceBuffer, INTERPOLATION_DELAY_MS, type Vec2 } from "@pl/realtime/client";
import type { CueName } from "@pl/audio";
import type { VenueIdentity } from "@pl/venue-kit";
import { buildFriendModel, PoseClock, resolvePose } from "../friend";
import { tagGlow, type HaloTint } from "../post/tags";
import type { SharedStage } from "../stage/stage";
import { PALETTE } from "../stage/palette";
import { DAY_SKY } from "../post/post-pipeline";
import { HUB_POSE, pixelsPerUnit } from "../stage/camera-rig";
import { attachProjectedShadow, type ProjectedShadow } from "../world/projected-shadow";
import { BubbleBoard } from "./bubbles";
import { deadZoneFor, FOLLOW, followGoal } from "./camera";
import { facingFromHeading, plateYaw, toWire, toWorld, WORLD_PER_WIRE } from "./coords";
import { DoorTracker, type DoorZone } from "./doors";
import { emoteFrame, type EmoteFrame } from "./emotes";
import { HubFx } from "./fx";
import { ImpostorCrowd, spritePixels } from "./impostors";
import { classifyTap, screenToGround, stickAxis, type FriendHitBox } from "./intents";
import { NEAR_BUDGET, selectNear, selectTags, type LodCandidate } from "./lod";
import type { HubNet, HubNetState } from "./net";
import { HubOverlay, type BubbleView, type ScreenPos, type TagView, type WellBubble } from "./overlay";
import { EMOTE_COOLDOWN_MS, EMOTE_GLYPH, emoteId, emoteName, phraseText } from "./phrases";
import { buildRoom, type RoomLabel, type RoomView } from "./rooms";
import { dailyCountdown, haloTint, statusLine } from "./status";
import type { FlingBelt, FriendModelFactory, HubFriendModel, HubScene, HubSceneOptions, HubStats } from "./types";
import { LocalWalker } from "./walker";

/** World units per sprite pixel in the hub (art bible §2: 0.15). */
export const HUB_PIXEL = 0.15;
/** Plate tilt: pitched back so the front face stays ≤ 20° off the view vector at the 28° hub pitch. */
const PLATE_TILT = (18 * Math.PI) / 180;
/** Visible width the rig keeps at the focus (frame 2: ~19 u across). */
const VISIBLE_WIDTH = 19;

const EMOTE_CUE: Readonly<Record<EmoteName, CueName>> = {
  wave: "emote.wave",
  hop: "emote.hop",
  spin: "emote.spin",
  heart: "emote.heart",
  "pixel-burst": "emote.burst",
  sit: "emote.sit",
  flex: "emote.flex",
  stomp: "emote.stomp",
};

/** The default factory: the voxel Friend from `../friend`. */
export const voxelFriendFactory: FriendModelFactory = (a, lost, opts) => buildFriendModel(a, lost, opts);

/** Belt colours (GDD §12.4 ladder; Gulp Master wears a paper-cloud band). */
const BELT_COLORS: Readonly<Record<FlingBelt, number>> = {
  white: PALETTE.paper,
  yellow: PALETTE.sun,
  orange: PALETTE.coral,
  green: PALETTE.meadowTuft,
  blue: PALETTE.pond,
  red: PALETTE.coralDark,
  brown: PALETTE.trunk,
  purple: PALETTE.lilacDark,
  black: PALETTE.ink,
  "gulp-master": PALETTE.cloud,
};

/** Halo colours per streak tier for the geometric halo (gold-white shows as gold on meshes; the far crowd animates). */
const HALO_HEX: Readonly<Record<HaloTint, number>> = {
  halo: PALETTE.halo,
  paper: PALETTE.paper,
  sun: PALETTE.sun,
  coral: PALETTE.coral,
  lilac: PALETTE.lilac,
  goldWhite: PALETTE.gold,
};

interface Actor {
  readonly key: string;
  entityId: string | null;
  readonly tokenId: TokenIdStr;
  readonly kind: "you" | "remote" | "resting";
  loaned: boolean;
  venue: string | null;
  appearance: FriendAppearance | null;
  pub: FriendPublic | null;
  presenceGold: number;
  lost: Hex64;
  lostPx: number;
  healsInMs: number | null;
  halo: HaloTint;
  x: number;
  z: number;
  facing: Facing;
  walking: boolean;
  readonly clock: PoseClock;
  frame: number;
  emote: { name: EmoteName; start: number; impactDone: boolean } | null;
  model: HubFriendModel | null;
  modelLod: 0 | 1;
  shadow: ProjectedShadow | null;
  belt: Mesh | null;
  height: number;
  width: number;
  /** Last screen box (CSS px) for tap picking. */
  box: FriendHitBox | null;
  hidden: boolean;
}

/** Points every projected shadow child at its source mesh's current geometry (models swap geometry per pose). */
function syncShadows(root: { traverse(cb: (o: unknown) => void): void }): void {
  root.traverse((o) => {
    const m = o as {
      isMesh?: boolean;
      geometry?: unknown;
      children?: { userData: Record<string, unknown>; geometry?: unknown }[];
    };
    if (!m.isMesh || !m.children) return;
    for (const c of m.children) if (c.userData["plShadow"]) c.geometry = m.geometry;
  });
}

/**
 * Creates the hub on a shared stage. Call `enter()` to join the starting room; `identity()` is read on every join and
 * for your own Friend's state. Nothing is shown until the first `enter`.
 */
export function createHubScene(
  stage: SharedStage,
  net: HubNet,
  identity: () => VenueIdentity,
  opts: HubSceneOptions,
): HubScene {
  const now = opts.now ?? (() => Date.now());
  const build = opts.buildFriend ?? voxelFriendFactory;
  const audio = opts.audio;
  const unlocked = new Set<EmoteName>(opts.unlockedEmotes ?? EMOTES);
  const canvas = stage.renderer.domElement;
  const host =
    opts.overlay ??
    ((): HTMLElement => {
      const parent = canvas.parentElement ?? document.body;
      const d = document.createElement("div");
      d.style.cssText = "position:absolute;inset:0;pointer-events:none";
      parent.appendChild(d);
      return d;
    })();
  const ownsHost = opts.overlay === undefined;

  // Moves carry an increasing sequence number (the room drops stale or replayed ones).
  let seq = 0;
  const send = (m: ClientMsg): void => {
    if (m[0] === "move") {
      seq = (seq + 1) >>> 0;
      net.send(["move", seq, m[2], m[3]]);
    } else net.send(m);
  };
  const presence = new PresenceBuffer();
  const bubbles = new BubbleBoard();
  const fx = new HubFx();
  const crowd = new ImpostorCrowd();
  const walker = new LocalWalker(
    { contains: () => false, clip: (a) => a, findPath: () => null, nearestWalkable: () => null },
    [0, 0],
  );
  const doors = new DoorTracker();
  const enabledVenues = opts.venues ? new Set(opts.venues) : undefined;
  const actors = new Map<string, Actor>();
  const rooms = new Map<RoomSlug, RoomView>();
  const mutedTokens = new Set<TokenIdStr>();
  const mendedByYou = new Set<TokenIdStr>();
  const venueCounts = new Map<string, number>();
  let restingList: readonly SkyFriend[] = [];
  let view: RoomView | null = null;
  let room: RoomSlug | null = null;
  let youId: string | null = null;
  let near = new Set<string>();
  let selected: string | null = null;
  let transitioning = false;
  let disposed = false;
  let dragging = false;
  let keySteer = false;
  let lastEmoteAt = -Infinity;
  let lastSayAt = -Infinity;
  let lastNetState: HubNetState | null = null;
  let lastLostRefresh = 0;
  let venueZone: DoorZone | null = null;
  let undecorate: (() => void) | null = null;
  const beltMats = new Map<FlingBelt, MeshLambertMaterial>();
  const beltMaterial = (b: FlingBelt): MeshLambertMaterial => {
    let m = beltMats.get(b);
    if (!m) beltMats.set(b, (m = createBandMaterial({ color: BELT_COLORS[b] ?? PALETTE.paper, lightMix: 0.3 })));
    return m;
  };
  const stats: HubStats = {
    presences: 0,
    resting: 0,
    near: 0,
    far: 0,
    impostorPixels: 0,
    tags: 0,
    bubbles: 0,
    frameMs: 0,
  };

  stage.scene.add(crowd.mesh, fx.markers, fx.sparkles);
  attachProjectedShadow(crowd.mesh);
  const rig = stage.rig;
  // Pulled back from frame 1's 21 u so the whole plaza reads (sprite pixels stay ≥ 3 render px: the readability rule).
  rig.pose = { ...HUB_POSE, distance: 26 };
  // Fog only beyond the plaza's far rim: Friends at the back must never dither into the sky.
  stage.post.setSky({ ...DAY_SKY, fogStart: 12, fogEnd: 36 });
  rig.baseYaw = HUB_POSE.yaw;
  rig.followRate = FOLLOW.rate;
  rig.minVisibleWidth = VISIBLE_WIDTH;
  rig.deadZone = deadZoneFor(VISIBLE_WIDTH, stage.reducedMotion);
  stage.post.haloWidth = 1;

  const overlay = new HubOverlay(host, {
    onDoor: (id) => walkToDoor(id),
    onWell: (tokenId) => opts.onMendRequest?.(tokenId),
  });

  // ── Friend state ─────────────────────────────────────────────────────────────────────────────────────────────
  const recompute = (a: Actor): void => {
    const t = now();
    if (!a.pub || !a.appearance) return;
    const front = frontMask(a.appearance);
    const gold = { goldHeld: a.pub.goldHeld };
    let lost = effectiveLost(a.pub.scars, t, a.tokenId, gold);
    // Defensive: a stale mask outside the front would draw paper holes in empty space.
    if (popcount(lost) > popcount(front)) lost = EMPTY_MASK;
    a.lost = lost;
    a.lostPx = popcount(lost);
    const w = a.lostPx > 0 ? wholeAt(a.pub.scars, t, a.tokenId, gold) : null;
    a.healsInMs = w === null ? null : Math.max(0, w - t);
    a.halo = haloTint(a.pub.streak);
    if (a.model) {
      a.model.setLost(lost);
      a.model.setGold?.(Math.max(a.pub.goldHeld, a.presenceGold));
      a.model.setStitched?.(a.pub.stitched ?? EMPTY_MASK);
      a.model.setHaloColor?.(HALO_HEX[a.halo]);
      syncShadows(a.model.object);
    }
  };

  const sizeFromAppearance = (a: Actor): void => {
    if (!a.appearance) return;
    const px = spritePixels(frontMask(a.appearance), EMPTY_MASK);
    a.height = Math.max(4, px.height) * HUB_PIXEL;
    let minC = 16;
    let maxC = -1;
    for (let k = 0; k < px.count; k++) {
      const c = px.cells[k * 3] as number;
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
    }
    a.width = Math.max(4, maxC - minC + 1) * HUB_PIXEL;
  };

  const load = (a: Actor): void => {
    const you = a.kind === "you" ? identity().friend : null;
    if (you) {
      a.appearance = you.appearance;
      a.pub = you.pub;
      a.loaned = you.loaned;
      sizeFromAppearance(a);
      recompute(a);
      return;
    }
    opts.friends.appearance(a.tokenId).then(
      (ap) => {
        if (actors.get(a.key) !== a) return;
        a.appearance = ap;
        sizeFromAppearance(a);
        recompute(a);
      },
      () => undefined,
    );
    if (!a.pub)
      opts.friends.publicState(a.tokenId).then(
        (p) => {
          if (actors.get(a.key) !== a) return;
          a.pub = p;
          recompute(a);
        },
        () => undefined,
      );
  };

  const makeActor = (key: string, kind: Actor["kind"], tokenId: TokenIdStr, x: number, z: number): Actor => ({
    key,
    entityId: null,
    tokenId,
    kind,
    loaned: false,
    venue: null,
    appearance: null,
    pub: null,
    presenceGold: 0,
    lost: EMPTY_MASK,
    lostPx: 0,
    healsInMs: null,
    halo: "halo",
    x,
    z,
    facing: "down",
    walking: false,
    clock: new PoseClock(),
    frame: 0,
    emote: null,
    model: null,
    modelLod: 1,
    shadow: null,
    belt: null,
    height: 2,
    width: 1.8,
    box: null,
    hidden: false,
  });

  const dropModel = (a: Actor): void => {
    if (!a.model) return;
    a.belt?.geometry.dispose();
    a.belt = null;
    a.shadow?.dispose();
    a.shadow = null;
    a.model.object.removeFromParent();
    a.model.dispose();
    a.model = null;
  };

  const removeActor = (key: string): void => {
    const a = actors.get(key);
    if (!a) return;
    dropModel(a);
    bubbles.remove(key);
    actors.delete(key);
  };

  const refreshFriend = (tokenId: TokenIdStr): void => {
    opts.friends.publicState(tokenId, true).then(
      (p) => {
        for (const a of actors.values())
          if (a.tokenId === tokenId) {
            a.pub = p;
            recompute(a);
          }
      },
      () => undefined,
    );
  };

  // ── Resting Friends ─────────────────────────────────────────────────────────────────────────────────────────
  const placeResting = (): void => {
    for (const k of [...actors.keys()]) if (k.startsWith("rest:")) removeActor(k);
    if (!view) return;
    const mine = identity().friend.appearance.tokenId;
    const list = [...restingList].filter((f) => f.tokenId !== mine).sort((p, q) => (p.tokenId < q.tokenId ? -1 : 1));
    list.slice(0, view.restingSpots.length).forEach((f, i) => {
      const spot = view?.restingSpots[i];
      if (!spot) return;
      const a = makeActor(`rest:${f.tokenId}`, "resting", f.tokenId, spot.x, spot.z);
      a.pub = f.pub;
      actors.set(a.key, a);
      load(a);
    });
  };

  // ── Network ─────────────────────────────────────────────────────────────────────────────────────────────────
  const onMsg = (m: ServerMsg): void => {
    presence.apply(m);
    const t = performance.now();
    switch (m[0]) {
      case "welcome": {
        youId = m[1];
        for (const k of [...actors.keys()]) if (actors.get(k)?.kind === "remote") removeActor(k);
        for (const e of m[2]) {
          if (e.id === youId) {
            walker.correct([e.x, e.z]);
            const you = actors.get("you");
            if (you) you.entityId = e.id;
            continue;
          }
          addRemote(e.id, e.tokenId, e.x, e.z, e.loaned, e.venue, e.goldHeld);
        }
        snapCamera();
        break;
      }
      case "join":
        if (m[1].id !== youId) addRemote(m[1].id, m[1].tokenId, m[1].x, m[1].z, m[1].loaned, m[1].venue, m[1].goldHeld);
        break;
      case "leave":
        removeActor(m[1]);
        break;
      case "moved":
        if (m[1] === youId && !walker.moving) {
          const d = Math.hypot(m[4] - walker.position[0], m[5] - walker.position[1]);
          if (d > 150) walker.correct([m[4], m[5]]);
        }
        break;
      case "emote": {
        if (m[1] === youId) break;
        const name = emoteName(m[2]);
        const a = actors.get(m[1]);
        if (name && a && !mutedTokens.has(a.tokenId)) playEmote(a, name, t);
        break;
      }
      case "say": {
        if (m[1] === youId) break;
        const text = phraseText(m[2]);
        const a = actors.get(m[1]);
        if (text && a && !mutedTokens.has(a.tokenId)) bubbles.push(a.key, "say", text, t);
        break;
      }
      case "venue": {
        const a = actors.get(m[1]);
        if (a) a.venue = m[2];
        break;
      }
      case "scars":
        refreshFriend(m[1]);
        break;
      case "mended": {
        const [, target, by, px] = m;
        if (by === identity().friend.appearance.tokenId) mendedByYou.add(target);
        for (const a of actors.values()) {
          if (a.tokenId === target) {
            fx.burst("sparkle", a.x, a.z, a.height, t);
            overlay.callout(`+${px} px`, project(a.x, a.height + 0.4, a.z), t);
            playEmote(a, "heart", t);
          } else if (a.tokenId === by) playEmote(a, "heart", t);
        }
        audio?.play("mend.chime");
        refreshFriend(target);
        break;
      }
      default:
        break;
    }
  };
  const offNet = net.on(onMsg);

  const addRemote = (
    id: string,
    tokenId: TokenIdStr,
    wx: number,
    wz: number,
    loaned: boolean,
    venue: string | null,
    gold: number,
  ): void => {
    removeActor(id);
    const p = toWorld(wx, wz);
    const a = makeActor(id, "remote", tokenId, p.x, p.z);
    a.entityId = id;
    a.loaned = loaned;
    a.venue = venue;
    a.presenceGold = gold;
    actors.set(id, a);
    load(a);
  };

  // ── Emotes & chat ───────────────────────────────────────────────────────────────────────────────────────────
  function playEmote(a: Actor, name: EmoteName, t: number): void {
    a.emote = { name, start: t, impactDone: false };
    bubbles.push(a.key, "emote", EMOTE_GLYPH[name], t);
    if (name === "pixel-burst") fx.burst("shards", a.x, a.z, a.height, t);
    if (name === "heart") fx.burst("heart", a.x, a.z, a.height, t);
    const you = actors.get("you");
    const dist = you ? Math.hypot(you.x - a.x, you.z - a.z) : 0;
    if (dist < 9) audio?.play(EMOTE_CUE[name], { x: screenX01(a), gain: a.kind === "you" ? 1 : 0.6 });
  }

  const emote = (name: EmoteName): boolean => {
    const t = performance.now();
    if (!unlocked.has(name) || t - lastEmoteAt < EMOTE_COOLDOWN_MS) return false;
    const you = actors.get("you");
    if (!you) return false;
    lastEmoteAt = t;
    send(["emote", emoteId(name)]);
    playEmote(you, name, t);
    return true;
  };

  const say = (id: number): boolean => {
    const t = performance.now();
    const text = phraseText(id);
    const you = actors.get("you");
    if (text === null || !you || t - lastSayAt < 2000) return false;
    lastSayAt = t;
    send(["say", id]);
    bubbles.push("you", "say", text, t);
    return true;
  };

  // ── Doors & rooms ───────────────────────────────────────────────────────────────────────────────────────────
  const walkToDoor = (doorId: string): void => {
    const z = view?.zones.find((d) => d.id === doorId);
    if (!z) return;
    const n = z.area.length || 1;
    const c: Vec2 = [z.area.reduce((s, p) => s + p[0], 0) / n, z.area.reduce((s, p) => s + p[1], 0) / n];
    walkToWire(c);
    audio?.play("ui.click");
  };

  const enterVenue = (z: DoorZone): void => {
    const you = actors.get("you");
    walker.stop();
    venueZone = z;
    if (you) you.venue = z.target;
    send(["venue", z.target]);
    audio?.play("door.enter");
    if (room) opts.onEnterVenue?.({ venueId: z.target, mode: z.mode ?? null, room });
  };

  const exitVenue = (): void => {
    const you = actors.get("you");
    if (you) you.venue = null;
    send(["venue", null]);
    const z = venueZone && view?.zones.find((d) => d.id === venueZone?.id);
    venueZone = null;
    if (z) walkToWire(z.spawn);
  };

  const snapCamera = (): void => {
    const you = actors.get("you");
    if (!view || !you) return;
    const p = toWorld(walker.position[0], walker.position[1]);
    you.x = p.x;
    you.z = p.z;
    const g = followGoal(p.x, p.z, null, view.bounds);
    rig.snap(new Vector3(g.x, g.y, g.z));
  };

  const enterRoom = async (slug: RoomSlug, from: RoomSlug | null): Promise<void> => {
    if (view) view.root.removeFromParent();
    for (const k of [...actors.keys()]) if (k !== "you") removeActor(k);
    bubbles.clear();
    fx.clear();
    near = new Set();
    selected = null;
    undecorate?.();
    undecorate = null;
    let v = rooms.get(slug);
    if (!v) rooms.set(slug, (v = buildRoom(slug, enabledVenues)));
    undecorate = opts.decorate?.(slug, v.root) ?? null;
    view = v;
    room = slug;
    stage.scene.add(v.root);
    overlay.setLabels(v.labels);
    doors.reset(v.zones);
    const arrival = (from ? v.navmesh.doorTo(from)?.spawn : undefined) ?? v.navmesh.data.spawns[0] ?? [0, 0];
    walker.reset(v.navmesh, arrival);
    let you = actors.get("you");
    // A new identity (guest → owner, another owned Friend) gets a fresh actor.
    if (you && you.tokenId !== identity().friend.appearance.tokenId) {
      removeActor("you");
      you = undefined;
    }
    if (!you) {
      you = makeActor("you", "you", identity().friend.appearance.tokenId, 0, 0);
      actors.set("you", you);
    }
    you.venue = null;
    load(you);
    snapCamera();
    restingList = [];
    if (opts.resting) {
      const r = opts.resting(slug);
      Promise.resolve(r).then(
        (list) => {
          if (room !== slug) return;
          restingList = list;
          placeResting();
        },
        () => undefined,
      );
    }
    opts.onState?.("connecting");
    try {
      await net.connect(slug, from);
    } catch (e) {
      opts.onState?.("error", e instanceof Error ? e.message : String(e));
      throw e;
    }
    snapCamera();
  };

  const changeRoom = (target: RoomSlug): void => {
    if (transitioning || disposed) return;
    transitioning = true;
    const from = room;
    walker.stop();
    audio?.play("door.enter");
    overlay
      .iris(() => enterRoom(target, from).catch(() => undefined), stage.reducedMotion)
      .finally(() => {
        transitioning = false;
        opts.onRoomChange?.(target);
      });
  };

  // ── Walking ─────────────────────────────────────────────────────────────────────────────────────────────────
  const walkToWire = (p: Vec2): boolean => {
    if (!view || transitioning) return false;
    const path = walker.walkTo(p);
    return path !== null;
  };

  // ── Projection helpers ──────────────────────────────────────────────────────────────────────────────────────
  const tmp = new Vector3();
  const project = (x: number, y: number, z: number): ScreenPos => {
    tmp.set(x, y, z).project(stage.camera);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h, visible: tmp.z < 1 && tmp.z > -1 };
  };
  function screenX01(a: Actor): number {
    tmp.set(a.x, 1, a.z).project(stage.camera);
    return Math.min(1, Math.max(0, (tmp.x + 1) / 2));
  }
  const ray = new Raycaster();
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const ndc = new Vector2();
  const groundAt = (ndcX: number, ndcY: number): Vector3 | null => {
    ndc.set(ndcX, ndcY);
    ray.setFromCamera(ndc, stage.camera);
    return ray.ray.intersectPlane(ground, new Vector3());
  };

  // ── Input ───────────────────────────────────────────────────────────────────────────────────────────────────
  const yawRad = (): number => (rig.pose.yaw * Math.PI) / 180;
  const offInput = stage.input.on((e) => {
    if (disposed || transitioning || !view) return;
    const you = actors.get("you");
    if (you?.venue) return;
    switch (e.type) {
      case "tap": {
        const boxes: FriendHitBox[] = [];
        for (const a of actors.values()) if (a.box && !a.hidden) boxes.push(a.box);
        const intent = classifyTap(e.at.x, e.at.y, boxes, []);
        if (intent.type === "mend") {
          selected = intent.key;
          opts.onMendRequest?.(intent.tokenId);
          audio?.play("ui.click");
        } else if (intent.type === "inspect") {
          selected = intent.key;
          opts.onFriendTap?.(intent.tokenId);
          audio?.play("ui.click");
        } else if (intent.type === "self") {
          emote("hop");
        } else {
          const g = groundAt(e.at.ndcX, e.at.ndcY);
          if (g) walkToWire(toWire(g.x, g.z));
        }
        break;
      }
      case "dragstart":
        dragging = true;
        break;
      case "drag": {
        const s = stickAxis(e.vector.x, e.vector.y);
        walker.steer(s ? screenToGround(s.x, s.y, yawRad()) : null);
        break;
      }
      case "dragend":
      case "cancel":
        if (dragging) {
          dragging = false;
          if (!keySteer) walker.steer(null);
        }
        break;
      case "key":
        if (e.down && /^Digit[1-8]$/.test(e.code)) {
          const name = EMOTES[Number(e.code.slice(5)) - 1];
          if (name) emote(name);
        }
        if (e.down && e.code === "Escape") walker.stop();
        break;
    }
  });

  // ── Frame ───────────────────────────────────────────────────────────────────────────────────────────────────
  const upAxis = new Vector3();
  const offFrame = stage.onFrame((dt) => {
    if (disposed || !view) return;
    const t0 = performance.now();
    const t = t0;
    const dtMs = dt * 1000;
    const rm = stage.reducedMotion;
    rig.deadZone = deadZoneFor(VISIBLE_WIDTH, rm);

    // Net state for the shell's loading/error UI.
    const ns = net.state();
    if (ns !== lastNetState) {
      lastNetState = ns;
      opts.onState?.(ns);
    }

    // Keyboard steering (arrows/WASD) → the same walker as the stick.
    const axis = stage.input.axis();
    const you = actors.get("you");
    if (!transitioning && !you?.venue && (axis.x !== 0 || axis.y !== 0)) {
      walker.steer(screenToGround(axis.x, axis.y, yawRad()));
      keySteer = true;
    } else if (keySteer) {
      keySteer = false;
      if (!dragging) walker.steer(null);
    }

    for (const mv of walker.update(dtMs, t)) send(["move", 0, mv.x, mv.z]);
    const hit = !transitioning ? doors.update(walker.position) : null;
    if (hit) {
      if (hit.kind === "venue") enterVenue(hit);
      else changeRoom(hit.target as RoomSlug);
    }

    // Periodic regrowth refresh (scars heal while you watch, 0.5 px/h: once a minute is plenty).
    if (t - lastLostRefresh > 60_000) {
      lastLostRefresh = t;
      for (const a of actors.values()) recompute(a);
    }

    // Positions and poses.
    const renderT = net.serverNow() - INTERPOLATION_DELAY_MS;
    const onlineTokens = new Set<TokenIdStr>();
    for (const a of actors.values()) if (a.kind !== "resting") onlineTokens.add(a.tokenId);
    let presences = 0;
    let resting = 0;
    for (const a of actors.values()) {
      if (a.kind === "you") {
        const p = toWorld(walker.position[0], walker.position[1]);
        a.x = p.x;
        a.z = p.z;
        a.walking = walker.moving;
        if (walker.moving) a.facing = facingFromHeading(walker.heading[0], walker.heading[1], a.facing);
        presences++;
      } else if (a.kind === "remote" && a.entityId) {
        const s = presence.sample(a.entityId, renderT);
        if (s) {
          a.x = s.x * WORLD_PER_WIRE;
          a.z = s.z * WORLD_PER_WIRE;
          a.walking = s.moving;
          if (s.moving) a.facing = facingFromHeading(s.heading[0], s.heading[1], a.facing);
        }
        presences++;
      } else {
        a.hidden = onlineTokens.has(a.tokenId);
        if (!a.hidden) resting++;
      }
      if (a.kind !== "resting") {
        const before = a.frame;
        a.frame = a.clock.update(dtMs, a.walking);
        if (a.kind === "you" && a.walking && a.frame !== before && a.frame % 4 === 0)
          audio?.play("hub.step", { x: screenX01(a), gain: 0.8 });
      }
    }
    stats.presences = presences;
    stats.resting = resting;

    // LOD: voxel meshes near you, the impostor crowd beyond.
    const youA = actors.get("you");
    const focus = youA ? { x: youA.x, z: youA.z } : { x: rig.focus.x, z: rig.focus.z };
    const cands: LodCandidate[] = [];
    for (const a of actors.values()) if (a.appearance && !a.hidden) cands.push({ key: a.key, x: a.x, z: a.z });
    const always = new Set<string>(["you"]);
    if (selected) always.add(selected);
    near = selectNear(cands, focus, NEAR_BUDGET[stage.quality], near, always);

    const camPos = stage.camera.position;
    const camYaw = yawRad();
    const renderH = stage.post.internalSize.height;
    crowd.begin();
    let nearCount = 0;
    let farCount = 0;
    for (const a of actors.values()) {
      if (!a.appearance || a.hidden) {
        dropModel(a);
        a.box = null;
        continue;
      }
      let ef: EmoteFrame | null = null;
      if (a.emote) {
        ef = emoteFrame(a.emote.name, t - a.emote.start, rm);
        if (!ef) a.emote = null;
        else if (ef.impact && !a.emote.impactDone) {
          a.emote.impactDone = true;
          fx.burst("dust", a.x, a.z, a.height, t);
          if (!rm) rig.shake(0.12);
        }
      }
      const yaw = plateYaw(a.x, a.z, camPos.x, camPos.z, camYaw);
      const dy = ef?.dy ?? 0;
      const sx = ef?.sx ?? 1;
      const sy = ef?.sy ?? 1;
      if (near.has(a.key)) {
        nearCount++;
        const dist = Math.hypot(camPos.x - a.x, camPos.y, camPos.z - a.z);
        const pxPerSprite = pixelsPerUnit(stage.camera.fov, renderH, dist) * HUB_PIXEL;
        const lod: 0 | 1 = pxPerSprite >= 6 ? 0 : 1;
        if (!a.model) {
          a.model = build(a.appearance, a.lost, {
            gold: Math.max(a.pub?.goldHeld ?? 0, a.presenceGold),
            lod,
            stitched: a.pub?.stitched ?? EMPTY_MASK,
            halo: { color: HALO_HEX[a.halo] },
          });
          a.modelLod = lod;
          const obj = a.model.object;
          obj.name = `hub-friend-${a.tokenId}`;
          obj.traverse((o) => {
            if (o.name === "friend-gold") tagGlow(o, "gold");
          });
          stage.scene.add(obj);
          a.shadow = attachProjectedShadow(obj);
          if (a.model.height) a.height = a.model.height;
          const belt = opts.beltOf?.(a.tokenId);
          if (belt) {
            // A 1-voxel band across the waist row (GDD §12.4), just proud of the front plate.
            const g = new BoxGeometry(a.width + HUB_PIXEL * 0.6, HUB_PIXEL, HUB_PIXEL * 1.9);
            a.belt = new Mesh(g, beltMaterial(belt));
            a.belt.name = "hub-belt";
            a.belt.position.set(0, a.height * 0.42, -HUB_PIXEL * 0.7);
            obj.add(a.belt);
          }
        } else if (lod !== a.modelLod && a.model.setLod) {
          a.model.setLod(lod);
          a.modelLod = lod;
        }
        const pose: Facing = a.kind === "resting" ? "down" : a.facing;
        a.model.setPose(pose, a.walking, a.kind === "resting" ? 0 : a.frame);
        syncShadows(a.model.object);
        const obj = a.model.object;
        obj.position.set(a.x, dy, a.z);
        obj.rotation.set(-PLATE_TILT, yaw, ef?.roll ?? 0, "YXZ");
        obj.scale.set(sx, sy, 1);
      } else {
        dropModel(a);
        farCount++;
        const pose = resolvePose(a.appearance, a.kind === "resting" ? "down" : a.facing, a.walking, a.frame);
        const frame = a.appearance.frames[pose.index] ?? frontMask(a.appearance);
        crowd.add(spritePixels(frame, a.lost), a.x, dy, a.z, yaw, PLATE_TILT, HUB_PIXEL, sx, sy);
      }
      // Tap box from the projected plate.
      const foot = project(a.x, 0, a.z);
      upAxis.set(0, a.height * Math.cos(PLATE_TILT), -a.height * Math.sin(PLATE_TILT));
      const head = project(a.x + upAxis.x, upAxis.y + dy, a.z + upAxis.z);
      const hPx = Math.max(8, foot.y - head.y);
      const wPx = (hPx * a.width) / Math.max(0.1, a.height);
      a.box = foot.visible
        ? {
            key: a.key,
            tokenId: a.tokenId,
            left: foot.x - wPx / 2,
            right: foot.x + wPx / 2,
            top: head.y,
            bottom: foot.y,
            depth: Math.hypot(camPos.x - a.x, camPos.y, camPos.z - a.z),
            scarred: a.lostPx > 0,
            isYou: a.kind === "you",
          }
        : null;
    }
    crowd.end();
    stats.near = nearCount;
    stats.far = farCount;
    stats.impostorPixels = crowd.count;

    // Markers: path preview and your lime ellipse.
    const path = walker.path.map((p) => toWorld(p[0], p[1]));
    fx.setPath(path);
    fx.setYou(youA && !youA.venue ? { x: youA.x, z: youA.z } : null);
    fx.update(t, rm);

    // Camera follow.
    if (youA) {
      const heading = walker.moving ? { x: walker.heading[0], z: walker.heading[1] } : null;
      const g = followGoal(youA.x, youA.z, heading, view.bounds);
      rig.follow(tmp.set(g.x, g.y, g.z));
    }

    // Overlay: tags, bubbles, labels, well.
    const tagCands = [];
    for (const a of actors.values()) {
      if (!a.appearance || a.hidden || !a.box) continue;
      const d = youA ? Math.hypot(youA.x - a.x, youA.z - a.z) : 0;
      tagCands.push({ key: a.key, distance: d, pinned: a.kind === "you" || a.key === selected });
    }
    const levels = selectTags(tagCands);
    const tags: TagView[] = [];
    for (const [key, level] of levels) {
      const a = actors.get(key);
      if (!a || level === "none") continue;
      const status = statusLine({
        isYou: a.kind === "you",
        resting: a.kind === "resting",
        loaned: a.loaned,
        tokenId: a.tokenId,
        venue: a.venue,
        lostPx: a.lostPx,
        healsInMs: a.healsInMs,
        gold: Math.max(a.pub?.goldHeld ?? 0, a.presenceGold),
        mendedByYou: mendedByYou.has(a.tokenId),
      });
      const you = a.kind === "you";
      tags.push({
        key,
        id: you ? "YOU" : `#${a.tokenId}`,
        status: you ? [`#${a.tokenId}`, status].filter(Boolean).join(" · ") : status,
        level: you ? "full" : level,
        you,
        at: project(a.x, 0, a.z),
      });
    }
    overlay.updateTags(tags);
    stats.tags = tags.length;

    const bviews: BubbleView[] = [];
    const vis = bubbles.visible(t);
    for (const a of actors.values()) {
      if (!a.appearance || a.hidden) continue;
      const b = vis.get(a.key);
      // Resting Friends say "zz" only when close enough to carry a tag (the plaza must not fill with zz bubbles).
      const text = b ? b.text : a.kind === "resting" && levels.has(a.key) ? "zz" : null;
      if (!text) continue;
      const kind = b ? b.kind : "zz";
      upAxis.set(0, (a.height + 0.25) * Math.cos(PLATE_TILT), -(a.height + 0.25) * Math.sin(PLATE_TILT));
      bviews.push({ key: a.key, text, kind, at: project(a.x + upAxis.x, upAxis.y, a.z + upAxis.z) });
    }
    overlay.updateBubbles(bviews);
    stats.bubbles = bviews.length;

    const wallNow = now();
    overlay.updateLabels(
      (l: RoomLabel) => project(l.at.x, l.at.y, l.at.z),
      (l: RoomLabel) => {
        if (l.live === "daily") return { title: l.title, sub: dailyCountdown(wallNow) };
        if (l.kind === "pill" && l.venueId) {
          let n = venueCounts.get(l.venueId);
          if (n === undefined) {
            n = 0;
            for (const a of actors.values()) if (a.venue === l.venueId && !a.hidden) n++;
          }
          return { title: l.title === "daily" ? `● daily · ${n} playing` : `● ${n} playing · enter`, sub: "" };
        }
        return null;
      },
    );
    if (view.wellAnchor) {
      const list: WellBubble[] = [...actors.values()]
        .filter((a) => a.kind !== "you" && !a.hidden && a.appearance && a.lostPx > 0)
        .sort((p, q) => q.lostPx - p.lostPx)
        .slice(0, 7)
        .map((a) => ({ tokenId: a.tokenId, frame: frontMask(a.appearance as FriendAppearance), lost: a.lost }));
      overlay.updateWell(list, project(view.wellAnchor.x, view.wellAnchor.y, view.wellAnchor.z));
    } else overlay.updateWell([], null);
    overlay.tick(t);
    stats.frameMs = performance.now() - t0;
  });

  audio?.music?.play("hub");

  const scene: HubScene = {
    get room() {
      return room;
    },
    enter(slug, from = null) {
      return enterRoom(slug ?? room ?? opts.room ?? "plaza", from);
    },
    emote,
    say,
    walkTo: (x, z) => walkToWire([x, z]),
    walkToFriend(tokenId) {
      const a = [...actors.values()].find((x) => x.tokenId === tokenId && !x.hidden);
      const you = actors.get("you");
      if (!a || !you) return false;
      const dx = you.x - a.x;
      const dz = you.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      return walkToWire(toWire(a.x + (dx / l) * 1.1, a.z + (dz / l) * 1.1));
    },
    exitVenue,
    setResting(list) {
      restingList = list;
      placeResting();
    },
    setVenueCounts(counts) {
      venueCounts.clear();
      for (const [k, v] of Object.entries(counts)) venueCounts.set(k, v);
    },
    setMuted(tokenId, muted) {
      if (muted) mutedTokens.add(tokenId);
      else mutedTokens.delete(tokenId);
      for (const a of actors.values()) if (a.tokenId === tokenId) bubbles.setMuted(a.key, muted);
    },
    refreshFriend,
    get stats() {
      return stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offNet();
      offInput();
      offFrame();
      audio?.music?.stop({ at: "now", fade: 0.3 });
      for (const k of [...actors.keys()]) removeActor(k);
      undecorate?.();
      for (const m of beltMats.values()) m.dispose();
      for (const r of rooms.values()) r.dispose();
      rooms.clear();
      crowd.dispose();
      fx.dispose();
      overlay.dispose();
      if (ownsHost) host.remove();
      net.close();
    },
  };
  return scene;
}
