/**
 * @pl/game handheld: the "Handheld Arcade" venue, the 1-bit 128×128 "Sharp Memory LCD" mode (GDD §7, art bible §9).
 * Same shared sim, same scars, same boards as the 3D venue, drawn with a 2D canvas. Entry points:
 * `createHandheldVenue(opts)` (the `NativeVenue`: a 2D overlay on the shared stage's container), `mountHandheld(canvas,
 * host)` (the bare screen on a given canvas) and the CSS device frame `createHandheldDevice(parent)`.
 */
export * from "./app.js";
export * from "./device.js";
export * from "./font.js";
export * from "./heal.js";
export * from "./input.js";
export * from "./lcd.js";
export * from "./mount.js";
export * from "./project.js";
export * from "./screens.js";
export * from "./sprites.js";
export * from "./view.js";
