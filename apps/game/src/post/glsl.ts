/** Ordered 4×4 Bayer threshold in [0, 1): the only "gradient" the art style allows. */
export const BAYER_GLSL = /* glsl */ `
float plBayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float plBayer4(vec2 a){ return plBayer2(0.5 * a) * 0.25 + plBayer2(a); }
`;
