// Point-cloud generators for the Shapes scene.
// Every generator returns { pos, col, sweep } for exactly `n` particles:
//   pos   Float32Array(n*3)  object-space position (shapes are ~5 units tall, centred on the origin)
//   col   Float32Array(n*3)  LINEAR rgb colour (brightness already baked in)
//   sweep Float32Array(n)    0..1 order in which the particle settles during a morph
//                            (e.g. along the knot's path, bottom-to-top, left-to-right)
import * as THREE from 'three';

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Small seeded RNG so the shapes look the same on every load. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}

function randDir(rand, out) {
  const z = rand() * 2 - 1;
  const t = rand() * TAU;
  const r = Math.sqrt(1 - z * z);
  out.x = r * Math.cos(t);
  out.y = z;
  out.z = r * Math.sin(t);
  return out;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Gradient sampler over sRGB hex stops; colours are interpolated in linear space. */
export function palette(hexes) {
  const cols = hexes.map((h) => new THREE.Color(h));
  return (t, out) => {
    const x = clamp01(t) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(x));
    return out.lerpColors(cols[i], cols[i + 1], x - i);
  };
}

class Writer {
  constructor(n) {
    this.n = n;
    this.i = 0;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.sweep = new Float32Array(n);
  }

  get full() {
    return this.i >= this.n;
  }

  push(x, y, z, c, b, sweep) {
    if (this.i >= this.n) return;
    const i = this.i++;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.col[j] = c.r * b;
    this.col[j + 1] = c.g * b;
    this.col[j + 2] = c.b * b;
    this.sweep[i] = clamp01(sweep);
  }

  /** Pad (if needed) and shuffle so particle i of one shape maps to a random spot of the next. */
  finish(rand) {
    const { n, pos, col, sweep } = this;
    const filled = Math.max(1, this.i);
    for (let i = this.i; i < n; i++) {
      const s = Math.floor(rand() * filled);
      pos.copyWithin(i * 3, s * 3, s * 3 + 3);
      col.copyWithin(i * 3, s * 3, s * 3 + 3);
      sweep[i] = sweep[s];
    }
    for (let i = n - 1; i > 0; i--) {
      const k = Math.floor(rand() * (i + 1));
      for (let c = 0; c < 3; c++) {
        const a = i * 3 + c;
        const b = k * 3 + c;
        let t = pos[a];
        pos[a] = pos[b];
        pos[b] = t;
        t = col[a];
        col[a] = col[b];
        col[b] = t;
      }
      const t = sweep[i];
      sweep[i] = sweep[k];
      sweep[k] = t;
    }
    return { pos, col, sweep };
  }
}

// ------------------------------------------------------------------ 1 sphere

export function sphereTarget(n, rand) {
  const w = new Writer(n);
  const R = 2.2;
  const shell = palette(['#3a1cff', '#2a6dff', '#16c8ff', '#7dffe9', '#e9fffb']);
  const core = palette(['#ff2fb0', '#ff6fd0', '#ffc6f0']);
  const c = new THREE.Color();
  const d = new THREE.Vector3();
  const nShell = Math.round(n * 0.64);
  const nInner = Math.round(n * 0.14);
  const nVol = n - nShell - nInner;

  // Outer Fibonacci shell with swirled colour bands.
  for (let i = 0; i < nShell; i++) {
    const y = 1 - (2 * (i + 0.5)) / nShell;
    const r = Math.sqrt(1 - y * y);
    const th = i * GOLDEN;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    const jit = R * (1 + gauss(rand) * 0.008);
    const lon = Math.atan2(z, x);
    shell((y + 1) / 2 + 0.11 * Math.sin(lon * 3 + y * 5), c);
    w.push(x * jit, y * jit, z * jit, c, 0.8 + 0.3 * rand(), (1 - y) / 2);
  }
  // Inner glowing shell.
  const R2 = R * 0.5;
  for (let i = 0; i < nInner; i++) {
    const y = 1 - (2 * (i + 0.5)) / nInner;
    const r = Math.sqrt(1 - y * y);
    const th = i * GOLDEN;
    const jit = R2 * (1 + gauss(rand) * 0.02);
    core((y + 1) / 2, c);
    w.push(Math.cos(th) * r * jit, y * jit, Math.sin(th) * r * jit, c, 0.75, (1 - y) / 2);
  }
  // Soft volume between the shells.
  for (let i = 0; i < nVol; i++) {
    randDir(rand, d);
    const rr = R * 0.92 * Math.cbrt(rand());
    const k = rr / R;
    core(1 - k, c);
    w.push(d.x * rr, d.y * rr, d.z * rr, c, 0.28 + 0.2 * (1 - k), (1 - d.y * k) / 2);
  }
  return w.finish(rand);
}

// ------------------------------------------------------------------ 2 torus knot

export function knotTarget(n, rand) {
  const w = new Writer(n);
  const p = 2;
  const q = 3;
  const radius = 1.5;
  const tube = 0.34;
  const pal = palette(['#ff2d95', '#ff6a3d', '#ffc93c', '#b14dff', '#ff2d95']);
  const c = new THREE.Color();
  const curve = (u, out) => {
    const qu = (q / p) * u;
    const cs = Math.cos(qu);
    out.set(radius * (2 + cs) * 0.5 * Math.cos(u), radius * (2 + cs) * 0.5 * Math.sin(u), radius * Math.sin(qu) * 0.5);
    return out;
  };
  // Arc-length table so particles are spread evenly along the curve.
  const M = 4096;
  const U = p * TAU;
  const cum = new Float32Array(M + 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  curve(0, a);
  for (let i = 1; i <= M; i++) {
    curve((i / M) * U, b);
    cum[i] = cum[i - 1] + a.distanceTo(b);
    a.copy(b);
  }
  const total = cum[M];
  const P1 = new THREE.Vector3();
  const P2 = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = rand();
    const target = s * total;
    let lo = 0;
    let hi = M;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid;
      else hi = mid;
    }
    const f = (target - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
    const u = ((lo + f) / M) * U;
    curve(u, P1);
    curve(u + 0.01, P2);
    T.subVectors(P2, P1);
    N.addVectors(P2, P1);
    B.crossVectors(T, N);
    N.crossVectors(B, T);
    B.normalize();
    N.normalize();
    const phi = rand() * TAU;
    const surface = rand() < 0.74;
    const rr = surface ? tube * (1 + gauss(rand) * 0.035) : tube * 0.85 * Math.sqrt(rand());
    const cp = Math.cos(phi) * rr;
    const sp = Math.sin(phi) * rr;
    pal((s * 2) % 1, c);
    const light = 0.72 + 0.28 * Math.cos(phi - 0.6);
    w.push(P1.x + N.x * cp + B.x * sp, P1.y + N.y * cp + B.y * sp, P1.z + N.z * cp + B.z * sp, c, surface ? light : 0.4, s);
  }
  return w.finish(rand);
}

// ------------------------------------------------------------------ 3 heart

// Taubin's heart (x² + 9/4 y² + z² − 1)³ = x² z³ + 9/80 y² z³  (z up, y = depth).
// Along a ray r·d from the origin this becomes  a r² − b r^(5/3) = 1, which has exactly
// one positive root, so the heart is star-shaped and every ray finds its surface point.
function heartRadius(dx, dy, dz) {
  const a = dx * dx + 2.25 * dy * dy + dz * dz;
  const b = dz * Math.cbrt(dx * dx + 0.1125 * dy * dy);
  // f is convex and increasing right of its root (r > 0.6), so Newton started above the
  // root converges monotonically in a handful of steps.
  let r = 1.6;
  for (let k = 0; k < 20; k++) {
    const c = Math.cbrt(r * r);
    if (a * r * r - b * r * c - 1 >= 0) break;
    r *= 1.25;
  }
  for (let i = 0; i < 8; i++) {
    const c = Math.cbrt(r * r); // r^(2/3)
    const f = a * r * r - b * r * c - 1;
    const df = 2 * a * r - (5 / 3) * b * c;
    if (df <= 1e-9) break;
    const step = f / df;
    r -= step;
    if (Math.abs(step) < 1e-7) break;
  }
  return r;
}

export function heartTarget(n, rand) {
  const w = new Writer(n);
  const S = 2.05;
  const zc = 0.1;
  const surf = palette(['#9e0020', '#ff1748', '#ff4f86', '#ffa3c8']);
  const inner = palette(['#ff1f5a', '#ff7aa8']);
  const c = new THREE.Color();
  const d = new THREE.Vector3();
  const rMax = 1.45;
  let guard = 0;
  while (!w.full && guard++ < n * 40) {
    randDir(rand, d);
    const r = heartRadius(d.x, d.z, d.y); // our y (up) is the heart's z; our z (depth) is its y
    if (rand() > (r / rMax) * (r / rMax)) continue; // even out surface density
    const surface = rand() < 0.7;
    const rr = surface ? r * (1 - Math.abs(gauss(rand)) * 0.01) : r * Math.pow(rand(), 0.45) * 0.97;
    const X = d.x * rr * S;
    const Y = (d.y * rr - zc) * S;
    const Z = d.z * rr * S;
    const t = (Y + 2.3) / 4.6;
    if (surface) {
      surf(t + 0.08 * Math.sin(X * 1.5 + Z * 2.0), c);
      const light = 0.6 + 0.55 * Math.max(0, d.x * -0.35 + d.y * 0.5 + d.z * 0.79);
      w.push(X, Y, Z, c, (0.65 + 0.3 * rand()) * light, t);
    } else {
      inner(t, c);
      w.push(X, Y, Z, c, 0.3, t);
    }
  }
  return w.finish(rand);
}

// ------------------------------------------------------------------ 4 DNA

export function dnaTarget(n, rand) {
  const w = new Writer(n);
  const H = 5.2;
  const R = 1.0;
  const turns = 2.2;
  const k = (TAU * turns) / H;
  const off = Math.PI * 0.78;
  const tube = 0.17;
  const strandA = palette(['#1fe4ff', '#2f6bff', '#1fe4ff']);
  const strandB = palette(['#ff3d9a', '#a24dff', '#ff3d9a']);
  const pairs = [
    ['#5dffa8', '#ffd84a'],
    ['#ffd84a', '#5dffa8'],
    ['#ff7a45', '#45c8ff'],
    ['#45c8ff', '#ff7a45'],
  ].map((p) => p.map((h) => new THREE.Color(h)));
  const dust = new THREE.Color('#7c8cff');
  const c = new THREE.Color();
  const d = new THREE.Vector3();
  const nStrand = Math.round(n * 0.5);
  const nRung = Math.round(n * 0.42);
  const rungs = 24;

  for (let i = 0; i < nStrand; i++) {
    const s = rand();
    const y = (s - 0.5) * H;
    const second = i & 1;
    const ang = y * k + (second ? off : 0);
    randDir(rand, d);
    // mostly on the tube's skin: where the two strands cross on screen they must not
    // pile up into a white blob
    const skin = rand() < 0.82;
    const rr = tube * (skin ? 1 + gauss(rand) * 0.04 : Math.sqrt(rand()));
    (second ? strandB : strandA)(s, c);
    w.push(Math.cos(ang) * R + d.x * rr, y + d.y * rr, Math.sin(ang) * R + d.z * rr, c, skin ? 0.48 + 0.22 * rand() : 0.3, s);
  }
  for (let i = 0; i < nRung; i++) {
    const m = Math.floor(rand() * rungs);
    const s = (m + 0.5) / rungs;
    const y = (s - 0.5) * H * 0.97;
    const a0 = y * k;
    const a1 = a0 + off;
    const x0 = Math.cos(a0) * R;
    const z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;
    let t = 0.08 + rand() * 0.84;
    if (Math.abs(t - 0.5) < 0.025) t += t < 0.5 ? -0.03 : 0.03; // tiny gap between the two bases
    const pair = pairs[m % pairs.length];
    c.copy(t < 0.5 ? pair[0] : pair[1]);
    const j = 0.035;
    w.push(x0 + (x1 - x0) * t + gauss(rand) * j, y + gauss(rand) * j, z0 + (z1 - z0) * t + gauss(rand) * j, c, 0.45 + 0.25 * rand(), s);
  }
  while (!w.full) {
    const ang = rand() * TAU;
    const r = 1.3 + rand() * 1.5;
    const y = (rand() - 0.5) * H * 1.1;
    w.push(Math.cos(ang) * r, y, Math.sin(ang) * r, dust, 0.12 + 0.18 * rand(), y / H + 0.5);
  }
  return w.finish(rand);
}

// ------------------------------------------------------------------ 5 planet

function ringDensity(r) {
  if (r < 1.62) return 0;
  if (r < 1.95) return 0.22; // faint inner ring
  if (r < 2.42) return 1; // bright main ring
  if (r < 2.52) return 0.03; // dark gap
  if (r < 2.8) return 0.68;
  if (r < 2.84) return 0.06; // thin gap
  if (r < 2.96) return 0.5;
  return 0;
}

export function planetTarget(n, rand) {
  const w = new Writer(n);
  const Rp = 1.22;
  const body = palette(['#9c3216', '#ff7426', '#ffb35c', '#ffe3b8', '#d4572a']);
  const ring = palette(['#3352ff', '#6f8dff', '#b7a6ff', '#ffc48f', '#ff8f5c']);
  const c = new THREE.Color();
  const d = new THREE.Vector3();
  const nBody = Math.round(n * 0.44);
  const nRing = Math.round(n * 0.52);

  for (let i = 0; i < nBody; i++) {
    randDir(rand, d);
    const surface = rand() < 0.8;
    const rr = surface ? Rp * (1 + gauss(rand) * 0.006) : Rp * Math.cbrt(rand()) * 0.96;
    const lat = Math.asin(d.y);
    const lon = Math.atan2(d.z, d.x);
    const wave = Math.sin(lat * 11 + 1.4 * Math.sin(lat * 4) + 0.35 * Math.sin(lon * 2 + lat * 7));
    const band = 0.5 + 0.5 * Math.sign(wave) * Math.pow(Math.abs(wave), 0.6);
    body(band, c);
    // the planet spins about its axis, so only latitude may shape the light (brighter north)
    const light = 0.78 + 0.22 * d.y;
    w.push(d.x * rr, d.y * rr, d.z * rr, c, surface ? 0.85 * light : 0.25, 0.3 * (rr / Rp));
  }
  const r0 = 1.6;
  const r1 = 2.98;
  let guard = 0;
  let placed = 0;
  while (placed < nRing && guard++ < nRing * 20) {
    const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0));
    const dens = ringDensity(r);
    if (rand() > dens) continue;
    const ang = rand() * TAU;
    const t = (r - r0) / (r1 - r0);
    ring(t, c);
    const fine = 0.8 + 0.2 * Math.sin(r * 73) * Math.sin(r * 31);
    w.push(Math.cos(ang) * r, gauss(rand) * 0.014, Math.sin(ang) * r, c, (0.28 + 0.34 * dens) * fine, 0.35 + 0.65 * t);
    placed++;
  }
  // faint outer haze
  const haze = new THREE.Color('#9aa8ff');
  while (!w.full) {
    const r = 3.0 + rand() * 0.7;
    const ang = rand() * TAU;
    w.push(Math.cos(ang) * r, gauss(rand) * 0.05, Math.sin(ang) * r, haze, 0.1 + 0.12 * rand(), 1);
  }
  return w.finish(rand);
}

// ------------------------------------------------------------------ 6 text

const FONT_STACK = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;
const BASE_PX = 160;
/** Max height (units) of the whole text block for 1, 2 and 3 lines; the width cap is TEXT_W. */
const TEXT_H = [2.4, 3.3, 3.9];
const TEXT_W = 6.6;
/** Letter dots per unit² of letter face: dense enough to read, sparse enough not to burn out. */
const TEXT_DENSITY = 17000;

/** Cut `tokens` into `lines` groups so the widest line is as narrow as possible. */
function bestSplit(tokens, lines, joiner, width) {
  let best = null;
  let bestW = Infinity;
  const rec = (start, left, acc) => {
    if (left === 1) {
      const all = [...acc, tokens.slice(start).join(joiner).trim()];
      const m = Math.max(...all.map(width));
      if (m < bestW) {
        bestW = m;
        best = all;
      }
      return;
    }
    for (let i = start + 1; i <= tokens.length - (left - 1); i++) {
      rec(i, left - 1, [...acc, tokens.slice(start, i).join(joiner).trim()]);
    }
  };
  if (tokens.length >= lines) rec(0, lines, []);
  return best ? { lines: best, width: bestW } : null;
}

/** Break points: after a word (with its spaces) or after any single CJK character. */
const TOKENS = /(?:[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+)\s*/g;

/** Long text wraps onto 2–3 lines so the letters stay big enough to read. */
function layoutLines(ctx, str) {
  const width = (t) => ctx.measureText(t).width;
  const aspect = width(str) / BASE_PX;
  const n = aspect <= 5.2 ? 1 : aspect <= 10.5 ? 2 : 3;
  if (n === 1) return [str];
  // prefer whole words; split inside a word only when that is much better balanced
  const byWords = bestSplit(str.match(TOKENS) || [str], n, '', width);
  const byChars = bestSplit(Array.from(str), n, '', width);
  if (byWords && (!byChars || byWords.width <= byChars.width * 1.5)) return byWords.lines;
  return byChars ? byChars.lines : [str];
}

function rasterise(str) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Synthetic "black" weight smears Chinese / Japanese / Korean strokes together.
  const weight = CJK.test(str) ? 600 : 900;
  let fontPx = BASE_PX;
  const font = () => `${weight} ${fontPx}px ${FONT_STACK}`;
  ctx.font = font();
  const lines = layoutLines(ctx, str);
  let width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (width > 1600) {
    fontPx = Math.max(32, Math.floor((fontPx * 1600) / width));
    ctx.font = font();
    width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  }
  const lineH = Math.ceil(fontPx * 1.2);
  const pad = Math.ceil(fontPx * 0.3);
  canvas.width = Math.ceil(width) + pad * 2;
  canvas.height = lineH * lines.length + pad * 2;
  ctx.font = font(); // resizing the canvas resets the context
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, pad + lineH * (i + 0.5)));
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const W = canvas.width;
  const Hh = canvas.height;
  const filled = [];
  const edges = [];
  let minX = W;
  let maxX = 0;
  let minY = Hh;
  let maxY = 0;
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && data[(y * W + x) * 4 + 3] > 127;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      const idx = y * W + x;
      filled.push(idx);
      if (!on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)) edges.push(idx);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { W, filled, edges, minX, maxX, minY, maxY, lines: lines.length };
}

/**
 * Text rasterised on a 2D canvas, then extruded into a thin 3D slab of points.
 * Only as many dots as the letters can hold go into them (so a short word does not
 * burn out to a flat blob); the rest become a faint glowing dust that hugs the letters.
 */
export function textTarget(n, text, rand) {
  let str = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  let img = str ? rasterise(str) : null;
  if (!img || img.filled.length < 20) {
    str = 'HELLO';
    img = rasterise(str);
  }
  const { W, filled, edges, minX, maxX, minY, maxY, lines } = img;
  const w = new Writer(n);
  const pal = palette(['#00a896', '#00a0e0', '#8a5ae6', '#ea58b0', '#f2d640']);
  const c = new THREE.Color();
  const pw = maxX - minX + 1;
  const ph = maxY - minY + 1;
  const s = Math.min(TEXT_W / pw, TEXT_H[lines - 1] / ph);
  const cx = (minX + maxX + 1) / 2;
  const cy = (minY + maxY + 1) / 2;
  const depth = 0.25;
  // TEXT_DENSITY is for the full ("high") particle count; lower qualities use bigger dots
  const want = filled.length * s * s * TEXT_DENSITY * (n / 120000);
  const nLetter = Math.round(Math.min(n, Math.max(want, n * 0.25)));
  // a tiny text (one short letter) still gets a quarter of the dots: dim them instead
  const dim = Math.min(1, want / nLetter);
  const pick = (edge) => (edge ? edges[Math.floor(rand() * edges.length)] : filled[Math.floor(rand() * filled.length)]);

  for (let i = 0; i < nLetter; i++) {
    const edge = edges.length > 0 && rand() < 0.32;
    const idx = pick(edge);
    const px = (idx % W) + rand();
    const py = Math.floor(idx / W) + rand();
    const X = (px - cx) * s;
    const Y = -(py - cy) * s;
    let Z;
    let b;
    if (edge) {
      Z = (rand() - 0.5) * depth; // the side walls give the crisp outline
      b = 0.8;
    } else {
      const r = rand();
      if (r < 0.66) {
        Z = depth / 2; // front face
        b = 1;
      } else if (r < 0.88) {
        Z = -depth / 2; // back face
        b = 0.25;
      } else {
        Z = (rand() - 0.5) * depth;
        b = 0.15;
      }
      Z += gauss(rand) * 0.008;
    }
    const t = (px - minX) / pw;
    pal(t + 0.05 * Math.sin(Y * 3), c);
    w.push(X, Y, Z, c, b * dim * (0.8 + 0.3 * rand()), t);
  }
  // faint dust around the strokes: a soft particle glow, a little deeper than the letters
  while (!w.full) {
    const idx = pick(false);
    const px = (idx % W) + rand();
    const py = Math.floor(idx / W) + rand();
    const spread = 0.12 + 0.3 * rand() * rand();
    const X = (px - cx) * s + gauss(rand) * spread;
    const Y = -(py - cy) * s + gauss(rand) * spread;
    const Z = -0.05 + gauss(rand) * 0.35;
    const t = (px - minX) / pw;
    pal(t, c);
    const r = rand();
    w.push(X, Y, Z, c, 0.015 + 0.11 * r * r * r, t);
  }
  const out = w.finish(rand);
  out.text = str;
  return out;
}

// ------------------------------------------------------------------ intro cloud

/** A wide, dim cloud the particles fly in from on first load. */
export function cloudTarget(n, rand) {
  const pos = new Float32Array(n * 3);
  const d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    randDir(rand, d);
    const r = 4.5 + Math.pow(rand(), 0.6) * 4.5;
    pos[i * 3] = d.x * r;
    pos[i * 3 + 1] = d.y * r;
    pos[i * 3 + 2] = d.z * r;
  }
  return pos;
}
