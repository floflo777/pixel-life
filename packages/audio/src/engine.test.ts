import { describe, expect, it } from "vitest";
import { CUES } from "./cues";
import { AudioEngine, REDUCED_MAX_VOICES } from "./engine";
import type { PlayParams } from "./engine";
import { FakeAudioContext, ManualTimer, asAudioContext } from "./test-utils/fake-audio-context";
import type { FakeGain, FakePanner } from "./test-utils/fake-audio-context";

function setup(options: { reducedAudio?: boolean; muted?: boolean; maxVoices?: number } = {}) {
  const fake = new FakeAudioContext();
  const timer = new ManualTimer();
  const engine = new AudioEngine({
    createContext: () => asAudioContext(fake),
    timer,
    random: () => 0.5,
    suspendWhenHidden: false,
    ...options,
  });
  return { fake, timer, engine };
}

describe("AudioEngine", () => {
  it("does nothing before a gesture unlock", () => {
    const { fake, engine } = setup();
    expect(engine.status).toBe("locked");
    expect(engine.play("ui.click")).toBe(false);
    expect(fake.nodes.length).toBe(1); // only the fake's destination: no graph yet
  });

  it("unlocks, builds the graph and plays a cue", async () => {
    const { fake, engine } = setup();
    expect(await engine.unlock()).toBe(true);
    expect(engine.status).toBe("running");
    expect(engine.play("ui.click")).toBe(true);
    expect(fake.sources).toHaveLength(1);
    const src = fake.sources[0];
    expect(src?.startedAt).toBe(0);
    expect(src?.buffer?.sampleRate).toBe(fake.sampleRate);
    expect(src?.playbackRate.value).toBeCloseTo(1); // random 0.5 → no variance
  });

  it("reports unsupported without a context factory", async () => {
    const g = globalThis as { AudioContext?: unknown };
    const saved = g.AudioContext;
    delete g.AudioContext;
    try {
      const engine = new AudioEngine();
      expect(await engine.unlock()).toBe(false);
      expect(engine.status).toBe("unsupported");
    } finally {
      if (saved !== undefined) g.AudioContext = saved;
    }
  });

  it("pans by screen x and transposes by step", async () => {
    const { fake, engine } = setup();
    await engine.unlock();
    const params: PlayParams = { x: 0, step: 5 };
    engine.play("pixel.sweep", params);
    const src = fake.sources[0];
    expect(src?.playbackRate.value).toBeCloseTo(2);
    const gain = src?.outputs[0] as FakeGain;
    const panner = gain.outputs[0] as FakePanner;
    expect(panner.pan.value).toBeCloseTo(-0.7);
  });

  it("respects mute, and unmute restores playback", async () => {
    const { engine } = setup({ muted: true });
    await engine.unlock();
    expect(engine.play("ui.click")).toBe(false);
    engine.setMuted(false);
    expect(engine.play("ui.click")).toBe(true);
  });

  it("limits voices per cue and globally", async () => {
    const { fake, engine } = setup({ maxVoices: 4 });
    await engine.unlock();
    let started = 0;
    for (let i = 0; i < 10; i++) {
      fake.currentTime = i * 0.025;
      if (engine.play("smash.nib")) started++;
    }
    expect(started).toBe(10); // per-cue steal keeps it responsive
    expect(engine.activeVoices()).toBeLessThanOrEqual(CUES["smash.nib"].maxVoices);
    // Stolen voices are stopped just after the steal.
    expect(fake.sources.filter((s) => s.stoppedAt !== null).length).toBeGreaterThan(0);
  });

  it("drops non-essential cues and caps voices in reduced audio", async () => {
    const { engine } = setup({ reducedAudio: true });
    await engine.unlock();
    expect(engine.play("hub.step")).toBe(false);
    expect(engine.play("bite")).toBe(true);
    engine.setReducedAudio(false);
    expect(engine.play("hub.step")).toBe(true);
    expect(REDUCED_MAX_VOICES).toBeLessThan(24);
  });

  it("ducks the music on heavy cues", async () => {
    const { fake, engine } = setup();
    await engine.unlock();
    engine.play("gulp.bite");
    const ducked = fake.nodes.some(
      (n) => n.kind === "gain" && (n as FakeGain).gain.events.some((e) => e.method === "target" && e.value < 0.5),
    );
    expect(ducked).toBe(true);
  });

  it("sets bus volumes and disposes cleanly", async () => {
    const { fake, engine } = setup();
    await engine.unlock();
    engine.setVolume("sfx", 2);
    expect(engine.volume("sfx")).toBe(1);
    engine.dispose();
    expect(engine.status).toBe("disposed");
    expect(fake.state).toBe("closed");
    expect(engine.play("ui.click")).toBe(false);
  });
});

describe("MusicDirector via the engine", () => {
  it("never plays before unlock, then starts the requested theme", async () => {
    const { fake, timer, engine } = setup();
    engine.music.play("hub", "daily-2026-09-30");
    timer.fire();
    expect(fake.sources).toHaveLength(0);
    await engine.unlock();
    expect(engine.music.playing).toBe(true);
    expect(timer.active).toBe(true);
    expect(fake.sources.length).toBeGreaterThan(0); // pad/melody + wind loop
  });

  it("schedules identically for the same seed", async () => {
    const run = async () => {
      const { fake, timer, engine } = setup();
      await engine.unlock();
      engine.music.setIntensity(1);
      engine.music.play("run", 1234);
      for (let t = 0; t < 4; t += 0.025) {
        fake.currentTime = t;
        timer.fire();
      }
      return fake.sources.map((s) => [s.startedAt, s.buffer?.length]);
    };
    const a = await run();
    const b = await run();
    expect(a.length).toBeGreaterThan(20);
    expect(a).toEqual(b);
  });

  it("only schedules audible layers at low intensity", async () => {
    const { fake, timer, engine } = setup();
    await engine.unlock();
    engine.music.setIntensity(0);
    engine.music.play("run", 1);
    for (let t = 0; t < 2; t += 0.025) {
      fake.currentTime = t;
      timer.fire();
    }
    // Drop-in = pad only: 3 pad notes per bar, nothing else.
    expect(fake.sources.length).toBe(3);
  });

  it("lands stingers on the beat grid", async () => {
    const { fake, timer, engine } = setup();
    await engine.unlock();
    engine.music.play("run", 5);
    fake.currentTime = 0.3;
    timer.fire();
    const at = engine.music.stinger("combo");
    expect(at).not.toBeNull();
    const beat = 60 / 112;
    const origin = 0.06;
    const beats = ((at ?? 0) - origin) / beat;
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-9);
    expect(at).toBeGreaterThan(0.3);
  });

  it("slow-mo detunes and filters the music", async () => {
    const { fake, timer, engine } = setup();
    await engine.unlock();
    engine.music.setIntensity(1);
    engine.music.play("run", 5);
    fake.currentTime = 0.5;
    timer.fire();
    engine.music.setSlowmo(1);
    const filter = fake.nodes.find((n) => n.kind === "biquad") as unknown as { frequency: { value: number } };
    expect(filter.frequency.value).toBeLessThan(1000);
    const detuned = fake.sources.filter((s) => s.playbackRate.value < 0.8);
    expect(detuned.length).toBeGreaterThan(0);
  });

  it("stops on the next bar when asked", async () => {
    const { fake, timer, engine } = setup();
    await engine.unlock();
    engine.music.play("run", 5);
    fake.currentTime = 0.2;
    timer.fire();
    engine.music.stop({ at: "bar" });
    expect(engine.music.playing).toBe(true);
    for (let t = 0.2; t < 3; t += 0.025) {
      fake.currentTime = t;
      timer.fire();
    }
    expect(engine.music.playing).toBe(false);
    expect(timer.active).toBe(false);
  });
});

describe("prewarm", () => {
  it("renders buffers in the background so first plays never synthesize", async () => {
    const { fake, engine } = setup();
    await engine.unlock();
    await engine.prewarmInBackground(["gulp.rumble", "bite"]);
    const nodesBefore = fake.nodes.length;
    engine.play("gulp.rumble");
    expect(fake.sources[0]?.buffer?.length).toBeGreaterThan(fake.sampleRate);
    // Only the source node is created on play (no extra graph nodes).
    expect(fake.nodes.length).toBe(nodesBefore + 1);
  });
});
