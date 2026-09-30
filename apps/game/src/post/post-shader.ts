import { BAYER_GLSL } from "./glsl";

/** Compile-time feature switches for the post pass (set from the quality tier). */
export interface PostFeatures {
  readonly halo: boolean;
  readonly bloom: boolean;
  readonly crease: boolean;
  readonly outline: boolean;
  readonly dither: boolean;
  readonly fogSteps: number;
  /** Bloom kernel radius in render px (5 = the bible's 11×11). */
  readonly bloomRadius: number;
}

/** Builds the `#define` block for a feature set (also the program cache key). */
export function postDefines(f: PostFeatures): Record<string, string | number> {
  const steps = Math.max(0, Math.round(f.fogSteps));
  const d: Record<string, string | number> = { FOG_STEPS: `${steps}.0`, FOG_STEPS_I: steps };
  if (f.halo) d["PL_HALO"] = 1;
  if (f.bloom) d["PL_BLOOM"] = 1;
  if (f.crease) d["PL_CREASE"] = 1;
  if (f.outline) d["PL_OUTLINE"] = 1;
  if (f.dither) d["PL_DITHER"] = 1;
  d["BLOOM_R"] = Math.max(1, Math.min(5, Math.round(f.bloomRadius)));
  return d;
}

/** Fullscreen triangle-ish quad vertex shader (clip-space plane). */
export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * The one post pass (art bible §3 step 5), run at internal resolution: sky, stepped fog, depth
 * outline, crease lines from depth-reconstructed normals, Friend halo + keyline from the mask
 * target, dithered dot-bloom from the glow channel, and 1-bit impact frames/bursts.
 */
export const POST_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tMask;
uniform vec2 res;
uniform float near;
uniform float far;
uniform mat4 invViewProj;
uniform mat4 invProj;
uniform vec3 camPos;
uniform vec3 sky[5];
uniform vec2 skyEdges;
uniform vec2 fogRange;
uniform vec3 fogColor;
uniform vec3 ink;
uniform vec3 paper;
uniform float haloWidth;
uniform vec3 haloColors[8];
uniform vec3 glowColors[8];
uniform float glowGain;
uniform float time;
uniform vec4 burst;
uniform float fullFrame;
uniform float borderPx;
varying vec2 vUv;
${BAYER_GLSL}

float linDepth(float z) {
  float n = z * 2.0 - 1.0;
  return 2.0 * near * far / (far + near - n * (far - near));
}
float depthAt(vec2 px) { return texture2D(tDepth, (px + 0.5) / res).x; }
vec3 viewPos(vec2 px) {
  float z = depthAt(px);
  vec4 p = invProj * vec4((px + 0.5) / res * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
vec3 skyColor(vec2 px, float b) {
  vec4 p = invViewProj * vec4((px + 0.5) / res * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w - camPos);
  float s = clamp((d.y - skyEdges.x) / (skyEdges.y - skyEdges.x), 0.0, 1.0) * 4.0;
  float i = floor(min(s, 3.999));
  float f = clamp((fract(s) - 0.5) * 2.6 + 0.5, 0.0, 1.0);
  vec3 lo = sky[4]; vec3 hi = sky[3];
  if (i > 2.5) { lo = sky[1]; hi = sky[0]; }
  else if (i > 1.5) { lo = sky[2]; hi = sky[1]; }
  else if (i > 0.5) { lo = sky[3]; hi = sky[2]; }
  return f > b ? hi : lo;
}
float maxc(vec3 c) { return max(c.r, max(c.g, c.b)); }
int maskHalo(vec2 px) { return int(texture2D(tMask, (px + 0.5) / res).r * 255.0 + 0.5); }
int maskGlow(vec2 px) { return int(texture2D(tMask, (px + 0.5) / res).g * 255.0 + 0.5); }
#ifdef PL_CREASE
vec3 normalAt(vec2 px) {
  vec3 c = viewPos(px);
  vec3 l = viewPos(px - vec2(1.0, 0.0)); vec3 r = viewPos(px + vec2(1.0, 0.0));
  vec3 d = viewPos(px - vec2(0.0, 1.0)); vec3 u = viewPos(px + vec2(0.0, 1.0));
  vec3 dx = abs(r.z - c.z) < abs(c.z - l.z) ? r - c : c - l;
  vec3 dy = abs(u.z - c.z) < abs(c.z - d.z) ? u - c : c - d;
  return normalize(cross(dx, dy));
}
#endif

void main() {
  vec2 px = floor(vUv * res);
#ifdef PL_DITHER
  float b = plBayer4(px);
#else
  float b = 0.5;
#endif
  float z = depthAt(px);
  bool isSky = z > 0.99999;
  vec3 col = isSky ? skyColor(px, b) : texture2D(tColor, (px + 0.5) / res).rgb;
  float d0 = isSky ? far : linDepth(z);
  int h0 = maskHalo(px);

  float fl = 0.0;
#if FOG_STEPS_I > 0
  if (!isSky) {
    float f = clamp((d0 - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
    fl = floor(f * FOG_STEPS + b) / FOG_STEPS;
    col = mix(col, fogColor, fl * 0.8);
  }
#endif

#ifdef PL_CREASE
  if (!isSky && h0 == 0) {
    vec3 n0 = normalAt(px);
    vec3 nr = normalAt(px + vec2(1.0, 0.0));
    vec3 nu = normalAt(px + vec2(0.0, 1.0));
    float zr = linDepth(depthAt(px + vec2(1.0, 0.0)));
    float zu = linDepth(depthAt(px + vec2(0.0, 1.0)));
    if ((length(n0 - nr) > 0.45 && abs(zr - d0) < 0.06 * d0) || (length(n0 - nu) > 0.45 && abs(zu - d0) < 0.06 * d0))
      col = mix(col, ink, 0.5 * (1.0 - fl * 0.8));
  }
#endif

#ifdef PL_OUTLINE
  float edge = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    float zn = depthAt(px + o);
    float dn = zn > 0.99999 ? far : linDepth(zn);
    if (d0 - dn > 0.035 * dn + 0.03) edge = 1.0;
  }
  if (edge > 0.0) col = mix(ink, fogColor, fl * 0.75);
#endif

#ifdef PL_HALO
  if (h0 == 0 && haloWidth > 0.0) {
    float md = 99.0;
    int hi = 0;
    for (int y = -4; y <= 4; y++) for (int x = -4; x <= 4; x++) {
      float dd = length(vec2(float(x), float(y)));
      if (dd > haloWidth + 1.5) continue;
      int m = maskHalo(px + vec2(float(x), float(y)));
      if (m > 0 && dd < md) { md = dd; hi = m; }
    }
    if (hi > 0) {
      vec3 hc = haloColors[hi];
      // Streak 30+: gold-white dither, animated at 2 fps.
      if (hi == 6 && plBayer4(px + vec2(floor(time * 2.0) * 2.0, 0.0)) > 0.5) hc = vec3(1.0, 0.973, 0.894);
      if (md <= haloWidth + 0.45) col = hc;
      else if (md <= haloWidth + 1.45) col = ink;
    }
  }
#endif

#ifdef PL_BLOOM
  if (maskGlow(px) == 0) {
    vec3 g = vec3(0.0);
    for (int y = -BLOOM_R; y <= BLOOM_R; y++) for (int x = -BLOOM_R; x <= BLOOM_R; x++) {
      float r2 = float(x * x + y * y);
      if (r2 > float(BLOOM_R * BLOOM_R) + 5.0) continue;
      int gi = maskGlow(px + vec2(float(x), float(y)));
      if (gi > 0) g += glowColors[gi] * (1.0 / (1.0 + r2 * 0.35));
    }
    g *= glowGain / 9.0;
    float a = maxc(g);
    if (a > 0.0) {
      vec3 gc = g / max(a, 1e-3);
      if (a > b) col = mix(col, gc, 0.55);
      if (a > b + 0.9) col = mix(col, vec3(1.0, 0.98, 0.9), 0.6);
    }
  }
#endif

  float l = dot(col, vec3(0.299, 0.587, 0.114)) + (b - 0.5) * 0.35;
  if (burst.z > 0.0) {
    vec2 d = px - burst.xy;
    float ang = atan(d.y, d.x);
    float tri = abs(fract(ang / 6.2831853 * 9.0 + 0.25) - 0.5) * 2.0;
    float R = mix(burst.w, burst.z, pow(tri, 1.6));
    float r = length(d);
    if (r < R) col = l > 0.5 ? ink : paper;
    else if (r < R + 2.0) col = ink;
  }
  if (fullFrame > 0.5) {
    bool light = l > 0.5;
    if (fullFrame > 1.5) light = !light;
    col = light ? paper : ink;
  }
  if (borderPx > 0.0 && (px.x < borderPx || px.y < borderPx || px.x >= res.x - borderPx || px.y >= res.y - borderPx)) col = ink;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Nearest-neighbour upscale from the internal target to the canvas. */
export const BLIT_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tPost;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tPost, vUv).rgb, 1.0); }
`;
