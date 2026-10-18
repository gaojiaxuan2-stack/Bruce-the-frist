// strange-fx.js — shared bits for the Doctor Strange mode: palettes, the HUD
// safe area, and a batched spark field (hundreds of molten streaks drawn
// with a handful of strokes, so phones keep up).

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
export const easeInBack = (x) => 2.70158 * x * x * x - 1.70158 * x * x;

// glow / mid / core: sigil strokes. sparks: white-hot → gold → ember.
// rgb: light spill colour for the shaders.
export const PALETTES = {
  mystic: { glow: '#ff6a00', mid: '#ffa53a', core: '#fff1cf', sparks: ['#fff6dc', '#ffc45c', '#ff7d14'], rgb: [1.0, 0.56, 0.14] },
  time: { glow: '#00e05a', mid: '#3dff8a', core: '#eafff1', sparks: ['#f0fff5', '#8affb6', '#1fd968'], rgb: [0.22, 1.0, 0.5] },
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Spark colours part-way between two palettes (k: 0 = a, 1 = b).
export function mixSparks(a, b, k) {
  if (k <= 0.001) return a.sparks;
  if (k >= 0.999) return b.sparks;
  return a.sparks.map((c, i) => {
    const x = hex(c), y = hex(b.sparks[i]);
    return `rgb(${x.map((v, j) => Math.round(v + (y[j] - v) * k)).join(',')})`;
  });
}
export function mixRGB(a, b, k) { return a.rgb.map((v, i) => v + (b.rgb[i] - v) * k); }

// Soft bloom sprite with a smooth, gaussian-like falloff (draw.js's
// glowSprite is flat to 25 % and then linear, which reads as a disc). Every
// glow in this mode is tuned to this profile. Draw with 'lighter'.
const sprites = new Map();
export function bloomSprite(color, size = 128) {
  const key = color + size;
  let c = sprites.get(key);
  if (c) return c;
  const [r, g, b] = hex(color);
  c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const h = size / 2;
  const grad = x.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, a] of [[0, 1], [0.12, 0.85], [0.3, 0.42], [0.55, 0.14], [0.8, 0.03], [1, 0]]) grad.addColorStop(o, `rgba(${r},${g},${b},${a})`);
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}
export function drawBloom(ctx, x, y, radius, color, alpha = 1) {
  if (alpha <= 0.003 || !(radius > 0.5)) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, alpha);
  ctx.drawImage(bloomSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

// Small seeded PRNG so the procedural glyphs are stable.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pooled sparks in flat typed arrays: no per-spark objects, and drawing
// buckets them by heat (3 colours) x width (2) into six Path2D strokes.
const ALPHA = [1, 0.9, 0.55];
const WIDTH = [1.2, 2.2];
const F = ['x', 'y', 'vx', 'vy', 'age', 'life', 'grav', 'drag', 'w', 'tl'];

export class SparkField {
  constructor(cap = 1500) {
    this.cap = cap;
    this.n = 0;
    this.cursor = 0;
    for (const f of F) this[f] = new Float32Array(cap);
  }

  // drag: fraction of speed kept per second. w > 1.6 = thick spark.
  // tl: seconds of motion the streak shows (longer = more of a streak).
  emit(x, y, vx, vy, life, grav = 0, drag = 0.4, w = 1.2, tl = 0.045) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { i = this.cursor; this.cursor = (this.cursor + 1) % this.cap; }   // full: recycle the oldest
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.w[i] = w; this.tl[i] = tl;
  }

  update(dt) {
    const { x, y, vx, vy, age, life, grav, drag, w, tl } = this;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const a = age[i] + dt;
      if (a >= life[i]) continue;
      const k = Math.pow(drag[i], dt);
      const nvx = vx[i] * k, nvy = vy[i] * k + grav[i] * dt;
      x[j] = x[i] + nvx * dt; y[j] = y[i] + nvy * dt;
      vx[j] = nvx; vy[j] = nvy; age[j] = a;
      life[j] = life[i]; grav[j] = grav[i]; drag[j] = drag[i]; w[j] = w[i]; tl[j] = tl[i];
      j++;
    }
    this.n = j;
    if (this.cursor >= j) this.cursor = 0;
  }

  // colors: [hot, warm, ember]. Streaks are capped at maxTail px.
  draw(ctx, colors, { maxTail = 42, alpha = 1 } = {}) {
    if (!this.n) return;
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const { x, y, vx, vy, age, life, w, tl } = this;
    for (let i = 0; i < this.n; i++) {
      const f = age[i] / life[i];
      const b = (f < 0.38 ? 0 : f < 0.7 ? 2 : 4) + (w[i] > 1.6 ? 1 : 0);
      const sp = Math.hypot(vx[i], vy[i]);
      const k = sp > 1e-3 ? Math.min(maxTail, sp * tl[i]) / sp : 0;
      const p = paths[b];
      p.moveTo(x[i], y[i]);
      p.lineTo(x[i] - vx[i] * k, y[i] - vy[i] * k + 0.01);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let b = 0; b < 6; b++) {
      ctx.strokeStyle = colors[b >> 1];
      ctx.globalAlpha = ALPHA[b >> 1] * alpha;
      ctx.lineWidth = WIDTH[b & 1];
      ctx.stroke(paths[b]);
    }
    ctx.restore();
  }

  clear() { this.n = 0; this.cursor = 0; }
}
