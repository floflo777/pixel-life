/**
 * A minimal in-memory AudioContext for unit tests: records nodes, connections, automation and
 * source starts so engine behaviour can be asserted without a browser. Test-only; not exported.
 */

/** One automation call recorded on a FakeParam. */
export interface Automation {
  readonly method: string;
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  value: number;
  readonly events: Automation[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number): this {
    this.events.push({ method: "set", value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ method: "linear", value, time });
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ method: "exp", value, time });
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, time: number, _tc: number): this {
    this.events.push({ method: "target", value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ method: "cancel", value: Number.NaN, time });
    return this;
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  constructor(
    readonly ctx: FakeAudioContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode>(dest: T): T {
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "gain");
  }
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "panner");
  }
}

export class FakeBiquad extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "biquad");
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  constructor(ctx: FakeAudioContext) {
    super(ctx, "compressor");
  }
}

export class FakeBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(_channel: number): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  constructor(ctx: FakeAudioContext) {
    super(ctx, "source");
    ctx.sources.push(this);
  }
  start(when = 0): void {
    if (this.startedAt !== null) throw new Error("InvalidStateError: start called twice");
    this.startedAt = when;
  }
  stop(when = 0): void {
    if (this.startedAt === null) throw new Error("InvalidStateError: stop before start");
    this.stoppedAt = when;
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly nodes: FakeNode[] = [];
  readonly sources: FakeSource[] = [];
  readonly destination: FakeNode;
  constructor(sampleRate = 16_000) {
    this.sampleRate = sampleRate;
    this.destination = new FakeNode(this, "destination");
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }
  /** Sources started at or before `time` (and not stopped before it). */
  startedBy(time: number): FakeSource[] {
    return this.sources.filter((s) => s.startedAt !== null && s.startedAt <= time);
  }
}

/** Casts the fake to the DOM type at the single boundary where the engine receives it. */
export function asAudioContext(fake: FakeAudioContext): AudioContext {
  return fake as unknown as AudioContext;
}

/** A manual timer: tests call `fire()` instead of waiting for real intervals. */
export class ManualTimer {
  private fn: (() => void) | null = null;
  setInterval(fn: () => void, _ms: number): unknown {
    this.fn = fn;
    return 1;
  }
  clearInterval(_handle: unknown): void {
    this.fn = null;
  }
  get active(): boolean {
    return this.fn !== null;
  }
  fire(): void {
    this.fn?.();
  }
}
