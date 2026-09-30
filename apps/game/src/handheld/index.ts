/**
 * @pl/game handheld: the 1-bit 128×128 "Sharp Memory LCD" mode (GDD §7, art bible §9). Same sim, same scars, same
 * board as the 3D venue, drawn with a 2D canvas. Entry points: `mountHandheld(canvas, host)` (a native venue mount on a
 * given canvas), `createHandheldVenue(getCanvas)` and the optional CSS device frame `createHandheldDevice(parent)`.
 */
export * from "./app.js";
export * from "./device.js";
export * from "./fake-sim.js";
export * from "./font.js";
export * from "./heal.js";
export * from "./input.js";
export * from "./lcd.js";
export * from "./mount.js";
export * from "./project.js";
export * from "./screens.js";
export * from "./sprites.js";
export * from "./view.js";
