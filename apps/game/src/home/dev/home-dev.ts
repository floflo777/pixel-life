/**
 * Dev page for the home isle: a fixture Friend on a Gen-3 isle (4 terraces) with sample decor, a hat and a belt, plus
 * a tiny DOM shelf driving the edit-mode callback API. `?edit=1` starts in edit mode. Sets `window.__homeReady`.
 */
import { CATALOG, type HomeLayout } from "@pl/shared";
import { FIXTURE_FRIENDS } from "../../friend/dev/fixtures";
import { createStage } from "../../stage/stage";
import { createHomeScene } from "../scene";

declare global {
  interface Window {
    __homeReady?: boolean;
  }
}

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("stage") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const status = document.getElementById("status") as HTMLDivElement;
const friend = FIXTURE_FRIENDS[Number(q.get("friend") ?? 0)] ?? FIXTURE_FRIENDS[0];
if (!friend) throw new Error("no fixture Friend");

const layout: HomeLayout = {
  v: 1,
  items: [
    { item: "tree_meadow", t: 0, x: 0, z: 0, r: 0 },
    { item: "tree_sun", t: 0, x: 9, z: 1, r: 0 },
    { item: "fountain", t: 0, x: 1, z: 7, r: 0 },
    { item: "bench", t: 0, x: 8, z: 7, r: 0 },
    { item: "lamp", t: 0, x: 7, z: 4, r: 0 },
    { item: "flowerbed", t: 0, x: 4, z: 9, r: 0 },
    { item: "plush_nib", t: 0, x: 3, z: 4, r: 0 },
    { item: "crystal", t: 0, x: 10, z: 10, r: 0 },
    { item: "gold_arch", t: 0, x: 4, z: 1, r: 0 },
    { item: "gulp_tooth", t: 0, x: 8, z: 5, r: 0 },
    { item: "reeds", t: 0, x: 0, z: 11, r: 0 },
    { item: "cloud_falls", t: 1, x: 5, z: 5, r: 0 },
    { item: "tree_paper", t: 1, x: 1, z: 2, r: 0 },
  ],
};
const owned = Object.fromEntries(CATALOG.map((i) => [i.id, 3]));

const stage = createStage(canvas, { reducedMotion: true, quality: "high" });
const home = createHomeScene(
  stage,
  layout,
  { appearance: friend, hat: q.get("hat") ?? "hat_party", belt: "green" },
  { generation: 3, owned },
);

const say = (s: string): void => void (status.textContent = s);
home.editor.on((e) => {
  if (e.type === "change") say(`items ${e.layout.items.length} · unsaved`);
  if (e.type === "select") say(e.index === null ? "tap an item or pick one from the shelf" : `selected #${e.index}`);
  if (e.type === "rejected") say(`can't: ${e.error}`);
  if (e.type === "armed" && e.itemId) say(`tap a free tile to place ${e.itemId}`);
});

const button = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", onClick);
  panel.appendChild(b);
  return b;
};
const edit = button("edit", () => {
  const on = !home.editor.active;
  if (on) home.beginEdit();
  else say(`saved layout: ${home.endEdit().items.length} items`);
  edit.setAttribute("aria-pressed", String(on));
  canvas.focus();
});
button("rotate", () => home.editor.rotate());
button("remove", () => home.editor.remove());
for (const id of ["rock", "bench", "planter", "sun_lantern"]) button(`+${id}`, () => home.editor.arm(id));
button("terrace ▲", () => home.focusTerrace(1));
button("terrace ▼", () => home.focusTerrace(0));

if (q.get("edit") === "1") {
  home.beginEdit();
  home.editor.tap({ t: 0, x: 8, z: 7 });
  edit.setAttribute("aria-pressed", "true");
}
requestAnimationFrame(() => requestAnimationFrame(() => (window.__homeReady = true)));
