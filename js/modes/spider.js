// SPIDER-MAN — web-shooters with sticky tethers, a face-tracked mask,
// spider-sense, and a Spider-Verse comic world with a NYC skyline backdrop.
//
// Webs: spider-webs.js · mask: spider-mask.js · tingle: spider-sense.js ·
// comic grade + skyline shader: spider-gl.js

import { drawHand, drawGlow, clamp } from '../draw.js';
import { WebSystem } from './spider-webs.js';
import { SpiderMask } from './spider-mask.js';
import { SpiderSense } from './spider-sense.js';
import { renderComic } from './spider-gl.js';

// What each option turns on; the live values ease toward these.
const LOOKS = {
  city: { mask: 1, miles: 0, grade: 1, bg: 1, glitch: 0 },
  miles: { mask: 1, miles: 1, grade: 1, bg: 1, glitch: 1 },
  comic: { mask: 1, miles: 0, grade: 1, bg: 0, glitch: 0 },
  webs: { mask: 0, miles: 0, grade: 0, bg: 0, glitch: 0 },
};
const HOLD_GRACE = 0.22;   // s a tether survives a flickering pose
const REFIRE = 0.22;       // s between shots from one hand
const CLEAR_HOLD = 0.5;    // s both fists must be held

const S = {
  webs: null, mask: null, sense: null,
  cur: { mask: 0, miles: 0, grade: 0, bg: 0, glitch: 0 },
  segFade: 0,              // person mask availability, eased
  head: { x: 0, y: 0 },    // parallax offset
  lastFace: null, lastFaceT: -99,
  hands: new Map(),        // id -> { lastSpider, lastFire }
  hold: new Map(),         // id -> wrist, hands still making the sign
  lastLeave: -99,          // when a hand was last lost (flicker filter)
  clearHold: 0, clearLatch: false, clearFlash: -99,
};

// The tracked face, unless it is stale (the core keeps the last one around
// when face tracking is switched off).
function faceOf(frame) {
  const f = frame.face;
  return f && f.lm && !(frame.now - f.seen > 1500) ? f : null;
}

// Where the head is (CSS px). Falls back to the usual selfie framing.
function headOf(frame) {
  const f = faceOf(frame) || (frame.t - S.lastFaceT < 2 ? S.lastFace : null);
  if (f && f.width > 10) return { x: f.center.x, y: f.center.y, r: Math.max(f.width, f.height) * 0.58 };
  const m = Math.min(frame.W, frame.H);
  return { x: frame.W / 2, y: frame.H * 0.4, r: m * 0.17 };
}

function countFists(frame) {
  let n = 0;
  for (const h of frame.hands) if (h.is('fist')) n++;
  return n;
}

// 0..1: how close a hand is to the web-shooter sign (index + pinky out).
function spiderness(h) {
  const c = h.curl;
  return (1 - c.index) * (1 - c.pinky) * clamp(c.middle * 1.25) * clamp(c.ring * 1.25);
}

function aimOf(h) {
  const lm = h.lm, w = lm[0];
  let x = (lm[8].x + lm[20].x) / 2 - w.x, y = (lm[8].y + lm[20].y) / 2 - w.y;
  const l = Math.hypot(x, y) || 1;
  x = (x / l) * 0.75 + h.dir.x * 0.25; y = (y / l) * 0.75 + h.dir.y * 0.25;
  const l2 = Math.hypot(x, y) || 1;
  return { x: x / l2, y: y / l2 };
}

const ICONS = {
  city: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21v-9h3V8h3v4h2V3h4v6h2V6h3v5h3v10z"/></svg>',
  miles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13.5 2 5 13.5h6L9.5 22 19 10h-6z"/></svg>',
  comic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 4h18v12H11l-5 4v-4H3z"/><path d="M12 7v4.5M12 13.6v.1"/></svg>',
  webs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12V2M12 12l8.7-5M12 12l8.7 5M12 12v10M12 12l-8.7 5M12 12 3.3 7"/><path d="m12 6.6 4.7 2.7v5.4L12 17.4l-4.7-2.7V9.3z"/></svg>',
};

export default {
  id: 'spider',
  name: 'SPIDER-MAN',
  short: 'SPIDEY',
  tagline: 'Thwip thwip!',
  accent: '#ff2a3d',
  icon: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="13" rx="3" ry="4.2"/><circle cx="12" cy="7.6" r="2.1"/><path d="M9.6 11.5 4 8.5 2.5 3.5M14.4 11.5 20 8.5l1.5-5M9.3 13.5H3.5L1.5 17M14.7 13.5h5.8l2 3.5M9.8 15.8 5.5 19l-1 3.5M14.2 15.8l4.3 3.2 1 3.5M10.2 9.5 7 6.5 6.5 2M13.8 9.5 17 6.5l.5-4.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hint: '<b>🤟</b> THWIP · hold it to swing · <b>✊✊</b> clear',
  guide: [['🤟', 'Shoot a web'], ['🤟⏳', 'Hold = tether'], ['👋💨', 'Spider-sense'], ['✊✊', 'Clear webs']],
  options: [
    { id: 'city', label: 'CITY', short: 'CITY', icon: ICONS.city },
    { id: 'miles', label: 'MILES', short: 'MILES', icon: ICONS.miles },
    { id: 'comic', label: 'COMIC', short: 'COMIC', icon: ICONS.comic },
    { id: 'webs', label: 'WEBS ONLY', short: 'WEBS', icon: ICONS.webs },
  ],
  skeleton: false,

  // Face only while a mask is drawn, segmentation only while the skyline
  // shows (including their fade-outs, so nothing pops).
  needs() {
    const L = LOOKS[this.option] || LOOKS.city;
    return { face: L.mask > 0 || S.cur.mask > 0.02, segment: L.bg > 0 || S.cur.bg > 0.02 };
  },

  init() {
    S.webs = new WebSystem();
    S.mask = new SpiderMask();
    S.sense = new SpiderSense();
  },

  enter() {
    Object.assign(S.cur, { mask: 0, miles: 0, grade: 0, bg: 0, glitch: 0 });
    S.cur.miles = (LOOKS[this.option] || LOOKS.city).miles;
    S.segFade = 0;
    S.hands.clear();
    S.clearHold = 0; S.clearLatch = false; S.lastLeave = -99;
    S.webs.reset(); S.mask.reset(); S.sense.reset();
  },

  exit() {
    S.webs.reset();
    S.sense.reset();
    S.hands.clear();
  },

  update(frame, app) {
    const t = frame.t, dt = Math.min(frame.dt, 0.1);
    const L = LOOKS[this.option] || LOOKS.city;
    const k = Math.min(1, dt * 4);
    for (const key in S.cur) S.cur[key] += (L[key] - S.cur[key]) * k;
    S.segFade = clamp(S.segFade + (frame.hasMask ? dt * 2 : -dt * 4));

    const f = faceOf(frame);
    if (f) { S.lastFace = f; S.lastFaceT = t; }
    const hx = f ? clamp((f.center.x / frame.W - 0.5) * 2, -1, 1) : 0;
    const hy = f ? clamp((f.center.y / frame.H - 0.45) * 2, -1, 1) : 0;
    S.head.x += (hx - S.head.x) * Math.min(1, dt * 3);
    S.head.y += (hy - S.head.y) * Math.min(1, dt * 3);
    S.mask.update(f, dt);

    for (const h of frame.hands) if (!S.hands.has(h.id)) S.hands.set(h.id, { lastSpider: -99, lastFire: -99 });
    const head = headOf(frame);

    for (const e of frame.events) {
      const h = e.hand;
      if (e.type === 'pose' && e.pose === 'spider') {
        if (!h || h.ghost || h.overUI) continue;
        const st = S.hands.get(h.id);
        if (!st) continue;
        // a flicker while tethered keeps the same web
        if (S.webs.attachedTo(h.id) && t - st.lastSpider <= HOLD_GRACE) continue;
        if (t - st.lastFire < REFIRE) continue;
        st.lastFire = t;
        S.webs.fire(h, t, frame, app);
      } else if (e.type === 'handenter') {
        // a hand arriving (not the tracker re-finding one it just lost)
        if (t - S.lastLeave > 0.6) S.sense.trigger(t, app);
      } else if (e.type === 'handleave' && h) {
        S.hands.delete(h.id);
        S.lastLeave = t;
      }
    }

    // Who is still holding the sign (with a little grace for flicker).
    const hold = S.hold, minSide = Math.min(frame.W, frame.H);
    hold.clear();
    for (const h of frame.hands) {
      const st = S.hands.get(h.id);
      if (h.pose === 'spider') st.lastSpider = t;
      if (t - st.lastSpider <= HOLD_GRACE) hold.set(h.id, h.lm[0]);
      // spider-sense: a fast hand near the head (speed relative to the short
      // side, so a portrait phone needs the same real motion as a laptop)
      if (!h.ghost && h.speed > minSide * 1.6 && Math.hypot(h.palm.x - head.x, h.palm.y - head.y) < head.r * 3.2) S.sense.trigger(t, app);
    }
    S.webs.update(frame, hold, app);

    // Both fists held = clear every web.
    const fists = countFists(frame);
    if (fists >= 2 && !S.clearLatch && S.webs.count() > 0) {
      S.clearHold += dt;
      if (S.clearHold >= CLEAR_HOLD) {
        S.webs.clearAll(t);
        S.clearLatch = true; S.clearHold = 0; S.clearFlash = t;
        app.sfx.play('whoosh');
      }
    } else if (fists < 2) {
      S.clearHold = Math.max(0, S.clearHold - dt * 3);
      S.clearLatch = false;
    }
  },

  renderGL(gfx, frame) {
    const c = S.cur;
    const bg = c.bg * S.segFade;
    if (c.grade < 0.004 && bg < 0.004) { gfx.drawVideo(); return; }
    renderComic(gfx, { grade: c.grade, bg, pal: c.miles, glitch: c.glitch, head: S.head });
  },

  draw2D(ctx, frame) {
    const c = S.cur;
    S.mask.draw(ctx, frame, { amt: c.mask, miles: c.miles, comic: c.grade });
    S.sense.draw(ctx, frame, headOf(frame));
    S.webs.draw(ctx, frame);
    drawHands(ctx, frame);
    S.webs.drawTexts(ctx, frame);
  },

  simScenarios: {
    // Right hand: open → 🤟 aimed somewhere new → hold (tether) → open …
    thwip: (t) => {
      const P = 3.2, n = Math.floor(t / P), u = t % P;
      const aims = [0.55, -0.5, 0.95, -0.15, 0.3, -0.85];
      const a0 = aims[(n + aims.length - 1) % aims.length], a1 = aims[n % aims.length];
      const rot = a0 + (a1 - a0) * clamp(u / 0.45);
      const pose = u > 0.55 && u < 2.4 ? 'spider' : 'open';
      return [{ id: 'R', hand: 'right', pose, x: 0.64 + Math.sin(t * 0.9) * 0.04, y: 0.8 + Math.sin(t * 1.3) * 0.02, size: 0.17, rot }];
    },
    // Both hands taking turns.
    dual: (t) => {
      const P = 1.5, n = Math.floor(t / P), u = t % P;
      const fireL = n % 2 === 0, on = u > 0.25 && u < 1.15;
      const aimsL = [-0.55, -0.2, -0.9, -0.4], aimsR = [0.5, 0.2, 0.85, 0.35];
      return [
        { id: 'L', hand: 'left', pose: fireL && on ? 'spider' : 'open', x: 0.3, y: 0.8, size: 0.16, rot: aimsL[Math.floor(n / 2) % 4] },
        { id: 'R', hand: 'right', pose: !fireL && on ? 'spider' : 'open', x: 0.7, y: 0.8, size: 0.16, rot: aimsR[Math.floor(n / 2) % 4] },
      ];
    },
    // Hold the sign and swing the hand around: slack sags, taut twangs.
    tether: (t) => {
      const P = 8, u = t % P;
      const pose = u > 0.4 && u < 6.4 ? 'spider' : 'open';
      const a = u * 1.1;
      return [{ id: 'R', hand: 'right', pose, x: 0.56 + Math.sin(a) * 0.2, y: 0.72 + Math.sin(a * 1.7) * 0.08, size: 0.17, rot: 0.45 + Math.sin(a * 0.8) * 0.15 }];
    },
    // Shoot a few, then both fists to clear.
    clear: (t) => {
      const P = 7.5, u = t % P;
      if (u > 4.4 && u < 6.0) {
        return [
          { id: 'L', hand: 'left', pose: 'fist', x: 0.36, y: 0.78, size: 0.16, rot: -0.1 },
          { id: 'R', hand: 'right', pose: 'fist', x: 0.64, y: 0.78, size: 0.16, rot: 0.1 },
        ];
      }
      const n = Math.floor(u / 0.55), v = u % 0.55;
      const on = u < 4.4 && v > 0.12 && v < 0.42;
      const left = n % 2 === 0;
      return [
        { id: 'L', hand: 'left', pose: on && left ? 'spider' : 'open', x: 0.32, y: 0.8, size: 0.16, rot: [-0.3, -0.7, -0.1, -0.95][(n >> 1) % 4] },
        { id: 'R', hand: 'right', pose: on && !left ? 'spider' : 'open', x: 0.68, y: 0.8, size: 0.16, rot: [0.3, 0.75, 0.05, 1.0][(n >> 1) % 4] },
      ];
    },
    // A fast swipe past the head, back and forth.
    sense: (t) => {
      const P = 1.6, n = Math.floor(t / P), u = t % P;
      let s = clamp((u - 0.5) / 0.3);
      if (n % 2) s = 1 - s;
      return [{ id: 'R', hand: 'right', pose: 'open', x: 0.84 - s * 0.6, y: 0.66 - Math.sin(s * Math.PI) * 0.14, size: 0.16, rot: -0.3 + s * 0.5 }];
    },
    // Still pose for screenshots: one tether held, the other hand relaxed.
    pose: (t) => [
      { id: 'R', hand: 'right', pose: t % 9 < 0.5 ? 'open' : 'spider', x: 0.74, y: 0.84, size: 0.17, rot: -0.55 },
      { id: 'L', hand: 'left', pose: 'relaxed', x: 0.2, y: 0.9, size: 0.15, rot: 0.2 },
    ],
  },
};

// Subtle skeletons, a red glow on web-shooting hands, an aim hint when a
// hand is nearly in the sign, and charge rings for the two-fist clear.
function drawHands(ctx, frame) {
  const t = frame.t;
  const charging = countFists(frame) >= 2 && S.clearHold > 0 && !S.clearLatch;
  ctx.save();
  ctx.lineCap = 'round';
  for (const h of frame.hands) {
    const s = clamp(h.size, 20, 400);
    drawHand(ctx, h, { color: 'rgba(255,255,255,0.8)', width: 1.1, alpha: 0.3, joints: false });
    const lm = h.lm;
    ctx.globalCompositeOperation = 'lighter';
    if (h.pose === 'spider') {
      const pulse = 0.8 + Math.sin(t * 12) * 0.2;
      drawGlow(ctx, lm[0].x, lm[0].y, s * 0.55, '#ff2a3d', 0.55 * pulse * (h.ghost ? 0.4 : 1));
      drawGlow(ctx, lm[0].x, lm[0].y, s * 0.14, '#ffffff', 0.7);
      drawGlow(ctx, lm[8].x, lm[8].y, s * 0.22, '#ff2a3d', 0.45);
      drawGlow(ctx, lm[20].x, lm[20].y, s * 0.22, '#ff2a3d', 0.45);
    } else if (!h.ghost && !h.overUI && h.pose !== 'fist') {
      const sp = spiderness(h);
      if (sp > 0.3) {
        // nearly there: a dotted aim line from the wrist
        const a = aimOf(h), k = clamp((sp - 0.3) / 0.5);
        drawGlow(ctx, lm[0].x, lm[0].y, s * 0.4, '#ff2a3d', 0.35 * k);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.55 * k;
        ctx.strokeStyle = '#ff5566';
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 9]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.moveTo(lm[0].x + a.x * s * 1.6, lm[0].y + a.y * s * 1.6);
        ctx.lineTo(lm[0].x + a.x * s * 3.6, lm[0].y + a.y * s * 3.6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (charging && h.is('fist')) {
      const p = clamp(S.clearHold / CLEAR_HOLD);
      const r = s * 0.85;
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.palm.x, h.palm.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, h.palm.x, h.palm.y, r * 1.4, '#ff2a3d', 0.35 * p);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#ff2a3d';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(h.palm.x, h.palm.y, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
    }
  }
  // flash where the fists were when the webs let go
  const fa = t - S.clearFlash;
  if (fa < 0.4) {
    ctx.globalCompositeOperation = 'lighter';
    for (const h of frame.hands) drawGlow(ctx, h.palm.x, h.palm.y, clamp(h.size, 20, 400) * (1 + fa * 4), '#ffffff', 0.5 * (1 - fa / 0.4));
  }
  ctx.restore();
}
