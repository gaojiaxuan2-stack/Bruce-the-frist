// Shaders for the Shapes scene. All per-particle animation happens here:
// morph (aFrom -> position with stagger, puff and curl swirl), breathing, heartbeat,
// "charging" tremble, fist core, explosion burst, the fingertip push with its wake and
// the planet body hiding whatever is behind it.
import * as THREE from 'three';
import { GLSL } from '../../core/glsl.js';

export const TRAIL_SLOTS = 8;

const vertexShader = /* glsl */ `
${GLSL.simplex3}
${GLSL.curl}
${GLSL.hash}
${GLSL.pointSize}

attribute vec3 aFrom;
attribute vec3 aColorFrom;
attribute vec3 aColorTo;
attribute vec4 aRand;   // x: stagger random, y: size, z: phase, w: amplitude random
attribute float aDelay; // morph start (0..1), mixes random + the shape's sweep order
attribute float aCarry; // swirl weight carried over from an interrupted morph

uniform float uTime;
uniform float uProgress;
uniform float uSpread;
uniform float uPuff;
uniform float uSwirl;
uniform float uCarryDecay;
uniform float uCollapse;
uniform float uExplodeT;
uniform float uExplodeAmp;
uniform float uTremble;
uniform float uBeat;
uniform float uSize;
uniform float uSizeFrom;   // per-shape dot size, blended per particle during the morph
uniform float uSizeTo;
uniform float uOcclude;    // 0..1: the planet body hides the ring / back side behind it
uniform float uOccRadius;  // object-space radius of that body
uniform float uFocus;
uniform float uRepelRadius;
uniform vec4 uTrail[${TRAIL_SLOTS}];

varying vec3 vColor;
varying float vAlpha;

float easeInOutCubic(float x) {
  return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) * 0.5;
}

void main() {
  // ---- morph between the previous and the current shape
  float lp = clamp((uProgress - aDelay * uSpread) / (1.0 - uSpread), 0.0, 1.0);
  float e = easeInOutCubic(lp);
  float mid = sin(3.14159265 * lp);
  vec3 p = mix(aFrom, position, e);
  p *= 1.0 + uPuff * mid * (0.5 + aRand.w);
  vec3 col = mix(aColorFrom, aColorTo, e);
  vec3 shapeP = p;
  float ph = aRand.z * 6.2831853;
  vec3 rnd = hash31(aRand.z * 7919.0 + 3.0) - 0.5;

  // ---- explosion envelope (fast out, springy return)
  float boom = 0.0;
  if (uExplodeT < 4.0) {
    float t = uExplodeT / (0.26 + 0.22 * aRand.x);
    boom = t * exp(1.0 - t);
  }

  // ---- curl-noise swirl while travelling (and during the explosion)
  float travel = max(mid, aCarry * uCarryDecay);
  float swAmp = uSwirl * (0.15 + 0.85 * travel) + boom * 0.6;
  if (swAmp > 0.002) {
    vec3 c = curlNoise(p * 0.32 + vec3(0.0, uTime * 0.12, 0.0));
    p += c * swAmp * (0.3 + 0.7 * aRand.w);
  }

  // ---- breathing + individual drift
  float n = snoise(shapeP * 0.55 + vec3(0.0, 0.0, uTime * 0.22));
  p += normalize(shapeP + vec3(1e-4)) * n * 0.06;
  p += 0.02 * vec3(sin(uTime * 0.9 + ph), sin(uTime * 1.13 + ph * 1.7), sin(uTime * 0.77 + ph * 2.3));
  p *= 1.0 + uBeat;

  // ---- "charging" tremble while a finger count is being held
  p += uTremble * 0.055 * vec3(sin(uTime * 31.0 + ph * 7.0), sin(uTime * 37.0 + ph * 11.0), sin(uTime * 43.0 + ph * 13.0));
  p *= 1.0 - uTremble * 0.04;

  // ---- fist: collapse into a tight spinning core (a bright ball inside a tilted swirl disc)
  float ci = clamp(uCollapse * 1.4 - aRand.x * 0.4, 0.0, 1.0);
  ci = ci * ci * (3.0 - 2.0 * ci);
  if (ci > 0.0) {
    vec3 dir = shapeP + rnd * 0.9 + vec3(1e-4);
    if (aRand.x > 0.42) dir.y *= 0.12;
    dir = normalize(dir);
    float r = (0.06 + 0.95 * pow(aRand.w, 1.7)) * (1.0 + 0.07 * sin(uTime * 9.0 + ph));
    float ang = uTime * (0.7 + 0.3 / (r + 0.05)) + ph;
    float cs = cos(ang);
    float sn = sin(ang);
    vec3 core = dir * r;
    core.xz = mat2(cs, -sn, sn, cs) * core.xz;
    core.yz = mat2(0.88, 0.47, -0.47, 0.88) * core.yz;
    p = mix(p, core, ci);
  }

  // ---- open palm after the fist: burst outward, then re-form
  if (boom > 0.0005) {
    vec3 dir = normalize(shapeP + rnd * 1.3 + vec3(1e-4));
    p += dir * boom * uExplodeAmp * (0.3 + 1.2 * aRand.w * aRand.w);
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  // ---- fingertip push (view space; uTrail = ray direction + strength, head + fading wake).
  // Area preserving: a dot at distance d from the finger's ray moves out to
  // sqrt(d^2 + K^2 s e(d)). That clears a round hole of radius ~K*sqrt(s) and spreads the
  // displaced dots evenly around it; the map never folds over, so there is no hard rim.
  vec3 disp = vec3(0.0);
  float total = 0.0;
  float wsum = 0.0;
  float wmax = 1e-4;
  float re = uRepelRadius * (-mv.z / uFocus);
  float re2 = re * re;
  float K2 = re2 * 1.35 * (1.0 + 0.8 * rnd.x); // every dot has its own hole size: a soft edge, not a drawn circle
  float F2 = re2 * 6.0;
  for (int i = 0; i < ${TRAIL_SLOTS}; i++) {
    vec4 tr = uTrail[i];
    if (abs(tr.w) < 0.002) continue;
    vec3 perp = mv.xyz - tr.xyz * dot(mv.xyz, tr.xyz);
    float d2 = dot(perp, perp);
    float fe = exp(-d2 / F2);
    float nd2 = max(d2 + K2 * tr.w * fe, d2 * 0.35);
    float inv = inversesqrt(max(d2, 1e-8));
    disp += perp * inv * (sqrt(nd2) - d2 * inv);
    float g = abs(tr.w) * fe;
    wsum += g;
    wmax = max(wmax, g);
    total += abs(tr.w) * exp(-d2 / re2);
  }
  // overlapping head + wake slots must not dig a hole twice as deep
  mv.xyz += disp / max(1.0, wsum / wmax);
  float push = min(total, 1.5);

  // ---- planet body: dots behind it (seen from the camera) fade out, so the far half of
  // the ring passes behind the planet instead of shining through it
  float occ = 0.0;
  if (uOcclude > 0.001) {
    vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float R = uOccRadius * length(modelViewMatrix[0].xyz);
    float L = length(mv.xyz);
    vec3 rd = mv.xyz / L;
    float tca = dot(c, rd);
    float h2 = R * R - (dot(c, c) - tca * tca);
    if (h2 > 0.0) {
      float t0 = tca - sqrt(h2);
      occ = smoothstep(0.0, 0.25, L - t0) * smoothstep(0.0, 0.2, h2 / (R * R)) * uOcclude;
    }
  }

  gl_Position = projectionMatrix * mv;

  // ---- size + brightness (soft depth of field: out-of-focus dots get bigger and fainter)
  float dof = abs(-mv.z - uFocus);
  float shapeSize = mix(uSizeFrom, uSizeTo, e);
  float size = uSize * shapeSize * aRand.y * (1.0 + 0.15 * push + 0.25 * boom) * (1.0 + 0.1 * min(dof, 4.0)) * mix(1.0, 0.75, ci);
  gl_PointSize = clamp(pointSize(size, mv), 1.0, 64.0);

  float tw = 0.78 + 0.22 * sin(uTime * (1.3 + aRand.x * 2.7) + ph * 3.0);
  vAlpha = (0.5 + 0.5 * aRand.w) * tw / (1.0 + dof * 0.22);
  vAlpha *= 1.0 + push * 0.1 + uTremble * 0.7 + boom * 0.3;
  vAlpha *= mix(1.0, 0.06 + 0.5 * aRand.w * aRand.w, ci); // the dense centre stays soft, the outer swirl keeps its colour
  vAlpha *= 1.0 - 0.9 * occ;
  vColor = mix(col, vec3(1.0, 0.93, 0.86) * max(max(col.r, col.g), col.b) * 1.3 + 0.05, clamp(push * 0.04 + ci * 0.15 + boom * 0.1, 0.0, 0.6));
}
`;

const fragmentShader = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float halo = 1.0 - d;
  float a = halo * halo * 0.75 + smoothstep(0.45, 0.0, d) * 0.55;
  gl_FragColor = vec4(vColor * uIntensity, a * vAlpha);
}
`;

export function createShapeMaterial(shared) {
  const trail = [];
  for (let i = 0; i < TRAIL_SLOTS; i++) trail.push(new THREE.Vector4(0, 0, -1, 0));
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uProgress: { value: 0 },
      uSpread: { value: 0.45 },
      uPuff: { value: 0.16 },
      uSwirl: { value: 0 },
      uCarryDecay: { value: 0 },
      uCollapse: { value: 0 },
      uExplodeT: { value: 100 },
      uExplodeAmp: { value: 1.6 },
      uTremble: { value: 0 },
      uBeat: { value: 0 },
      uSize: { value: 2.6 },
      uSizeFrom: { value: 1 },
      uSizeTo: { value: 1 },
      uOcclude: { value: 0 },
      uOccRadius: { value: 1.1 },
      uFocus: { value: 10 },
      uRepelRadius: { value: 0.62 },
      uTrail: { value: trail },
      uIntensity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------------------ background stars

const starVertex = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute vec3 aStar; // x: size, y: phase, z: brightness
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aStar.x * uPixelRatio;
  vAlpha = aStar.z * (0.65 + 0.35 * sin(uTime * (0.6 + aStar.y) + aStar.y * 40.0));
  vColor = mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.9, 0.8), fract(aStar.y * 13.7));
}
`;

const starFragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.0);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

export function createStarMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: { uTime: shared.uTime, uPixelRatio: shared.uPixelRatio },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
