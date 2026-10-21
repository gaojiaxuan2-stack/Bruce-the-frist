// particles.js — a small pooled particle system for the 2D overlay.

import { glowSprite } from './draw.js';

export class Particles {
  constructor(max = 1500) {
    this.max = max;
    this.list = [];
  }

  // p: { x, y, vx, vy, life (s), size, color, drag (0..1 per s), gravity (px/s²),
  //      shrink (bool), kind: 'glow' | 'dot' | 'spark' | 'line', spin }
  emit(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      vx: 0, vy: 0, life: 1, size: 4, color: '#fff', drag: 0.9, gravity: 0, shrink: true, kind: 'glow',
      ...p, age: 0, px: p.x, py: p.y,
    });
  }

  burst(x, y, n, fn) { for (let i = 0; i < n; i++) this.emit(fn(i, x, y)); }

  update(dt) {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.px = p.x; p.py = p.y;
      const drag = Math.pow(p.drag, dt);
      p.vx *= drag; p.vy *= drag;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      L[j++] = p;
    }
    L.length = j;
  }

  draw(ctx) {
    if (!this.list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Streaks are batched into one stroke per (colour, width, alpha) bucket —
    // hundreds of separate stroke() calls are slow on phones.
    const batches = this._batches || (this._batches = new Map());
    for (const b of batches.values()) b.n = 0;
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      const s = p.shrink ? p.size * k : p.size;
      const alpha = Math.min(1, k * 1.5);
      if (p.kind === 'spark' || p.kind === 'line') {
        const w = Math.max(0.5, Math.round(s) * 0.5);
        const a = Math.ceil(alpha * 4) / 4;
        const key = `${p.color}|${w}|${a}`;
        let b = batches.get(key);
        if (!b) { b = { color: p.color, w, a, n: 0, pts: [] }; batches.set(key, b); }
        const tail = p.kind === 'spark' ? 2.2 : 1;
        const i = b.n * 4;
        b.pts[i] = p.x; b.pts[i + 1] = p.y;
        b.pts[i + 2] = p.x - (p.x - p.px) * tail; b.pts[i + 3] = p.y - (p.y - p.py) * tail;
        b.n++;
        continue;
      }
      ctx.globalAlpha = alpha;
      if (p.kind === 'dot') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.3, s), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const img = glowSprite(p.color);
        ctx.drawImage(img, p.x - s * 2, p.y - s * 2, s * 4, s * 4);
      }
    }
    for (const [key, b] of batches) {
      if (!b.n) { batches.delete(key); continue; }
      ctx.globalAlpha = b.a;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.w;
      ctx.beginPath();
      for (let i = 0; i < b.n * 4; i += 4) { ctx.moveTo(b.pts[i], b.pts[i + 1]); ctx.lineTo(b.pts[i + 2], b.pts[i + 3]); }
      ctx.stroke();
    }
    ctx.restore();
  }

  clear() { this.list.length = 0; }
}
