// DOCTOR STRANGE — eldritch shields on open palms, sling-ring portals drawn
// in the air with a fingertip, the Mirror Dimension folding the room behind
// you, and the Eye of Agamotto's green time echoes.
//
// Sigil art: strange-sigil.js · sparks + palettes: strange-fx.js ·
// circle detection + portal life cycle: strange-portal.js · shaders: strange-gl.js

import { drawHand } from '../draw.js';
import { SparkField, PALETTES, TAU, clamp, mixSparks, mixRGB, drawBloom } from './strange-fx.js';
import { sigilArt, drawSigil, rimPoint, LAYERS } from './strange-sigil.js';
import { findLoop, Portals, CLOSE_HOLD, LOOP_ANGLE } from './strange-portal.js';
import { renderWorld, renderPortals, TimeEcho } from './strange-gl.js';

// What each option turns on; the live values ease toward these.
const LOOKS = {
  mystic: { mirror: 0, echo: 0, green: 0 },
  mirror: { mirror: 1, echo: 0, green: 0 },
  time: { mirror: 0, echo: 1, green: 1 },
};
const SHIELD_ARM = 0.15;   // s an open palm must be held
const SHIELD_IN = 0.32;    // s to grow in
const SHIELD_OUT = 0.24;   // s to collapse
const TRAIL_SHOW = 1.5;    // s of visible fingertip trail
const TRAIL_KEEP = 2.6;    // s of trail searched for a drawn circle
const STROKE_GAP = 0.35;   // s without pointing that starts a new stroke
const GUIDE_ANGLE = 2.8;   // rad drawn before the "finish the circle" guide shows
const MAX_PORTALS = 2;

const HINT = '<b>✋</b> shield · <b>☝️ draw ⭕</b> portal · <b>✊</b> close';
const HINTS = {
  draw: '<b>☝️ Draw a circle</b> in the air to open a portal',
  keep: 'Keep going… <b>close the circle ⭕</b>',
  close: 'Hold a <b>✊ fist</b> on a portal to close it',
  closing: '<b>Hold it…</b> sealing the portal',
};

const S = {
  sparks: null, portals: null, echo: null,
  shields: new Map(),      // hand id -> shield
  trails: new Map(),       // hand id -> fingertip trail
  cur: { mirror: 0, echo: 0, green: 0 },
  segFade: 0,              // person mask availability, eased
  q: 1,                    // spark budget (lower on phones)
  sparkCols: PALETTES.mystic.sparks, rgb: PALETTES.mystic.rgb, green: -1,
  ghosts: [], ghostPool: [], ghostT: 0,   // TIME: hand afterimages
  hint: { key: 'default', cand: 'default', since: 0 },
  sfxT: {},
  lights: new Float32Array(16),
  tmp: { x: 0, y: 0, tx: 0, ty: 0 },
  hud: null, hudKey: '',
  crackleAt: 0,
};

function sfx(app, name, gap, t) {
  if (t - (S.sfxT[name] ?? -9) < gap) return false;
  S.sfxT[name] = t;
  app.sfx.play(name);
  return true;
}

const pal = () => (S.cur.green > 0.5 ? PALETTES.time : PALETTES.mystic);

// ---------------------------------------------------------------------------
// Shields

const snapshot = () => ({ x: 0, y: 0, R: 0, amt: 0, spins: LAYERS.map(() => 0), m: [1, 0, 0, 1], t: 0, at: -9 });

function newShield(h) {
  const R = h.size * 1.95;
  return {
    id: h.id, x: h.palm.x, y: h.palm.y, R, Rt: R, amt: 0, on: false, lost: false,
    spins: LAYERS.map(() => Math.random() * TAU), n: [0, 0, 1], lean: 0, speed: 0,
    m: [1, 0, 0, 1], acc: 0, t: 0,
    echoes: [snapshot(), snapshot(), snapshot()], echoK: 0, echoT: -9,   // TIME afterimages
  };
}

// TIME: remember where the shield was, for its green afterimages.
function recordEcho(sh, t) {
  if (t - sh.echoT < 0.07) return;
  sh.echoT = t;
  const e = sh.echoes[sh.echoK];
  sh.echoK = (sh.echoK + 1) % sh.echoes.length;
  e.x = sh.x; e.y = sh.y; e.R = sh.R; e.amt = sh.amt; e.t = t; e.at = t;
  for (let i = 0; i < 4; i++) e.m[i] = sh.m[i];
  for (let i = 0; i < e.spins.length; i++) e.spins[i] = sh.spins[i];
}

function trackShield(h, frame, app, m) {
  let sh = S.shields.get(h.id);
  if (!sh) { sh = newShield(h); S.shields.set(h.id, sh); }
  sh.lost = false;
  if (h.ghost) return;   // the tracker blinked: hold still
  const want = h.pose === 'open' && h.poseTime >= SHIELD_ARM && !h.overUI;
  sh.x = h.palm.x; sh.y = h.palm.y;
  sh.Rt = clamp(h.size * 1.95, m * 0.1, m * 0.4);
  if (sh.amt <= 0) sh.R = sh.Rt;
  sh.speed = h.speed;
  if (want !== sh.on) {
    sh.on = want;
    if (want) summon(sh, frame, app, m); else dismiss(sh, frame, app, m);
  }
  // roll away from upright, and the palm's facing (from landmark depth)
  let lean = h.angle + Math.PI / 2;
  if (lean > Math.PI) lean -= TAU;
  const k = Math.min(1, frame.dt * 6);
  sh.lean += (clamp(lean, -1.2, 1.2) - sh.lean) * k;
  const lm = h.lm, w = lm[0], a = lm[5], b = lm[17];
  const ux = a.x - w.x, uy = a.y - w.y, uz = a.z - w.z, vx = b.x - w.x, vy = b.y - w.y, vz = b.z - w.z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz);
  if (nl > 1e-3 && isFinite(nl)) {
    nx /= nl; ny /= nl; nz /= nl;
    if (nz < 0) { nx = -nx; ny = -ny; }
    sh.n[0] += (nx - sh.n[0]) * k * 0.5;
    sh.n[1] += (ny - sh.n[1]) * k * 0.5;
  }
}

function summon(sh, frame, app, m) {
  const t = frame.t, R = sh.Rt, P = pal();
  for (let i = 0; i < 48 * S.q; i++) {
    const a = Math.random() * TAU, v = R * (1.2 + Math.random() * 2.6);
    S.sparks.emit(sh.x + Math.cos(a) * R * 0.15, sh.y + Math.sin(a) * R * 0.15, Math.cos(a) * v, Math.sin(a) * v,
      0.3 + Math.random() * 0.35, m * 0.9, 0.12, Math.random() < 0.3 ? 2 : 1);
  }
  S.portals.flashes.push({ x: sh.x, y: sh.y, r: R * 0.95, t0: t, dur: 0.32, color: P.core });
  if (sfx(app, 'whoosh', 0.25, t)) {
    app.sfx.tone({ type: 'sine', f0: 520, f1: 1040, dur: 0.4, vol: 0.07 });
    app.sfx.tone({ type: 'triangle', f0: 1040, f1: 1560, dur: 0.3, vol: 0.04, delay: 0.06 });
  }
}

function dismiss(sh, frame, app, m) {
  const R = sh.R;
  for (let i = 0; i < 30 * S.q; i++) {
    const a = Math.random() * TAU, v = R * (0.6 + Math.random() * 1.4);
    S.sparks.emit(sh.x + Math.cos(a) * R * 0.9, sh.y + Math.sin(a) * R * 0.9, -Math.cos(a) * v * 0.4 + Math.sin(a) * v, -Math.sin(a) * v * 0.4 - Math.cos(a) * v,
      0.25 + Math.random() * 0.3, m * 1.4, 0.2, 1);
  }
  sfx(app, 'spark', 0.12, frame.t);
}

function animateShields(frame, m) {
  const dt = Math.min(frame.dt, 0.1);
  for (const [id, sh] of S.shields) {
    if (!frame.hands.some((h) => h.id === id)) { sh.on = false; sh.lost = true; }
    sh.amt = sh.on ? Math.min(1, sh.amt + dt / SHIELD_IN) : Math.max(0, sh.amt - dt / SHIELD_OUT);
    if (sh.amt <= 0) { if (sh.lost) S.shields.delete(id); continue; }
    sh.R += (sh.Rt - sh.R) * Math.min(1, dt * 10);
    const boost = 1 + Math.min(2.5, sh.speed / (m * 1.1));   // waving spins it up
    for (let i = 0; i < LAYERS.length; i++) sh.spins[i] += LAYERS[i].speed * dt * boost;
    // tilt + foreshortening as one 2x2 matrix: squash along the tilt axis
    const tx = sh.n[0] + Math.sin(sh.lean) * 0.32, ty = sh.n[1];
    const kk = Math.sqrt(1 - Math.min(0.5, tx * tx + ty * ty));
    const phi = Math.atan2(ty, tx), c = Math.cos(phi), s = Math.sin(phi);
    sh.m[0] = kk * c * c + s * s; sh.m[1] = sh.m[2] = (kk - 1) * c * s; sh.m[3] = kk * s * s + c * c;
    sh.t = frame.t;
    if (S.cur.green > 0.05) recordEcho(sh, frame.t);
    // sparks flung off the rim, tangentially, then falling
    if (sh.on && sh.amt > 0.35) {
      sh.acc += (80 + sh.R * 0.45) * S.q * (0.5 + 0.5 * boost) * dt;
      while (sh.acc >= 1) {
        sh.acc -= 1;
        const P = rimPoint(sh, Math.random() * TAU, 0.97, S.tmp);
        const v = sh.R * (0.7 + Math.random() * 1.6);
        S.sparks.emit(P.x, P.y, P.tx * v + (P.x - sh.x) * 0.5, P.ty * v + (P.y - sh.y) * 0.5,
          0.35 + Math.random() * 0.45, m * 1.3, 0.3, Math.random() < 0.2 ? 2 : 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fingertip trails → portals

function trackTrail(h, frame, app, m) {
  const t = frame.t;
  let tr = S.trails.get(h.id);
  if (!tr) { tr = { pts: [], off: true, offT: -9, stroke: 0, cool: 0, guide: null, acc: 0 }; S.trails.set(h.id, tr); }
  tr.guide = null;
  if (h.overUI) { tr.pts.length = 0; return; }
  const pointing = h.is('point');
  if (!pointing && !tr.off) { tr.off = true; tr.offT = t; }
  if (pointing) {
    // a real pause (not a dropped frame) starts a new stroke
    if (tr.off && t - tr.offT > STROKE_GAP) tr.stroke++;
    tr.off = false;
    const p = h.pointer, prev = tr.pts[tr.pts.length - 1];
    tr.pts.push({ x: p.x, y: p.y, t, s: tr.stroke });
    // sparks drip off the fingertip, more when it moves fast
    let vx = 0, vy = 0;
    if (prev && prev.s === tr.stroke && t > prev.t) { vx = (p.x - prev.x) / (t - prev.t); vy = (p.y - prev.y) / (t - prev.t); }
    const sp = Math.hypot(vx, vy);
    tr.acc += (16 + Math.min(70, sp / 14)) * S.q * Math.min(frame.dt, 0.1);
    while (tr.acc >= 1) {
      tr.acc -= 1;
      const a = Math.random() * TAU, v = m * (0.05 + Math.random() * 0.2);
      S.sparks.emit(p.x, p.y, Math.cos(a) * v - vx * 0.15, Math.sin(a) * v - vy * 0.15, 0.25 + Math.random() * 0.4, m * 1.2, 0.3, 1);
    }
    if (sp > m * 1.2) sfx(app, 'spark', 0.1 + Math.random() * 0.1, t);
  }
  while (tr.pts.length && t - tr.pts[0].t > TRAIL_KEEP) tr.pts.shift();
  if (!pointing || t < tr.cool) return;
  let start = tr.pts.length;
  while (start > 0 && tr.pts[start - 1].s === tr.stroke) start--;
  const loop = findLoop(tr.pts, start, m * 0.07, m * 0.5);
  if (!loop) return;
  if (loop.closed) {
    openPortal(loop, frame, app, m);
    tr.stroke++;           // the drawn ring fades; a fresh stroke starts
    tr.cool = t + 0.8;
  } else if (loop.swept > GUIDE_ANGLE && loop.err < 0.14) {
    tr.guide = loop;
  }
}

function openPortal(loop, frame, app, m) {
  const { W, t } = frame;
  const band = app.ui.bands();
  let R = clamp(loop.r * 1.12, m * 0.12, m * 0.35);
  R = Math.max(m * 0.1, Math.min(R, (band.bottom - band.top) * 0.62));
  const x = clamp(loop.cx, R * 0.75, W - R * 0.75);
  const lo = band.top + R * 0.8, hi = band.bottom - R * 0.8;
  const y = lo <= hi ? clamp(loop.cy, lo, hi) : (band.top + band.bottom) / 2;
  // a portal drawn over another replaces it, unless it has only just opened
  // (the finger overshooting the first circle); at most two stay open
  for (const p of S.portals.live()) {
    if (Math.hypot(p.x - x, p.y - y) >= (p.R + R) * 0.6) continue;
    if (t - p.t0 < 2) return;
    closePortal(p, t, app);
  }
  let live = S.portals.live();
  while (live.length >= MAX_PORTALS) { closePortal(live[0], t, app); live = S.portals.live(); }
  S.portals.open(x, y, R, t, loop.dir);
  // the drawn ring bursts into sparks
  for (let i = 0; i < 130 * S.q; i++) {
    const a = Math.random() * TAU, c = Math.cos(a), s = Math.sin(a);
    const v = R * (0.4 + Math.random() * 1.8);
    S.sparks.emit(loop.cx + c * loop.r, loop.cy + s * loop.r, c * v - s * v * loop.dir * 0.8, s * v + c * v * loop.dir * 0.8,
      0.3 + Math.random() * 0.45, m * 1.4, 0.25, Math.random() < 0.3 ? 2 : 1);
  }
  app.sfx.play('portal');
  app.sfx.tone({ type: 'sine', f0: 220, f1: 660, dur: 0.6, vol: 0.06, attack: 0.05 });
}

function closePortal(p, t, app) {
  if (!S.portals.close(p, t)) return;
  sfx(app, 'whoosh', 0.1, t);
  app.sfx.tone({ type: 'sawtooth', f0: 440, f1: 70, dur: 0.45, vol: 0.05 });
}

// A fist held on a live portal seals it.
function trackFists(frame, app) {
  const t = frame.t, dt = Math.min(frame.dt, 0.1);
  for (const p of S.portals.list) {
    if (p.state !== 'live') continue;
    let near = false;
    for (const h of frame.hands) {
      if (!h.is('fist') || h.overUI) continue;
      if (Math.hypot(h.palm.x - p.x, h.palm.y - p.y) < p.R * 1.2 + h.size * 0.5) { near = true; break; }
    }
    if (near) {
      if (p.hold === 0) app.sfx.play('hover');
      p.hold += dt;
      if (Math.floor(p.hold * 10) !== Math.floor((p.hold - dt) * 10)) {
        app.sfx.tone({ type: 'triangle', f0: 300 + p.hold * 900, f1: 320 + p.hold * 900, dur: 0.06, vol: 0.04 });
      }
      if (p.hold >= CLOSE_HOLD) { closePortal(p, t, app); }
    } else {
      p.hold = Math.max(0, p.hold - dt * 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Time Stone: green afterimages of the hands

function trackGhosts(frame) {
  const t = frame.t;
  if (S.cur.green < 0.02) { while (S.ghosts.length) S.ghostPool.push(S.ghosts.pop()); return; }
  while (S.ghosts.length && t - S.ghosts[0].t > 0.5) S.ghostPool.push(S.ghosts.shift());
  if (t - S.ghostT < 0.065) return;
  S.ghostT = t;
  for (const h of frame.hands) {
    if (h.ghost) continue;
    const g = S.ghostPool.pop() || { lm: Array.from({ length: 21 }, () => ({ x: 0, y: 0 })), t: 0, ghost: false };
    for (let i = 0; i < 21; i++) { g.lm[i].x = h.lm[i].x; g.lm[i].y = h.lm[i].y; }
    g.t = t;
    S.ghosts.push(g);
  }
}

// ---------------------------------------------------------------------------
// Hints that follow what the user is doing

function updateHint(frame, app, mode) {
  const t = frame.t;
  let key = 'default';
  let guide = false;
  for (const tr of S.trails.values()) if (tr.guide) guide = true;
  if (S.portals.list.some((p) => p.state === 'live' && p.hold > 0.02)) key = 'closing';
  else if (guide) key = 'keep';
  else if (frame.hands.some((h) => h.is('point') && !h.overUI)) key = 'draw';
  else if (S.portals.list.some((p) => p.state === 'live')) key = 'close';
  if (key !== S.hint.cand) { S.hint.cand = key; S.hint.since = t; }
  if (key !== S.hint.key && (t - S.hint.since > 0.4 || key === 'closing')) {
    S.hint.key = key;
    app.ui.setHint(key === 'default' ? mode.hint : HINTS[key]);
  }
}

// ---------------------------------------------------------------------------
// Drawing

function drawTrails(ctx, frame, P, m) {
  const t = frame.t, sc = clamp(m / 700, 0.6, 1.3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tr of S.trails.values()) {
    const pts = tr.pts;
    if (pts.length > 1) {
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      let any = false;
      // smooth: quadratic curves between segment midpoints
      for (let i = 1; i < pts.length; i++) {
        const a = t - pts[i].t, p0 = pts[i - 1], p1 = pts[i];
        if (a > TRAIL_SHOW || p1.s !== p0.s) continue;
        const b = Math.min(4, Math.floor((a / TRAIL_SHOW) * 5));
        const p2 = i + 1 < pts.length && pts[i + 1].s === p1.s ? pts[i + 1] : p1;
        paths[b].moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        paths[b].quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        any = true;
      }
      if (any) {
        for (let b = 0; b < 5; b++) {
          const k = 1 - b / 5;
          ctx.globalAlpha = 0.22 * k; ctx.strokeStyle = P.glow; ctx.lineWidth = 14 * sc * (0.4 + 0.6 * k); ctx.stroke(paths[b]);
          ctx.globalAlpha = 0.85 * k; ctx.strokeStyle = P.mid; ctx.lineWidth = 3.6 * sc * (0.4 + 0.6 * k); ctx.stroke(paths[b]);
          ctx.globalAlpha = k; ctx.strokeStyle = P.core; ctx.lineWidth = 1.3 * sc; ctx.stroke(paths[b]);
        }
        // twinkles along the fresh part of the trail
        ctx.globalAlpha = 1;
        for (let j = 0; j < 7; j++) {
          const p = pts[(Math.random() * pts.length) | 0];
          const a = t - p.t;
          if (a > TRAIL_SHOW) continue;
          drawBloom(ctx, p.x + (Math.random() - 0.5) * 10 * sc, p.y + (Math.random() - 0.5) * 10 * sc, (5 + Math.random() * 9) * sc, P.core, (1 - a / TRAIL_SHOW) * 0.8);
        }
      }
    }
    // "finish the circle": a ghost of the portal-to-be
    const g = tr.guide;
    if (g) {
      const k = clamp((g.swept - GUIDE_ANGLE) / (LOOP_ANGLE - GUIDE_ANGLE));
      ctx.setLineDash([2, 9 * sc]);
      ctx.lineDashOffset = -t * 40 * g.dir;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, TAU);
      ctx.globalAlpha = 0.25 + 0.3 * k; ctx.strokeStyle = P.glow; ctx.lineWidth = 6 * sc; ctx.stroke();
      ctx.globalAlpha = 0.55 + 0.45 * k; ctx.strokeStyle = P.core; ctx.lineWidth = 1.6 * sc; ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      drawBloom(ctx, g.cx, g.cy, g.r * 0.5, P.glow, 0.06 + 0.12 * k);
    }
  }
  ctx.restore();
}

function drawHands(ctx, frame, P, m) {
  const sc = clamp(m / 700, 0.6, 1.3);
  ctx.save();
  for (const h of frame.hands) {
    const sh = S.shields.get(h.id);
    const a = sh ? sh.amt : 0;
    drawHand(ctx, h, { color: 'rgba(255,238,210,0.95)', width: 1.2, alpha: 0.5 - 0.25 * a, joints: true });
    if (h.pose === 'point' && !h.ghost && !h.overUI) {
      const p = h.pointer;
      ctx.globalCompositeOperation = 'lighter';
      drawBloom(ctx, p.x, p.y, 30 * sc, P.glow, 0.55);
      drawBloom(ctx, p.x, p.y, 9 * sc, P.core, 0.95);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  // Time Stone afterimages
  if (S.ghosts.length) {
    const t = frame.t, T = PALETTES.time;
    for (const g of S.ghosts) {
      const k = 1 - (t - g.t) / 0.5;
      if (k > 0) drawHand(ctx, g, { color: T.mid, width: 1.5, alpha: k * 0.5 * S.cur.green, joints: false });
    }
  }
  ctx.restore();
}

// Fade whatever sits under the HUD bars so the chips and hint stay legible.
function fadeHud(ctx, W, H, app) {
  const b = app.ui.bands();
  const key = `${W}x${H}:${b.top}:${b.bottom}`;
  if (S.hudKey !== key) {
    const top = ctx.createLinearGradient(0, 0, 0, b.top + 30);
    top.addColorStop(0, 'rgba(0,0,0,0.75)');
    top.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    const y0 = b.bottom - 30;
    const bot = ctx.createLinearGradient(0, y0, 0, H);
    bot.addColorStop(0, 'rgba(0,0,0,0)');
    bot.addColorStop(clamp(30 / Math.max(1, H - y0) * 1.4), 'rgba(0,0,0,0.55)');
    bot.addColorStop(1, 'rgba(0,0,0,0.75)');
    S.hud = { top, bot, y0 };
    S.hudKey = key;
  }
  const { top, bot, y0 } = S.hud;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = top; ctx.fillRect(0, 0, W, b.top + 30);
  ctx.fillStyle = bot; ctx.fillRect(0, y0, W, H - y0);
  ctx.restore();
}

// Shields and portals light up the room (CSS px; the shader scales).
function fillLights() {
  const L = S.lights;
  L.fill(0);
  let k = 0;
  for (const sh of S.shields.values()) {
    if (k >= 4 || sh.amt <= 0.01) continue;
    L[k * 4] = sh.x; L[k * 4 + 1] = sh.y; L[k * 4 + 2] = sh.R * 1.6; L[k * 4 + 3] = 0.4 * sh.amt;
    k++;
  }
  for (const p of S.portals.list) {
    if (k >= 4 || p.k <= 0.01) continue;
    L[k * 4] = p.x; L[k * 4 + 1] = p.y; L[k * 4 + 2] = p.R * 2.0; L[k * 4 + 3] = 0.55 * Math.min(1, p.k);
    k++;
  }
}

// ---------------------------------------------------------------------------
// Sim helpers: a pointing right hand with rot = 0 has its index tip at
// (-0.477, -1.878) hand units from the wrist; a fist's palm at (0.042, -0.744).
const vw = () => (typeof innerWidth === 'number' ? innerWidth : 1280);
const vh = () => (typeof innerHeight === 'number' ? innerHeight : 720);
function pointAt(id, tx, ty, size) {
  const W = vw(), H = vh(), u = size * Math.min(W, H);
  return { id, hand: 'right', pose: 'point', x: (tx + 0.477 * u) / W, y: (ty + 1.878 * u) / H, size, rot: 0 };
}
function fistAt(id, px, py, size) {
  const W = vw(), H = vh(), u = size * Math.min(W, H);
  return { id, hand: 'right', pose: 'fist', x: (px - 0.042 * u) / W, y: (py + 0.744 * u) / H, size, rot: 0 };
}
// Index tip tracing a circle: still at the start, one turn (plus a bit)
// over `dur` seconds, then resting where it ended.
function traceCircle(u, cx, cy, r, dir = 1, a0 = -Math.PI / 2, dur = 1.4) {
  const th = a0 + dir * clamp(u / dur) * TAU * 1.05;
  return [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
}

const ICONS = {
  mystic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/><rect x="6.6" y="6.6" width="10.8" height="10.8"/><rect x="6.6" y="6.6" width="10.8" height="10.8" transform="rotate(45 12 12)"/></svg>',
  mirror: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5z"/><path d="M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25 3.8 16.75"/></svg>',
  time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
};

export default {
  id: 'strange',
  name: 'STRANGE',
  short: 'MAGIC',
  tagline: 'The mystic arts',
  accent: '#ff9a1f',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6"/><rect x="7.8" y="7.8" width="8.4" height="8.4" transform="rotate(45 12 12)"/><rect x="7.8" y="7.8" width="8.4" height="8.4"/></svg>',
  hint: HINT,
  guide: [['✋', 'Open palm: shield'], ['☝️⭕', 'Draw a circle: portal'], ['✊', 'Fist on portal: close']],
  options: [
    { id: 'mystic', label: 'MYSTIC', short: 'MYSTIC', icon: ICONS.mystic },
    { id: 'mirror', label: 'MIRROR DIMENSION', short: 'MIRROR', icon: ICONS.mirror },
    { id: 'time', label: 'TIME STONE', short: 'TIME', icon: ICONS.time },
  ],
  skeleton: false,

  // Segmentation only for the Mirror Dimension (and while it fades out).
  needs() {
    return { segment: this.option === 'mirror' || S.cur.mirror > 0.02 };
  },

  init() {
    S.sparks = new SparkField(1800);
    S.portals = new Portals();
    S.echo = new TimeEcho();
    sigilArt('mystic', PALETTES.mystic);
  },

  enter() {
    const L = LOOKS[this.option] || LOOKS.mystic;
    Object.assign(S.cur, { mirror: 0, echo: L.echo, green: L.green });
    S.segFade = 0;
    S.shields.clear(); S.trails.clear();
    S.portals.reset(); S.sparks.clear(); S.echo.reset();
    S.hint.key = S.hint.cand = 'default';
    if (L.green) sigilArt('time', PALETTES.time);
  },

  exit(app) {
    app.sfx.stopLoop('strange-hum');
    S.shields.clear(); S.trails.clear();
    S.portals.reset(); S.sparks.clear();
  },

  setOption(id, app) {
    if (id === 'time') sigilArt('time', PALETTES.time);
    if (id === 'mirror') app.sfx.play('whoosh');
  },

  update(frame, app) {
    const t = frame.t, dt = Math.min(frame.dt, 0.1);
    const m = Math.min(frame.W, frame.H);
    S.q = frame.W < 600 ? 0.6 : 1;
    S.sparks.cap = S.q < 1 ? 1100 : 1800;

    const L = LOOKS[this.option] || LOOKS.mystic;
    const k = Math.min(1, dt * 3.5);
    S.cur.echo += (L.echo - S.cur.echo) * k;
    S.cur.green += (L.green - S.cur.green) * k;
    // the mirror world unfolds as a steady radial wipe
    S.cur.mirror = L.mirror > S.cur.mirror ? Math.min(L.mirror, S.cur.mirror + dt / 1.4) : Math.max(L.mirror, S.cur.mirror - dt / 0.9);
    S.segFade = clamp(S.segFade + (frame.hasMask ? dt * 2 : -dt * 2));
    if (Math.abs(S.cur.green - S.green) > 0.01) {
      S.green = S.cur.green;
      S.sparkCols = mixSparks(PALETTES.mystic, PALETTES.time, S.green);
      S.rgb = mixRGB(PALETTES.mystic, PALETTES.time, S.green);
    }

    for (const e of frame.events) {
      if (e.type === 'handleave' && e.hand) S.trails.delete(e.hand.id);
    }
    for (const h of frame.hands) {
      trackShield(h, frame, app, m);
      trackTrail(h, frame, app, m);
    }
    for (const id of S.trails.keys()) if (!frame.hands.some((h) => h.id === id)) S.trails.delete(id);
    animateShields(frame, m);
    trackFists(frame, app);
    const ended = S.portals.update(frame, S.sparks, S.q);
    if (ended.length) { app.sfx.play('pop'); app.sfx.play('spark'); }
    S.sparks.update(dt);
    trackGhosts(frame);
    updateHint(frame, app, this);

    // a low mystic hum under shields and portals, crackle from the rims
    let lvl = 0;
    for (const sh of S.shields.values()) lvl = Math.max(lvl, sh.amt);
    const open = S.portals.list.length;
    const hum = clamp(lvl * 0.5 + Math.min(1, open) * 0.5);
    if (hum > 0.01) S.humT = t;
    if (t - (S.humT ?? -9) < 1.5) app.sfx.loop('strange-hum', hum, { type: 'triangle', base: 55, range: 60, vol: 0.1, filter: 380 });
    else app.sfx.stopLoop('strange-hum');
    if (open && t > S.crackleAt) {   // the rims crackle now and then
      sfx(app, 'spark', 0.1, t);
      S.crackleAt = t + 0.25 + Math.random() * 0.45;
    }
  },

  renderGL(gfx, frame) {
    const c = S.cur;
    if (c.echo > 0.01) S.echo.capture(gfx, frame.t);
    fillLights();
    renderWorld(gfx, {
      grade: 1, mirror: c.mirror, maskOK: S.segFade, center: [frame.W * 0.5, frame.H * 0.45],
      echo: c.echo, echoObj: S.echo, lights: S.lights, tint: S.rgb,
    }, frame.t);
    renderPortals(gfx, S.portals.list, frame.W, frame.H, S.rgb);
  },

  draw2D(ctx, frame, app) {
    const m = Math.min(frame.W, frame.H);
    const P = pal(), g = S.cur.green;
    S.portals.draw2D(ctx, frame, P);
    for (const sh of S.shields.values()) {
      if (sh.amt <= 0) continue;
      if (g > 0.05) {
        // TIME: a moving shield leaves fading green afterimages
        const art = sigilArt('time', PALETTES.time);
        for (const e of sh.echoes) {
          const age = frame.t - e.at;
          if (age < 0.32 && Math.hypot(e.x - sh.x, e.y - sh.y) > sh.R * 0.06) drawSigil(ctx, art, e, g * 0.34 * (1 - age / 0.32));
        }
      }
      if (g < 0.995) drawSigil(ctx, sigilArt('mystic', PALETTES.mystic), sh, 1 - g);
      if (g > 0.005) drawSigil(ctx, sigilArt('time', PALETTES.time), sh, g);
    }
    drawTrails(ctx, frame, P, m);
    drawHands(ctx, frame, P, m);
    S.sparks.draw(ctx, S.sparkCols);
    fadeHud(ctx, frame.W, frame.H, app);
  },

  simScenarios: {
    // Two open palms drifting; the right one closes now and then.
    shield: (t) => {
      const P = 7, u = t % P;
      const tall = vh() > vw();
      const closed = u > 4.8 && u < 5.7;
      return [
        { id: 'L', hand: 'left', pose: 'open', x: (tall ? 0.3 : 0.27) + Math.sin(t * 0.6) * 0.04, y: (tall ? 0.5 : 0.72) + Math.cos(t * 0.5) * 0.03, size: 0.17, rot: -0.2 + Math.sin(t * 0.7) * 0.15 },
        { id: 'R', hand: 'right', pose: closed ? 'fist' : 'open', x: (tall ? 0.7 : 0.73) - Math.sin(t * 0.5) * 0.04, y: (tall ? 0.76 : 0.74) + Math.sin(t * 0.6) * 0.03, size: 0.17, rot: 0.2 - Math.sin(t * 0.6) * 0.15 },
      ];
    },
    // Point and trace circles: a portal opens each time (max two, the
    // oldest gives way), alternating spots and directions.
    circle: (t) => {
      const W = vw(), H = vh(), m = Math.min(W, H), tall = H > W;
      const P = 4.2, n = Math.floor(t / P), u = t % P;
      const spot = n % 2;
      const cx = tall ? W * 0.5 : W * (spot ? 0.67 : 0.33), cy = tall ? H * (spot ? 0.62 : 0.37) : H * 0.47;
      const r = m * (tall ? 0.24 : 0.22);
      let [x, y] = traceCircle(u - 0.4, cx, cy, r, spot ? -1 : 1);
      if (u > 2.0) y += m * 0.15 * clamp((u - 2.0) / 1.5);   // drift away after
      return [pointAt('R', x, y, 0.16)];
    },
    // Draw a portal, then hold a fist on it until it collapses; hands leave.
    close: (t) => {
      const W = vw(), H = vh(), m = Math.min(W, H);
      const P = 8.5, u = t % P;
      const cx = W * 0.5, cy = H * 0.46, r = m * 0.22, size = 0.16;
      const [ex, ey] = traceCircle(9, cx, cy, r);
      const away = [ex + m * 0.12, ey + m * 0.28];
      if (u < 2.0) return [pointAt('R', ...traceCircle(u - 0.4, cx, cy, r), size)];
      if (u < 3.0) { const k = clamp((u - 2.0) / 0.8); return [pointAt('R', ex + (away[0] - ex) * k, ey + (away[1] - ey) * k, size)]; }
      if (u < 3.7) { const k = clamp((u - 3.0) / 0.6); return [fistAt('R', away[0] + (cx - away[0]) * k, away[1] + (cy - away[1]) * k, size)]; }
      if (u < 5.6) return [fistAt('R', cx + Math.sin(u * 9) * 3, cy, size)];
      if (u < 6.4) { const k = clamp((u - 5.6) / 0.8); return [fistAt('R', cx + m * 0.3 * k, cy + m * 0.4 * k, size)]; }
      return [];
    },
    // Everything at once for a hero shot: a shield, a portal, a trail.
    hero: (t) => {
      const W = vw(), H = vh(), m = Math.min(W, H), tall = H > W;
      const P = 9, u = t % P;
      const cx = tall ? W * 0.5 : W * 0.64, cy = tall ? H * 0.36 : H * 0.44, r = m * 0.21;
      let [x, y] = traceCircle(u - 0.4, cx, cy, r, -1);
      if (u > 2.0) { x += m * 0.1 * clamp((u - 2.0) / 2); y += m * 0.22 * clamp((u - 2.0) / 2); }
      return [
        { id: 'L', hand: 'left', pose: 'open', x: (tall ? 0.3 : 0.24) + Math.sin(t * 0.5) * 0.03, y: (tall ? 0.8 : 0.74) + Math.cos(t * 0.6) * 0.02, size: tall ? 0.19 : 0.17, rot: -0.25 },
        pointAt('R', x, y, 0.16),
      ];
    },
    // Mirror Dimension (run with &opt=mirror): one shield, hand low.
    mirror: (t) => [
      { id: 'L', hand: 'left', pose: 'open', x: 0.2 + Math.sin(t * 0.5) * 0.03, y: 0.86, size: 0.15, rot: -0.3 },
    ],
    // Time Stone (run with &opt=time): palms sweeping leave green echoes.
    time: (t) => {
      const tall = vh() > vw();
      return [
        { id: 'L', hand: 'left', pose: 'open', x: 0.28 + Math.sin(t * 1.6) * 0.1, y: (tall ? 0.55 : 0.72) + Math.cos(t * 1.1) * 0.05, size: 0.16, rot: -0.2 + Math.sin(t * 1.6) * 0.3 },
        { id: 'R', hand: 'right', pose: 'open', x: 0.72 - Math.sin(t * 1.3) * 0.1, y: (tall ? 0.8 : 0.74) + Math.sin(t * 1.4) * 0.05, size: 0.16, rot: 0.2 - Math.sin(t * 1.3) * 0.3 },
      ];
    },
  },
};
