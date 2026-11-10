// Watercolour post-process: turns the linear HDR render of the stacks into a painted plate.
// Kuwahara-style flat washes, pigment pooling at edges, granulation, wet-in-wet blooms and paper fibre.
// Night mode pools into an umber ground with a warm lamp glow; day mode fades to paper.

export const watercolorVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const watercolorFragment = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uDark;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uNight;
varying vec2 vUv;

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 grade(vec3 c) { return pow(aces(c * 1.05), vec3(1.0 / 2.2)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tap(vec2 uv) { return grade(texture2D(tScene, uv).rgb); }

void main() {
  float asp = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 q = uv * vec2(asp, 1.0);

  // hand-drawn wobble: the image drifts along slow noise, like pigment that settled unevenly
  vec2 warp = vec2(fbm(q * 7.0 + 3.1), fbm(q * 7.0 + 8.7)) - 0.5;
  vec2 suv = uv + warp * 0.0065;

  // simplified Kuwahara: four quadrants, keep the calmest one = flat washes with crisp edges
  vec2 st = 2.2 / uRes;
  vec3 m[4]; float s[4];
  for (int k = 0; k < 4; k++) {
    vec2 dir = vec2(k == 0 || k == 2 ? -1.0 : 1.0, k < 2 ? -1.0 : 1.0);
    vec3 acc = vec3(0.0); float acc2 = 0.0;
    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
      vec3 c = tap(suv + dir * vec2(float(i), float(j)) * st);
      acc += c; float l = lum(c); acc2 += l * l;
    }
    acc /= 9.0; m[k] = acc; float ml = lum(acc); s[k] = acc2 / 9.0 - ml * ml;
  }
  vec3 col = m[0]; float best = s[0];
  for (int k = 1; k < 4; k++) { if (s[k] < best) { best = s[k]; col = m[k]; } }

  // pigment pooling at shape edges
  float e1 = lum(tap(suv + vec2(st.x * 1.5, 0.0))) - lum(tap(suv - vec2(st.x * 1.5, 0.0)));
  float e2 = lum(tap(suv + vec2(0.0, st.y * 1.5))) - lum(tap(suv - vec2(0.0, st.y * 1.5)));
  float edge = smoothstep(0.035, 0.2, length(vec2(e1, e2)));
  float L = lum(col);

  // layered washes: soften toward a few tonal steps
  float Lq = (floor(L * 5.0) + smoothstep(0.35, 0.65, fract(L * 5.0))) / 5.0;
  col *= mix(1.0, Lq / max(L, 0.001), 0.45);
  col = mix(vec3(lum(col)), col, 0.92);

  // granulation + blotchy wet-in-wet blooms
  float gran = fbm(q * uRes.y / 140.0);
  float bloom = fbm(q * 2.3 + vec2(0.0, uTime * 0.004));
  col *= 0.86 + 0.26 * gran;
  col *= 0.9 + 0.2 * bloom;
  float fiber = fbm(q * uRes.y / 3.0) * 0.6 + fbm(vec2(q.x * uRes.y / 1.5, q.y * 4.0)) * 0.4;

  vec3 outc;
  if (uDark > 0.5) {
    col = mix(col, col * vec3(0.78, 0.8, 1.08), 1.0 - smoothstep(0.0, 0.4, L));
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 8; i++) { float a = float(i) * 0.785; vec3 c = tap(suv + vec2(cos(a), sin(a)) * 26.0 / uRes); glow += max(c - 0.55, 0.0); }
    outc = mix(uNight, col, 0.94) + glow * vec3(1.0, 0.72, 0.4) * 0.22;
    outc *= 1.0 - edge * 0.3;
    outc *= 0.94 + 0.08 * fiber;
    vec2 v = vUv - vec2(0.6, 0.48);
    outc = mix(outc, uNight, smoothstep(0.18, 0.62, dot(v, v) * 1.6 + (bloom - 0.5) * 0.25));
  } else {
    col = mix(col, uPaper, smoothstep(0.66, 0.97, L) * 0.75);
    outc = uPaper * mix(vec3(1.0), col / uPaper, 0.93);
    outc *= 1.0 - edge * 0.32;
    outc *= 0.93 + 0.09 * fiber;
    float border = min(min(vUv.x, 1.0 - vUv.x) * asp, min(vUv.y, 1.0 - vUv.y));
    outc = mix(uPaper * (0.97 + 0.05 * fiber), outc, smoothstep(0.0, 0.16, border + (bloom - 0.5) * 0.12));
  }
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`
