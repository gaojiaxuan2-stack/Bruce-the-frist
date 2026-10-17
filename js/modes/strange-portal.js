// strange-portal.js — sling-ring portals: finding a drawn circle in a
// fingertip trail, and the portal life cycle (open → live → collapse) with
// its showering rim of sparks. The view through the portal is drawn in
// WebGL by strange-gl.js.

import { TAU, clamp, easeOutBack, easeInBack, drawGlow } from './strange-fx.js';

export const LOOP_ANGLE = (300 / 180) * Math.PI;   // swept angle that closes a loop
const OPEN_S = 0.6;
const CLOSE_S = 0.5;
const LIFE_S = 25;
export const CLOSE_HOLD = 0.4;    // s a fist must stay on a portal

// Least-squares circle (Kasa) from running sums of x, y, z = x² + y².
function kasa(n, sx, sy, sxx, syy, sxy, sxz, syz, sz) {
  const a = sxx, b = sxy, c = sx, d = sxy, e = syy, f = sy, g = sx, h = sy, k = n;
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  if (!isFinite(det) || Math.abs(det) < 1e-6) return null;
  const r1 = -sxz, r2 = -syz, r3 = -sz;
  const D = (r1 * (e * k - f * h) - b * (r2 * k - f * r3) + c * (r2 * h - e * r3)) / det;
  const E = (a * (r2 * k - f * r3) - r1 * (d * k - f * g) + c * (d * r3 - r2 * g)) / det;
  const F = (a * (e * r3 - r2 * h) - b * (d * r3 - r2 * g) + r1 * (d * h - e * g)) / det;
  const cx = -D / 2, cy = -E / 2, rr = cx * cx + cy * cy - F;
  if (!(rr > 0) || !isFinite(rr)) return null;
  return { cx, cy, r: Math.sqrt(rr) };
}

// pts: [{x, y}] oldest → newest; only pts[start..] are considered. Walks back
// from the newest point looking for the shortest tail that winds ≥ 300°
// around its best-fit circle, stays round and ends near where it started.
// Returns that loop with closed = true, or the most-wound round-ish partial
// arc (closed = false, for the "keep going" guide), or null.
export function findLoop(pts, start, minR, maxR) {
  const n = pts.length;
  if (n - start < 6) return null;
  const o = pts[n - 1];
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0, path = 0;
  let best = null;
  for (let i = n - 1; i >= start; i--) {
    const x = pts[i].x - o.x, y = pts[i].y - o.y, z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
    if (i < n - 1) path += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const m = n - i;
    if (m < 6 || path < TAU * minR * 0.45) continue;
    const fit = kasa(m, sx, sy, sxx, syy, sxy, sxz, syz, sz);
    if (!fit || fit.r < minR || fit.r > maxR) continue;
    let swept = 0, err = 0;
    let prev = Math.atan2(pts[i].y - o.y - fit.cy, pts[i].x - o.x - fit.cx);
    for (let j = i; j < n; j++) {
      const dx = pts[j].x - o.x - fit.cx, dy = pts[j].y - o.y - fit.cy;
      err += Math.abs(Math.hypot(dx, dy) - fit.r);
      if (j > i) {
        const ang = Math.atan2(dy, dx);
        let d = ang - prev;
        if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
        swept += d;
        prev = ang;
      }
    }
    err /= m * fit.r;
    const sw = Math.abs(swept);
    const gap = Math.hypot(pts[i].x - o.x, pts[i].y - o.y) / fit.r;
    const cand = { cx: fit.cx + o.x, cy: fit.cy + o.y, r: fit.r, swept: sw, err, gap, dir: Math.sign(swept) || 1, closed: false };
    if (sw >= LOOP_ANGLE && err < 0.2 && gap < 1.35) { cand.closed = true; return cand; }
    if (err < 0.28 && (!best || sw > best.swept)) best = cand;
    if (sw > TAU * 1.25) break;   // wound past a full turn without closing cleanly
  }
  return best;
}

export class Portals {
  constructor() {
    this.list = [];
    this.seq = 0;
    this.flashes = [];   // { x, y, r, t0, dur, color }
  }

  reset() { this.list.length = 0; this.flashes.length = 0; }
  live() { return this.list.filter((p) => p.state !== 'closing'); }

  // dir: the way the circle was drawn (the rim spins the same way).
  open(x, y, R, t, dir = 1) {
    const p = {
      id: ++this.seq, x, y, R, t0: t, state: 'opening', closeT: 0, k0: 1,
      k: 0, open: 0, hold: 0, scene: (this.seq - 1) % 3, spin: dir, seed: Math.random() * 50, acc: 0,
    };
    this.list.push(p);
    this.flashes.push({ x, y, r: R * 1.6, t0: t, dur: 0.45, color: '#fff3d6' });
    return p;
  }

  close(p, t) {
    if (p.state === 'closing') return false;
    p.state = 'closing';
    p.closeT = t;
    p.k0 = p.k;
    return true;
  }

  // q: quality 0..1 (fewer sparks on phones). Returns portals that just ended.
  update(frame, sparks, q) {
    const t = frame.t, dt = Math.min(frame.dt, 0.1), m = Math.min(frame.W, frame.H);
    const ended = [];
    for (const p of this.list) {
      const age = t - p.t0;
      if (p.state === 'opening') {
        p.open = clamp(age / OPEN_S);
        p.k = Math.max(0, easeOutBack(p.open));
        if (p.open >= 1) p.state = 'live';
      } else if (p.state === 'live') {
        // breathe; shrink a little while a fist is closing it
        const target = 1 - 0.1 * clamp(p.hold / CLOSE_HOLD) + 0.012 * Math.sin(t * 7 + p.seed);
        p.k += (target - p.k) * Math.min(1, dt * 12);
        if (age > LIFE_S) this.close(p, t);
      } else {
        const c = clamp((t - p.closeT) / CLOSE_S);
        p.k = Math.max(0, p.k0 * (1 - easeInBack(c)));
        if (c >= 1) { p.dead = true; ended.push(p); }
      }
      // the iconic rim: sparks thrown off tangentially, then falling
      const r = p.R * p.k;
      if (r > 2 && !p.dead) {
        const opening = p.state === 'opening' ? 1.6 : 1;
        const charging = 1 + clamp(p.hold / CLOSE_HOLD) * 1.2;
        p.acc += (380 + p.R * 2.3) * q * Math.min(1, p.k) * opening * charging * dt;
        let n = Math.floor(p.acc);
        p.acc -= n;
        while (n-- > 0) {
          const th = Math.random() * TAU;
          const c = Math.cos(th), s = Math.sin(th);
          const rr = r * (0.97 + Math.random() * 0.06);
          const sp = p.R * (1.2 + Math.random() * 1.8);
          const out = p.R * (0.1 + Math.random() * 0.6);
          sparks.emit(p.x + c * rr, p.y + s * rr,
            -s * sp * p.spin + c * out, c * sp * p.spin + s * out,
            0.2 + Math.random() * 0.4, m * 1.0, 0.3, Math.random() < 0.25 ? 2 : 1);
        }
      }
    }
    for (const p of ended) {
      // implosion flash, then embers scatter
      for (let i = 0; i < 110 * q; i++) {
        const a = Math.random() * TAU, v = p.R * (0.6 + Math.random() * 2.6);
        sparks.emit(p.x, p.y, Math.cos(a) * v, Math.sin(a) * v, 0.3 + Math.random() * 0.5, m * 1.2, 0.2, Math.random() < 0.3 ? 2 : 1);
      }
      this.flashes.push({ x: p.x, y: p.y, r: p.R * 0.9, t0: t, dur: 0.35, color: '#fff3d6' });
    }
    if (ended.length) this.list = this.list.filter((p) => !p.dead);
    this.flashes = this.flashes.filter((f) => t - f.t0 < f.dur);
    return ended;
  }

  // 2D extras over the WebGL portal: glow, fist-charge ring, flashes.
  draw2D(ctx, frame, pal) {
    const t = frame.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const r = p.R * p.k;
      if (r < 2) continue;
      drawGlow(ctx, p.x, p.y, r * 1.55, pal.glow, 0.22);
      if (p.hold > 0.001 && p.state === 'live') {
        const k = clamp(p.hold / CLOSE_HOLD);
        const rr = p.R * 1.16;
        ctx.globalAlpha = 0.35 + 0.3 * k;
        ctx.strokeStyle = pal.mid;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 10]);
        ctx.lineDashOffset = -t * 60;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.core;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + k * TAU); ctx.stroke();
        const ea = -Math.PI / 2 + k * TAU;
        drawGlow(ctx, p.x + Math.cos(ea) * rr, p.y + Math.sin(ea) * rr, 22, pal.core, 0.9);
      }
    }
    for (const f of this.flashes) {
      const u = (t - f.t0) / f.dur;
      drawGlow(ctx, f.x, f.y, f.r * (0.6 + u * 0.8), f.color, (1 - u) * 0.85);
    }
    ctx.restore();
  }
}
