/**
 * The Sky playground: the real hub scene over an in-memory `@pl/realtime` Hub (no server) with N bot presences that
 * walk, emote, chat, enter venues and get mended, plus resting Friends and a frame-2 style HUD.
 * Query: ?n=24 (bots) &room=plaza &quality=high|medium|low &rm=1 (reduced motion) &stats=1 &freeze=1 (no bots moving)
 * &mute=1. Keys: arrows/WASD walk, 1–8 emotes, P stats; tap/click to walk, drag = stick, tap a scarred Friend = Mend.
 */
import {
  EMOTES,
  EMPTY_MASK,
  QUICK_CHAT_PHRASES,
  ROOMS,
  encodeMsg,
  fromIndices,
  frontMask,
  mulberry32,
  scarsHash,
  toIndices,
  toRows,
  type FriendAppearance,
  type FriendPublic,
  type RoomSlug,
  type SkyFriend,
  type TokenIdStr,
} from "@pl/shared";
import { HUB_NAVMESHES, Navmesh, shardId, type HubSession, type Vec2 } from "@pl/realtime";
import type { VenueIdentity } from "@pl/venue-kit";
import { AudioEngine } from "@pl/audio";
import { createStage, type SharedStage } from "../src/stage/stage";
import type { QualityTier } from "../src/stage/quality";
import { FIXTURE_FRIENDS } from "../src/friend/dev/fixtures";
import { createHubScene, ROOM_NAMES, type HubScene } from "../src/hub";
import { createLocalHub, createLocalHubNet, LocalSocket } from "../src/hub/net";

const q = new URLSearchParams(location.search);
const tierParam = q.get("quality");
const quality: QualityTier | undefined =
  tierParam === "high" || tierParam === "medium" || tierParam === "low" ? tierParam : undefined;
const reducedMotion = q.get("rm") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const botCount = Math.max(0, Math.min(59, Number(q.get("n") ?? 24)));
const roomParam = q.get("room");
const startRoom: RoomSlug = (ROOMS as readonly string[]).includes(roomParam ?? "") ? (roomParam as RoomSlug) : "plaza";
const freeze = q.get("freeze") === "1";
const rng32 = mulberry32(Number(q.get("seed") ?? 7));
const rnd = (): number => rng32() / 4294967296;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── Fixture Friends: 13 real sprites, reused under distinct token ids ─────────────────────────────────────────────
const YOU_TOKEN = "344030";
const base = FIXTURE_FRIENDS;
const appearanceFor = (tokenId: TokenIdStr): FriendAppearance => {
  const direct = base.find((f) => f.tokenId === tokenId);
  if (direct) return direct;
  const n = Number(tokenId) % base.length;
  return { ...(base[n] ?? (base[0] as FriendAppearance)), tokenId };
};
const pubs = new Map<TokenIdStr, FriendPublic>();
const t0 = Date.now();
const makePub = (tokenId: TokenIdStr, scars: number, gold: number, streak: number): FriendPublic => {
  const front = toIndices(frontMask(appearanceFor(tokenId)));
  const lost: number[] = [];
  for (let i = 0; i < scars && front.length; i++) lost.push(front[Math.floor(rnd() * front.length)] as number);
  return {
    tokenId,
    scars: { lost: lost.length ? fromIndices(lost) : EMPTY_MASK, updatedAt: t0, version: 1 },
    goldHeld: gold,
    glowCracks: 0,
    streak,
    lastSeen: t0,
    economy: "sim",
  };
};
const pubFor = (tokenId: TokenIdStr): FriendPublic => {
  let p = pubs.get(tokenId);
  if (!p) {
    const r = rnd();
    p = makePub(
      tokenId,
      r < 0.35 ? 2 + Math.floor(rnd() * 7) : 0,
      rnd() < 0.15 ? 1 + Math.floor(rnd() * 3) : 0,
      rnd() < 0.7 ? 0 : Math.floor(rnd() * 40),
    );
    pubs.set(tokenId, p);
  }
  return p;
};
pubs.set(YOU_TOKEN, makePub(YOU_TOKEN, 2, 0, 4));

const identity = (): VenueIdentity => ({
  mode: "owner",
  loaned: false,
  friend: { appearance: appearanceFor(YOU_TOKEN), pub: pubFor(YOU_TOKEN), loaned: false },
});

// ── In-memory server + bots ───────────────────────────────────────────────────────────────────────────────────────
// One shard for the whole crowd (the default soft cap of 40 would open a second shard for the 60-presence test).
const hub = createLocalHub({ directory: { softCap: 60 } });
interface Bot {
  readonly tokenId: TokenIdStr;
  session: HubSession | null;
  room: RoomSlug;
  seq: number;
  nextAt: number;
  pos: Vec2;
  legs: Vec2[];
  legEndAt: number;
}
const bots: Bot[] = [];
const botTokens = [...base.map((f) => f.tokenId).filter((t) => t !== YOU_TOKEN)];
for (let i = 0; i < botCount; i++) {
  const tokenId = i < botTokens.length ? (botTokens[i] as string) : String(70000 + i * 17);
  const pub = pubFor(tokenId);
  const s = new LocalSocket();
  const r = hub.join(s, {
    identityKey: `bot:${i}`,
    owner: null,
    room: startRoom,
    profile: { kind: "owner", tokenId, loaned: i % 9 === 4, scarsHash: scarsHash(pub.scars), goldHeld: pub.goldHeld },
  });
  const me = r.ok ? hub.snapshot(shardId(startRoom, 0)).find((e) => e.id === r.session.entityId) : undefined;
  bots.push({
    tokenId,
    session: r.ok ? r.session : null,
    room: startRoom,
    seq: 0,
    nextAt: Date.now() + rnd() * 1500,
    pos: me ? [me.x, me.z] : [0, 0],
    legs: [],
    legEndAt: 0,
  });
}
const meshes = new Map<RoomSlug, Navmesh>();
const meshOf = (slug: RoomSlug): Navmesh => {
  let m = meshes.get(slug);
  if (!m) meshes.set(slug, (m = new Navmesh(HUB_NAVMESHES[slug])));
  return m;
};
const randomSpot = (m: Navmesh): Vec2 | null => {
  for (let k = 0; k < 20; k++) {
    const p: Vec2 = [Math.round((rnd() - 0.5) * 3800), Math.round((rnd() - 0.5) * 3600)];
    if (m.contains(p) && !m.doorAt(p)) return p;
  }
  return null;
};
/** Bots walk like players: an A* path sent one leg at a time, each leg when the previous one would end. */
const walkBot = (b: Bot, to: Vec2): void => {
  const path = meshOf(b.room).findPath(b.pos, to);
  if (path) b.legs = path.slice(1);
  b.legEndAt = 0;
};
const stepLegs = (b: Bot, now: number): void => {
  if (!b.session || !b.legs.length || now < b.legEndAt) return;
  const leg = b.legs.shift() as Vec2;
  const [x, z] = [Math.round(leg[0]), Math.round(leg[1])];
  b.session.receive(encodeMsg(["move", ++b.seq, x, z]));
  b.legEndAt = now + (Math.hypot(x - b.pos[0], z - b.pos[1]) / 1200) * 1000;
  b.pos = [x, z];
};
// Spread bots over the room right away (the server spawns everyone on a small ring): jump-start with one walk each.
for (const b of bots) {
  const p = randomSpot(meshOf(b.room));
  if (p) walkBot(b, p);
}
const tickBots = (): void => {
  const now = Date.now();
  for (const b of bots) {
    stepLegs(b, now);
    if (freeze || !b.session || now < b.nextAt || b.legs.length) continue;
    b.nextAt = now + 2200 + rnd() * 4800;
    const roll = rnd();
    if (roll < 0.55) {
      const p = randomSpot(meshOf(b.room));
      if (p) walkBot(b, p);
    } else if (roll < 0.75) b.session.receive(encodeMsg(["emote", Math.floor(rnd() * EMOTES.length)]));
    else if (roll < 0.92) b.session.receive(encodeMsg(["say", Math.floor(rnd() * QUICK_CHAT_PHRASES)]));
    else b.session.receive(encodeMsg(["venue", rnd() < 0.5 ? "pixel-life" : null]));
  }
};
setInterval(tickBots, 100);

// A Mend somewhere every ~6 s: the target's scars shrink, the room sees the sparkle.
setInterval(() => {
  if (freeze) return;
  const scarred = bots.filter((b) => (pubs.get(b.tokenId)?.scars.lost ?? EMPTY_MASK) !== EMPTY_MASK);
  const target = scarred[Math.floor(rnd() * scarred.length)];
  const by = bots[Math.floor(rnd() * bots.length)];
  if (!target || !by || target === by) return;
  const p = pubs.get(target.tokenId) as FriendPublic;
  const lost = toIndices(p.scars.lost);
  const px = Math.min(lost.length, 1 + Math.floor(rnd() * 3));
  const next = lost.slice(px);
  const scars = {
    lost: next.length ? fromIndices(next) : EMPTY_MASK,
    updatedAt: Date.now(),
    version: p.scars.version + 1,
  };
  pubs.set(target.tokenId, { ...p, scars, stitched: fromIndices(lost.slice(0, px)) });
  hub.updateToken(target.tokenId, { scarsHash: scarsHash(scars) });
  hub.mended(target.tokenId, by.tokenId, px);
}, 6000);

// Resting Friends (offline owners): a few per room, always some scarred (they are Mend targets).
const restingFor = (slug: RoomSlug): SkyFriend[] =>
  Array.from({ length: slug === "plaza" ? 10 : 5 }, (_, i) => {
    const tokenId = String(90000 + ROOMS.indexOf(slug) * 100 + i * 7);
    const pub = pubs.get(tokenId) ?? makePub(tokenId, i % 2 === 0 ? 3 + i : 0, 0, i * 3);
    pubs.set(tokenId, pub);
    return { tokenId, familyId: appearanceFor(tokenId).familyId, pub };
  });

// ── Stage + scene ─────────────────────────────────────────────────────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>("stage");
let stage: SharedStage;
try {
  stage = createStage(canvas, { reducedMotion, preserveDrawingBuffer: q.has("shot"), ...(quality ? { quality } : {}) });
} catch (e) {
  document.body.textContent = `stage unavailable: ${String(e)}`;
  throw e;
}
const net = createLocalHubNet(hub, {
  identityKey: "you",
  owner: null,
  profile: { kind: "owner", tokenId: YOU_TOKEN, loaned: false, scarsHash: "h", goldHeld: 0 },
});
// Hub music + footsteps + emote blips (unlocked on the first gesture; ?mute=1 to silence).
const audio = new AudioEngine({ muted: q.get("mute") === "1", reducedAudio: reducedMotion });
audio.unlockOnGesture(window);
const toast = (text: string): void => {
  const el = $("toast");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 1600);
};
const scene: HubScene = createHubScene(stage, net, identity, {
  friends: {
    appearance: async (id) => appearanceFor(id),
    publicState: async (id) => pubFor(id),
  },
  overlay: $("overlay"),
  audio,
  resting: restingFor,
  room: startRoom,
  onEnterVenue: (e) => {
    toast(`enter ${e.venueId}${e.mode ? ` (${e.mode})` : ""}`);
    setTimeout(() => scene.exitVenue(), 1500);
  },
  onRoomChange: (r) => toast(`→ ${r}`),
  onMendRequest: (tokenId) => {
    const p = pubFor(tokenId);
    const n = toIndices(p.scars.lost).length;
    $("mend").style.display = "block";
    $("mend-id").textContent = `#${tokenId}`;
    $("mend-sub").textContent = `${n} px · ${n} rf (simulated)`;
  },
  onFriendTap: (tokenId) => toast(`#${tokenId}`),
});

// ── HUD ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const sil = $<HTMLCanvasElement>("sil").getContext("2d");
const drawYou = (): void => {
  const me = identity().friend;
  const rows = toRows(frontMask(me.appearance));
  const lost = toRows(me.pub.scars.lost);
  if (sil) {
    sil.fillStyle = "#eee";
    sil.fillRect(0, 0, 16, 16);
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== "#") return;
        sil.fillStyle = lost[y]?.[x] === "#" ? "#ed927e" : "#1d1b24";
        sil.fillRect(x, y, 1, 1);
      }),
    );
  }
  const total = toIndices(frontMask(me.appearance)).length;
  const l = toIndices(me.pub.scars.lost).length;
  $("you-px").innerHTML = `${total - l}/${total} <small>PX</small>`;
  $("you-heal").textContent = l ? `${l} scar${l > 1 ? "s" : ""} healing · ${Math.round(l * 2)}h` : "whole";
};
drawYou();
for (const b of document.querySelectorAll<HTMLButtonElement>("#bar button")) {
  b.addEventListener("click", () => {
    const e = b.dataset["emote"];
    const s = b.dataset["say"];
    if (e) scene.emote(e as (typeof EMOTES)[number]);
    if (s) scene.say(Number(s));
  });
}
$("play").addEventListener("click", () => toast("▶ quick run (loose pixels)"));
$("mend").addEventListener("click", () => ($("mend").style.display = "none"));

const statsEl = $("stats");
if (q.get("stats") === "1") statsEl.style.display = "block";
let fpsT = 0;
let fpsN = 0;
let fps = 0;
stage.onFrame((dt) => {
  fpsT += dt;
  fpsN++;
  if (fpsT >= 0.5) {
    fps = fpsN / fpsT;
    fpsT = 0;
    fpsN = 0;
  }
  const st = scene.stats;
  $("place-name").textContent = `the sky · ${scene.room ? ROOM_NAMES[scene.room] : ""} · ${st.presences} friends here`;
  const s = stage.post.stats;
  statsEl.textContent = [
    `tier ${stage.quality}  ${fps.toFixed(0)} fps  scene js ${st.frameMs.toFixed(2)} ms`,
    `presences ${st.presences}  resting ${st.resting}  near ${st.near}  far ${st.far} (${st.impostorPixels} px)`,
    `tags ${st.tags}  bubbles ${st.bubbles}`,
    `calls scene ${s.sceneCalls} mask ${s.maskCalls} total ${s.totalCalls}  tris ${s.sceneTriangles}`,
  ].join("\n");
});
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") statsEl.style.display = statsEl.style.display === "block" ? "none" : "block";
});

declare global {
  interface Window {
    __hub?: { ready: boolean; stage: SharedStage; scene: HubScene; frameTimes: number[] };
  }
}
const frameTimes: number[] = [];
stage.onFrame(() => {
  frameTimes.push(scene.stats.frameMs);
  if (frameTimes.length > 600) frameTimes.shift();
});
scene.enter(startRoom).then(
  () => {
    let frames = 0;
    const off = stage.onFrame(() => {
      if (++frames < 20) return;
      off();
      window.__hub = { ready: true, stage, scene, frameTimes };
    });
  },
  (e: unknown) => toast(`could not join: ${String(e)}`),
);
