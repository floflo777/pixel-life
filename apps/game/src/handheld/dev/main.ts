/**
 * Handheld playground: the device frame + `mountHandheld` on the venue-kit test host (economy SIMULATED).
 * Query: `?skipBoot` · `?heal=3600` (scar-healing time-lapse factor) · `?reduced` · `?guest` · `?token=65042`.
 *   npx vite --config apps/game/src/handheld/dev/vite.config.ts
 */
import { createTestVenueHost } from "@pl/venue-kit";
import { createHandheldDevice } from "../device.js";
import { mountHandheld } from "../mount.js";
import { devFriend } from "./fixture.js";

const q = new URLSearchParams(location.search);
const start = Date.now();
const token = q.get("token") ?? undefined;
const guest = q.has("guest");
const harness = createTestVenueHost({
  startTime: start,
  reducedMotion: q.has("reduced") || matchMedia("(prefers-reduced-motion: reduce)").matches,
  identity: { mode: guest ? "guest" : "owner", friend: { ...devFriend(start, token), loaned: guest }, loaned: guest },
});
const heal = Number(q.get("heal") ?? "1");

const device = createHandheldDevice(document.body, guest ? "pixel life · guest" : "pixel life");
const inst = await mountHandheld(device.canvas, harness.host, {
  now: () => harness.now,
  skipBoot: q.has("skipBoot"),
  keyTarget: window,
});
device.bind(inst);

let last = performance.now();
const loop = (t: number) => {
  const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
  last = t;
  harness.advance(Math.round(dt * 1000 * heal));
  harness.frame(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

declare global {
  interface Window {
    __hh?: { inst: typeof inst; harness: typeof harness; ready: boolean };
  }
}
window.__hh = { inst, harness, ready: true };
