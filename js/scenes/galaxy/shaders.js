// GLSL for the galaxy scene. Every star is placed on the GPU from a few random
// numbers, so changing a GUI value or morphing to a new galaxy costs nothing on
// the CPU. Shader outputs are LINEAR colour (OutputPass converts to sRGB).
import { GLSL } from '../../core/glsl.js';

/** Uniforms + helpers shared by the star and dust shaders. */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uRotTime;      // rigid pattern rotation (rad, wraps at TAU)
uniform float uLifeTime;     // drives the bounded differential rotation (wraps at TAU)
uniform float uDir;          // rotation direction (-1 / +1, smoothed)
uniform float uRadius;
uniform vec4 uParA;          // branches, spin, randomness, randomnessPower (current galaxy)
uniform vec4 uParB;          // same for the galaxy we morph into
uniform vec3 uInA;
uniform vec3 uOutA;
uniform vec3 uInB;
uniform vec3 uOutB;
uniform float uMorph;        // 1 = settled, < 1 = morphing A -> B
uniform vec3 uWell;          // gravity well on the galactic plane
uniform float uWellStrength;
uniform float uWellRadius;
uniform float uWellPhase;
uniform float uCollapse;     // fist: 0..1
uniform float uCollapseSpin; // accumulated spin while collapsing
uniform float uPulse;
uniform float uBang;         // < 0 off, else 0..1 progress
uniform float uBangPower;    // 1 = Big Bang, small = gentle re-form
uniform float uBangC;        // collapse state the bang starts from
uniform float uBangSpin;

attribute vec4 aSeed;  // x radius 0..1, y arm selector, z life phase, w brightness
attribute vec4 aRnd;   // x stagger, y variation, zw direction
attribute float aKind; // 0 disk, 1 bulge, 2 haze, 3 dust, 4 bright

const float TAU = 6.28318530718;
const float PI = 3.14159265359;
const float LIFE = 1.25663706144; // TAU / 5 -> the life clock can wrap at TAU without a jump

bool isKind(float k) { return abs(aKind - k) < 0.5; }

vec2 rot2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec3 randDir(vec2 r) {
  float phi = r.x * TAU;
  float ct = r.y * 2.0 - 1.0;
  float st = sqrt(max(0.0, 1.0 - ct * ct));
  return vec3(st * cos(phi), ct, st * sin(phi));
}

// Three.js-Journey style spiral arm placement, with a few extras per kind.
vec3 diskPos(vec4 par, float rn, float sel, vec3 off) {
  float r = rn * uRadius;
  if (isKind(1.0)) {               // bulge: a flattened ball of old stars
    vec3 b = off * r;
    b.y *= 0.62;
    return b;
  }
  float branches = max(floor(par.x + 0.5), 1.0);
  float ang = floor(sel * branches) / branches * TAU + r * par.y;
  float pw = par.w;
  float spread = par.z;
  if (isKind(2.0)) {               // haze: wide, soft light along the arms
    pw = max(1.0, pw * 0.6);
    spread = spread * 1.2 + 0.04;
  } else if (isKind(3.0)) {        // dust: thin lane on the inner edge of the arm
    ang += (0.07 + 0.04 * (fract(sel * 31.7) - 0.5)) * sign(par.y + 1e-4);
    pw = pw * 1.4;
    spread *= 0.55;
  } else if (isKind(4.0)) {        // bright young stars hug the arms
    pw = pw * 1.25;
  }
  vec3 o = sign(off) * pow(abs(off), vec3(pw)) * spread * r;
  vec3 p = vec3(cos(ang) * r + o.x, o.y * 0.45, sin(ang) * r + o.z);
  float h = fract(sel * 97.31) * 2.0 - 1.0;   // disk thickness, puffier in the middle
  p.y += h * h * h * uRadius * 0.05 * (0.3 + 1.3 * exp(-rn * 5.0));
  return p;
}

vec3 armColor(vec3 cin, vec3 cout, float rn) {
  // mix in (approximate) sRGB space so the gradient looks like the GUI colours
  vec3 a = pow(max(cin, vec3(0.0)), vec3(0.4545));
  vec3 b = pow(max(cout, vec3(0.0)), vec3(0.4545));
  return pow(mix(a, b, clamp(rn * 1.1, 0.0, 1.0)), vec3(2.2));
}

vec3 starColor(vec3 cin, vec3 cout, float rn) {
  float v = aRnd.y;
  vec3 c = armColor(cin, cout, rn + (fract(v * 7.31) - 0.5) * 0.12);
  if (isKind(1.0)) c = mix(armColor(cin, cout, 0.0), vec3(1.0, 0.82, 0.62), 0.12 + 0.25 * v * v);
  else if (isKind(4.0)) c = mix(c, vec3(0.75, 0.86, 1.0), 0.15 + 0.25 * v);
  // a touch more saturation so additive blending does not wash the colours out
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.25), vec3(0.0));
  return c * (0.8 + 0.4 * fract(v * 13.7));
}

// Fist: everything spirals into a small, fast-spinning bright knot.
// ci (out) is how far this star has fallen in, 0..1.
const float BALL_DIM = 0.022; // energy kept per star once collapsed (200k stars in a tiny ball!)
vec3 collapsePos(vec3 p, float c, float spin, out float ci) {
  ci = 0.0;
  if (c <= 0.0) return p;
  ci = clamp(c * 1.6 - aRnd.x * 0.6, 0.0, 1.0);
  ci = ci * ci * (3.0 - 2.0 * ci);
  float rn = aSeed.x;
  p.xz = rot2(p.xz, ci * spin * (1.0 + 1.2 * (1.0 - rn)) * uDir);
  float target = 0.07 + 0.06 * aRnd.y;
  p *= mix(1.0, target, ci) * (1.0 + uPulse * ci);
  p.y *= mix(1.0, 0.45, ci);
  return p;
}

// Star position in galaxy (= world) space, plus colour, alpha factor and "heat" (white-hot glow).
vec3 galaxyPosition(out vec3 col, out float alpha, out float heat, out float wellF) {
  float rn = aSeed.x;
  vec3 p = diskPos(uParA, rn, aSeed.y, position);
  col = starColor(uInA, uOutA, rn);
  alpha = 1.0;
  heat = 0.0;
  wellF = 0.0;

  // new galaxy: stars puff outward, swirl and fall into the new shape and colours
  if (uMorph < 1.0) {
    vec3 pb = diskPos(uParB, rn, aSeed.y, position);
    vec3 cb = starColor(uInB, uOutB, rn);
    float m = clamp((uMorph - aRnd.x * 0.4) / 0.6, 0.0, 1.0);
    float e = m * m * (3.0 - 2.0 * m);
    float s = sin(PI * e);
    p = mix(p, pb, e);
    p.xz = rot2(p.xz, s * 0.9 * uDir);
    p += randDir(aRnd.zw) * s * uRadius * (0.05 + 0.22 * aRnd.y);
    col = mix(col, cb, e);
    alpha *= 1.0 - 0.6 * s;
  }

  // rotation: rigid pattern speed + a bounded differential term (inner stars orbit faster).
  // Each star lives one LIFE cycle, fading in/out, so the arms never wind up.
  float k = 0.55 + 0.9 / (0.35 + 2.5 * rn);
  float life = fract(uLifeTime / LIFE + aSeed.z);
  p.xz = rot2(p.xz, uRotTime + (k - 1.0) * (life - 0.5) * LIFE);
  alpha *= smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.88, life);

  // Big Bang / re-form: from the collapsed knot, out to a burst shell, back into the spiral
  if (uBang >= 0.0) {
    float ci0;
    vec3 start = collapsePos(p, uBangC, uBangSpin, ci0);
    float b = uBang;
    vec3 shell = randDir(aRnd.zw) * uRadius * (0.22 + 0.55 * aRnd.y) * vec3(1.0, 0.55, 1.0) + p * 0.35;
    vec3 burst = mix(p * 0.45, shell, uBangPower);
    float e1 = 1.0 - pow(1.0 - clamp(b / 0.24, 0.0, 1.0), 4.0);
    float e2 = smoothstep(0.1 + 0.42 * aRnd.x, 1.0, b);
    vec3 q = mix(mix(start, burst, e1), p, e2);
    q.xz = rot2(q.xz, e1 * (1.0 - e2) * 1.5 * uDir);
    p = q;
    alpha *= mix(1.0, BALL_DIM, ci0 * (1.0 - e1));
    float hot = mix(uBangC, 1.0, uBangPower) * (0.4 + 0.6 * ci0) * 0.85;
    float hb = hot * (1.0 - smoothstep(0.0, 0.3 + 0.25 * aRnd.x, b));
    heat += hb;
    alpha *= 1.0 - 0.75 * hb * e1;   // the burst is dense: keep it from turning into a white disc
  }

  float ci;
  p = collapsePos(p, uCollapse, uCollapseSpin, ci);
  alpha *= mix(1.0, BALL_DIM, ci);
  heat += smoothstep(0.45, 1.0, ci) * 0.85;

  // ☝️ gravity well: stars nearby orbit the fingertip and sink into a funnel
  if (uWellStrength > 0.001) {
    vec2 rel = p.xz - uWell.xz;
    float d2 = dot(rel, rel) / (uWellRadius * uWellRadius);
    float f = exp(-d2);
    float fw = exp(-d2 * 0.6);
    // coherent twist + a per-star orbit that restarts (faded) every ~2 s, so it never winds up
    float wl = fract(uWellPhase * 0.45 + aSeed.z * 7.13 + aRnd.x);
    rel = rot2(rel, uWellStrength * fw * (2.2 + 1.6 * wl) * uDir);
    rel *= 1.0 - uWellStrength * 0.55 * f;
    p.xz = uWell.xz + rel;
    p.y = p.y * (1.0 - 0.6 * uWellStrength * f) - uWellStrength * uWellRadius * 0.45 * f;
    float env = smoothstep(0.0, 0.18, wl) * smoothstep(1.0, 0.82, wl);
    alpha *= mix(1.0, env, uWellStrength * fw) * (1.0 - 0.3 * uWellStrength * f);
    wellF = uWellStrength * fw;
    heat += uWellStrength * f * 0.22;
  }
  return p;
}
`;

export const starVertex = /* glsl */ `
${GLSL.pointSize}
${COMMON}
uniform float uSize;
uniform float uBright;
varying vec3 vColor;
varying float vAlpha;
varying float vHaze;

void main() {
  vec3 col;
  float alpha, heat, wellF;
  vec3 p = galaxyPosition(col, alpha, heat, wellF);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float w = aSeed.w;
  float size;
  float bright;
  float maxPx = 16.0;
  vHaze = 0.0;
  if (isKind(2.0)) {
    size = 24.0 + 22.0 * w;
    bright = 0.045 * (1.0 - clamp(heat, 0.0, 1.0));
    vHaze = 1.0;
    maxPx = 48.0;
  } else {
    if (isKind(1.0)) { size = 0.75 + 0.7 * w; bright = 0.22 + 0.3 * w; }
    else if (isKind(4.0)) { size = 1.5 + 1.2 * w; bright = 0.9 + 0.7 * w; }
    else { size = 0.7 + 1.5 * pow(w, 4.0); bright = 0.3 + 0.9 * w * w; }
    // the middle is much denser: dim it so additive blending keeps the colours
    bright *= mix(0.3, 1.25, smoothstep(0.0, 0.75, aSeed.x));
    size *= uSize;
  }
  float h = clamp(heat, 0.0, 1.0);
  col = mix(col, vec3(1.0, 0.88, 0.74) * 1.15, h);
  size *= 1.0 + 0.3 * h + 0.3 * wellF;
  bright *= 1.0 + 0.3 * h + 0.3 * wellF;

  float ps = pointSize(size, mv);
  float minPx = 1.6 * uPixelRatio;
  if (ps < minPx) {               // too small to draw: keep the energy, not the size
    alpha *= (ps / minPx) * (ps / minPx);
    ps = minPx;
  }
  gl_PointSize = min(ps, maxPx * uPixelRatio);
  alpha *= smoothstep(0.25, 1.4, -mv.z);  // fade stars right in front of the camera
  vColor = col;
  vAlpha = alpha * bright * uBright;
  if (vAlpha < 0.002) {            // invisible: skip rasterising it
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHaze;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = vHaze > 0.5 ? pow(1.0 - d, 2.2) : max(exp(-d * d * 5.0) - 0.0067, 0.0);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export const dustVertex = /* glsl */ `
${GLSL.pointSize}
${COMMON}
uniform float uDust;
varying float vAlpha;

void main() {
  vec3 col;
  float alpha, heat, wellF;
  vec3 p = galaxyPosition(col, alpha, heat, wellF);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(pointSize(9.0 + 9.0 * aSeed.w, mv), 26.0 * uPixelRatio);
  float fade = 1.0 - smoothstep(0.0, 0.25, uCollapse);
  if (uBang >= 0.0) fade *= smoothstep(0.5, 1.0, uBang);
  fade *= 1.0 - clamp(wellF * 1.5, 0.0, 1.0);
  fade *= smoothstep(0.25, 1.4, -mv.z);
  // lanes are strongest in the middle of the disk
  float rn = aSeed.x;
  float lane = smoothstep(0.08, 0.25, rn) * (1.0 - smoothstep(0.65, 0.92, rn));
  vAlpha = alpha * uDust * fade * lane * (0.45 + 0.55 * aRnd.y);
  if (vAlpha < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

export const dustFragment = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 1.6) * vAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

export const bgVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uBgBright;
attribute vec4 aStar;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.65 + 0.35 * sin(uTime * (0.5 + aStar.z * 2.6) + aStar.z * 60.0);
  vec3 cool = vec3(0.62, 0.75, 1.0);
  vec3 warm = vec3(1.0, 0.8, 0.6);
  vColor = mix(mix(cool, warm, aStar.w), vec3(1.0), 0.35);
  vAlpha = aStar.y * tw * uBgBright;
  gl_PointSize = max(aStar.x * uPixelRatio, 1.0);
}
`;

export const bgFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor, max(exp(-d * d * 4.0) - 0.018, 0.0) * vAlpha);
}
`;

/** Camera-facing quad (PlaneGeometry 1x1) centred on the mesh position. */
export const billboardVertex = /* glsl */ `
uniform float uScale;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uScale;
  gl_Position = projectionMatrix * mv;
}
`;

export const coreFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float g = exp(-r * r * 26.0) * 0.85 + exp(-r * 6.5) * 0.2;
  g *= 1.0 - smoothstep(0.7, 1.0, r);
  gl_FragColor = vec4(uColor * g * uIntensity, 1.0);
}
`;

export const wellFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float glow = exp(-r * r * 70.0) * (0.85 + 0.15 * sin(uTime * 5.0)) + exp(-r * 9.0) * 0.2;
  float v = glow * (1.0 - smoothstep(0.75, 1.0, r));
  gl_FragColor = vec4(uColor * v * uIntensity, 1.0);
}
`;

/** Flat swirl on the galactic plane around the gravity well. */
export const wellRingFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uDir;
varying vec2 vUv;
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x);
  // three spiral arms flowing into the centre
  float arms = pow(0.5 + 0.5 * sin(a * 3.0 + uDir * uTime * 2.6 + log(r + 0.05) * 5.0), 3.0);
  float band = smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.55, 1.0, r));
  float ring = exp(-pow((r - 0.3) / 0.05, 2.0)) * 0.5;
  gl_FragColor = vec4(uColor * (arms * band * 0.5 + ring) * uIntensity, 1.0);
}
`;

/** Flat ring on the galactic plane (Big Bang shock wave). */
export const shockVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const shockFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float width = 0.03 + 0.06 * uProgress;
  float ring = exp(-pow((r - 0.9) / width, 2.0));
  float v = ring * (1.0 - smoothstep(0.96, 1.0, r)) * uIntensity;
  gl_FragColor = vec4(uColor * v, 1.0);
}
`;
