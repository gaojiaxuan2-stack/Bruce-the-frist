// ironman-fx.js — small shared bits for the Iron Man mode: maths, cached
// sprites (glows that fade to the SAME hue, a starburst, a lens-ghost ring)
// and GlowLayer, an offscreen canvas that gets a cheap bloom when it is
// composited (progressive 2x downsamples, added back on top — no shadowBlur).

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
export const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

export const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgba = (h, a) => { const [r, g, b] = hexRGB(h); return `rgba(${r},${g},${b},${a})`; };

// Small seeded PRNG so procedural art is stable.
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

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

const sprites = new Map();
function cached(key, make) {
  let c = sprites.get(key);
  if (!c) { c = make(); sprites.set(key, c); }
  return c;
}

// Soft radial glow that fades to its own hue at zero alpha (a fade to
// transparent black leaves a dark halo over a bright camera image).
export function glow(color) {
  return cached('g' + color, () => {
    const c = canvas(128), g = c.getContext('2d');
    const [r, gg, b] = hexRGB(color);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, a] of [[0, 1], [0.1, 0.9], [0.28, 0.45], [0.5, 0.16], [0.75, 0.04], [1, 0]]) grad.addColorStop(o, `rgba(${r},${gg},${b},${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

// Draw a glow sprite (use with 'lighter'). rx, ry: radii; ry defaults to rx.
export function drawGlow(ctx, x, y, rx, color, alpha = 1, ry = rx) {
  if (alpha <= 0.004 || !(rx > 0.5) || !(ry > 0.3)) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, alpha);
  ctx.drawImage(glow(color), x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

// Hollow soft ring — a lens ghost.
export function ghostRing(color) {
  return cached('r' + color, () => {
    const c = canvas(128), g = c.getContext('2d');
    const [r, gg, b] = hexRGB(color);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, a] of [[0, 0.1], [0.6, 0.05], [0.8, 0.5], [0.88, 0.22], [1, 0]]) grad.addColorStop(o, `rgba(${r},${gg},${b},${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

// Radial light streaks — the beam coming straight at the viewer.
export function starburst(color, seed = 7) {
  return cached('s' + color + seed, () => {
    const S = 512, R = S / 2, c = canvas(S), g = c.getContext('2d');
    const rnd = rng(seed);
    g.translate(R, R);
    g.fillStyle = '#fff';
    for (let i = 0; i < 72; i++) {
      const a = rnd() * TAU, len = R * (0.3 + 0.7 * rnd() * rnd()), w = 0.004 + rnd() * 0.016;
      g.globalAlpha = 0.25 + 0.75 * rnd();
      g.beginPath();
      g.moveTo(Math.cos(a + 1.5708) * 2, Math.sin(a + 1.5708) * 2);
      g.lineTo(Math.cos(a - w) * len, Math.sin(a - w) * len);
      g.lineTo(Math.cos(a + w) * len, Math.sin(a + w) * len);
      g.closePath();
      g.fill();
    }
    // tint: white-hot centre fading out through the beam colour
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-in';
    const [r, gg, b] = hexRGB(color);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.12, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.45)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(-R, -R, S, S);
    return c;
  });
}

// An offscreen layer for thin holographic line art. composite() draws it
// sharp, plus two blurred copies (1/4 and 1/8 resolution) added on top, so
// every line and label gets a bloom for the price of a few blits.
export class GlowLayer {
  constructor() {
    this.c = canvas(2); this.g = this.c.getContext('2d');
    this.levels = [canvas(1), canvas(1), canvas(1)].map((c) => ({ c, g: c.getContext('2d') }));
    this.shadow = canvas(1); this.sg = this.shadow.getContext('2d');
    this.w = 0; this.h = 0;
  }

  begin(W, H, dpr) {
    const w = Math.max(8, Math.round(W * dpr)), h = Math.max(8, Math.round(H * dpr));
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.c.width = w; this.c.height = h;
      this.levels.forEach((L, i) => {
        const k = 2 << i;
        L.c.width = Math.max(1, Math.round(w / k)); L.c.height = Math.max(1, Math.round(h / k));
      });
      this.shadow.width = this.levels[1].c.width; this.shadow.height = this.levels[1].c.height;
    }
    this.W = W; this.H = H;
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  // shade: strength of a soft dark halo under the art (legibility on bright scenes).
  composite(ctx, x, y, alpha, bloom, shade = 0.75) {
    if (alpha <= 0.004) return;
    let src = this.c;
    for (const L of this.levels) {
      L.g.clearRect(0, 0, L.c.width, L.c.height);
      L.g.drawImage(src, 0, 0, L.c.width, L.c.height);
      src = L.c;
    }
    const { W, H } = this;
    ctx.save();
    if (shade > 0) {
      // silhouette of the blurred art, thickened, filled with near-black
      const sg = this.sg, sw = this.shadow.width, sh = this.shadow.height;
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, sw, sh);
      sg.drawImage(this.levels[1].c, 0, 0);
      sg.drawImage(this.levels[1].c, 0, 0);
      sg.drawImage(this.levels[2].c, 0, 0, sw, sh);
      sg.drawImage(this.levels[2].c, 0, 0, sw, sh);
      sg.globalCompositeOperation = 'source-in';
      sg.fillStyle = '#00060d';
      sg.fillRect(0, 0, sw, sh);
      sg.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha * shade;
      ctx.drawImage(this.shadow, x, y + 1, W, H);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * bloom;
    ctx.drawImage(this.levels[1].c, x, y, W, H);
    ctx.globalAlpha = alpha * bloom * 0.9;
    ctx.drawImage(this.levels[2].c, x, y, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.c, x, y, W, H);
    ctx.restore();
  }
}
