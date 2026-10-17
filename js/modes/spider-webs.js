// spider-webs.js — web-shooter shots, sticky tethers (verlet ropes),
// splats and the comic "THWIP!" lettering.

import { comicText, drawGlow, clamp, easeOutBack } from '../draw.js';
import { Particles } from '../particles.js';

const SPEED = 2500;         // projectile speed, px/s
const MAX_WEBS = 16;
const N = 12;               // rope points
const ITER = 12;            // rope constraint iterations
const STRAND_FADE = [6.0, 7.5];   // s after release: strand fades out
const SPLAT_FADE = [7.0, 8.5];    // s after release: splat fades out
const SHRIVEL = 0.55;       // s for the clear animation
const WORDS = ['THWIP!', 'THWIP!', 'THWIPP!', 'THWIP!!'];
const TAU = Math.PI * 2;

// Small seeded PRNG so every splat is irregular but stable.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Height of the HUD bars (CSS px) that webs and lettering keep clear of.
export function hudBands(W, H) {
  const top = W < 600 ? 112 : W < 1180 ? 104 : 74;
  const bottom = W < 900 ? 150 : 124;
  return { top: Math.max(top, H * 0.04), bottom: Math.max(bottom, H * 0.04) };
}

function easeOutElastic(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1;
}

// Distance along (dx, dy) from o until it leaves rect r; Infinity if never.
function rayExit(o, dx, dy, r) {
  let best = Infinity;
  const cand = (t) => { if (t > 1e-3 && t < best) best = t; };
  if (dx > 1e-4) cand((r.r - o.x) / dx); else if (dx < -1e-4) cand((r.l - o.x) / dx);
  if (dy > 1e-4) cand((r.b - o.y) / dy); else if (dy < -1e-4) cand((r.t - o.y) / dy);
  return best;
}

// Pre-render one radial web splat (8-12 spokes, 4-6 rings sagging inward).
function makeSplat(R, dpr, seed) {
  const pad = 8;
  const half = R + pad;
  const c = document.createElement('canvas');
  c.width = c.height = Math.max(8, Math.ceil(half * 2 * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(half, half);
  const rnd = rng(seed);

  // Geometry first (quadratic curves: x0 y0 cx cy x1 y1), then three passes.
  const curves = [];
  const n = 8 + Math.floor(rnd() * 5);
  const spokes = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * (TAU / n) * 0.45;
    const sp = { c: Math.cos(a), s: Math.sin(a), len: R * (0.74 + rnd() * 0.26) };
    const bend = (rnd() - 0.5) * 0.12, ex = sp.c * sp.len, ey = sp.s * sp.len;
    curves.push(0, 0, ex * 0.5 - ey * bend, ey * 0.5 + ex * bend, ex, ey);
    spokes.push(sp);
  }
  const rings = 4 + Math.floor(rnd() * 3);
  for (let k = 1; k <= rings; k++) {
    const f = (k / (rings + 0.4)) * (0.94 + rnd() * 0.08);
    for (let i = 0; i < n; i++) {
      const A = spokes[i], B = spokes[(i + 1) % n];
      const broken = k >= rings - 1 && rnd() < 0.14;   // a few snapped outer threads
      const ra = Math.min(A.len, f * R * (0.96 + rnd() * 0.08));
      const rb = Math.min(B.len, f * R * (0.96 + rnd() * 0.08));
      const sag = 0.26 + rnd() * 0.16;
      if (broken) continue;
      const ax = A.c * ra, ay = A.s * ra, bx = B.c * rb, by = B.s * rb;
      curves.push(ax, ay, (ax + bx) * 0.5 * (1 - sag), (ay + by) * 0.5 * (1 - sag), bx, by);
    }
  }

  const lw = clamp(R * 0.022, 1, 2.6);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < curves.length; i += 6) {
    g.moveTo(curves[i], curves[i + 1]);
    g.quadraticCurveTo(curves[i + 2], curves[i + 3], curves[i + 4], curves[i + 5]);
  }
  const passes = [
    ['rgba(6,8,28,0.4)', lw + 2.2],       // dark underlay: readable on bright walls
    ['rgba(150,190,255,0.22)', lw * 3.6], // soft bluish glow
    ['#f4f8ff', lw],                      // silver-white core
  ];
  for (const [color, width] of passes) { g.strokeStyle = color; g.lineWidth = width; g.stroke(); }

  // sticky glob in the middle
  g.beginPath();
  const m = 9;
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU, r = R * 0.075 * (0.8 + rnd() * 0.5);
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.lineWidth = 2.5;
  g.strokeStyle = 'rgba(6,8,28,0.35)';
  g.stroke();
  g.fillStyle = '#f7faff';
  g.fill();
  return { canvas: c, half };
}

export class WebSystem {
  constructor() {
    this.webs = [];
    this.texts = [];
    this.fx = new Particles(500);
    this.seq = 1;
    this.buf = new Float32Array(2 * 64);    // resampled strand points
    this.buf2 = new Float32Array(2 * 64);
    this.lastTwang = -9;
  }

  reset() { this.webs.length = 0; this.texts.length = 0; this.fx.clear(); }
  count() {
    let n = 0;
    for (const w of this.webs) if (w.dieT === Infinity) n++;
    return n;
  }
  attachedTo(handId) { return this.webs.find((w) => w.attached && w.handId === handId) || null; }

  // Shoot from the wrist toward the index/pinky tips.
  fire(hand, t, frame, app) {
    const { W, H } = frame;
    const lm = hand.lm, wr = lm[0];
    let mx = (lm[8].x + lm[20].x) / 2 - wr.x, my = (lm[8].y + lm[20].y) / 2 - wr.y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    let dx = mx * 0.75 + hand.dir.x * 0.25, dy = my * 0.75 + hand.dir.y * 0.25;
    const dl = Math.hypot(dx, dy);
    if (!(dl > 1e-3)) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }

    const s = clamp(hand.size || 80, 30, 400);
    const minD = Math.min(W, H);
    const R = clamp(s * 0.8, minD * 0.075, minD * 0.15);
    const band = hudBands(W, H);
    const rect = { l: W * 0.04, r: W * 0.96, t: band.top + R, b: H - band.bottom - R * 0.6 };
    if (rect.t > rect.b) rect.t = rect.b = (rect.t + rect.b) / 2;
    let d = rayExit(wr, dx, dy, rect);
    if (!isFinite(d)) d = minD * 0.4;
    d = Math.max(d, s * 1.2);
    const ax = clamp(wr.x + dx * d, rect.l, rect.r);
    const ay = clamp(wr.y + dy * d, rect.t, rect.b);
    const dist = Math.max(1, Math.hypot(ax - wr.x, ay - wr.y));

    // Only the newest web of a hand stays on its tether.
    for (const w of this.webs) if (w.attached && w.handId === hand.id) this.release(w, t);

    const seed = (Math.random() * 1e9) | 0;
    this.webs.push({
      id: this.seq++, handId: hand.id, t0: t, seed,
      ox: wr.x, oy: wr.y, fx: wr.x, fy: wr.y, ax, ay, dist, travel: 0,
      ang: Math.atan2(ay - wr.y, ax - wr.x),
      stuck: false, attached: true, hitT: Infinity, relT: Infinity, dieT: Infinity,
      pts: new Float32Array(N * 4), L0: dist, taut: 0, vib: 0, armed: false,
      w: clamp(s * 0.022, 1.3, 3.2), R, splat: null, phase: Math.random() * TAU,
    });
    // Too many webs: shrivel the oldest loose ones.
    let alive = this.webs.filter((w) => w.dieT === Infinity);
    while (alive.length > MAX_WEBS) {
      const old = alive.find((w) => !w.attached) || alive[0];
      old.dieT = t; old.attached = false;
      alive = alive.filter((w) => w !== old);
    }

    // Lettering near the wrist, on the side away from the shot.
    const side = (wr.x < W / 2 ? 1 : -1);
    let nx = -dy, ny = dx;
    if (nx * side < 0) { nx = -nx; ny = -ny; }
    const size = clamp(s * 0.55, 30, 70);
    const tx = clamp(wr.x + nx * s * 0.9 - dx * s * 0.2, size * 1.8, W - size * 1.8);
    const ty = clamp(wr.y + ny * s * 0.9 - dy * s * 0.2 - s * 0.3, band.top + size * 0.7, H - band.bottom - size * 0.7);
    this.texts.push({ text: WORDS[(Math.random() * WORDS.length) | 0], x: tx, y: ty, t0: t, size, rot: (Math.random() - 0.5) * 0.4, alt: this.seq % 2 });
    if (this.texts.length > 6) this.texts.shift();

    // muzzle puff
    for (let i = 0; i < 7; i++) {
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
      const v = 250 + Math.random() * 450;
      this.fx.emit({ x: wr.x, y: wr.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.22 + Math.random() * 0.15, size: 2 + Math.random() * 2, color: '#dbe8ff', drag: 0.02, kind: 'spark' });
    }
    app.sfx.play('thwip');
  }

  release(w, t) {
    if (!w.attached) return;
    w.attached = false;
    if (w.stuck) w.relT = t;
  }

  clearAll(t) {
    for (const w of this.webs) {
      if (w.dieT !== Infinity) continue;
      w.dieT = t; w.attached = false;
      const x = w.stuck ? w.ax : w.ox, y = w.stuck ? w.ay : w.oy;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU, v = 60 + Math.random() * 160;
        this.fx.emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.3, size: 1.5 + Math.random() * 1.5, color: '#cfe0ff', drag: 0.1, gravity: 200, kind: 'dot' });
      }
    }
  }

  _impact(w, t, app) {
    w.stuck = true;
    w.hitT = t;
    if (!w.attached) w.relT = t;
    try { w.splat = makeSplat(w.R, app.dpr || 1, w.seed); } catch (e) { w.splat = null; }
    // seed the rope along the wavy flight line so it settles with a spring
    const P = w.pts;
    const ex = w.ox - w.ax, ey = w.oy - w.ay;
    const L = Math.hypot(ex, ey) || 1;
    const nx = -ey / L, ny = ex / L;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const off = Math.sin(s * Math.PI) * Math.sin(s * 9 + w.phase) * w.w * 3;
      const x = w.ax + ex * s + nx * off, y = w.ay + ey * s + ny * off;
      P[i * 4] = x; P[i * 4 + 1] = y; P[i * 4 + 2] = x; P[i * 4 + 3] = y;
    }
    w.L0 = L * 1.02;
    const v = 120 + w.R * 2;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, sp = v * (0.4 + Math.random());
      this.fx.emit({ x: w.ax, y: w.ay, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.35, size: 1.2 + Math.random() * 1.6, color: '#ffffff', drag: 0.03, gravity: 380, kind: 'dot' });
    }
    app.sfx.play('splat');
  }

  // hold: Map handId -> wrist {x, y} for hands still making the sign.
  update(frame, hold, app) {
    const t = frame.t;
    // fixed rope substeps keep the physics real-time even at low frame rates
    const steps = clamp(Math.ceil(frame.dt * 60), 1, 4), dt = clamp(frame.dt / steps, 1 / 240, 1 / 40);
    const g = frame.H * 1.4;
    for (const w of this.webs) {
      if (w.attached) {
        const wr = hold.get(w.handId);
        if (wr) { w.ox = wr.x; w.oy = wr.y; } else this.release(w, t);
      }
      if (!w.stuck) {
        w.travel += SPEED * frame.dt;
        if (w.travel >= w.dist && w.dieT === Infinity) this._impact(w, t, app);
      } else for (let i = 0; i < steps; i++) this._rope(w, dt, g, t, app);
    }
    this.webs = this.webs.filter((w) => {
      if (w.dieT !== Infinity) return t - w.dieT < SHRIVEL;
      return !(w.stuck && t - w.relT > SPLAT_FADE[1]);
    });
    this.texts = this.texts.filter((x) => t - x.t0 < 0.95);
    this.fx.update(frame.dt);
  }

  _rope(w, dt, g, t, app) {
    const P = w.pts;
    const pin = w.attached;
    if (pin) {
      const d = Math.hypot(w.ox - w.ax, w.oy - w.ay);
      if (d > w.L0) w.L0 = d;   // the line pays out when pulled
      else if (w.L0 > d * 1.35 + 30) w.L0 += (d * 1.35 + 30 - w.L0) * Math.min(1, dt * 1.5);   // reel in big slack
      const taut = clamp((d / w.L0 - 0.9) / 0.1, 0, 1);
      // slack -> snapped taut: twang
      if (taut < 0.4) w.armed = true;
      if (taut > 0.97 && w.armed) {
        w.armed = false;
        w.vib = 1;
        if (t - this.lastTwang > 0.35) {
          this.lastTwang = t;
          app.sfx.tone({ type: 'triangle', f0: 190, f1: 120, dur: 0.12, vol: 0.06 });
        }
      }
      w.taut = taut;
    } else w.taut = Math.max(0, w.taut - dt * 4);
    w.vib *= Math.exp(-dt * 5);

    const damp = Math.pow(0.3, dt), gg = g * dt * dt;
    for (let i = 1; i < N; i++) {
      if (i === N - 1 && pin) continue;
      const k = i * 4;
      const x = P[k], y = P[k + 1];
      const vx = (x - P[k + 2]) * damp, vy = (y - P[k + 3]) * damp;
      P[k + 2] = x; P[k + 3] = y;
      P[k] = x + vx; P[k + 1] = y + vy + gg;
    }
    P[0] = P[2] = w.ax; P[1] = P[3] = w.ay;
    if (pin) {
      const k = (N - 1) * 4;
      P[k + 2] = P[k]; P[k + 3] = P[k + 1];   // keep its velocity for when it lets go
      P[k] = w.ox; P[k + 1] = w.oy;
    }
    const seg = w.L0 / (N - 1);
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = i * 4, b = a + 4;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d <= seg) continue;   // a rope resists stretching, not bunching
        const diff = (d - seg) / d;
        const wa = i === 0 ? 0 : 1, wb = (i + 1 === N - 1 && pin) ? 0 : 1;
        const sum = wa + wb;
        if (!sum) continue;
        P[a] += dx * diff * (wa / sum); P[a + 1] += dy * diff * (wa / sum);
        P[b] -= dx * diff * (wb / sum); P[b + 1] -= dy * diff * (wb / sum);
      }
    }
  }

  // Catmull-Rom resample of the rope into this.buf; returns point count.
  _resample(w, t, shrink) {
    const P = w.pts, out = this.buf;
    let len = 0;
    for (let i = 1; i < N; i++) len += Math.hypot(P[i * 4] - P[i * 4 - 4], P[i * 4 + 1] - P[i * 4 - 3]);
    const M = clamp(Math.round(len / 14), N, 60);
    const vib = (w.taut * 0.5 + w.vib * 2.5) * w.w;
    const ex = P[(N - 1) * 4] - P[0], ey = P[(N - 1) * 4 + 1] - P[1];
    const el = Math.hypot(ex, ey) || 1;
    for (let j = 0; j < M; j++) {
      const u = (j / (M - 1)) * (N - 1);
      const i = Math.min(N - 2, Math.floor(u)), f = u - i;
      const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(N - 1, i + 2);
      const f2 = f * f, f3 = f2 * f;
      for (let c = 0; c < 2; c++) {
        const p0 = P[i0 * 4 + c], p1 = P[i * 4 + c], p2 = P[i2 * 4 + c], p3 = P[i3 * 4 + c];
        out[j * 2 + c] = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
      }
      const s = j / (M - 1);
      if (vib > 0.05) {
        const o = Math.sin(t * 62 + s * 7) * vib * Math.sin(s * Math.PI);
        out[j * 2] += (-ey / el) * o; out[j * 2 + 1] += (ex / el) * o;
      }
      if (shrink > 0) {   // shrivel back into the splat
        out[j * 2] = w.ax + (out[j * 2] - w.ax) * (1 - shrink);
        out[j * 2 + 1] = w.ay + (out[j * 2 + 1] - w.ay) * (1 - shrink);
      }
    }
    return M;
  }

  // Wavy in-flight strand from the wrist to the travelling tip.
  _flight(w, t) {
    const out = this.buf;
    const f = clamp(w.travel / w.dist, 0, 1);
    const tx = w.fx + (w.ax - w.fx) * f, ty = w.fy + (w.ay - w.fy) * f;
    const ex = tx - w.ox, ey = ty - w.oy;
    const L = Math.hypot(ex, ey) || 1;
    const nx = -ey / L, ny = ex / L;
    const M = clamp(Math.round(L / 12), 8, 60);
    const A = w.w * 2.4 * (1 - f * 0.5);
    for (let j = 0; j < M; j++) {
      const s = j / (M - 1);
      const o = Math.sin(s * L / 34 - t * 30 + w.phase) * A * Math.pow(Math.sin(s * Math.PI), 0.7);
      out[j * 2] = w.ox + ex * s + nx * o;
      out[j * 2 + 1] = w.oy + ey * s + ny * o;
    }
    return { M, tx, ty };
  }

  _poly(ctx, buf, M) {
    ctx.beginPath();
    ctx.moveTo(buf[0], buf[1]);
    for (let j = 1; j < M; j++) ctx.lineTo(buf[j * 2], buf[j * 2 + 1]);
  }

  _strand(ctx, M, w, alpha, t) {
    const buf = this.buf;
    // dark underlay, bluish glow, silver core
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = '#080a1e';
    ctx.lineWidth = w.w + 2.2;
    this._poly(ctx, buf, M); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.2;
    ctx.strokeStyle = '#8fb8ff';
    ctx.lineWidth = w.w * 4;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#eef3ff';
    ctx.lineWidth = w.w;
    ctx.stroke();
    // two thin fibres twisting around the core
    const b2 = this.buf2;
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.6, w.w * 0.4);
    for (let sign = 1; sign >= -1; sign -= 2) {
      let acc = 0;
      for (let j = 0; j < M; j++) {
        const a = Math.max(0, j - 1), b = Math.min(M - 1, j + 1);
        const tx = buf[b * 2] - buf[a * 2], ty = buf[b * 2 + 1] - buf[a * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        if (j) acc += Math.hypot(buf[j * 2] - buf[j * 2 - 2], buf[j * 2 + 1] - buf[j * 2 - 1]);
        const o = Math.sin(acc * 0.11 + w.phase + t * 2) * w.w * 1.1 * sign;
        b2[j * 2] = buf[j * 2] - (ty / tl) * o;
        b2[j * 2 + 1] = buf[j * 2 + 1] + (tx / tl) * o;
      }
      this._poly(ctx, b2, M); ctx.stroke();
    }
  }

  draw(ctx, frame) {
    const t = frame.t;
    if (!this.webs.length && !this.fx.list.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // stuck strands (under their splats)
    for (const w of this.webs) {
      if (!w.stuck) continue;
      const die = w.dieT !== Infinity ? clamp((t - w.dieT) / SHRIVEL, 0, 1) : 0;
      const age = t - w.relT;
      let a = age > STRAND_FADE[0] ? 1 - (age - STRAND_FADE[0]) / (STRAND_FADE[1] - STRAND_FADE[0]) : 1;
      a *= 1 - die;
      if (a <= 0.01) continue;
      const M = this._resample(w, t, die * die * (3 - 2 * die));
      this._strand(ctx, M, w, a, t);
    }

    // splats
    for (const w of this.webs) {
      if (!w.stuck || !w.splat) continue;
      const age = t - w.hitT;
      const die = w.dieT !== Infinity ? clamp((t - w.dieT) / SHRIVEL, 0, 1) : 0;
      const rel = t - w.relT;
      let a = rel > SPLAT_FADE[0] ? 1 - (rel - SPLAT_FADE[0]) / (SPLAT_FADE[1] - SPLAT_FADE[0]) : 1;
      a *= 1 - die * die;
      if (a <= 0.01) continue;
      const pop = easeOutElastic(clamp(age / 0.7, 0, 1)) * 0.92 + clamp(age / 0.08, 0, 1) * 0.08;
      const sc = pop * (1 - die * 0.85);
      if (sc <= 0.01) continue;
      if (age < 0.16) {
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, w.ax, w.ay, w.R * (0.5 + age * 4), '#cfe0ff', (1 - age / 0.16) * 0.8);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(w.ax, w.ay);
      ctx.rotate(w.ang + die * 2.2);
      ctx.scale(1.1 * sc, 0.94 * sc);
      const h = w.splat.half;
      ctx.drawImage(w.splat.canvas, -h, -h, h * 2, h * 2);
      ctx.restore();
    }

    // flying shots on top, with a bright tip
    for (const w of this.webs) {
      if (w.stuck) continue;
      const die = w.dieT !== Infinity ? clamp((t - w.dieT) / SHRIVEL, 0, 1) : 0;
      const { M, tx, ty } = this._flight(w, t);
      this._strand(ctx, M, w, 1 - die, t);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      drawGlow(ctx, tx, ty, w.w * 9, '#bcd4ff', 0.9);
      drawGlow(ctx, tx, ty, w.w * 3.5, '#ffffff', 1);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    this.fx.draw(ctx);
  }

  drawTexts(ctx, frame) {
    const t = frame.t;
    for (const x of this.texts) {
      const age = t - x.t0;
      const scale = age < 0.2 ? Math.max(0.01, easeOutBack(age / 0.2)) : 1 + (age - 0.2) * 0.06;
      const alpha = age < 0.65 ? 1 : clamp(1 - (age - 0.65) / 0.3, 0, 1);
      comicText(ctx, x.text, x.x, x.y - age * 14, {
        size: x.size, rot: x.rot, scale, alpha,
        fill: x.alt ? '#fff35a' : '#ffffff', shadow: '#e62429',
      });
    }
  }
}
