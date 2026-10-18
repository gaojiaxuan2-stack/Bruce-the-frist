// neon-fx.js — the 2D overlay of NEON DRAW: particles (pen sparks, fingertip
// glitter, flames, shatter), the pen nib, pinch charge + hold rings, comet
// cursor, shockwaves and the brush badge. All glow is sprite-based
// ('lighter' + glowSprite), never shadowBlur.

import { drawGlow, glowSprite, clamp, lerp, easeOutCubic, easeOutBack } from '../draw.js';
import { Particles } from '../particles.js';
import { FIRE_COLS, STAR_COLS, RAINBOW_COLS } from './neon-ink.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const tmp = { x: 0, y: 0 };

// Colours a stroke's particles use.
export function strokeColors(s) {
  if (s.style === 'fire') return FIRE_COLS;
  if (s.style === 'stars') return STAR_COLS;
  if (s.style === 'rainbow') return RAINBOW_COLS;
  return [s.css, s.css, '#ffffff'];
}

// Tick ring art, rendered once.
let ticks = null;
function tickRing() {
  if (ticks) return ticks;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU, big = i % 5 === 0;
    g.lineWidth = big ? 3 : 1.5;
    g.globalAlpha = big ? 0.9 : 0.5;
    g.beginPath();
    g.moveTo(Math.cos(a) * (big ? 104 : 110), Math.sin(a) * (big ? 104 : 110));
    g.lineTo(Math.cos(a) * 120, Math.sin(a) * 120);
    g.stroke();
  }
  ticks = c;
  return c;
}

export class NeonFx {
  constructor(max = 800) {
    this.parts = new Particles(max);
    this.waves = [];      // { x, y, t0, col, r }
    this.badge = null;    // { text, col, t0, hands: [{x,y}] }
  }

  clear() { this.parts.clear(); this.waves.length = 0; this.badge = null; }

  update(dt) { this.parts.update(dt); }

  // --- emitters ------------------------------------------------------------------

  // Sparks flying off the nib while drawing; style decides the kind.
  pen(x, y, vx, vy, style, cols, sc, n) {
    const P = this.parts;
    for (let i = 0; i < n; i++) {
      if (style === 'fire') {
        P.emit({ x: x + rnd(-3, 3) * sc, y: y + rnd(-3, 3) * sc, vx: rnd(-25, 25) * sc + vx * 0.1, vy: rnd(-140, -50) * sc,
          gravity: -90 * sc, drag: 0.5, life: rnd(0.35, 0.7), size: rnd(3, 6) * sc, color: pick(FIRE_COLS), kind: 'glow' });
      } else if (style === 'stars') {
        P.emit({ x, y, vx: rnd(-40, 40) * sc - vx * 0.05, vy: rnd(-30, 30) * sc, gravity: 50 * sc, drag: 0.35,
          life: rnd(0.7, 1.4), size: rnd(0.7, 1.6) * sc, color: pick(STAR_COLS), kind: 'dot', shrink: true });
      } else {
        const a = Math.random() * TAU, v = rnd(70, 260) * sc;
        P.emit({ x, y, vx: Math.cos(a) * v - vx * 0.15, vy: Math.sin(a) * v - vy * 0.15, gravity: 380 * sc, drag: 0.25,
          life: rnd(0.16, 0.38), size: rnd(1.6, 2.6) * sc, color: Math.random() < 0.35 ? '#ffffff' : pick(cols), kind: 'spark' });
      }
    }
  }

  // Glitter trailing a moving fingertip.
  tip(x, y, vx, vy, col, sc) {
    this.parts.emit({ x, y, vx: vx * 0.12 + rnd(-24, 24) * sc, vy: vy * 0.12 + rnd(-30, 10) * sc, gravity: -24 * sc, drag: 0.45,
      life: rnd(0.4, 0.85), size: rnd(1.4, 2.8) * sc, color: col, kind: 'glow' });
  }

  // Rising flames off finished FIRE strokes (budgeted by the caller).
  ember(x, y, sc) {
    const spark = Math.random() < 0.15;
    this.parts.emit({ x: x + rnd(-4, 4) * sc, y, vx: rnd(-14, 14) * sc, vy: rnd(-110, -40) * sc, gravity: -70 * sc, drag: 0.6,
      life: spark ? rnd(0.6, 1.1) : rnd(0.3, 0.65), size: spark ? 1.6 * sc : rnd(2.5, 5.5) * sc,
      color: spark ? '#ffd36b' : pick(FIRE_COLS), kind: spark ? 'spark' : 'glow' });
  }

  // Slow glints drifting off STARS strokes.
  glint(x, y, sc) {
    this.parts.emit({ x, y, vx: rnd(-8, 8) * sc, vy: rnd(-6, 18) * sc, drag: 0.6, life: rnd(0.8, 1.6),
      size: rnd(0.6, 1.3) * sc, color: pick(STAR_COLS), kind: 'dot' });
  }

  // Everything breaks apart, flying away from the fist.
  shatter(strokes, fx, fy, sc, budget) {
    let total = 0;
    for (const s of strokes) total += Math.max(20, s.len);
    if (!total) return;
    for (const s of strokes) {
      const n = Math.max(3, Math.round((budget * Math.max(20, s.len)) / total));
      const cols = strokeColors(s);
      for (let i = 0; i < n; i++) {
        s.sample(tmp);
        let dx = tmp.x - fx, dy = tmp.y - fy;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        const v = rnd(140, 460) * sc, glow = Math.random() < 0.4;
        this.parts.emit({
          x: tmp.x, y: tmp.y, vx: dx * v + rnd(-90, 90) * sc, vy: dy * v + rnd(-170, 40) * sc,
          gravity: 560 * sc, drag: 0.35, life: rnd(0.55, 1.1), size: (glow ? rnd(2.5, 5) : rnd(2, 3.2)) * sc,
          color: Math.random() < 0.25 ? '#ffffff' : pick(cols), kind: glow ? 'glow' : 'spark',
        });
      }
    }
  }

  // Undo: the stroke burns away into rising embers.
  dissolve(s, sc, n = 80) {
    const cols = strokeColors(s);
    for (let i = 0; i < n; i++) {
      s.sample(tmp);
      this.parts.emit({ x: tmp.x, y: tmp.y, vx: rnd(-30, 30) * sc, vy: rnd(-90, -20) * sc, gravity: -40 * sc, drag: 0.6,
        life: rnd(0.5, 1.2), size: rnd(1.5, 3.4) * sc, color: Math.random() < 0.3 ? '#ffffff' : pick(cols), kind: 'glow' });
    }
  }

  burst(x, y, cols, n, sc, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = rnd(0.3, 1) * speed * sc;
      this.parts.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 120 * sc, drag: 0.2,
        life: rnd(0.3, 0.6), size: rnd(1.8, 2.8) * sc, color: pick(cols), kind: 'spark' });
    }
  }

  wave(x, y, col, r) { this.waves.push({ x, y, t0: -1, col, r }); }

  showBadge(text, col, t) { this.badge = { text, col, t0: t }; }

  // --- drawing -------------------------------------------------------------------

  drawParticles(ctx) { this.parts.draw(ctx); }

  drawWaves(ctx, t) {
    if (!this.waves.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let j = 0;
    for (const w of this.waves) {
      if (w.t0 < 0) w.t0 = t;
      const k = (t - w.t0) / 0.7;
      if (k >= 1) continue;
      this.waves[j++] = w;
      const e = easeOutCubic(k), r = w.r * (0.15 + e);
      ctx.strokeStyle = w.col;
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.lineWidth = 14 * (1 - k) + 2;
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.lineWidth = 2.2 * (1 - k) + 0.6;
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TAU); ctx.stroke();
    }
    this.waves.length = j;
    ctx.restore();
  }

  // Brush name floating above each live hand for a moment after a switch.
  drawBadge(ctx, t, spots, sc) {
    const b = this.badge;
    if (!b) return;
    const age = t - b.t0;
    if (age > 1.4) { this.badge = null; return; }
    const a = clamp(age / 0.12) * clamp((1.4 - age) / 0.4);
    const pop = easeOutBack(clamp(age / 0.35));
    ctx.save();
    ctx.font = '900 13px Orbitron, Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of spots) {
      const x = p.x, y = p.y - (34 + age * 16) * sc;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc * pop, sc * pop);
      const w = ctx.measureText(b.text).width + 26;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.7;
      ctx.drawImage(glowSprite(b.col), -w * 0.75, -28, w * 1.5, 56);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.strokeStyle = b.col;
      ctx.lineWidth = 1.5;
      roundRect(ctx, -w / 2, -12, w, 24, 12);
      ctx.fillStyle = 'rgba(5,6,10,0.55)';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.text, 0, 1);
      ctx.restore();
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Converging ring while the fingers close: "you're about to draw".
export function drawCharge(ctx, x, y, k, col, sc, t) {
  if (k <= 0.01) return;
  const r = lerp(30, 11, k) * sc;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(ctx, x, y, r * 1.5, col, 0.25 * k);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.25 + 0.75 * k;
  ctx.lineWidth = 2;
  // Four arcs that close into a ring as the pinch completes.
  const gap = (1 - k) * 0.9, rot = t * 2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a0 = rot + (i * TAU) / 4 + gap * 0.5, a1 = rot + ((i + 1) * TAU) / 4 - gap * 0.5;
    ctx.moveTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.arc(x, y, r, a0, a1);
  }
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = k;
  ctx.beginPath(); ctx.arc(x, y, 1.6 + k, 0, TAU); ctx.fill();
  ctx.restore();
}

// The glowing nib under a drawing pinch.
export function drawNib(ctx, x, y, col, sc, t, style) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const fl = style === 'fire' ? 0.8 + 0.4 * Math.sin(t * 37) * Math.sin(t * 23) : 1;
  drawGlow(ctx, x, y, 30 * sc * fl, col, 0.55);
  drawGlow(ctx, x, y, 11 * sc, '#ffffff', 0.9);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([4 * sc, 5 * sc]);
  ctx.lineDashOffset = -t * 40;
  ctx.beginPath(); ctx.arc(x, y, 15 * sc, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, 2.6 * sc, 0, TAU); ctx.fill();
  ctx.restore();
}

// Radial hold gauge (✊ clear / ✌️ undo).
export function drawHold(ctx, x, y, r, p, a, col, label, t) {
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a * 0.55;
  const tr = tickRing(), s = r * 2.2;
  ctx.translate(x, y);
  ctx.rotate(t * 0.6);
  ctx.drawImage(tr, -s / 2, -s / 2, s, s);
  ctx.rotate(-t * 0.6);
  ctx.globalAlpha = a * 0.2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  if (p > 0) {
    const a0 = -Math.PI / 2, a1 = a0 + p * TAU;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col;
    ctx.globalAlpha = a * 0.3;
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r, a0, a1); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, Math.cos(a1) * r, Math.sin(a1) * r, 14, col, a * 0.9);
    drawGlow(ctx, Math.cos(a1) * r, Math.sin(a1) * r, 6, '#ffffff', a);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = a;
  ctx.font = '900 11px Orbitron, Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 0, r + 16);
  ctx.restore();
}

// Short fading comet behind a pointing finger. tr: { buf: (x, y, t) × N
// ring, N, head, count }; the bright head only while still pointing.
export function drawComet(ctx, tr, col, sc, now, life, head = true) {
  const N = tr.N, buf = tr.buf;
  if (tr.count < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? '#ffffff' : col;
    for (let i = tr.count - 1; i > 0; i--) {
      const a = (tr.head - i + N) % N, b = (tr.head - i + 1 + N) % N;
      const age = now - buf[b * 3 + 2];
      const k = clamp(1 - age / life) * (1 - (i - 1) / tr.count);
      if (k <= 0.02) continue;
      ctx.globalAlpha = pass ? k * 0.8 : k * 0.55;
      ctx.lineWidth = (pass ? 1.2 + 1.8 * k : 3 + 9 * k) * sc;
      ctx.beginPath();
      ctx.moveTo(buf[a * 3], buf[a * 3 + 1]);
      ctx.lineTo(buf[b * 3], buf[b * 3 + 1]);
      ctx.stroke();
    }
  }
  if (head) {
    const h = tr.head;
    drawGlow(ctx, buf[h * 3], buf[h * 3 + 1], 18 * sc, col, 0.7);
    drawGlow(ctx, buf[h * 3], buf[h * 3 + 1], 7 * sc, '#ffffff', 0.9);
  }
  ctx.restore();
}
