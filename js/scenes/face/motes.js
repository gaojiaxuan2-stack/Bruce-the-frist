// A sparse field of slowly drifting dust motes around the head. They live in
// world space (not in the rotating head group), so they give parallax and a
// sense of depth when the head turns.
import * as THREE from 'three';
import { GLSL } from '../../core/glsl.js';
import { MUSIC_GLSL } from '../music/MusicReact.js';

const vertexShader = /* glsl */ `
${GLSL.hash}
${MUSIC_GLSL}
uniform float uTime;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform float uOpacity;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;

void main() {
  vec3 h = hash31(aSeed * 113.0 + 1.7);
  vec3 p = position;
  float a = uTime * (0.015 + 0.02 * h.x);
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  p += vec3(sin(uTime * 0.21 + h.y * 30.0), sin(uTime * 0.17 + h.z * 30.0), cos(uTime * 0.19 + h.x * 30.0)) * 0.25;
  vec4 mu = music();
  p *= 1.0 + 0.05 * mu.y; // the dust swells out with the bass
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.018 + 0.03 * h.z * h.z);
  gl_PointSize = max(1.0, size * projectionMatrix[1][1] * 0.5 * uViewportHeight * uPixelRatio / max(-mv.z, 0.1));
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + h.x * 1.4) + h.y * 40.0);
  vAlpha = uOpacity * twinkle * (0.25 + 0.75 * h.x) * smoothstep(1.0, 4.0, -mv.z);
  vAlpha *= 1.0 + 0.35 * mu.x + 2.0 * mu.w * musicGlint(h.z, uTime); // and glitters with the treble
  vSeed = h.y;
}
`;

const fragmentShader = /* glsl */ `
${GLSL.softDisc}
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vAlpha;
varying float vSeed;
void main() {
  float a = glowDisc(gl_PointCoord) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(uColorA, uColorB, vSeed), a);
}
`;

/** @param {object} music MusicReact uniforms (uReact, uBeatWave) */
export function createMotes(count, shared, music) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // A thick shell around the head, flattened a little in depth.
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = 4 + Math.pow(Math.random(), 0.7) * 9;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(t) * 1.25;
    pos[i * 3 + 1] = r * u * 0.85;
    pos[i * 3 + 2] = r * s * Math.sin(t) * 0.8 - 1;
    seed[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: shared.uTime,
    uPixelRatio: shared.uPixelRatio,
    uViewportHeight: shared.uViewportHeight,
    ...music,
    uOpacity: { value: 0.5 },
    uColorA: { value: new THREE.Color('#ffd7ae') },
    uColorB: { value: new THREE.Color('#9fd8ff') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, uniforms };
}
