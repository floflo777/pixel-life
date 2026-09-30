import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AIM_REPEAT_DELAY_MS,
  AIM_REPEAT_HZ,
  AimController,
  BACK_HOLD_MS,
  ButtonPad,
  FLING_BUFFER_MS,
  aimStepToAngle,
  angleToAimStep,
  chargeStep,
  chargeToPower,
  dragToFling,
  keyToButton,
  tapToButton,
  type PadEvent,
} from "./input.js";

describe("keyToButton", () => {
  it("maps arrows / WASD / Z X / Space / Enter / Escape to the device buttons", () => {
    expect(["ArrowLeft", "KeyA"].map(keyToButton)).toEqual(["left", "left"]);
    expect(["ArrowRight", "KeyD"].map(keyToButton)).toEqual(["right", "right"]);
    expect(["Space", "Enter", "KeyZ", "ArrowUp", "KeyW", "NumpadEnter"].map(keyToButton)).toEqual(Array(6).fill("ok"));
    expect(["KeyX", "Escape", "Backspace", "ArrowDown", "KeyS"].map(keyToButton)).toEqual(Array(5).fill("back"));
  });

  it("ignores every other key", () => {
    expect(["Tab", "KeyQ", "ShiftLeft", "F5", ""].map(keyToButton)).toEqual(Array(5).fill(null));
  });
});

describe("tapToButton", () => {
  it("splits the screen in thirds: ◄ ● ►", () => {
    expect(tapToButton(10, 60, 128, 128)).toBe("left");
    expect(tapToButton(64, 10, 128, 128)).toBe("ok");
    expect(tapToButton(120, 120, 128, 128)).toBe("right");
    expect(tapToButton(-1, 10, 128, 128)).toBeNull();
    expect(tapToButton(10, 128, 128, 128)).toBeNull();
  });
});

describe("aim and charge quantisation", () => {
  it("round-trips the 16 aim steps", () => {
    for (let s = 0; s < 16; s++) expect(angleToAimStep(aimStepToAngle(s))).toBe(s);
    expect(aimStepToAngle(16)).toBe(0);
    expect(aimStepToAngle(-1)).toBe(aimStepToAngle(15));
    expect(angleToAimStep(4095)).toBe(0);
  });

  it("snaps any angle to within half a step", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4095 }), (a) => {
        const d = Math.abs(aimStepToAngle(angleToAimStep(a)) - a);
        expect(Math.min(d, 4096 - d)).toBeLessThanOrEqual(128);
      }),
    );
  });

  it("charges 1..8 over 0.8 s and maps step 8 to full power", () => {
    expect(chargeStep(0)).toBe(1);
    expect(chargeStep(99)).toBe(1);
    expect(chargeStep(100)).toBe(2);
    expect(chargeStep(700)).toBe(8);
    expect(chargeStep(5000)).toBe(8);
    expect(chargeStep(-50)).toBe(1);
    expect(chargeToPower(8)).toBe(1023);
    expect(chargeToPower(4)).toBe(512);
    expect(chargeToPower(0)).toBe(0);
  });
});

describe("dragToFling (slingshot)", () => {
  it("flings opposite to the drag", () => {
    expect(dragToFling(-40, 0)).toEqual({ ang: 0, pow: 1023 }); // drag left → +x
    expect(dragToFling(40, 0)?.ang).toBe(2048); // drag right → −x
    expect(dragToFling(0, -20)?.ang).toBe(1024); // drag up → +z (toward the camera)
    expect(dragToFling(0, 20)?.ang).toBe(3072);
  });

  it("treats short drags as taps and caps power", () => {
    expect(dragToFling(1, 1)).toBeNull();
    expect(dragToFling(-400, 0)?.pow).toBe(1023);
    expect(dragToFling(-20, 0)?.pow).toBe(512);
  });

  it("always yields angles in 0..4095 and power in 0..1023", () => {
    const c = fc.integer({ min: -300, max: 300 });
    fc.assert(
      fc.property(c, c, (dx, dy) => {
        const f = dragToFling(dx, dy);
        if (!f) return;
        expect(f.ang).toBeGreaterThanOrEqual(0);
        expect(f.ang).toBeLessThan(4096);
        expect(f.pow).toBeGreaterThanOrEqual(0);
        expect(f.pow).toBeLessThanOrEqual(1023);
      }),
    );
  });
});

describe("ButtonPad", () => {
  const types = (es: PadEvent[]) => es.map((e) => `${e.type}:${e.button}`);

  it("emits down/up once per hold and ignores key auto-repeat presses", () => {
    const pad = new ButtonPad();
    pad.press("ok", 0);
    pad.press("ok", 30);
    pad.release("ok", 120);
    pad.release("ok", 130);
    const es = pad.poll(130);
    expect(types(es)).toEqual(["down:ok", "up:ok"]);
    expect(es[1]).toMatchObject({ heldMs: 120 });
  });

  it("repeats held ◄/► at 12 Hz after the initial delay", () => {
    const pad = new ButtonPad();
    pad.press("left", 0);
    expect(types(pad.poll(AIM_REPEAT_DELAY_MS - 1))).toEqual(["down:left"]);
    const reps = pad.poll(AIM_REPEAT_DELAY_MS + 1000).filter((e) => e.type === "repeat");
    expect(reps.length).toBe(AIM_REPEAT_HZ + 1);
  });

  it("fires `long` once after holding for 1 s", () => {
    const pad = new ButtonPad();
    pad.press("back", 0);
    expect(types(pad.poll(BACK_HOLD_MS - 1))).toEqual(["down:back"]);
    expect(types(pad.poll(BACK_HOLD_MS))).toEqual(["long:back"]);
    expect(pad.poll(BACK_HOLD_MS * 3)).toEqual([]);
  });

  it("treats ◄ + ► together as back (3-button device) without spinning the aim", () => {
    const pad = new ButtonPad();
    pad.press("left", 0);
    pad.press("right", 20);
    expect(pad.isDown("back")).toBe(true);
    const es = pad.poll(2000);
    expect(types(es)).toContain("down:back");
    expect(types(es)).toContain("long:back");
    expect(es.some((e) => e.type === "repeat")).toBe(false);
    pad.release("left", 2100);
    expect(pad.isDown("back")).toBe(false);
    expect(types(pad.poll(2100))).toEqual(["up:left", "up:back"]);
  });

  it("releaseAll lets go of everything (blur, pause)", () => {
    const pad = new ButtonPad();
    pad.press("ok", 0);
    pad.press("left", 0);
    pad.releaseAll(50);
    expect(pad.isDown("ok") || pad.isDown("left")).toBe(false);
    expect(pad.heldMs("ok", 60)).toBe(0);
  });
});

describe("AimController", () => {
  it("steps the aim with ◄/► and wraps", () => {
    const aim = new AimController(0);
    aim.update([{ type: "down", button: "left" }], 0, true);
    expect(aim.aim).toBe(15);
    aim.update(
      [
        { type: "down", button: "right" },
        { type: "repeat", button: "right" },
      ],
      0,
      true,
    );
    expect(aim.aim).toBe(1);
    expect(aim.angle).toBe(256);
  });

  it("charges while ● is held and flings on release with the charged power", () => {
    const aim = new AimController(4);
    expect(aim.update([{ type: "down", button: "ok" }], 1000, true)).toBeNull();
    aim.update([], 1350, true);
    expect(aim.charge).toBe(4);
    const f = aim.update([{ type: "up", button: "ok", heldMs: 800 }], 1800, true);
    expect(f).toEqual({ ang: 1024, pow: 1023 });
    expect(aim.charge).toBe(0);
  });

  it("buffers a release while the Friend is busy and fires when it becomes ready", () => {
    const aim = new AimController(0);
    aim.update([{ type: "down", button: "ok" }], 0, false);
    expect(aim.update([{ type: "up", button: "ok", heldMs: 50 }], 50, false)).toBeNull();
    expect(aim.update([], 50 + FLING_BUFFER_MS - 1, true)).toEqual({ ang: 0, pow: chargeToPower(1) });
    expect(aim.update([], 400, true)).toBeNull();
  });

  it("drops a buffered fling after the buffer window", () => {
    const aim = new AimController(0);
    aim.update([{ type: "down", button: "ok" }], 0, false);
    aim.update([{ type: "up", button: "ok", heldMs: 50 }], 50, false);
    expect(aim.update([], 50 + FLING_BUFFER_MS + 1, false)).toBeNull();
    expect(aim.update([], 50 + FLING_BUFFER_MS + 2, true)).toBeNull();
  });

  it("back cancels a charge", () => {
    const aim = new AimController(0);
    aim.update([{ type: "down", button: "ok" }], 0, true);
    aim.update([{ type: "down", button: "back" }], 300, true);
    expect(aim.charge).toBe(0);
    expect(aim.update([{ type: "up", button: "ok", heldMs: 400 }], 400, true)).toBeNull();
  });
});
