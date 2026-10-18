// spider-sense.js — the classic comic "tingle": wavy lines that flicker
// out around the head for ~0.6 s, with a soft shimmer sound.

import { drawGlow, clamp, easeOutCubic } from '../draw.js';

const LIFE = 0.65;
const GAP = 1.5;   // minimum seconds between tingles
const M = 16;      // points per squiggle
// the same squiggles three times: ink underlay, red glow, white core
// [composite, colour, width (× head radius), min width px, alpha]
const PASSES = [
  ['source-over', '#140206', 0.05, 4, 0.6],
  ['lighter', '#ff2438', 0.06, 4, 0.85],
  ['source-over', '#ffffff', 0.02, 1.6, 1],
];

export class SpiderSense {
  constructor() {
    this.t0 = -99;
    this.lines = [];
    this.buf = new Float32Array(2 * M);
  }

  reset() { this.t0 = -99; this.lines.length = 0; }
  get active() { return this.lines.length > 0; }

  trigger(t, app) {
    if (t - this.t0 < GAP) return false;
    this.t0 = t;
    // squiggles fanned around the top and sides of the head
    this.lines.length = 0;
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.02 + 0.96 * (i / (n - 1))) + (Math.random() - 0.5) * 0.12;
      this.lines.push({ a, len: 0.45 + Math.random() * 0.3, waves: 2.2 + Math.random() * 1.2, ph: Math.random() * 6, delay: Math.random() * 0.08 });
    }
    // two short side ticks lower down
    for (const a of [0.35, Math.PI - 0.35]) this.lines.push({ a, len: 0.36, waves: 2, ph: Math.random() * 6, delay: 0.05 });
    const s = app.sfx;
    s.tone({ type: 'sine', f0: 2500, f1: 3300, dur: 0.12, vol: 0.05 });
    s.tone({ type: 'sine', f0: 2900, f1: 3900, dur: 0.12, vol: 0.04, delay: 0.08 });
    s.noise({ dur: 0.3, vol: 0.035, type: 'highpass', f0: 5500, q: 0.7 });
    return true;
  }

  // head: { x, y, r } in CSS px; top: keep the lines below this y (HUD bar)
  draw(ctx, frame, head, top = 0) {
    const age = frame.t - this.t0;
    if (age > LIFE) { this.lines.length = 0; return; }
    if (!head || !(head.r > 4) || !this.lines.length) return;
    const fade = age < LIFE - 0.22 ? 1 : clamp((LIFE - age) / 0.22, 0, 1);
    const R = head.r;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, head.x, head.y, R * 2.2, '#ff2a3d', 0.25 * fade * (1 - age / LIFE));
    // a thin "danger" ring that snaps outward from the head
    const ring = clamp(age / 0.35, 0, 1);
    if (ring < 1) {
      ctx.globalAlpha = (1 - ring) * 0.7;
      ctx.strokeStyle = '#ff3045';
      ctx.lineWidth = Math.max(2, R * 0.035) * (1 - ring * 0.6);
      ctx.beginPath();
      ctx.arc(head.x, head.y, R * (1.05 + easeOutCubic(ring) * 0.95), 0, Math.PI * 2);
      ctx.stroke();
    }
    const buf = this.buf;
    const jitter = R * 0.014;
    const seed = Math.floor(frame.t * 30);
    for (const [op, color, w, minW, alpha] of PASSES) {
      // same seed per pass, so the three layers jitter together
      let rs = (seed % 2147483646) + 1;
      const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
      ctx.globalCompositeOperation = op;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(minW, R * w);
      ctx.globalAlpha = fade * alpha;
      ctx.beginPath();
      for (const L of this.lines) {
        const a2 = age - L.delay;
        if (a2 <= 0) continue;
        const grow = easeOutCubic(clamp(a2 / 0.14, 0, 1));
        const r0 = R * (1.2 + 0.22 * (age / LIFE));   // starts just outside the head
        const ca = Math.cos(L.a), sa = Math.sin(L.a);
        let len = R * L.len * grow;
        // shorten lines that would reach into the top HUD bar
        if (sa < -0.05) len = Math.min(len, (head.y - top - R * 0.06) / -sa - r0);
        if (len < R * 0.1) continue;
        for (let j = 0; j < M; j++) {
          const s = j / (M - 1);
          const o = Math.sin(s * Math.PI * 2 * L.waves + L.ph + frame.t * 38) * R * 0.055;
          const jx = (rnd() - 0.5) * jitter, jy = (rnd() - 0.5) * jitter;
          buf[j * 2] = head.x + ca * (r0 + len * s) - sa * o + jx;
          buf[j * 2 + 1] = head.y + sa * (r0 + len * s) + ca * o + jy;
        }
        ctx.moveTo(buf[0], buf[1]);
        for (let j = 1; j < M; j++) ctx.lineTo(buf[j * 2], buf[j * 2 + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
