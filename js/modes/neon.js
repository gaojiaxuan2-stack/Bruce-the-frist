// NEON DRAW — paint with light. Pinch 🤏 and move to draw glowing tubes in
// the air; hold ✌️ to undo the last stroke, hold ✊ to shatter everything.
// Brushes: NEON, RAINBOW, FIRE, STARS (each stroke keeps the brush it was
// drawn with). Open hands sprinkle glitter, pointing ☝️ leaves a comet trail,
// and the strokes light up the darkened room around you.
//
// Strokes: neon-ink.js · GPU tubes + lighting: neon-gl.js · 2D fx: neon-fx.js

import { drawHand, drawGlow, clamp, lerp } from '../draw.js';
import { FINGER_TIPS } from '../gestures.js';
import { Stroke, Ink, PALETTE, PALETTE_RGB, FIRE_COLS, STAR_COLS, RAINBOW_COLS, MAX_PTS, hsv } from './neon-ink.js';
import { NeonGL } from './neon-gl.js';
import { NeonFx, drawCharge, drawNib, drawHold, drawComet, strokeColors } from './neon-fx.js';
import { SCENARIOS } from './neon-sim.js';

const BRUSHES = {
  neon: { label: 'NEON', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19V5l12 14V5"/></svg>' },
  rainbow: { label: 'RAINBOW', short: 'RAINBOW', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 18a9.5 9.5 0 0 1 19 0M6.5 18a5.5 5.5 0 0 1 11 0M10.3 18a1.7 1.7 0 0 1 3.4 0"/></svg>' },
  fire: { label: 'FIRE', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c4.1 0 7-2.8 7-6.9 0-3.5-2.5-5.9-4-8.6-.5 1.9-1.5 3-2.7 3.5.4-3-1.2-5.8-3.6-8 .3 3.2-1.3 5.3-2.8 7.2C4.7 11 5 13.1 5 15.1 5 19.2 7.9 22 12 22zm0-2c-1.7 0-3-1.2-3-2.9 0-1.6 1.2-2.6 2-3.9.6 1.3 2.1 1.9 2.7 3.2.3.5.3.9.3 1.2 0 1.4-.9 2.4-2 2.4z"/></svg>' },
  stars: { label: 'STARS', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 2.5l1.9 5.6L17.5 10l-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9zM18 14l.9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9z"/></svg>' },
};

const SETTLE = 0.1;        // s the nib follows the closing fingers before ink flows
const SOFT_START = 0.08;   // s a tight pinch must hold when the core flag stays off
const CLEAR_HOLD = 0.6;    // s ✊ to clear
const UNDO_HOLD = 0.5;     // s ✌️ to undo, then every UNDO_REPEAT while held
const UNDO_REPEAT = 0.75;
const TRAIL_LIFE = 0.3;    // s the comet tail lasts
const HOLD_COLS = { clear: '#ff4d6d', undo: '#38f9ff' };
const HINTS = {
  start: '<b>Pinch 🤏</b> thumb + index, then move to draw',
  more: '<b>🤏</b> draw · hold <b>✌️</b> undo · hold <b>✊</b> clear',
};
const TAU = Math.PI * 2;

const S = {
  ink: new Ink(), gl: new NeonGL(), fx: null,
  hands: new Map(),         // hand id -> per-hand state
  colorIdx: 0, enterT: 0, t: 0, W: 1, H: 1, sc: 1,
  flash: 0, flashX: 0, flashY: 0,
  hintKey: null, safeTop: 0, safeBot: 99999, hudAt: -9,
  buzzOn: false, lastEndSfx: -9, nextCrackle: 0, nextChime: 0, fireAcc: 0, starAcc: 0,
  items: [],                // reused render list
  light: { L: new Float32Array(32), LC: new Float32Array(24) },
  cells: new Float32Array(6 * 8),
  order: [0, 1, 2, 3, 4, 5],
  tmp: { x: 0, y: 0 },
};

const scOf = (h) => clamp(h.size / 110, 0.65, 1.6);
const brushOf = (mode) => (BRUSHES[mode.option] ? mode.option : 'neon');

// Colour of the next stroke for a brush.
function nextLook(style) {
  const i = S.colorIdx % PALETTE.length;
  if (style === 'fire') return { col: [1, 0.55, 0.12], css: '#ff9a1f', hue: 0 };
  if (style === 'rainbow') {
    const hue = (S.colorIdx * 0.21) % 1;
    return { col: hsv(hue, 0.8, 1), css: RAINBOW_COLS[Math.floor(hue * 12) % 12], hue };
  }
  return { col: PALETTE_RGB[i], css: PALETTE[i], hue: 0 };
}

// UI colour that previews the next stroke (rainbow cycles).
function previewCss(style, t) {
  if (style === 'rainbow') return RAINBOW_COLS[Math.floor(t * 4) % 12];
  return nextLook(style).css;
}

function fingerCols(style, t) {
  if (style === 'fire') return FIRE_COLS;
  if (style === 'stars') return STAR_COLS;
  if (style === 'rainbow') {
    const o = Math.floor(t * 4);
    return [0, 2, 4, 6, 8].map((k) => RAINBOW_COLS[(k + o) % 12]);
  }
  return PALETTE;
}

function handState(h) {
  let st = S.hands.get(h.id);
  if (!st) {
    st = {
      pen: null, penT: 0, px: 0, py: 0, vx: 0, vy: 0, soft: 0, armed: true, charge: 0,
      holdKind: null, holdT: 0, holdN: 0, holdP: 0, holdA: 0, holdCol: HOLD_COLS.clear, holdLabel: '',
      tips: new Float32Array(10), tipAcc: new Float32Array(5), tipsOn: false,
      trail: { buf: new Float32Array(3 * 24), N: 24, head: 0, count: 0 },
      seen: 0, x: 0, y: 0, r: 40,
    };
    S.hands.set(h.id, st);
  }
  return st;
}

// Where the HUD bars are (refreshed once a second).
function hudBounds(t, H) {
  if (t - S.hudAt < 1) return;
  S.hudAt = t;
  try {
    let top = 0;
    for (const sel of ['#modes', '.status']) {
      const el = document.querySelector(sel);
      if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
    }
    let bot = H;
    for (const id of ['hint', 'options']) {
      const el = document.getElementById(id);
      if (!el || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.height) bot = Math.min(bot, r.top);
    }
    S.safeTop = (top || 110) + 6;
    S.safeBot = bot - 6;
  } catch (e) { /* no DOM */ }
}

// --- pen -----------------------------------------------------------------------

function startPen(h, st, mode, app, t) {
  const style = brushOf(mode), look = nextLook(style);
  S.colorIdx++;
  const p = h.pinchPoint, sc = scOf(h);
  const s = new Stroke(style, look.col, look.css, look.hue, sc, t);
  s.add(p.x, p.y, 1);
  S.ink.add(s);
  st.pen = s; st.penT = t; st.px = p.x; st.py = p.y; st.vx = 0; st.vy = 0; st.soft = 0; st.armed = false;
  S.fx.burst(p.x, p.y, strokeColors(s), 10, sc, 150);
  app.sfx.tone({ type: 'triangle', f0: 420, f1: 840, dur: 0.07, vol: 0.06 });
  app.sfx.noise({ dur: 0.05, vol: 0.05, type: 'highpass', f0: 4000 });
}

// A very long line carries on in a fresh stroke (bounded memory per stroke).
function continuePen(st, t) {
  const old = st.pen;
  old.endT = t; old.cont = true;
  const s = new Stroke(old.style, old.col, old.css, old.hue, old.scale, old.born);
  s.add(old.lastX, old.lastY, 1);
  S.ink.add(s);
  st.pen = s;
}

function endPen(st, t, app) {
  const s = st.pen;
  st.pen = null;
  st.armed = false;
  if (!s) return;
  s.trimTail(0.75);
  let L = 0;
  for (let i = 1; i < s.n; i++) L += Math.hypot(s.pts[i * 2] - s.pts[i * 2 - 2], s.pts[i * 2 + 1] - s.pts[i * 2 - 1]);
  // A quick tap is not a dot: drop it.
  if (L < 8 && t - s.born < 0.25) { S.ink.remove(s); return; }
  s.endT = t;
  if (t - S.lastEndSfx > 0.12) {
    S.lastEndSfx = t;
    app.sfx.tone({ type: 'sine', f0: 1100, f1: 700, dur: 0.07, vol: 0.04 });
  }
}

function updatePen(h, st, dt, t, app) {
  const s = st.pen, p = h.pinchPoint;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  // Light smoothing on top of the landmark filter.
  const a = 1 - Math.exp(-dt * 32);
  const nx = st.px + (p.x - st.px) * a, ny = st.py + (p.y - st.py) * a;
  if (dt > 0) { st.vx += ((nx - st.px) / dt - st.vx) * 0.5; st.vy += ((ny - st.py) / dt - st.vy) * 0.5; }
  st.px = nx; st.py = ny;
  if (t - st.penT < SETTLE && s.n === 1) { s.moveFirst(nx, ny); return; }
  s.add(nx, ny, Math.min(1, h.pinch));
  if (s.n >= MAX_PTS) continuePen(st, t);
  // Sparks off the nib, more when moving fast.
  const speed = Math.hypot(st.vx, st.vy), sc = s.scale;
  const n = Math.min(4, Math.floor((speed * dt) / (s.style === 'stars' ? 9 : 14) + Math.random() * 0.35));
  if (n > 0) S.fx.pen(nx, ny, st.vx, st.vy, s.style, strokeColors(s), sc, n);
  if (s.style === 'fire' && t > S.nextCrackle) {
    S.nextCrackle = t + 0.05 + Math.random() * 0.18;
    app.sfx.noise({ dur: 0.03, vol: 0.05, type: 'highpass', f0: 2500 + Math.random() * 3500 });
  }
  if (s.style === 'stars' && t > S.nextChime && speed > 80) {
    S.nextChime = t + 0.2 + Math.random() * 0.12;
    const f = [1568, 1760, 2093, 2349, 2637][(Math.random() * 5) | 0];
    app.sfx.tone({ type: 'sine', f0: f, f1: f * 1.01, dur: 0.3, vol: 0.022 });
  }
}

// Pen down: the core pinch flag, or a tight pinch the core missed (its fist
// guard rejects a strongly curled index) as long as it is not a fist.
const penHeld = (h) => h.pinching || (h.pinch >= 0.5 && h.pose !== 'fist');
const softPinch = (h) => h.pinch >= 0.88 && h.curl.middle < 0.6 && h.pose !== 'fist';

// --- erase -----------------------------------------------------------------------

function clearAll(h, app, t) {
  for (const st of S.hands.values()) if (st.pen) { st.pen.endT = t; st.pen = null; st.armed = false; }
  const live = S.ink.list.filter((s) => !s.dying);
  if (!live.length) return;
  const sc = scOf(h), small = S.W * S.H < 500000;
  S.fx.shatter(live, h.palm.x, h.palm.y, sc, small ? 200 : 300);
  for (const s of live) { s.killDur = 0.45; s.kill = 0; s.shatter = 1; }
  S.fx.wave(h.palm.x, h.palm.y, HOLD_COLS.clear, Math.max(S.W, S.H) * 0.55);
  S.fx.wave(h.palm.x, h.palm.y, '#ffffff', Math.max(S.W, S.H) * 0.3);
  S.flash = 1; S.flashX = h.palm.x; S.flashY = h.palm.y;
  app.sfx.play('whoosh');
  app.sfx.noise({ dur: 0.35, vol: 0.22, type: 'highpass', f0: 5200, f1: 2400, q: 0.8 });
  app.sfx.noise({ dur: 0.16, vol: 0.18, type: 'bandpass', f0: 3200, q: 3, delay: 0.05 });
  app.sfx.tone({ type: 'sine', f0: 140, f1: 45, dur: 0.35, vol: 0.2 });
}

function undo(h, app) {
  const s = S.ink.lastFinished();
  if (!s) return false;
  const sc = scOf(h);
  s.killDur = 0.6; s.kill = 0; s.shatter = 0;
  S.fx.dissolve(s, sc, S.W * S.H < 500000 ? 60 : 90);
  S.fx.wave(h.palm.x, h.palm.y, HOLD_COLS.undo, 90 * sc);
  app.sfx.play('pop');
  app.sfx.tone({ type: 'sine', f0: 660, f1: 220, dur: 0.22, vol: 0.06, delay: 0.04 });
  return true;
}

// --- lights ----------------------------------------------------------------------

const lightCol = (s, sMid, t, out) => {
  if (s.style === 'rainbow') {
    const c = hsv(((s.hue + sMid / 480 - t * 0.28) % 1 + 1) % 1, 0.82, 1);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  } else if (s.style === 'fire') {
    const f = 0.8 + 0.2 * Math.sin(t * 13 + s.seed * 9) * Math.sin(t * 7.3);
    out[0] = f; out[1] = 0.45 * f; out[2] = 0.08 * f;
  } else {
    const k = s.style === 'stars' ? 0.55 : 1;
    out[0] = s.col[0] * k; out[1] = s.col[1] * k; out[2] = s.col[2] * k;
  }
  return out;
};
const LCOL = [0, 0, 0];

// Up to 8 lights: pens and pointing fingers first, then strokes clustered on
// a 3×2 grid (2×3 in portrait). Written in device px.
function computeLights(frame, d) {
  const { L, LC } = S.light;
  L.fill(0); LC.fill(0);
  const t = frame.t;
  let k = 0;
  const put = (x, y, r, I, c) => {
    if (k >= 8) return;
    L[k * 4] = x * d; L[k * 4 + 1] = y * d; L[k * 4 + 2] = r * d; L[k * 4 + 3] = I;
    LC[k * 3] = c[0]; LC[k * 3 + 1] = c[1]; LC[k * 3 + 2] = c[2];
    k++;
  };
  for (const h of frame.hands) {
    const st = S.hands.get(h.id);
    if (!st || k >= 2) continue;
    if (st.pen) {
      const s = st.pen;
      lightCol(s, s.len, t, LCOL);
      put(st.px, st.py, 170 * s.scale, s.style === 'fire' ? 0.7 + 0.25 * Math.random() : 0.75, LCOL);
    } else if (h.is('point') && !h.overUI) {
      const style = brushOf(MODE);
      const c = style === 'fire' ? [1, 0.5, 0.1] : style === 'rainbow' ? hsv((t * 0.33) % 1, 0.8, 1) : nextLook(style).col;
      put(h.pointer.x, h.pointer.y, 140 * scOf(h), 0.4, c);
    }
  }
  const W = S.W, H = S.H, cols = W >= H ? 3 : 2, rows = W >= H ? 2 : 3;
  const C = S.cells;
  C.fill(0);
  for (const s of S.ink.list) {
    if (s.kill >= 1 || !s.nChunks) continue;
    const amp = (1 - s.kill) * (s.endT < 0 ? 1.1 : 1);
    for (let i = 0; i < s.nChunks; i++) {
      const x = s.chunks[i * 4], y = s.chunks[i * 4 + 1], w = s.chunks[i * 4 + 2] * amp;
      lightCol(s, s.chunks[i * 4 + 3], t, LCOL);
      const cx = clamp(Math.floor((x / W) * cols), 0, cols - 1), cy = clamp(Math.floor((y / H) * rows), 0, rows - 1);
      const o = (cy * cols + cx) * 8;
      C[o] += w; C[o + 1] += x * w; C[o + 2] += y * w;
      C[o + 3] += LCOL[0] * w; C[o + 4] += LCOL[1] * w; C[o + 5] += LCOL[2] * w;
      C[o + 6] += x * x * w; C[o + 7] += y * y * w;
    }
  }
  const order = S.order;
  order.sort((a, b) => C[b * 8] - C[a * 8]);
  const m = Math.min(W, H);
  for (const i of order) {
    const o = i * 8, w = C[o];
    if (w < 1 || k >= 8) continue;
    const x = C[o + 1] / w, y = C[o + 2] / w;
    const spread = Math.sqrt(Math.max(0, C[o + 6] / w - x * x + C[o + 7] / w - y * y));
    LCOL[0] = C[o + 3] / w; LCOL[1] = C[o + 4] / w; LCOL[2] = C[o + 5] / w;
    put(x, y, clamp(spread * 0.9 + m * 0.14, m * 0.14, m * 0.5), clamp(w / 800) * 0.6, LCOL);
  }
}

// --- the mode --------------------------------------------------------------------

let MODE = null;

export default {
  id: 'neon',
  name: 'NEON DRAW',
  short: 'DRAW',
  tagline: 'Paint with light',
  accent: '#ff3df2',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-6 5-9 7-7s-1 6 1 7 5-6 7-9 3-2 3-2"/></svg>',
  hint: HINTS.start,
  guide: [['🤏', 'Pinch &amp; move: draw'], ['✌️⏳', 'Hold: undo stroke'], ['✊⏳', 'Hold: clear all'], ['☝️', 'Point: comet cursor'], ['🖐️', 'Open hand: sparkles']],
  options: Object.entries(BRUSHES).map(([id, b]) => ({ id, label: b.label, short: b.short || b.label, icon: b.icon })),
  skeleton: false,

  simScenarios: SCENARIOS,

  init(app) {
    MODE = this;
    S.fx = new NeonFx(app.W * app.H < 500000 ? 600 : 900);
    // ?brush=fire, or a scenario named after a brush (?sim=neon:fire).
    const want = app.params?.get('brush') || (app.params?.get('sim') || '').split(':')[1];
    if (BRUSHES[want]) this.option = want;
  },

  enter(app) {
    MODE = this;
    S.enterT = app.t;
    S.hands.clear();
    S.hintKey = null; S.hudAt = -9; S.flash = 0;
    S.fx.clear();
  },

  exit(app) {
    for (const st of S.hands.values()) if (st.pen) endPen(st, app.t, app);
    S.hands.clear();
    app.sfx.stopLoop('neon-buzz');
    S.buzzOn = false;
    S.fx.clear();
  },

  setOption(id, app) {
    const style = brushOf(this), t = app.t;
    S.fx.showBadge(BRUSHES[style].label, previewCss(style, t), t);
    const cols = style === 'neon' ? PALETTE : style === 'fire' ? FIRE_COLS : style === 'stars' ? STAR_COLS : RAINBOW_COLS;
    for (const h of app.frame?.hands || []) if (!h.ghost) S.fx.burst(h.pointer.x, h.pointer.y, cols, 18, scOf(h), 220);
    if (style === 'fire') app.sfx.noise({ dur: 0.4, vol: 0.14, type: 'lowpass', f0: 600, f1: 2400, attack: 0.05 });
    else if (style === 'stars') [1568, 2093, 2637].forEach((f, i) => app.sfx.tone({ type: 'sine', f0: f, dur: 0.35, vol: 0.03, delay: i * 0.06 }));
    else if (style === 'rainbow') [523, 659, 784, 1047].forEach((f, i) => app.sfx.tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.04, delay: i * 0.05 }));
    else app.sfx.tone({ type: 'sawtooth', f0: 120, f1: 240, dur: 0.12, vol: 0.05 });
  },

  update(frame, app) {
    const { t, W, H } = frame;
    const dt = Math.max(0, Math.min(0.1, frame.dt));
    S.t = t; S.W = W; S.H = H;
    hudBounds(t, H);
    S.ink.resize(W, H);

    let sum = 0, cnt = 0;
    for (const h of frame.hands) if (!h.ghost) { sum += scOf(h); cnt++; }
    if (cnt) S.sc = sum / cnt;

    // Events: core pinches start a stroke unless the HUD used them.
    for (const e of frame.events) {
      const h = e.hand;
      if (e.type === 'pinchstart') {
        const st = handState(h);
        if (e.consumed || h.overUI) { st.armed = false; continue; }
        if (!st.pen && !h.ghost) startPen(h, st, this, app, t);
      } else if (e.type === 'handleave') {
        const st = S.hands.get(h.id);
        if (st?.pen) endPen(st, t, app);
        S.hands.delete(h.id);
      }
    }

    const style = brushOf(this);
    let penSpeed = -1, penStyle = 'neon';
    for (const h of frame.hands) {
      const st = handState(h);
      st.seen = t;
      if (h.overUI) { st.armed = false; st.soft = 0; if (st.pen) endPen(st, t, app); }

      // Draw.
      if (st.pen) {
        if (!h.ghost) {
          if (!penHeld(h)) endPen(st, t, app);
          else updatePen(h, st, dt, t, app);
        }
        if (st.pen) { penSpeed = Math.max(penSpeed, Math.hypot(st.vx, st.vy)); penStyle = st.pen.style; }
      } else if (!h.ghost && !h.overUI) {
        if (!st.armed && !h.pinching && h.pinch < 0.5) st.armed = true;
        const y = h.pinchPoint.y;
        if (st.armed && softPinch(h) && y > S.safeTop && y < S.safeBot) {
          st.soft += dt;
          if (st.soft >= SOFT_START) startPen(h, st, this, app, t);
        } else st.soft = 0;
      }
      const ready = !st.pen && !h.ghost && !h.overUI && h.pose !== 'fist' && h.pose !== 'peace';
      st.charge = ready ? clamp((h.pinch - 0.35) / 0.53) : 0;

      // Hold ✊ to clear, ✌️ to undo.
      if (!h.ghost) {
        const kind = st.pen || h.overUI ? null : h.pose === 'fist' ? 'clear' : h.pose === 'peace' ? 'undo' : null;
        if (kind !== st.holdKind) { st.holdKind = kind; st.holdT = 0; st.holdN = 0; st.holdP = 0; }
        const can = kind === 'clear' ? S.ink.count > 0 : kind === 'undo' ? !!S.ink.lastFinished() : false;
        let show = false;
        if (kind && (can || st.holdN) && !(kind === 'clear' && st.holdN)) {
          if (can) {
            show = true;
            st.holdT += dt;
            const need = kind === 'clear' ? CLEAR_HOLD : st.holdN ? UNDO_REPEAT : UNDO_HOLD;
            st.holdP = clamp(st.holdT / need);
            if (st.holdT >= need) {
              st.holdT = 0; st.holdN++;
              if (kind === 'clear') clearAll(h, app, t); else undo(h, app);
            }
          }
        }
        if (kind) {
          st.holdCol = HOLD_COLS[kind]; st.holdLabel = kind === 'clear' ? 'CLEAR' : 'UNDO';
          if (kind === 'clear' && st.holdN) st.holdP = 1;
        }
        st.holdA = clamp(st.holdA + (show ? dt * 7 : -dt * 4));
        st.x = h.palm.x; st.y = h.palm.y; st.r = clamp(h.size * 0.85, 34, 120);
      } else st.holdA = clamp(st.holdA - dt * 4);

      // Glitter from the fingertips of an open hand.
      if (h.is('open') && !h.overUI && !st.pen) {
        const cols = fingerCols(style, t), sc = scOf(h), spacing = 15 * sc;
        for (let i = 0; i < 5; i++) {
          const p = h.lm[FINGER_TIPS[i]];
          if (st.tipsOn) {
            const ox = st.tips[i * 2], oy = st.tips[i * 2 + 1];
            const dd = Math.hypot(p.x - ox, p.y - oy);
            if (dt > 0 && dd / dt > 70) {
              st.tipAcc[i] += dd / spacing;
              let n = 0;
              while (st.tipAcc[i] >= 1 && n < 3) {
                st.tipAcc[i] -= 1; n++;
                const f = Math.random();
                S.fx.tip(lerp(ox, p.x, f), lerp(oy, p.y, f), (p.x - ox) / dt, (p.y - oy) / dt, cols[i % cols.length], sc);
              }
              st.tipAcc[i] = Math.min(st.tipAcc[i], 1);
            }
          }
          st.tips[i * 2] = p.x; st.tips[i * 2 + 1] = p.y;
        }
        st.tipsOn = true;
      } else st.tipsOn = false;

      // Comet behind a pointing finger.
      if (h.is('point')) {
        const tr = st.trail, p = h.pointer, hd = tr.head * 3;
        if (!tr.count || Math.hypot(p.x - tr.buf[hd], p.y - tr.buf[hd + 1]) > 1.5) {
          tr.head = (tr.head + 1) % tr.N;
          tr.buf[tr.head * 3] = p.x; tr.buf[tr.head * 3 + 1] = p.y; tr.buf[tr.head * 3 + 2] = t;
          tr.count = Math.min(tr.N, tr.count + 1);
        } else tr.buf[hd + 2] = t;
      }
    }

    // Forget hands that vanished without an event.
    for (const [id, st] of S.hands) {
      if (t - st.seen > 0.5) { if (st.pen) endPen(st, t, app); S.hands.delete(id); }
    }

    // Finished strokes keep living: flames, glints.
    let fireLen = 0, starLen = 0;
    for (const s of S.ink.list) {
      if (s.dying) continue;
      if (s.style === 'fire') fireLen += s.len;
      else if (s.style === 'stars') starLen += s.len;
    }
    if (fireLen > 0) {
      S.fireAcc = Math.min(4, S.fireAcc + dt * Math.min(120, fireLen / 9));
      while (S.fireAcc >= 1) { S.fireAcc -= 1; const s = pickByLen('fire', fireLen); if (s) { s.sample(S.tmp); S.fx.ember(S.tmp.x, S.tmp.y, s.scale); } }
    }
    if (starLen > 0) {
      S.starAcc = Math.min(3, S.starAcc + dt * Math.min(24, starLen / 45));
      while (S.starAcc >= 1) { S.starAcc -= 1; const s = pickByLen('stars', starLen); if (s) { s.sample(S.tmp); S.fx.glint(S.tmp.x, S.tmp.y, s.scale); } }
    }

    S.ink.update(dt);
    S.fx.update(dt);
    S.flash = Math.max(0, S.flash - dt * 2.2);

    // The electric hum of a live tube while any pen is down.
    if (penSpeed >= 0) {
      const lvl = 0.3 + Math.min(0.7, penSpeed / 1500);
      app.sfx.loop('neon-buzz', lvl, { type: 'sawtooth', base: penStyle === 'rainbow' ? 90 : 60, range: 70, vol: 0.05, filter: 360 });
      S.buzzOn = true;
    } else if (S.buzzOn) { app.sfx.stopLoop('neon-buzz'); S.buzzOn = false; }

    const key = S.ink.count ? 'more' : 'start';
    if (key !== S.hintKey) { S.hintKey = key; app.ui.setHint(HINTS[key]); }
  },

  renderGL(gfx, frame) {
    const t = frame.t, items = S.items;
    let n = 0;
    for (const s of S.ink.list) {
      if (s.kill >= 1) continue;
      let amp = 1;
      if (s.endT >= 0 && !s.cont) {
        const age = t - s.endT;
        // A gentle breathing pulse, and the flicker of a tube striking on.
        if (s.style === 'neon' || s.style === 'rainbow') amp = 0.9 + 0.1 * Math.sin(t * 2.1 + s.seed * TAU);
        if (age < 0.45) amp *= ((age * 37 + s.seed * 7) % 1) < 0.3 ? 0.45 : 1.08;
      }
      const it = items[n] || (items[n] = { stroke: null, amp: 1, live: 0 });
      it.stroke = s; it.amp = amp; it.live = s.endT < 0 ? 1 : clamp(1 - (t - s.endT) / 0.4);
      n++;
    }
    items.length = n;
    computeLights(frame, gfx.dpr);
    const mood = { dark: clamp((t - S.enterT) / 0.7), flash: S.flash, fx: S.flashX, fy: S.flashY };
    S.gl.render(gfx, items, S.light, mood);
  },

  draw2D(ctx, frame) {
    const t = frame.t, style = brushOf(this);
    const prev = previewCss(style, t);
    // Thin cool skeletons (the reference look), dimmer while drawing.
    for (const h of frame.hands) {
      const st = S.hands.get(h.id);
      drawHand(ctx, h, { color: 'rgba(225,238,255,0.6)', width: 1.2, joints: true, alpha: st?.pen ? 0.45 : 0.85 });
    }
    // Fingertip lights on open hands.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fc = fingerCols(style, t);
    for (const h of frame.hands) {
      if (!h.is('open') || h.overUI) continue;
      const sc = scOf(h);
      for (let i = 0; i < 5; i++) {
        const p = h.lm[FINGER_TIPS[i]];
        drawGlow(ctx, p.x, p.y, (9 + 2 * Math.sin(t * 5 + i)) * sc, fc[i % fc.length], 0.55);
      }
    }
    ctx.restore();
    // Comet cursors.
    for (const h of frame.hands) {
      const st = S.hands.get(h.id);
      if (!st || !st.trail.count) continue;
      drawComet(ctx, st.trail, prev, scOf(h), t, TRAIL_LIFE, h.is('point') && !h.overUI);
    }
    S.fx.drawParticles(ctx);
    // Nibs and pinch charge rings.
    for (const h of frame.hands) {
      const st = S.hands.get(h.id);
      if (!st) continue;
      if (st.pen) {
        const s = st.pen;
        drawNib(ctx, st.px, st.py, s.style === 'rainbow' ? prev : s.css, s.scale, t, s.style);
      } else if (st.charge > 0) drawCharge(ctx, h.pinchPoint.x, h.pinchPoint.y, st.charge, prev, scOf(h), t);
    }
    for (const st of S.hands.values()) drawHold(ctx, st.x, st.y, st.r, st.holdP, st.holdA, st.holdCol, st.holdLabel, t);
    S.fx.drawWaves(ctx, t);
    const spots = [];
    for (const h of frame.hands) if (!h.ghost) spots.push(h.pointer);
    S.fx.drawBadge(ctx, t, spots, S.sc);
  },
};

// Random finished stroke of a style, weighted by length.
function pickByLen(style, total) {
  let r = Math.random() * total;
  for (const s of S.ink.list) {
    if (s.dying || s.style !== style) continue;
    r -= s.len;
    if (r <= 0) return s;
  }
  return null;
}
