/**
 * State checksum (architecture §4.6). Two independent 32-bit lanes (FNV-1a-style and murmur-style) over the exact IEEE-754
 * bits of every number, read little-endian through a DataView so the byte order never depends on the host.
 */

/** Incremental 64-bit state hasher. Feed values in a fixed order, then read `hex()`. */
export class Hasher {
  private h1 = 0x811c9dc5 | 0;
  private h2 = 0x9e3779b9 | 0;
  private readonly view = new DataView(new ArrayBuffer(8));

  /** Mixes an unsigned 32-bit integer. */
  u32(x: number): void {
    const v = x | 0;
    this.h1 = Math.imul(this.h1 ^ v, 0x01000193);
    let k = Math.imul(v, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    this.h2 ^= k;
    this.h2 = (this.h2 << 13) | (this.h2 >>> 19);
    this.h2 = (Math.imul(this.h2, 5) + 0xe6546b64) | 0;
  }

  /** Mixes the exact 64 bits of a float64 (so −0, 0 and every ulp differ). */
  f64(x: number): void {
    this.view.setFloat64(0, x, true);
    this.u32(this.view.getUint32(0, true));
    this.u32(this.view.getUint32(4, true));
  }

  /** Mixes a boolean. */
  bool(b: boolean): void {
    this.u32(b ? 1 : 0);
  }

  /** 16 lowercase hex chars (two finalised 32-bit lanes). Does not reset the hasher. */
  hex(): string {
    return (
      fmix(this.h1 ^ this.h2)
        .toString(16)
        .padStart(8, "0") +
      fmix(this.h2 + 0x2545f491)
        .toString(16)
        .padStart(8, "0")
    );
  }
}

function fmix(h0: number): number {
  let h = h0 | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
