// spider-sense.js — the classic comic "tingle": wavy lines that flicker
// out around the head for ~0.6 s, with a soft shimmer sound.

import { drawGlow, clamp, easeOutCubic } from '../draw.js';

const LIFE = 0.65;
const GAP = 1.5;   // minimum seconds between tingles

export class SpiderSense {
  constructor() {
    this.t0 = -99;
    this.lines = [];
    this.buf = new Float32Array(2 * 18);
  }

  reset() { this.t0 = -99; }
  get active() { return this.lines.length > 0; }

  trigger(t, app) {
    if (t - this.t0 < GAP) return false;
    this.t0 = t;
    // squiggles fanned around the top and sides of the head
    this.lines = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.04 + 0.92 * (i / (n - 1))) + (Math.random() - 0.5) * 0.12;
      this.lines.push({ a, len: 0.42 + Math.random() * 0.26, waves: 2.2 + Math.random() * 1.2, ph: Math.random() * 6, delay: Math.random() * 0.08 });
    }
    // two short side ticks lower down
    for (const a of [0.32, Math.PI - 0.32]) this.lines.push({ a, len: 0.34, waves: 2, ph: Math.random() * 6, delay: 0.05 });
    const s = app.sfx;
    s.tone({ type: 'sine', f0: 2500, f1: 3300, dur: 0.12, vol: 0.05 });
    s.tone({ type: 'sine', f0: 2900, f1: 3900, dur: 0.12, vol: 0.04, delay: 0.08 });
    s.noise({ dur: 0.3, vol: 0.035, type: 'highpass', f0: 5500, q: 0.7 });
    return true;
  }

  // head: { x, y, r } in CSS px
  draw(ctx, frame, head) {
    const age = frame.t - this.t0;
    if (age > LIFE) { this.lines.length = 0; return; }
    if (!head || !(head.r > 4)) return;
    const fade = age < LIFE - 0.22 ? 1 : clamp((LIFE - age) / 0.22, 0, 1);
    const R = head.r;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, head.x, head.y, R * 2.1, '#ff2a3d', 0.22 * fade * (1 - age / LIFE));
    const buf = this.buf;
    const jitter = R * 0.012;
    // the same squiggles three times: ink underlay, red glow, white core
    const PASSES = [
      ['source-over', '#1a0208', Math.max(3, R * 0.036), 0.55],
      ['lighter', '#ff2438', Math.max(3, R * 0.05), 0.8],
      ['source-over', '#ffffff', Math.max(1.2, R * 0.016), 0.95],
    ];
    const seed = Math.floor(frame.t * 30);
    for (const [op, color, width, alpha] of PASSES) {
      let rs = (seed % 2147483646) + 1;
      const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
      ctx.globalCompositeOperation = op;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = fade * alpha;
      ctx.beginPath();
      for (const L of this.lines) {
        const a2 = age - L.delay;
        if (a2 <= 0) continue;
        const grow = easeOutCubic(clamp(a2 / 0.14, 0, 1));
        const r0 = R * (1.05 + 0.18 * (age / LIFE));
        const len = R * L.len * grow;
        const ca = Math.cos(L.a), sa = Math.sin(L.a);
        const m = 16;
        for (let j = 0; j < m; j++) {
          const s = j / (m - 1);
          const o = Math.sin(s * Math.PI * 2 * L.waves + L.ph + frame.t * 38) * R * 0.045;
          const jx = (rnd() - 0.5) * jitter, jy = (rnd() - 0.5) * jitter;
          buf[j * 2] = head.x + ca * (r0 + len * s) - sa * o + jx;
          buf[j * 2 + 1] = head.y + sa * (r0 + len * s) + ca * o + jy;
        }
        ctx.moveTo(buf[0], buf[1]);
        for (let j = 1; j < m; j++) ctx.lineTo(buf[j * 2], buf[j * 2 + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
