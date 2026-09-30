import { EMOTES, EMPTY_MASK } from "@pl/shared";
import { describe, expect, it, vi } from "vitest";
import { loaner } from "../test/fixtures.js";
import type { ShellAudio } from "../settings/audio.js";
import { hubAudio, restingLoaner, unlockedEmotes } from "./hub-scene.js";

describe("sky mount helpers", () => {
  it("rests loaners whole on the offline plaza", () => {
    const l = loaner(2);
    const f = restingLoaner(l, 1000);
    expect(f.tokenId).toBe(l.appearance.tokenId);
    expect(f.familyId).toBe(l.appearance.familyId);
    expect(f.pub.scars.lost).toBe(EMPTY_MASK);
    expect(f.pub.economy).toBe("sim");
  });

  it("unlocks the 4 starter emotes for guests and all 8 for owners", () => {
    const starters = EMOTES.slice(0, 4);
    expect(unlockedEmotes("guest", starters)).toEqual(starters);
    expect(unlockedEmotes("owner", starters)).toEqual(EMOTES);
  });

  it("plays cues and music through the lazily loaded engine", () => {
    const music = { play: vi.fn(), stop: vi.fn() };
    let engine: { music: typeof music } | null = null;
    const shell = { play: vi.fn(), engine: () => engine, unlock: async () => true } as unknown as ShellAudio;
    const a = hubAudio(shell);
    a.play("ui.click");
    expect(shell.play).toHaveBeenCalledWith("ui.click", undefined);
    a.music?.play("hub");
    expect(music.play).not.toHaveBeenCalled();
    engine = { music };
    a.music?.play("hub");
    a.music?.stop({ at: "bar" });
    expect(music.play).toHaveBeenCalledWith("hub");
    expect(music.stop).toHaveBeenCalledWith({ at: "bar" });
  });
});
