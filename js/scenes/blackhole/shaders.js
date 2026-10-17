// GLSL for the Black Hole scene. Everything moves on the GPU: the CPU only
// updates a handful of uniforms per frame.
import { GLSL } from '../../core/glsl.js';

/**
 * Gravitational lensing, done in view space.
 * uHoleView is the hole centre in view space. A point behind the plane through
 * the hole (perpendicular to the line of sight) is projected onto that plane,
 * and its distance b from the hole (the impact parameter) is pushed outward
 * with the point-lens formula  b' = (b + sqrt(b^2 + 4A)) / 2  (~ b + A/b far
 * away, smooth near b = 0). The far side of the disk therefore wraps over the
 * top and under the bottom of the shadow, like Gargantua in Interstellar.
 * The lens strength ramps in with depth behind the plane so nothing pops.
 */
const LENS = /* glsl */ `
uniform vec3 uHoleView;
uniform float uRing;

vec3 lensPrimary(vec3 p, float A, float ramp, out float stretch) {
  stretch = 1.0;
  float dC = length(uHoleView);
  vec3 c = uHoleView / dC;
  float dP = dot(p, c);
  float behind = dP - dC;
  if (behind <= 0.0 || A <= 0.0) return p;
  float a = A * smoothstep(0.0, ramp, behind);
  vec3 q = p * (dC / dP) - uHoleView;
  float b = max(length(q), 1e-4);
  float bn = 0.5 * (b + sqrt(b * b + 4.0 * a));
  stretch = bn / b;
  return (uHoleView + q * stretch) * (dP / dC);
}

// The secondary image: light that went UNDER the hole. It shows up on the
// opposite side, squeezed into a thin crescent that hugs the photon ring.
vec3 lensSecondary(vec3 p, float A, float ramp, out float weight) {
  weight = 0.0;
  float dC = length(uHoleView);
  vec3 c = uHoleView / dC;
  float dP = dot(p, c);
  float behind = dP - dC;
  if (behind <= 0.0 || A <= 0.0) return p;
  vec3 q = p * (dC / dP) - uHoleView;
  float b = max(length(q), 1e-4);
  float bRel = b / sqrt(A);
  float bs = uRing * (1.0 + 0.2 * exp(-bRel * 1.6) + 0.025 * sin(b * 9.0));
  weight = exp(-bRel * 1.25) * smoothstep(0.0, ramp, behind) * clamp(A / 3.0, 0.0, 1.0);
  return (uHoleView - (q / b) * bs) * (dP / dC);
}
`;

const SPRITE = /* glsl */ `
float sprite(vec2 uv) {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = max(1.0 - r2, 0.0);
  return a * a;
}
`;

// ---------------------------------------------------------------- accretion disk

export const diskVertex = /* glsl */ `
${GLSL.simplex3}
${GLSL.hash}
${GLSL.pointSize}
${LENS}
attribute vec4 aOrbit;   // spawn radius, start angle, phase, inflow speed (cycles per clock unit)
attribute vec4 aRand;    // gaussian, size rand, brightness rand, kind (0 disk, 1 stream, 2 plunge)
uniform float uTime;
uniform float uClock;
uniform float uRin;
uniform float uRout;
uniform float uRs;
uniform float uOrbitK;
uniform float uSize;
uniform float uBright;
uniform float uFeed;
uniform float uLensA;
uniform float uViewGain;
uniform float uFlash;
uniform float uStreams;
uniform float uBeam;
uniform vec4 uShock;     // radius, amplitude, width, -
uniform vec3 uCol0;
uniform vec3 uCol1;
uniform vec3 uCol2;
uniform vec3 uCol3;
varying vec3 vColor;

vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(uCol0, uCol1, smoothstep(0.0, 0.2, t));
  c = mix(c, uCol2, smoothstep(0.22, 0.6, t));
  return mix(c, uCol3, smoothstep(0.55, 1.0, t));
}

void main() {
  float kind = aRand.w;
  bool isStream = kind > 0.5 && kind < 1.5;
  bool isPlunge = kind > 1.5;
  float rOut = aOrbit.x;
  float s = aOrbit.w;
  float u = fract(aOrbit.z + s * uClock);
  float rEnd = isPlunge ? 1.02 : 2.6 * 0.86;
  float span = max(rOut - rEnd, 0.1);
  float x = rOut - span * u;
  // Keplerian spiral: angle = integral of omega(r(t)) dt with omega = K r^-1.5 and r(t) linear in time.
  float theta = aOrbit.y + (2.0 * uOrbitK / (s * span)) * (inversesqrt(x) - inversesqrt(rOut));

  float sh = 0.0;
  if (isStream) {
    sh = hash11(aOrbit.y * 17.31 + 3.7);
    // each stream fades in and out on its own slow cycle, and jumps to a new angle while hidden
    float cyc = uTime * 0.05 + sh;
    theta += floor(cyc) * 2.39996;
    x += aRand.x * 0.05 * (1.0 + 0.05 * x);
  }

#ifdef SECONDARY
  // Most particles have no visible secondary image: bail out before the noise.
  {
    vec4 mv0 = viewMatrix * (modelMatrix * vec4(x * cos(theta), 0.0, x * sin(theta), 1.0));
    float w0;
    lensSecondary(mv0.xyz, uLensA, 2.5, w0);
    if (w0 < 0.003) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vColor = vec3(0.0);
      return;
    }
  }
#endif

  // Swirling streaks: noise advected with the local orbital speed, two layers
  // cross-faded so the pattern never winds up into mush (flow-map trick).
  float omega = uOrbitK * pow(x, -1.5);
  const float P = 6.0;
  float tA = fract(uClock / P);
  float tB = fract(uClock / P + 0.5);
  float wA = 1.0 - abs(2.0 * tA - 1.0);
  float wB = 1.0 - wA;
  float lr = log(x);
  float phA = theta - omega * tA * P;
  float phB = theta - omega * tB * P;
  float nA = snoise(vec3(cos(phA) * 2.1, sin(phA) * 2.1, lr * 4.2 + 1.7));
  float nB = snoise(vec3(cos(phB) * 2.1, sin(phB) * 2.1, lr * 4.2 + 9.3));
  float n = (nA * wA + nB * wB) / sqrt(wA * wA + wB * wB);

  // Feeding pulls the whole flow inward; the release shock wave pushes it out.
  float xv = rEnd + (x - rEnd) * (1.0 - 0.2 * uFeed);
  float sd = (x - uShock.x) / uShock.z;
  float shock = uShock.y * exp(-sd * sd);
  xv += shock * 0.9;

  float thick = 0.018 + 0.026 * max(x - uRin, 0.0);
  if (isStream) thick *= 0.35;
  float h = aRand.x * (thick * (1.0 + 0.55 * n) + shock * 0.35);
  if (isStream) h += (sh - 0.5) * 0.32 * max(x - uRin, 0.0);

  vec3 pos = vec3(xv * cos(theta), h, xv * sin(theta));
  vec4 world = modelMatrix * vec4(pos, 1.0);

  // Relativistic Doppler beaming: the side coming toward us is brighter and bluer.
  vec3 vel = normalize((modelMatrix * vec4(-sin(theta), 0.0, cos(theta), 0.0)).xyz);
  vec3 toCam = normalize(cameraPosition - world.xyz);
  float beta = uBeam * 0.36 * sqrt(uRin / max(x, 1.0));
  float D = sqrt(1.0 - beta * beta) / (1.0 - beta * dot(vel, toCam));

  vec4 mv = viewMatrix * world;
#ifdef SECONDARY
  float weight;
  vec3 lp = lensSecondary(mv.xyz, uLensA, 2.5, weight);
  float stretch = 1.0;
  if (weight < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }
#else
  float stretch;
  vec3 lp = lensPrimary(mv.xyz, uLensA, 2.5, stretch);
  float weight = 1.0;
#endif
  vec4 mvl = vec4(lp, 1.0);
  gl_Position = projectionMatrix * mvl;

  // Temperature: blue-white hot inside -> yellow -> orange -> deep red rim.
  float t = clamp((x - uRin) / (uRout - uRin), 0.0, 1.0);
  float tt = pow(t, 0.6);
  tt -= (D - 1.0) * 0.3;
  tt -= uFeed * 0.35 * (1.0 - t);
  if (isPlunge) tt = min(tt, 0.08);
  vec3 col = palette(tt);

  float I = 0.015 + 0.07 * pow(uRin / max(x, uRin * 0.9), 2.4);
  I *= 0.3 + 1.25 * smoothstep(-0.5, 0.8, n);
  I *= pow(D, 1.6);
  I *= 0.55 + 0.9 * aRand.z;

  float fade = smoothstep(0.0, 0.07, u);
  if (isPlunge) {
    fade *= smoothstep(uRs * 1.05, uRs * 1.9, x) * 0.45;
  } else if (isStream) {
    float cyc = fract(uTime * 0.05 + sh);
    fade *= (1.0 - smoothstep(0.82, 1.0, u)) * smoothstep(0.0, 0.25, cyc) * (1.0 - smoothstep(0.6, 1.0, cyc));
    fade *= uStreams * 2.2;
    I = max(I, 0.045) * 1.6;
  } else {
    float edge = uRin * (0.93 + 0.07 * n);
    fade *= smoothstep(edge * 0.88, edge * 1.06, x);
  }
  I *= fade;
  I *= 1.0 + uFeed * 0.8 * (1.0 - t) + uFlash * 0.9;

  // The release shock front glows white-hot as it rolls through the disk.
  col = mix(col, uCol0 * 1.4, clamp(shock * 0.8, 0.0, 1.0));
  I += shock * (0.05 + 0.1 * aRand.z) * fade;

#ifdef SECONDARY
  I *= weight * 1.3;
#else
  // Lensed (stretched) images: keep their surface brightness.
  I *= mix(1.0, min(stretch, 2.5), 0.6);
#endif

  vColor = col * I * uBright * uViewGain;
  float size = uSize * (0.55 + 0.9 * aRand.y) * (1.0 + 0.5 * shock) * (isStream ? 1.2 : 1.0);
#ifdef SECONDARY
  size *= 0.8;
#endif
  gl_PointSize = min(pointSize(size, mvl) * sqrt(clamp(stretch, 1.0, 3.0)), 40.0);
}
`;

export const pointFragment = /* glsl */ `
${SPRITE}
varying vec3 vColor;
void main() {
  float a = sprite(gl_PointCoord);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// ---------------------------------------------------------------- background stars

export const starVertex = /* glsl */ `
${GLSL.pointSize}
${LENS}
attribute vec4 aStar;   // size px, brightness, temperature, phase
uniform float uTime;
uniform float uLensStar;
uniform float uStarBright;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float stretch;
  vec3 lp = lensPrimary(mv.xyz, uLensStar, 60.0, stretch);
  vec4 mvl = vec4(lp, 1.0);
  gl_Position = projectionMatrix * mvl;
  float tw = 0.7 + 0.3 * sin(uTime * (0.8 + aStar.w * 2.5) + aStar.w * 61.0);
  vec3 c = mix(vec3(0.62, 0.74, 1.0), vec3(1.0, 0.82, 0.62), aStar.z);
  // stars bunched up near the Einstein ring get a touch brighter (magnified)
  vColor = c * aStar.y * tw * uStarBright * min(sqrt(stretch), 2.5);
  gl_PointSize = aStar.x * uPixelRatio * (uViewportHeight / 900.0) * min(sqrt(stretch), 1.8);
}
`;

export const starFragment = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 5.0);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// ---------------------------------------------------------------- dust field

export const dustVertex = /* glsl */ `
${GLSL.pointSize}
${LENS}
attribute vec4 aDust;   // radius, angle, height, rand
uniform float uClock;
uniform float uOrbitK;
uniform float uSize;
uniform float uFeed;
uniform float uLensA;
uniform float uDust;
uniform float uFlash;
uniform vec4 uShock;
uniform vec3 uCol1;
uniform vec3 uCol2;
varying vec3 vColor;
void main() {
  float r = aDust.x * (1.0 - 0.12 * uFeed);
  float sd = (r - uShock.x * 1.15) / (uShock.z * 2.0);
  float shock = uShock.y * exp(-sd * sd);
  r += shock * 1.6;
  float th = aDust.y + uOrbitK * 0.45 * pow(aDust.x, -1.5) * uClock;
  vec3 pos = vec3(r * cos(th), aDust.z * (1.0 + shock * 0.4), r * sin(th));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float stretch;
  vec3 lp = lensPrimary(mv.xyz, uLensA, 3.0, stretch);
  vec4 mvl = vec4(lp, 1.0);
  gl_Position = projectionMatrix * mvl;
  float near = exp(-abs(aDust.z) * 0.35);
  vec3 c = mix(vec3(0.55, 0.58, 0.66), mix(uCol1, uCol2, 0.5), 0.55 * near);
  float I = (0.35 + 0.65 * aDust.w) * (0.4 + 0.6 * near) * smoothstep(2.5, 6.0, aDust.x);
  I *= 1.0 + shock * 1.5 + uFlash * 0.6;
  vColor = c * I * uDust;
  gl_PointSize = min(pointSize(uSize * (0.5 + aDust.w * 0.9), mvl) * sqrt(clamp(stretch, 1.0, 3.0)), 7.0);
}
`;

// ---------------------------------------------------------------- relativistic jets

export const jetVertex = /* glsl */ `
${GLSL.pointSize}
${LENS}
attribute vec4 aJet;    // side, seed, angle, rand
uniform float uJetClock;
uniform float uJet;
uniform float uSize;
uniform float uLensA;
varying vec3 vColor;
void main() {
  float s = fract(aJet.y + uJetClock * (0.1 + 0.05 * aJet.w));
  float len = s * 30.0;
  bool core = aJet.w < 0.35;
  // a tight bright spine inside a wider, fainter sheath
  float rad = core ? (0.04 + 0.012 * len) * (aJet.w / 0.35) : (0.12 + 0.09 * len) * sqrt(aJet.w);
  float ang = aJet.z + len * 0.7 - uJetClock * 2.5;
  vec3 pos = vec3(rad * cos(ang), aJet.x * (uRing * 1.05 + len), rad * sin(ang));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float stretch;
  vec3 lp = lensPrimary(mv.xyz, uLensA, 2.5, stretch);
  vec4 mvl = vec4(lp, 1.0);
  gl_Position = projectionMatrix * mvl;
  float knots = 0.7 + 0.3 * sin(len * 1.3 - uJetClock * 6.0 + aJet.x);
  float I = pow(1.0 - s, 1.7) * smoothstep(0.0, 0.04, s) * knots * (core ? 1.6 : 0.45);
  vec3 c = mix(vec3(0.6, 0.75, 1.0), vec3(0.35, 0.25, 1.0), s);
  vColor = c * I * uJet * 0.5;
  gl_PointSize = min(pointSize(uSize * (0.9 + 1.4 * s), mvl), 30.0);
}
`;

// ---------------------------------------------------------------- photon ring + shadow

export const billboardVertex = /* glsl */ `
varying vec2 vP;
varying vec3 vWorld;
void main() {
  vP = position.xy;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringFragment = /* glsl */ `
uniform float uRing;
uniform float uRingBright;
uniform float uTime;
uniform vec2 uBeamDir;
uniform vec3 uCol0;
uniform vec3 uCol1;
varying vec2 vP;
void main() {
  float r = length(vP);
  float d = (r - uRing) / uRing;
  float core = exp(-d * d / (2.0 * 0.014 * 0.014));
  float halo = exp(-d * d / (2.0 * 0.07 * 0.07)) * 0.22;
  vec2 dir = vP / max(r, 1e-4);
  float beam = 1.0 + 0.6 * dot(dir, uBeamDir);
  float ang = atan(vP.y, vP.x);
  float flick = 0.86 + 0.14 * sin(ang * 7.0 + uTime * 2.3) * sin(ang * 3.0 - uTime * 1.4);
  vec3 col = mix(mix(uCol0, uCol1, 0.35), vec3(1.0), 0.35);
  gl_FragColor = vec4(col * (core + halo) * beam * flick * uRingBright, 1.0);
}
`;

/**
 * "Light sink": the bloom pass would otherwise smear the bright ring and disk
 * into the shadow and turn it grey. The scene is rendered into a half-float
 * target, so this billboard writes NEGATIVE light inside the shadow, exactly
 * the glow the bloom pass added there on the previous frame (its composite
 * texture, colour * alpha). Bloom then adds this frame's glow on top and the
 * shadow ends up pure black, while the near side of the disk that passes in
 * front of the shadow keeps its own brightness.
 */
export const sinkFragment = /* glsl */ `
uniform float uRing;
uniform float uSink;
uniform float uRin;
uniform float uRout;
uniform sampler2D uBloomTex;
uniform vec2 uScreen;
varying vec2 vP;
varying vec3 vWorld;

// Does this view ray hit the near half of the disk (plane y = h) in front of the hole?
float bandHit(vec3 ro, vec3 rd, float h) {
  if (abs(rd.y) < 1e-5) return 0.0;
  float t = (h - ro.y) / rd.y;
  if (t <= 0.0) return 0.0;
  vec3 p = ro + rd * t;
  if (dot(p, ro) <= 0.0) return 0.0;
  float rho = length(p.xz);
  // only the bright inner part matters: the faint outer band never reaches the bloom threshold
  return smoothstep(uRin * 0.78, uRin * 0.92, rho) * (1.0 - smoothstep(uRin * 1.1, uRin * 1.45, rho));
}

void main() {
  float r = length(vP) / uRing;
  float k = 1.0 - smoothstep(0.84, 0.99, r);
  // Leave the part of the disk that passes in front of the shadow alone: it
  // keeps its own glow, and it must not feed back into the bloom (flicker).
  vec3 rd = normalize(vWorld - cameraPosition);
  float band = max(bandHit(cameraPosition, rd, 0.0), max(bandHit(cameraPosition, rd, 0.12), bandHit(cameraPosition, rd, -0.12)));
  k *= 1.0 - band;
  vec4 b = texture2D(uBloomTex, gl_FragCoord.xy / uScreen);
  // a little over-subtraction keeps it black while the glow is ramping up
  gl_FragColor = vec4(-b.rgb * b.a * k * uSink * 1.25, 1.0);
}
`;
