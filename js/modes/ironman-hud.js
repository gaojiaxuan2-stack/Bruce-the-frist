// ironman-hud.js — Tony Stark's helmet HUD. Everything is thin line art
// drawn into a GlowLayer (so it blooms for free): curved "wing" gauges on
// both sides of the visor, a drifting heading tape, readouts that tick, a
// radar sweep, warnings, and a boot-up sequence whenever the suit changes.
// The centre of the view stays clear; the top mode bar and the bottom hint
// bar are left alone.

import { TAU, clamp, lerp, easeOutCubic, rgba, rng, GlowLayer } from './ironman-fx.js';

export const PALETTES = {
  mk85: {
    id: 'mk85', name: 'MARK 85', ai: 'J.A.R.V.I.S.', sub: 'MARK 85 · ALL SYSTEMS NOMINAL', full: true,
    line: '#9ff4ff', main: '#4fd8ff', accent: '#ffcf3a', alert: '#ff3b30', text: '#e6fdff',
    core: '#e9fbff', beam: '#4fd8ff',
    gl: { lo: [0.82, 0.97, 1.1], hi: [1.08, 0.99, 0.88], sat: 0.9, expo: 0.9, hud: [0.31, 0.85, 1.0], beam: [0.42, 0.82, 1.0] },
  },
  warmachine: {
    id: 'warmachine', name: 'WAR MACHINE', ai: 'WM-OS', sub: 'WAR MACHINE · WEAPONS HOT', full: true,
    line: '#eef3f8', main: '#a3b3c4', accent: '#ff8a2a', alert: '#ff3b30', text: '#f3f6fa',
    core: '#fff4e4', beam: '#ffad5c',
    gl: { lo: [0.88, 0.95, 1.05], hi: [1.06, 1.0, 0.94], sat: 0.42, expo: 0.9, hud: [0.72, 0.78, 0.86], beam: [1.0, 0.66, 0.34] },
  },
  stealth: {
    id: 'stealth', name: 'STEALTH', ai: 'STEALTH', sub: 'SILENT RUNNING', full: false,
    line: '#8fe9ff', main: '#2fa8d0', accent: '#9ff4ff', alert: '#ff3b30', text: '#cdf6ff',
    core: '#e9fbff', beam: '#4fd8ff',
    gl: { lo: [0.6, 0.86, 1.06], hi: [0.9, 1.02, 1.12], sat: 0.2, expo: 0.76, hud: [0.18, 0.66, 0.82], beam: [0.42, 0.82, 1.0] },
  },
};

const UI = 'Rajdhani, "Segoe UI", system-ui, sans-serif';
const DISPLAY = 'Orbitron, Rajdhani, sans-serif';
const DEG = Math.PI / 180;
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const BOOT_TICKS = [0.12, 0.3, 0.48, 0.66, 0.84];
const SIDES = [-1, 1];

// Where everything goes, in CSS px. Portrait phones, landscape phones and
// desktops each get their own arrangement around the HUD bars.
function layoutFor(W, H) {
  const portrait = H > W;
  const compact = !portrait && H < 560;
  const phone = W < 600;
  const guide = W > 900;                       // gesture legend sits bottom-left
  const topL = phone ? 140 : 84;
  const topR = phone ? 140 : W < 1180 ? 122 : 84;
  const bottom = H - (W < 900 ? 154 : 134);
  const u = portrait ? clamp(W / 420, 0.8, 1) : clamp(Math.min(W / 1280, H / 720), 0.75, 1.25);
  const L = { W, H, u, portrait, compact, phone };
  L.cx = W / 2;
  if (portrait) {
    // everything stacks at the top; the lower half is left to the hands
    Object.assign(L, { cy: H * 0.55, rx: W / 2 - 12, ry: H * 0.33 });
    L.up = L.upR = 25 * DEG;
    L.dn = L.dnR = 28 * DEG;
    L.comp = { x: W / 2, y: topL - 2, w: W * 0.46 };
    L.left = { x: 16, y: topL + 52 };
    L.right = { x: W - 16, y: topL + 52 };
    L.radar = { x: W - 16 - 27, y: topL + 52 + 76, r: 27 };
    L.rplRows = true;
    L.msg = { x: W / 2, y: bottom - 6, align: 'center' };
  } else if (compact) {
    // short wings below two compact corner panels
    Object.assign(L, { cy: H * 0.6, rx: W / 2 - 26, ry: H * 0.55 });
    const yTop = 156, yBot = H - 130;
    L.up = L.upR = Math.asin(clamp((L.cy - yTop) / L.ry, 0, 0.95));
    L.dn = L.dnR = Math.asin(clamp((yBot - L.cy) / L.ry, 0, 0.95));
    L.comp = null;
    L.left = { x: 28, y: 84 };
    L.right = { x: W - 28, y: 128 };
    L.radar = null;
    L.rplRows = false;
    L.msg = { x: W / 2, y: bottom - 4, align: 'center' };
  } else {
    Object.assign(L, { cy: H * 0.47, rx: W / 2 - 62 * u, ry: H * 0.6 });
    const yTopL = topL + 66 * u, yTopR = topR + 66 * u;
    L.up = Math.asin(clamp((L.cy - yTopL) / L.ry, 0, 0.95));
    L.upR = Math.asin(clamp((L.cy - yTopR) / L.ry, 0, 0.95));
    L.dn = Math.asin(clamp(((guide ? H - 336 : bottom - 10) - L.cy) / L.ry, 0, 0.95));
    L.radar = { x: L.cx + L.rx - 110 * u, y: bottom - 64 * u, r: 46 * u };
    L.dnR = Math.asin(clamp((L.radar.y - L.radar.r - 26 - L.cy) / L.ry, 0, 0.95));
    L.comp = { x: W / 2, y: topL + 2, w: Math.min(400, W * 0.3) };
    L.left = { x: L.cx - L.rx + 100 * u, y: topL + 10 };
    L.right = { x: L.cx + L.rx - 100 * u, y: topR + 10 };
    L.rplRows = true;
    L.msg = { x: L.left.x, y: L.left.y + 186 * u, align: 'left' };
  }
  const fs = (px, min) => Math.max(min, Math.round(px * u * 10) / 10);
  L.F = {
    tiny: `600 ${fs(10.5, 9.5)}px ${UI}`,
    small: `600 ${fs(12, 10.5)}px ${UI}`,
    bold: `700 ${fs(14, 12)}px ${UI}`,
    num: `700 ${fs(portrait || compact ? 11.5 : 15, 11)}px ${DISPLAY}`,
    big: `900 ${fs(portrait || compact ? 20 : 28, 17)}px ${DISPLAY}`,
  };
  return L;
}

function fmtInt(n) {
  const s = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

// Reveal a string as if typed (k: 0..1).
function typed(s, k) {
  if (k >= 1) return s;
  if (k <= 0) return '';
  return s.slice(0, Math.ceil(s.length * k)) + '_';
}

// Elliptic arc on one side of the visor. s: -1 left, +1 right.
// phi: angle above the horizon (radians, positive = up).
function wingArc(g, L, s, k, p0, p1) {
  const rx = L.rx * k, ry = L.ry * k;
  if (s < 0) g.ellipse(L.cx, L.cy, rx, ry, 0, Math.PI + p0, Math.PI + p1);
  else g.ellipse(L.cx, L.cy, rx, ry, 0, -p1, -p0);
}
function wingPt(L, s, k, phi, out) {
  out.x = L.cx + s * L.rx * k * Math.cos(phi);
  out.y = L.cy - L.ry * k * Math.sin(phi);
  // outward normal of the ellipse
  let nx = (s * Math.cos(phi)) / L.rx, ny = -Math.sin(phi) / L.ry;
  const n = Math.hypot(nx, ny) || 1;
  out.nx = nx / n; out.ny = ny / n;
  return out;
}

export class HelmetHud {
  constructor() {
    this.layer = new GlowLayer();
    this.pal = PALETTES.mk85;
    this.next = null;       // palette waiting for the reboot
    this.boot = 0;          // seconds since the HUD (re)booted
    this.vis = 1;           // fades out before a reboot
    this.bootStep = 0;
    this.L = null;
    this.dip = 0;           // power dip after a blast
    this.msg = { text: '', color: '#fff', t: -99, dur: 0 };
    this.radarImg = null; this.sweepImg = null; this.radarKey = '';
    const r = rng(42);
    this.contacts = Array.from({ length: 5 }, () => ({ a: r() * TAU, d: 0.25 + r() * 0.65 }));
    this.pt = { x: 0, y: 0, nx: 0, ny: 0 };
  }

  reset(id) {
    this.pal = PALETTES[id] || PALETTES.mk85;
    this.next = null;
    this.boot = 0; this.bootStep = 0; this.vis = 1; this.dip = 0;
    this.msg.t = -99;
  }

  setPalette(id) {
    const p = PALETTES[id];
    if (!p || (p === this.pal && !this.next)) return;
    this.next = p;
  }

  say(text, color, t, dur = 1.4) { Object.assign(this.msg, { text, color, t, dur }); }

  update(dt, t, app) {
    if (this.next) {
      this.vis -= dt * 6;
      if (this.vis <= 0) { this.pal = this.next; this.next = null; this.boot = 0; this.bootStep = 0; this.vis = 0; }
    } else {
      this.vis = Math.min(1, this.vis + dt * 6);
      this.boot += dt;
    }
    this.dip = Math.max(0, this.dip - dt * 0.6);
    // soft blips as the HUD comes online
    while (this.bootStep < BOOT_TICKS.length && this.boot >= BOOT_TICKS[this.bootStep] && !this.next) {
      app.sfx.tone({ type: 'sine', f0: 1700 + this.bootStep * 260, f1: 2100 + this.bootStep * 260, dur: 0.05, vol: 0.035 });
      this.bootStep++;
    }
  }

  // Open the layer for this frame (reticles are drawn into it as well).
  begin(frame, app) {
    const { W, H } = frame;
    if (!this.L || this.L.W !== W || this.L.H !== H) { this.L = layoutFor(W, H); this.radarKey = ''; }
    return this.layer.begin(W, H, Math.min(app.dpr || 1, 2));
  }

  composite(ctx, frame, shake) {
    const t = frame.t;
    // subtle projector flicker with the odd dropout
    let a = 0.9 + 0.1 * Math.sin(t * 31) * Math.sin(t * 17.3);
    const blip = Math.floor(t * 9);
    if (((blip * 7919) % 101) / 101 > 0.975) a *= 0.6;
    this.layer.composite(ctx, shake.x, shake.y, a, 0.85);
  }

  // info: { targets:[{x,y}], rpl:[{label, charge, state}], steer } (Repulsors.info)
  draw(g, frame, info) {
    const L = this.L, P = this.pal, t = frame.t, b = this.boot, A = this.vis;
    if (A <= 0.01) return;
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    if ('letterSpacing' in g) g.letterSpacing = '0.5px';
    const st = (t0, d) => clamp((b - t0) / d);

    if (P.full) {
      this.drawWings(g, L, t, easeOutCubic(st(0, 0.75)), A);
      if (L.comp) this.drawCompass(g, L, t, easeOutCubic(st(0.2, 0.55)), A, info);
      this.drawLeft(g, L, t, st(0.25, 0.9), A, info);
      this.drawRight(g, L, t, st(0.4, 0.9), A, info);
      if (L.radar) this.drawRadar(g, L, t, easeOutCubic(st(0.5, 0.6)), A, info);
    } else {
      // stealth: one quiet status line
      g.globalAlpha = 0.75 * A * st(0.1, 0.4);
      g.font = L.F.small;
      g.fillStyle = P.line;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      const x = L.left.x, y = L.left.y;
      g.fillText(typed(`● ${P.ai} · ${P.sub}`, st(0.1, 0.6)), x, y);
      if (info.targets.length) {
        g.globalAlpha = 0.5 * A;
        g.fillText(`TGT ${String(info.targets.length).padStart(2, '0')} · SILENT LOCK`, x, y + 15 * L.u);
      }
    }
    this.drawMessage(g, L, t, A);

    // boot scan: a bright line sweeping down the visor
    if (b < 0.9) {
      const k = b / 0.9, y = lerp(L.H * 0.12, L.H * 0.86, easeOutCubic(k));
      g.globalAlpha = (1 - k) * 0.7 * A;
      g.strokeStyle = P.line;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(L.W * 0.06, y); g.lineTo(L.W * 0.94, y);
      g.stroke();
      g.font = L.F.tiny;
      g.fillStyle = P.line;
      g.textAlign = 'right';
      g.textBaseline = 'bottom';
      g.fillText(`${P.name} · SYSTEM CHECK ${Math.round(k * 100)}%`, L.W * 0.94, y - 3);
    }
    g.globalAlpha = 1;
  }

  // Curved gauges hugging both sides of the visor.
  drawWings(g, L, t, k, A) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u, pt = this.pt;
    for (const s of SIDES) {
      const up = s < 0 ? L.up : L.upR, dn = s < 0 ? L.dn : L.dnR;
      const mid = (up - dn) / 2, half = ((up + dn) / 2) * k;
      if (half < 0.01) continue;
      const p0 = mid - half, p1 = mid + half;

      // main arc + inward ticks
      g.strokeStyle = P.main;
      g.lineWidth = 1.2;
      g.globalAlpha = 0.8 * A;
      g.beginPath(); wingArc(g, L, s, 1, p0, p1); g.stroke();
      g.beginPath();
      const step = 2.5 * DEG;
      for (let i = Math.ceil(p0 / step); i * step <= p1; i++) {
        wingPt(L, s, 1, i * step, pt);
        const len = (i % 4 === 0 ? 10 : 4.5) * u;
        g.moveTo(pt.x - pt.nx * 2, pt.y - pt.ny * 2);
        g.lineTo(pt.x - pt.nx * (2 + len), pt.y - pt.ny * (2 + len));
      }
      g.lineWidth = 1;
      g.globalAlpha = 0.55 * A;
      g.stroke();
      // end caps
      g.beginPath();
      for (const p of [p0, p1]) {
        wingPt(L, s, 1, p, pt);
        g.moveTo(pt.x - pt.nx * 14 * u, pt.y - pt.ny * 14 * u);
        g.lineTo(pt.x + pt.nx * 10 * u, pt.y + pt.ny * 10 * u);
      }
      g.lineWidth = 1.5;
      g.globalAlpha = 0.85 * A;
      g.stroke();
      // degree labels on every other long tick
      g.font = L.F.tiny;
      g.fillStyle = P.main;
      g.textAlign = s < 0 ? 'left' : 'right';
      g.textBaseline = 'middle';
      g.globalAlpha = 0.6 * A;
      for (let i = Math.ceil(p0 / (step * 8)); i * step * 8 <= p1; i++) {
        wingPt(L, s, 1, i * step * 8, pt);
        g.fillText(String(Math.round(i * 20)), pt.x - pt.nx * 22 * u, pt.y - pt.ny * 22 * u);
      }

      // inner dashed arc, segments creeping along
      const kIn = 0.955, span = p1 - p0;
      g.strokeStyle = P.line;
      g.lineWidth = 2;
      g.globalAlpha = 0.5 * A;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const f = (t * (0.045 + i * 0.012) * (i % 2 ? 1 : -1) + i * 0.27 + 10) % 1;
        const a0 = p0 + f * span, a1 = Math.min(p1, a0 + span * (0.05 + 0.04 * (i % 3)));
        if (a1 <= a0) continue;
        wingPt(L, s, kIn, a0, pt);
        g.moveTo(pt.x, pt.y);
        wingArc(g, L, s, kIn, a0, a1);
      }
      g.stroke();

      // outer gauge: dim track + accent fill (power on the left, thrust on the right)
      const kOut = 1.03;
      const val = s < 0 ? clamp(0.82 + 0.05 * Math.sin(t * 0.7) - this.dip * 0.5) : clamp(0.6 + 0.12 * Math.sin(t * 0.37) + this.dip * 0.3);
      g.strokeStyle = P.main;
      g.lineWidth = 3 * u;
      g.globalAlpha = 0.18 * A;
      g.beginPath(); wingArc(g, L, s, kOut, p0, p1); g.stroke();
      g.strokeStyle = P.accent;
      g.globalAlpha = 0.85 * A;
      g.beginPath(); wingArc(g, L, s, kOut, p0, p0 + span * val); g.stroke();

      // pitch indicator: a small triangle riding the inside of the arc
      const ph = mid + Math.sin(t * 0.45 + s) * half * 0.55;
      wingPt(L, s, 1, ph, pt);
      const ix = pt.x - pt.nx * 16 * u, iy = pt.y - pt.ny * 16 * u;
      const tx = -pt.ny, ty = pt.nx;
      g.fillStyle = P.accent;
      g.globalAlpha = 0.9 * A;
      g.beginPath();
      g.moveTo(pt.x - pt.nx * 4 * u, pt.y - pt.ny * 4 * u);
      g.lineTo(ix + tx * 5 * u, iy + ty * 5 * u);
      g.lineTo(ix - tx * 5 * u, iy - ty * 5 * u);
      g.closePath();
      g.fill();
      g.font = L.F.tiny;
      g.textAlign = s < 0 ? 'left' : 'right';
      g.fillText(`${s < 0 ? 'PITCH' : 'ROLL'} ${(Math.sin(t * 0.45 + s) * 12).toFixed(1)}°`, ix - pt.nx * 6 * u, iy - pt.ny * 6 * u);
    }
  }

  // Heading tape under the mode bar.
  drawCompass(g, L, t, k, A, info) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u, { x, y, w } = L.comp;
    const hdg = ((284 + t * 3 + Math.sin(t * 0.3) * 14 + info.steer * 40) % 360 + 360) % 360;
    const span = 70, ppd = (w / span) * k, half = (w / 2) * k;
    g.strokeStyle = P.main;
    g.fillStyle = P.main;
    g.lineWidth = 1;
    g.font = L.F.tiny;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let d = Math.ceil((hdg - span / 2) / 5) * 5; d <= hdg + span / 2; d += 5) {
      const dx = (d - hdg) * ppd;
      const a = 1 - Math.pow(Math.abs(dx) / Math.max(half, 1), 2);
      if (a <= 0) continue;
      const deg = ((d % 360) + 360) % 360, major = deg % 15 === 0;
      g.globalAlpha = a * 0.85 * A;
      g.beginPath();
      g.moveTo(x + dx, y); g.lineTo(x + dx, y + (major ? 8 : 4) * u);
      g.stroke();
      if (major) {
        const lbl = CARD[deg];
        g.fillStyle = lbl ? P.accent : P.main;
        g.fillText(lbl || String(deg).padStart(3, '0'), x + dx, y + 10 * u);
      }
    }
    // centre caret and readout
    g.globalAlpha = 0.95 * A;
    g.fillStyle = P.accent;
    g.beginPath();
    g.moveTo(x, y + 1); g.lineTo(x - 4 * u, y - 5 * u); g.lineTo(x + 4 * u, y - 5 * u);
    g.closePath(); g.fill();
    g.globalAlpha = 0.5 * A;
    g.strokeStyle = P.main;
    g.beginPath();
    g.moveTo(x - half, y - 2); g.lineTo(x + half, y - 2);
    g.stroke();
    g.globalAlpha = 0.9 * A;
    g.fillStyle = P.text;
    g.font = L.F.num;
    g.textBaseline = 'top';
    g.fillText(`${String(Math.round(hdg) % 360).padStart(3, '0')}°`, x, y + 24 * u);
  }

  drawLeft(g, L, t, k, A, info) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u, x = L.left.x;
    let y = L.left.y;
    const line = (i) => clamp(k * 6 - i);   // staggered typing per row
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    // AI status with a blinking dot
    g.globalAlpha = (Math.sin(t * 5) > -0.3 ? 1 : 0.25) * A * line(0);
    g.fillStyle = P.accent;
    g.beginPath(); g.arc(x + 3, y, 3 * u, 0, TAU); g.fill();
    g.globalAlpha = A;
    g.font = L.F.bold;
    g.fillStyle = P.text;
    g.fillText(typed(`${P.ai} ONLINE`, line(0)), x + 11 * u, y);
    y += 15 * u;
    if (!L.compact && !L.portrait) {
      g.font = L.F.tiny;
      g.fillStyle = P.main;
      g.globalAlpha = 0.75 * A;
      g.fillText(typed(P.sub, line(1)), x, y);
      y += 22 * u;
    } else y += 6 * u;
    // PWR
    const pwr = 400 + Math.round(Math.sin(t * 0.7) * 3 + Math.sin(t * 2.3)) - Math.round(this.dip * 70);
    g.globalAlpha = 0.7 * A * line(2);
    g.font = L.F.tiny;
    g.fillStyle = P.main;
    g.fillText('PWR', x, y);
    g.globalAlpha = A * line(2);
    g.font = L.F.big;
    g.fillStyle = this.dip > 0.3 && Math.sin(t * 20) > 0 ? P.alert : P.text;
    g.fillText(typed(`${pwr}%`, line(2)), x + 26 * u, y + 2 * u);
    y += (L.portrait || L.compact ? 20 : 28) * u;
    // ARC REACTOR with a segmented bar
    const arc = Math.round(98 - this.dip * 9 + Math.sin(t * 0.21));
    const bw = (L.portrait ? 104 : L.compact ? 120 : 160) * u;
    g.globalAlpha = 0.85 * A * line(3);
    g.font = L.F.small;
    g.fillStyle = P.main;
    g.fillText(typed('ARC REACTOR', line(3)), x, y);
    g.textAlign = 'right';
    g.fillStyle = P.text;
    g.fillText(`${arc}%`, x + bw, y);
    g.textAlign = 'left';
    this.segBar(g, x, y + 7 * u, bw, 4 * u, 20, (arc / 100) * line(3), P.line, A * line(3), 0);
    y += 22 * u;
    if (L.rplRows) this.drawRpl(g, L, x, y, line(4), A, info, t);
  }

  // Live repulsor gauges, one per side of the screen.
  drawRpl(g, L, x, y, k, A, info, t) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u;
    const bw = (L.portrait ? 64 : 92) * u;
    g.textBaseline = 'middle';
    for (const r of info.rpl) {
      g.textAlign = 'left';
      g.font = L.F.small;
      g.fillStyle = P.main;
      g.globalAlpha = 0.85 * A * k;
      g.fillText(`RPLSR ${r.label}`, x, y);
      const col = r.state === 'FIRE' ? P.alert : r.state === 'READY' ? P.accent : P.line;
      this.segBar(g, x + 50 * u, y - 2 * u, bw, 4 * u, 10, r.charge, col, A * k, r.state === 'READY' ? t : 0);
      g.fillStyle = r.state === 'STBY' || r.state === 'OFFLINE' ? P.main : col;
      g.globalAlpha = (r.state === 'READY' && Math.sin(t * 14) < 0 ? 0.45 : 0.95) * A * k;
      g.fillText(r.state === 'CHRG' ? `${Math.round(r.charge * 100)}%` : r.state, x + 56 * u + bw, y);
      y += 15 * u;
    }
  }

  segBar(g, x, y, w, h, n, v, color, A, pulse) {
    const gap = Math.max(1, w / n * 0.25), sw = (w - gap * (n - 1)) / n;
    const on = Math.round(clamp(v) * n);
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = (i < on ? (pulse ? 0.7 + 0.3 * Math.sin(pulse * 12 - i * 0.6) : 0.9) : 0.16) * A;
      g.fillRect(x + i * (sw + gap), y, sw, h);
    }
  }

  drawRight(g, L, t, k, A, info) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u, x = L.right.x;
    let y = L.right.y;
    const alt = 12480 + Math.sin(t * 0.11) * 1400 + Math.sin(t * 0.53) * 80;
    const spd = 0.84 + 0.06 * Math.sin(t * 0.2) + 0.01 * Math.sin(t * 1.7) + this.dip * 0.05;
    const thr = 62 + 8 * Math.sin(t * 0.37) + this.dip * 30;
    const n = info.targets.length;
    const rows = [
      ['ALT', `${fmtInt(alt)} FT`, P.text],
      ['SPD', `MACH ${spd.toFixed(2)}`, P.text],
      ['THR', `${Math.round(thr)}%`, P.text],
      ['TGT', n ? `${String(n).padStart(2, '0')} LOCKED` : 'SCANNING', n ? P.accent : P.main],
    ];
    const tight = L.portrait || L.compact;
    if (tight) rows.splice(2, 1);
    if (L.compact) rows.length = 2;
    const lw = (L.compact ? 150 : tight ? 118 : 132) * u;
    g.textBaseline = 'middle';
    rows.forEach(([lbl, val, col], i) => {
      const kk = clamp(k * 5 - i);
      if (kk <= 0) return;
      g.textAlign = 'left';
      g.font = L.F.small;
      g.fillStyle = P.main;
      g.globalAlpha = 0.75 * A * kk;
      g.fillText(lbl, x - lw, y);
      g.textAlign = 'right';
      g.font = L.F.num;
      g.fillStyle = col;
      g.globalAlpha = A * kk;
      g.fillText(typed(val, kk), x, y);
      y += (tight ? 15 : 20) * u;
    });
    if (tight) return;
    // thrust trace: a scrolling waveform
    const kk = clamp(k * 5 - 4);
    if (kk <= 0) return;
    const w = lw, h = 18 * u, x0 = x - w;
    y += 4 * u;
    g.globalAlpha = 0.25 * A * kk;
    g.strokeStyle = P.main;
    g.lineWidth = 1;
    g.strokeRect(x0, y, w, h);
    g.globalAlpha = 0.85 * A * kk;
    g.strokeStyle = P.line;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const s = t * 3 + i * 0.35;
      const v = Math.sin(s) * 0.35 + Math.sin(s * 2.7 + 1) * 0.2 + Math.sin(s * 7.1) * 0.08 * (1 + this.dip * 4);
      const px = x0 + (i / 40) * w * kk, py = y + h / 2 - v * h * 0.8;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  }

  buildRadar(r, dpr) {
    const P = this.pal;
    const S = Math.ceil(r * 2 * dpr) + 4;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const R = (S - 4) / 2, m = S / 2;
    g.translate(m, m);
    g.fillStyle = rgba(P.main, 0.07);
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    g.strokeStyle = P.main;
    g.lineWidth = Math.max(1, dpr);
    g.globalAlpha = 0.85;
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
    g.globalAlpha = 0.35;
    for (const f of [0.66, 0.33]) { g.beginPath(); g.arc(0, 0, R * f, 0, TAU); g.stroke(); }
    g.beginPath();
    g.moveTo(-R, 0); g.lineTo(R, 0); g.moveTo(0, -R); g.lineTo(0, R);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU, l = i % 9 === 0 ? 0.84 : 0.92;
      g.moveTo(Math.cos(a) * R * l, Math.sin(a) * R * l);
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    g.stroke();
    this.radarImg = c;
    // sweep trail: a fan of thin wedges fading behind the beam
    const sc = document.createElement('canvas');
    sc.width = sc.height = S;
    const sg = sc.getContext('2d');
    sg.translate(m, m);
    sg.fillStyle = P.line;
    const N = 28, arcLen = 1.1;
    for (let i = 0; i < N; i++) {
      sg.globalAlpha = Math.pow(1 - i / N, 2) * 0.32;
      sg.beginPath();
      sg.moveTo(0, 0);
      sg.arc(0, 0, R, -((i + 1) / N) * arcLen, -(i / N) * arcLen + 0.01);
      sg.closePath();
      sg.fill();
    }
    sg.globalAlpha = 0.95;
    sg.strokeStyle = P.line;
    sg.lineWidth = Math.max(1, dpr * 1.2);
    sg.beginPath(); sg.moveTo(0, 0); sg.lineTo(R, 0); sg.stroke();
    this.sweepImg = sc;
  }

  drawRadar(g, L, t, k, A, info) {
    if (k <= 0.001) return;
    const P = this.pal, u = L.u, { x, y } = L.radar, r = L.radar.r;
    const dpr = this.layer.w / L.W;
    const key = `${P.id}|${r}|${dpr}`;
    if (this.radarKey !== key) { this.buildRadar(r, dpr); this.radarKey = key; }
    const rr = r * k;
    g.globalAlpha = A;
    g.drawImage(this.radarImg, x - rr - 2 / dpr, y - rr - 2 / dpr, rr * 2 + 4 / dpr, rr * 2 + 4 / dpr);
    const sweep = (t * 1.7) % TAU;
    g.save();
    g.translate(x, y);
    g.rotate(sweep);
    g.globalAlpha = A * k;
    g.drawImage(this.sweepImg, -rr - 2 / dpr, -rr - 2 / dpr, rr * 2 + 4 / dpr, rr * 2 + 4 / dpr);
    g.restore();
    // contacts flare up as the beam passes and slowly fade
    g.fillStyle = P.line;
    for (const c of this.contacts) {
      const since = (((sweep - c.a) % TAU) + TAU) % TAU;
      const v = Math.pow(1 - since / TAU, 3);
      g.globalAlpha = v * A * k;
      const cx = x + Math.cos(c.a) * c.d * rr, cy = y + Math.sin(c.a) * c.d * rr;
      g.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    }
    // hands = locked targets (gold diamonds)
    g.fillStyle = P.accent;
    for (const p of info.targets) {
      const px = clamp((p.x / L.W - 0.5) * 1.7, -0.8, 0.8), py = clamp((p.y / L.H - 0.55) * 1.7, -0.8, 0.8);
      const cx = x + px * rr, cy = y + py * rr, d = 3.5 * u;
      g.globalAlpha = (0.65 + 0.35 * Math.sin(t * 8)) * A * k;
      g.beginPath();
      g.moveTo(cx, cy - d); g.lineTo(cx + d, cy); g.lineTo(cx, cy + d); g.lineTo(cx - d, cy);
      g.closePath(); g.fill();
    }
    g.globalAlpha = 0.7 * A * k;
    g.font = L.F.tiny;
    g.fillStyle = P.main;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('RADAR · 2 KM', x, y + rr + 5 * u);
  }

  drawMessage(g, L, t, A) {
    const m = this.msg, age = t - m.t;
    if (age < 0 || age > m.dur || !m.text) return;
    const fade = Math.min(1, age * 8, (m.dur - age) * 4);
    const blink = age < 0.6 ? (Math.sin(age * 40) > 0 ? 1 : 0.35) : 1;
    g.globalAlpha = fade * blink * A;
    g.font = L.F.bold;
    g.fillStyle = m.color;
    g.textAlign = L.msg.align;
    g.textBaseline = 'middle';
    const txt = `▲ ${m.text}`;
    g.fillText(txt, L.msg.x, L.msg.y);
  }
}
