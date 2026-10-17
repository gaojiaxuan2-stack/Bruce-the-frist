// strange-sigil.js — the Eldritch shield. Five ring layers (rune band, tick
// ring, the square-in-circle star, a ring of script, a spinning core) plus a
// bloom halo are painted ONCE per palette to offscreen canvases; every frame
// they are just drawImage'd with their own counter-rotation, additively.

import { TAU, clamp, easeOutBack, rng, glow } from './strange-fx.js';

const SIZE = 640;   // layer canvas, px
const RL = 296;     // sigil radius inside a layer, px
const HALF = SIZE / 2;

// Outermost → core. speed: rad/s, the sign is the spin direction.
export const LAYERS = [
  { id: 'runes', speed: 0.32 },
  { id: 'ticks', speed: -0.7 },
  { id: 'star', speed: 0.45 },
  { id: 'script', speed: -0.34 },
  { id: 'core', speed: 1.2 },
];

const circle = (g, r) => { g.moveTo(r, 0); g.arc(0, 0, r, 0, TAU); };
const dot = (g, x, y, r) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); };
const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];

// One procedural rune: a short random walk on a 3x3 grid (2-4 strokes),
// sometimes a second tick or a tiny ring. Upright = pointing outward.
function rune(g, rnd, a, r, s) {
  const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
  const tx = -Math.sin(a), ty = Math.cos(a), nx = Math.cos(a), ny = Math.sin(a);
  const P = (i) => {
    const u = ((i % 3) - 1) * s * 0.42, v = (1 - Math.floor(i / 3)) * s * 0.5;
    return [cx + tx * u + nx * v, cy + ty * u + ny * v];
  };
  let cur = Math.floor(rnd() * 9);
  g.moveTo(...P(cur));
  const steps = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < steps; k++) {
    const col = cur % 3, row = Math.floor(cur / 3);
    let nc, nr;
    do {
      nc = clamp(col + Math.floor(rnd() * 3) - 1, 0, 2);
      nr = clamp(row + Math.floor(rnd() * 3) - 1, 0, 2);
    } while (nc === col && nr === row);
    cur = nr * 3 + nc;
    g.lineTo(...P(cur));
  }
  const extra = rnd();
  if (extra < 0.35) {
    const a0 = Math.floor(rnd() * 9);
    g.moveTo(...P(a0));
    g.lineTo(...P(a0 === 4 ? 1 : 4));
  } else if (extra < 0.55) {
    const [x, y] = P(Math.floor(rnd() * 9));
    dot(g, x, y, s * 0.13);
  }
}

// Painters. Each runs twice: a thick glowing pass (wm = 1) and a thin
// white-hot core pass (wm < 1).
const PAINT = {
  runes(g, wm) {
    g.lineWidth = 3.4 * wm;
    g.beginPath(); circle(g, RL * 0.972); g.stroke();
    g.lineWidth = 1.7 * wm;
    g.beginPath(); circle(g, RL * 0.997); circle(g, RL * 0.85); g.stroke();
    const rnd = rng(1971);
    const n = 32;
    g.lineWidth = 2.3 * wm;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      if (i % 8 === 7) {
        // separator: a small diamond
        const [x, y] = polar(RL * 0.911, a), d = RL * 0.022;
        const tx = -Math.sin(a) * d, ty = Math.cos(a) * d, nx = Math.cos(a) * d, ny = Math.sin(a) * d;
        g.moveTo(x + nx, y + ny); g.lineTo(x + tx, y + ty); g.lineTo(x - nx, y - ny); g.lineTo(x - tx, y - ty); g.closePath();
        continue;
      }
      rune(g, rnd, a, RL * 0.911, RL * 0.085);
    }
    g.stroke();
    // notches just outside the band
    g.lineWidth = 1.6 * wm;
    g.beginPath();
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU + TAU / 128;
      const r1 = RL * (i % 4 === 0 ? 0.835 : 0.842);
      g.moveTo(...polar(RL * 0.85, a)); g.lineTo(...polar(r1, a));
    }
    g.stroke();
  },

  ticks(g, wm) {
    g.lineWidth = 2.6 * wm;
    g.beginPath(); circle(g, RL * 0.79); g.stroke();
    g.lineWidth = 1.5 * wm;
    g.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const len = i % 10 === 0 ? 0.06 : i % 5 === 0 ? 0.04 : 0.022;
      g.moveTo(...polar(RL * 0.79, a)); g.lineTo(...polar(RL * (0.79 - len), a));
    }
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 4; i++) { const [x, y] = polar(RL * 0.79, (i / 4) * TAU + TAU / 8); dot(g, x, y, RL * 0.03); }
    g.lineWidth = 2.2 * wm;
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 48; i++) { const [x, y] = polar(RL * 0.705, (i / 48) * TAU); dot(g, x, y, RL * (i % 4 === 0 ? 0.008 : 0.0045)); }
    g.fill();
  },

  star(g, wm) {
    const R = RL * 0.665;
    g.lineWidth = 3.2 * wm;
    g.beginPath();
    for (const off of [0, TAU / 8]) {
      for (let k = 0; k < 4; k++) {
        const [x, y] = polar(R, off + (k / 4) * TAU);
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    }
    g.stroke();
    g.lineWidth = 2.0 * wm;
    g.beginPath(); circle(g, R); circle(g, R * Math.SQRT1_2); g.stroke();
    g.beginPath();
    for (let k = 0; k < 8; k++) { const [x, y] = polar(R, (k / 8) * TAU); dot(g, x, y, RL * 0.022); }
    g.lineWidth = 2.0 * wm;
    g.stroke();
  },

  script(g, wm) {
    g.lineWidth = 1.9 * wm;
    g.beginPath(); circle(g, RL * 0.43); circle(g, RL * 0.315); g.stroke();
    // pseudo-script: "words" of bars, dashes and dots along the ring
    const rnd = rng(42);
    const r = RL * 0.372, h = RL * 0.03;
    const step = TAU / 150;
    g.lineWidth = 1.8 * wm;
    g.beginPath();
    let a = 0, word = 3 + Math.floor(rnd() * 6);
    while (a < TAU - step * 2) {
      if (word-- <= 0) { a += step * 1.6; word = 3 + Math.floor(rnd() * 6); continue; }
      const kind = rnd();
      if (kind < 0.4) {
        const h0 = rnd() < 0.5 ? -h : -h * 0.3;
        g.moveTo(...polar(r + h0, a)); g.lineTo(...polar(r + h, a));
      } else if (kind < 0.7) {
        const rr = r + (rnd() < 0.5 ? h : -h);
        g.moveTo(...polar(rr, a - step * 0.35)); g.arc(0, 0, rr, a - step * 0.35, a + step * 0.45);
      } else if (kind < 0.85) {
        g.moveTo(...polar(r - h, a)); g.lineTo(...polar(r + h, a)); g.lineTo(...polar(r + h, a + step * 0.5));
      } else {
        const [x, y] = polar(r, a); dot(g, x, y, RL * 0.006);
      }
      a += step;
    }
    g.stroke();
  },

  core(g, wm) {
    g.lineWidth = 2.4 * wm;
    g.beginPath(); circle(g, RL * 0.235); g.stroke();
    g.lineWidth = 1.5 * wm;
    g.beginPath(); circle(g, RL * 0.205); circle(g, RL * 0.085); g.stroke();
    g.lineWidth = 2.2 * wm;
    g.beginPath();
    for (const off of [-TAU / 4, TAU / 4]) {
      for (let k = 0; k < 3; k++) {
        const [x, y] = polar(RL * 0.205, off + (k / 3) * TAU);
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    }
    g.stroke();
    g.beginPath();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      g.moveTo(...polar(RL * 0.245, a)); g.lineTo(...polar(RL * (k % 3 === 0 ? 0.29 : 0.265), a));
    }
    g.lineWidth = 1.6 * wm;
    g.stroke();
    g.beginPath(); dot(g, 0, 0, RL * 0.022); g.fill();
  },
};

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.translate(HALF, HALF);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return [c, g];
}

function paintLayer(pal, paint) {
  const [c, g] = canvas();
  // shadowBlur is fine here: it runs once per palette, never per frame.
  g.shadowColor = pal.glow;
  g.shadowBlur = 18;
  g.strokeStyle = g.fillStyle = pal.mid;
  paint(g, 1);
  g.shadowBlur = 0;
  g.strokeStyle = g.fillStyle = pal.core;
  paint(g, 0.42);
  return c;
}

// Soft bloom behind the strokes: wide blurred rings.
function paintHalo(pal) {
  const [c, g] = canvas();
  g.shadowColor = pal.glow;
  g.strokeStyle = pal.glow;
  for (const [r, w, a, blur] of [[0.972, 14, 0.3, 30], [0.665, 8, 0.16, 24], [0.79, 5, 0.12, 16], [0.372, 8, 0.12, 22], [0.22, 12, 0.22, 26]]) {
    g.globalAlpha = a;
    g.shadowBlur = blur;
    g.lineWidth = w;
    g.beginPath(); circle(g, RL * r); g.stroke();
  }
  return c;
}

let shadeC = null;
function shade() {
  if (shadeC) return shadeC;
  shadeC = document.createElement('canvas');
  shadeC.width = shadeC.height = 128;
  const g = shadeC.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, a] of [[0, 0.45], [0.6, 0.35], [0.88, 0.22], [1, 0]]) grad.addColorStop(o, `rgba(24,8,0,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return shadeC;
}

const cache = new Map();
export function sigilArt(name, pal) {
  let a = cache.get(name);
  if (!a) {
    a = { pal, halo: paintHalo(pal), layers: LAYERS.map((L) => paintLayer(pal, PAINT[L.id])) };
    cache.set(name, a);
  }
  return a;
}

// Subtle per-layer flicker, 0.72..1.
const flick = (t, f) => 0.86 + 0.14 * Math.sin(t * f) * Math.sin(t * f * 0.37 + 1.3);

// s: { x, y, R, amt (0..1 summon progress), spins[5], m: [a, b, c, d] (2x2
// tilt/foreshortening), t }. Draws additively; alpha scales everything.
export function drawSigil(ctx, art, s, alpha = 1) {
  if (alpha <= 0.004 || s.amt <= 0.001 || !(s.R > 1)) return;
  const sc = s.R / RL;
  const t = s.t, a = s.amt;
  ctx.save();
  ctx.translate(s.x, s.y);
  const m = s.m;
  ctx.transform(m[0], m[2], m[1], m[3], 0, 0);
  ctx.scale(sc, sc);
  ctx.globalCompositeOperation = 'lighter';

  // a faint smoky backing so the strokes still pop over bright walls
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha * clamp(a * 1.5) * 0.5;
  ctx.drawImage(shade(), -RL * 1.08, -RL * 1.08, RL * 2.16, RL * 2.16);
  ctx.globalCompositeOperation = 'lighter';
  // bloom: a broad glow, then the blurred rings
  ctx.globalAlpha = alpha * clamp(a * 1.3) * 0.16 * flick(t, 5.3);
  ctx.drawImage(glow(art.pal.glow), -RL * 1.3, -RL * 1.3, RL * 2.6, RL * 2.6);
  ctx.globalAlpha = alpha * clamp(a * 1.3) * (0.55 + 0.15 * flick(t, 9));
  ctx.drawImage(art.halo, -HALF, -HALF);

  // the rings: the core arrives first, the rune band last; each spins in
  // fast while it materialises
  const n = art.layers.length;
  for (let i = 0; i < n; i++) {
    const delay = (n - 1 - i) * 0.08;
    const p = clamp((a - delay) / (1 - 0.32));
    if (p <= 0) continue;
    const grow = 0.3 + 0.7 * easeOutBack(p);
    ctx.save();
    ctx.rotate(s.spins[i] + (1 - p) * (1 - p) * 5 * Math.sign(LAYERS[i].speed));
    ctx.scale(grow, grow);
    ctx.globalAlpha = alpha * Math.pow(p, 0.8) * flick(t + i * 3.1, 17 + i * 3);
    ctx.drawImage(art.layers[i], -HALF, -HALF);
    ctx.restore();
  }

  // comets of energy running round the rune band
  if (a > 0.6) {
    const k = clamp((a - 0.6) / 0.4) * alpha;
    const gl = glow(art.pal.mid), hot = glow(art.pal.core);
    const base = s.spins[0] * 3.2;
    for (let c = 0; c < 3; c++) {
      const ang = base + (c / 3) * TAU;
      const x = Math.cos(ang) * RL * 0.972, y = Math.sin(ang) * RL * 0.972;
      ctx.globalAlpha = 0.7 * k;
      ctx.drawImage(gl, x - RL * 0.12, y - RL * 0.12, RL * 0.24, RL * 0.24);
      ctx.globalAlpha = k;
      ctx.drawImage(hot, x - RL * 0.05, y - RL * 0.05, RL * 0.1, RL * 0.1);
    }
  }
  ctx.restore();
}

// Point on the shield's rim (angle th, radius fraction f) and the matching
// tangent, through the same 2x2 tilt as drawSigil.
export function rimPoint(s, th, f, out) {
  const m = s.m, r = s.R * f;
  const lx = Math.cos(th) * r, ly = Math.sin(th) * r;
  const tx = -Math.sin(th), ty = Math.cos(th);
  out.x = s.x + m[0] * lx + m[1] * ly;
  out.y = s.y + m[2] * lx + m[3] * ly;
  out.tx = m[0] * tx + m[1] * ty;
  out.ty = m[2] * tx + m[3] * ty;
  return out;
}
