// CPU-side geometry builders. Everything that moves is done in the vertex
// shader, so these only run when the star count changes.
import * as THREE from 'three';
import { mulberry32 } from './palettes.js';

// Particle kinds (aKind attribute) - keep in sync with shaders.js
export const KIND = { DISK: 0, BULGE: 1, HAZE: 2, DUST: 3, BRIGHT: 4 };

/**
 * Shared layout for galaxy particles:
 *   position (vec3) random offsets in [-1, 1] (shaped by randomnessPower in the shader)
 *   aSeed    (vec4) x: radius 0..1, y: arm selector, z: life phase, w: brightness/size
 *   aRnd     (vec4) x: stagger, y: colour variation, zw: random direction (scatter / Big Bang)
 *   aKind    (float) one of KIND
 */
function makeGeometry(total) {
  return {
    pos: new Float32Array(total * 3),
    seed: new Float32Array(total * 4),
    rnd: new Float32Array(total * 4),
    kind: new Float32Array(total),
    n: 0,
  };
}

function push(buf, rand, kind, rn, ox, oy, oz) {
  const i = buf.n++;
  buf.pos[i * 3] = ox;
  buf.pos[i * 3 + 1] = oy;
  buf.pos[i * 3 + 2] = oz;
  buf.seed[i * 4] = rn;
  buf.seed[i * 4 + 1] = rand();
  buf.seed[i * 4 + 2] = rand();
  buf.seed[i * 4 + 3] = rand();
  buf.rnd[i * 4] = rand();
  buf.rnd[i * 4 + 1] = rand();
  buf.rnd[i * 4 + 2] = rand();
  buf.rnd[i * 4 + 3] = rand();
  buf.kind[i] = kind;
}

function toGeometry(buf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(buf.pos.subarray(0, buf.n * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(buf.seed.subarray(0, buf.n * 4), 4));
  g.setAttribute('aRnd', new THREE.BufferAttribute(buf.rnd.subarray(0, buf.n * 4), 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(buf.kind.subarray(0, buf.n), 1));
  // Positions are computed on the GPU; a generous fixed sphere keeps three.js happy.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  return g;
}

const signedCube = (rand) => rand() * 2 - 1;

/** Unit-ball point (uniform in volume). */
function ballPoint(rand, out) {
  let x, y, z;
  do {
    x = rand() * 2 - 1;
    y = rand() * 2 - 1;
    z = rand() * 2 - 1;
  } while (x * x + y * y + z * z > 1);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Stars of the galaxy: disk + central bulge + bright young stars + soft haze. */
export function buildGalaxyGeometry(count, seed = 20240611) {
  const rand = mulberry32(seed);
  const nBulge = Math.round(count * 0.1);
  const nBright = Math.round(count * 0.018);
  const nDisk = Math.max(0, count - nBulge - nBright);
  const nHaze = Math.max(200, Math.round(count * 0.007));
  const buf = makeGeometry(count + nHaze);
  const b = [0, 0, 0];

  for (let i = 0; i < nDisk; i++) {
    const rn = 0.015 + 0.985 * rand();
    push(buf, rand, KIND.DISK, rn, signedCube(rand), signedCube(rand), signedCube(rand));
  }
  for (let i = 0; i < nBulge; i++) {
    const rn = 0.02 + Math.pow(rand(), 1.7) * 0.2;
    ballPoint(rand, b);
    push(buf, rand, KIND.BULGE, rn, b[0], b[1], b[2]);
  }
  for (let i = 0; i < nBright; i++) {
    const rn = 0.16 + 0.84 * rand();
    push(buf, rand, KIND.BRIGHT, rn, signedCube(rand), signedCube(rand), signedCube(rand));
  }
  for (let i = 0; i < nHaze; i++) {
    const rn = 0.04 + 0.96 * Math.pow(rand(), 0.9);
    push(buf, rand, KIND.HAZE, rn, signedCube(rand), signedCube(rand), signedCube(rand));
  }
  return toGeometry(buf);
}

/** Dark dust clouds that sit on the inner edge of every arm. */
export function buildDustGeometry(count, seed = 7741) {
  const rand = mulberry32(seed);
  const n = Math.max(200, Math.round(count * 0.022));
  const buf = makeGeometry(n);
  for (let i = 0; i < n; i++) {
    const rn = 0.1 + 0.78 * Math.pow(rand(), 0.85);
    push(buf, rand, KIND.DUST, rn, signedCube(rand), signedCube(rand), signedCube(rand));
  }
  return toGeometry(buf);
}

/** Distant background stars on a big sphere (aStar: size px, brightness, twinkle, temperature). */
export function buildBackgroundGeometry(count, seed = 99) {
  const rand = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const star = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 380 + rand() * 120;
    pos[i * 3] = s * Math.cos(phi) * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = s * Math.sin(phi) * r;
    const m = Math.pow(rand(), 5);
    star[i * 4] = 1.0 + m * 2.0; // size in px (before pixel ratio): bright stars are bigger,
    star[i * 4 + 1] = Math.min(0.5, 0.1 + Math.pow(rand(), 3) * 0.4 + m * 0.3); // not hotter
    star[i * 4 + 2] = rand(); // twinkle phase / speed
    star[i * 4 + 3] = rand(); // colour temperature
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aStar', new THREE.BufferAttribute(star, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 600);
  return g;
}
