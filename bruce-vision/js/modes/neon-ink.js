// neon-ink.js — the strokes of NEON DRAW: storage, smoothing, tessellation
// into GPU triangle strips, light clusters, and sampling for particles.
//
// A stroke keeps its raw pen points (CSS px, at least STEP apart). For the
// GPU it becomes a quadratic-midpoint curve, then a triangle strip whose
// vertices carry (x, y, s, side): s = arc length, side = ±1 across the tube.
// The strip is cached and rebuilt only when the stroke changes or on resize.

export const STYLES = ['neon', 'rainbow', 'fire', 'stars'];
export const PALETTE = ['#ff3df2', '#38f9ff', '#b6ff3d', '#ff9a1f', '#9d5cff'];
export const FIRE_COLS = ['#ffe08a', '#ffb02e', '#ff7a12', '#ff4a0a'];
export const STAR_COLS = ['#ffffff', '#fff1c4', '#c4e6ff', '#ffd98a'];
export const RAINBOW_COLS = Array.from({ length: 12 }, (_, i) => rgbCss(hsv(i / 12, 0.8, 1)));

export const STEP = 2.5;          // px between stored pen points
export const MAX_PTS = 1400;      // per stroke; longer lines continue in a new stroke
const MAX_TOTAL = 18000;          // points over all strokes
const MAX_STROKES = 80;
const CHUNK = 150;                // px of stroke per light sample
const TRIM_MAX = 10;              // most pen points a release may trim (~25 px)

// Per style: glow reach and core half-width (CSS px at hand scale 1).
const SHAPE = {
  neon: { R: 25, w: 2.0 },
  rainbow: { R: 25, w: 2.0 },
  fire: { R: 44, w: 2.3 },   // room for the flames to rise
  stars: { R: 22, w: 1.3 },
};

export function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export function hsv(h, s, v, out = [0, 0, 0]) {
  h = ((h % 1) + 1) % 1;
  for (let i = 0; i < 3; i++) {
    const k = (5 - i * 2 + h * 6) % 6;
    out[i] = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  }
  return out;
}
export function rgbCss(c, a = 1) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}
export const PALETTE_RGB = PALETTE.map(hexRgb);

let nextId = 1;

export class Stroke {
  constructor(style, col, css, hue, scale, t) {
    this.id = nextId++;
    this.style = STYLES.includes(style) ? style : 'neon';
    this.si = STYLES.indexOf(this.style);
    this.col = col;          // [r, g, b] 0..1
    this.css = css;          // particle colour
    this.hue = hue;          // rainbow phase
    this.scale = scale;
    const sh = SHAPE[this.style];
    this.R = sh.R * scale;
    this.w = sh.w * scale;
    this.seed = Math.random();
    this.chain = this.id;    // pieces of one long line share it (undo takes all)
    this.cont = false;       // true for a piece that a longer line carried on from
    this.born = t;
    this.endT = -1;          // when the pen lifted (-1 while drawing)
    this.pts = new Float32Array(256);
    this.pin = new Float32Array(128);   // pinch strength per point (tail trimming)
    this.n = 0;
    this.len = 0;
    this.geo = null; this.geoN = 0; this.geoVer = 0; this.dirty = true;
    this.chunks = new Float32Array(32); this.nChunks = 0;   // x, y, len, sMid
    this.kill = 0;           // 0..1 dissolve progress
    this.killDur = 0;        // > 0 once dissolving
    this.shatter = 0;        // 1 = clear-all break-up, 0 = undo burn
  }

  get dying() { return this.killDur > 0; }
  get lastX() { return this.pts[this.n * 2 - 2]; }
  get lastY() { return this.pts[this.n * 2 - 1]; }

  // Store a point if it is far enough from the last one. Returns true if added.
  add(x, y, pinch = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const n = this.n;
    if (n && Math.hypot(x - this.pts[n * 2 - 2], y - this.pts[n * 2 - 1]) < STEP) return false;
    if (n * 2 + 2 > this.pts.length) {
      const g = new Float32Array(this.pts.length * 2); g.set(this.pts); this.pts = g;
      const q = new Float32Array(this.pin.length * 2); q.set(this.pin); this.pin = q;
    }
    this.pts[n * 2] = x; this.pts[n * 2 + 1] = y; this.pin[n] = pinch;
    this.n++;
    this.dirty = true;
    return true;
  }

  // Move the only point (while the pen settles) without growing the stroke.
  moveFirst(x, y) {
    if (this.n !== 1 || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pts[0] = x; this.pts[1] = y; this.dirty = true;
  }

  // Drop the last few points made while the fingers were already opening:
  // clearly looser than the stroke's own pinch, and at most TRIM_MAX of them.
  trimTail() {
    const n0 = this.n;
    if (n0 < 4) return;
    let sum = 0;
    for (let i = 0; i < n0; i++) sum += this.pin[i];
    const th = (sum / n0) * 0.8;
    let n = n0;
    while (n > 2 && n0 - n < TRIM_MAX && this.pin[n - 1] < th) n--;
    if (n !== n0) { this.n = n; this.dirty = true; }
  }

  // Random point on the stroke (between two raw points).
  sample(out) {
    const n = this.n, P = this.pts;
    if (n < 2) { out.x = P[0]; out.y = P[1]; return out; }
    const i = Math.floor(Math.random() * (n - 1)), f = Math.random();
    out.x = P[i * 2] + (P[i * 2 + 2] - P[i * 2]) * f;
    out.y = P[i * 2 + 1] + (P[i * 2 + 3] - P[i * 2 + 1]) * f;
    return out;
  }

  rescale(sx, sy) {
    for (let i = 0; i < this.n; i++) { this.pts[i * 2] *= sx; this.pts[i * 2 + 1] *= sy; }
    this.dirty = true;
  }

  // Rebuild the cached strip + light chunks if the points changed.
  build() {
    if (!this.dirty) return;
    this.dirty = false;
    buildCurve(this.pts, this.n);
    const m = cn;
    if (!m) { this.geoN = 0; this.geoVer++; this.len = 0; this.nChunks = 0; return; }
    const floats = (m + 2) * 8;
    if (!this.geo || this.geo.length < floats) this.geo = new Float32Array(Math.max(floats, (this.geo?.length || 256) * 2));
    const G = this.geo, R = this.R;
    let k = 0;
    const put = (x, y, s, side) => { G[k++] = x; G[k++] = y; G[k++] = s; G[k++] = side; };
    // Tangents by central differences (keep the last good one on zero length).
    let tx = 1, ty = 0;
    if (tangent(0, m)) { tx = TX; ty = TY; }
    const len = C[(m - 1) * 3 + 2];
    // Start cap: one R behind the first point, s = -R gives a round end.
    let x = C[0], y = C[1];
    put(x - tx * R - ty * R, y - ty * R + tx * R, -R, 1);
    put(x - tx * R + ty * R, y - ty * R - tx * R, -R, -1);
    for (let i = 0; i < m; i++) {
      if (tangent(i, m)) { tx = TX; ty = TY; }
      x = C[i * 3]; y = C[i * 3 + 1];
      const s = C[i * 3 + 2];
      put(x - ty * R, y + tx * R, s, 1);
      put(x + ty * R, y - tx * R, s, -1);
    }
    put(x + tx * R - ty * R, y + ty * R + tx * R, len + R, 1);
    put(x + tx * R + ty * R, y + ty * R - tx * R, len + R, -1);
    this.geoN = k / 4;
    this.geoVer++;            // tells the GPU side to re-upload
    this.len = len;
    this.buildChunks(m, len);
  }

  buildChunks(m, len) {
    const need = Math.ceil(len / CHUNK) + 1;
    if (this.chunks.length < need * 4) this.chunks = new Float32Array(need * 8);
    const K = this.chunks;
    let nc = 0, sx = 0, sy = 0, cnt = 0, s0 = 0;
    for (let i = 0; i < m; i++) {
      sx += C[i * 3]; sy += C[i * 3 + 1]; cnt++;
      const s = C[i * 3 + 2];
      if (s - s0 >= CHUNK || i === m - 1) {
        K[nc * 4] = sx / cnt; K[nc * 4 + 1] = sy / cnt;
        K[nc * 4 + 2] = Math.max(s - s0, 12); K[nc * 4 + 3] = (s + s0) / 2;
        nc++; sx = 0; sy = 0; cnt = 0; s0 = s;
      }
    }
    this.nChunks = nc;
  }
}

// --- smoothed curve scratch (x, y, s per point) ------------------------------

let C = new Float32Array(3 * 4096);
let cn = 0;
let TX = 1, TY = 0;

function cpush(x, y) {
  if (cn * 3 + 3 > C.length) { const g = new Float32Array(C.length * 2); g.set(C); C = g; }
  let s = 0;
  if (cn) {
    const d = Math.hypot(x - C[cn * 3 - 3], y - C[cn * 3 - 2]);
    if (d < 0.3) return;
    s = C[cn * 3 - 1] + d;
  }
  C[cn * 3] = x; C[cn * 3 + 1] = y; C[cn * 3 + 2] = s;
  cn++;
}

// Quadratic curves between midpoints, through the first and last points.
function buildCurve(P, n) {
  cn = 0;
  if (!n) return;
  cpush(P[0], P[1]);
  if (n === 2) { cpush(P[2], P[3]); return; }
  for (let i = 1; i < n - 1; i++) {
    const bx = P[i * 2], by = P[i * 2 + 1];
    const ax = i === 1 ? P[0] : (P[i * 2 - 2] + bx) / 2, ay = i === 1 ? P[1] : (P[i * 2 - 1] + by) / 2;
    const cx = i === n - 2 ? P[i * 2 + 2] : (bx + P[i * 2 + 2]) / 2, cy = i === n - 2 ? P[i * 2 + 3] : (by + P[i * 2 + 3]) / 2;
    const L = Math.hypot(bx - ax, by - ay) + Math.hypot(cx - bx, cy - by);
    const k = Math.max(1, Math.min(10, Math.ceil(L / 5)));
    for (let j = 1; j <= k; j++) {
      const u = j / k, v = 1 - u;
      cpush(v * v * ax + 2 * u * v * bx + u * u * cx, v * v * ay + 2 * u * v * by + u * u * cy);
    }
  }
}

// Unit tangent at curve point i into TX/TY; false if undefined.
function tangent(i, m) {
  const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
  const dx = C[b * 3] - C[a * 3], dy = C[b * 3 + 1] - C[a * 3 + 1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-4) return false;
  TX = dx / l; TY = dy / l;
  return true;
}

// --- the collection ------------------------------------------------------------

export class Ink {
  constructor() {
    this.list = [];
    this.W = 0; this.H = 0;
    this.ver = 0;            // bumps when every stroke moved (resize)
  }

  get count() { let n = 0; for (const s of this.list) if (!s.dying) n++; return n; }
  get points() { let n = 0; for (const s of this.list) if (!s.dying) n += s.n; return n; }

  add(stroke) {
    this.list.push(stroke);
    this.enforce();
    return stroke;
  }

  remove(stroke) {
    const i = this.list.indexOf(stroke);
    if (i >= 0) this.list.splice(i, 1);
  }

  // Keep memory bounded: oldest finished strokes fade out first.
  enforce() {
    let pts = this.points, live = this.count;
    for (const s of this.list) {
      if (pts <= MAX_TOTAL && live <= MAX_STROKES) break;
      if (s.dying || s.endT < 0) continue;
      s.killDur = 0.5; s.shatter = 0;
      pts -= s.n; live--;
    }
  }

  // Newest finished stroke that is not already going away.
  lastFinished() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (!s.dying && s.endT >= 0) return s;
    }
    return null;
  }

  // Every live piece of the line a stroke belongs to.
  chainOf(stroke) { return this.list.filter((s) => s.chain === stroke.chain && !s.dying); }

  // Strokes stay put relative to the screen when it is resized/rotated.
  resize(W, H) {
    if (this.W && this.H && (W !== this.W || H !== this.H)) {
      const sx = W / this.W, sy = H / this.H;
      for (const s of this.list) s.rescale(sx, sy);
      this.ver++;
    }
    this.W = W; this.H = H;
  }

  // Advance dissolves; returns true if any stroke was removed.
  update(dt) {
    let removed = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.killDur > 0) {
        s.kill = Math.min(1, s.kill + dt / s.killDur);
        if (s.kill >= 1) { this.list.splice(i, 1); removed = true; }
      }
    }
    return removed;
  }

  clear() { this.list.length = 0; }
}
