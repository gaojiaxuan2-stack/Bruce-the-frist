// IRON MAN — the view from inside the helmet: a holographic HUD, target
// lock on every hand, palm repulsors you charge with an open hand and fire
// by pushing it at the camera, and a two-palm unibeam.
//
// HUD: ironman-hud.js · repulsors + target lock: ironman-repulsor.js ·
// cinematic grade + visor + blast light: ironman-gl.js · helpers: ironman-fx.js

import { HAND_CONNECTIONS } from '../gestures.js';
import { HelmetHud } from './ironman-hud.js';
import { Repulsors } from './ironman-repulsor.js';
import { renderSuit } from './ironman-gl.js';
import { clamp, lerp } from './ironman-fx.js';

const S = {
  hud: null,
  rep: null,
  on: 0,                 // mode fade-in (grade + visor), so nothing pops
  lastReadyMsg: -99,
  gl: { lo: [1, 1, 1], hi: [1, 1, 1], sat: 1, expo: 1, hud: [0, 0, 0], beam: [0, 0, 0] },
};

const ICONS = {
  mk85: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2.5c-4.2 0-7 2.6-7 6.6v4.6l2.4 5.6L12 21.5l4.6-2.2 2.4-5.6V9.1c0-4-2.8-6.6-7-6.6Z"/><path d="m6.8 10.6 4 1.2M17.2 10.6l-4 1.2M9.5 16.5h5"/></svg>',
  warmachine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></svg>',
  stealth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/><path d="M4 20 20 4"/></svg>',
};

function copyGL(dst, P, k) {
  const g = P.gl;
  for (let i = 0; i < 3; i++) {
    dst.lo[i] = lerp(dst.lo[i], g.lo[i], k);
    dst.hi[i] = lerp(dst.hi[i], g.hi[i], k);
    dst.hud[i] = lerp(dst.hud[i], g.hud[i], k);
    dst.beam[i] = lerp(dst.beam[i], g.beam[i], k);
  }
  dst.sat = lerp(dst.sat, g.sat, k);
  dst.expo = lerp(dst.expo, g.expo, k);
}

// Holographic gauntlet: thin skeleton lines with square joint nodes.
function drawSkeletons(g, frame, P) {
  g.lineCap = 'round';
  g.lineWidth = 1;
  for (const h of frame.hands) {
    const lm = h.lm;
    g.globalAlpha = h.ghost ? 0.25 : 0.65;
    g.strokeStyle = P.line;
    g.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) { g.moveTo(lm[a].x, lm[a].y); g.lineTo(lm[b].x, lm[b].y); }
    g.stroke();
    g.globalAlpha = h.ghost ? 0.3 : 0.9;
    g.fillStyle = P.line;
    for (let i = 0; i < 21; i++) {
      const r = i % 4 === 0 && i ? 2 : 1.4;
      g.fillRect(lm[i].x - r, lm[i].y - r, r * 2, r * 2);
    }
  }
  g.globalAlpha = 1;
}

export default {
  id: 'ironman',
  name: 'IRON MAN',
  short: 'IRON',
  tagline: 'Repulsors online',
  accent: '#ffcf3a',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 4.5 18.5 16H5.5Z" stroke-linejoin="round"/></svg>',
  hint: 'Open palm <b>✋</b> to charge · <b>push</b> it at the camera to fire · <b>🙌</b> unibeam',
  guide: [['✋', 'Open palm: charge'], ['✋💥', 'Push or hold: fire'], ['✊', 'Fist: cancel'], ['🙌', 'Palms together: unibeam']],
  options: [
    { id: 'mk85', label: 'MARK 85', short: 'MK85', icon: ICONS.mk85 },
    { id: 'warmachine', label: 'WAR MACHINE', short: 'WAR', icon: ICONS.warmachine },
    { id: 'stealth', label: 'STEALTH', short: 'STEALTH', icon: ICONS.stealth },
  ],
  skeleton: false,

  init() {
    S.hud = new HelmetHud();
    S.rep = new Repulsors();
    try { document.fonts?.load?.('900 24px Orbitron'); document.fonts?.load?.('600 12px Rajdhani'); } catch (e) { /* fonts API missing */ }
  },

  enter(app) {
    S.hud.reset(this.option);
    S.rep.reset(app);
    S.rep.pal = S.hud.pal;
    S.rep.onEvent = (type, T) => this.onRepulsor(type, T, app);
    S.on = 0;
    copyGL(S.gl, S.hud.pal, 1);
  },

  exit(app) {
    S.rep.reset(app);
    S.rep.onEvent = null;
  },

  setOption(id, app) {
    S.hud.setPalette(id);
    // power down, then the new suit boots up
    app.sfx.tone({ type: 'sawtooth', f0: 600, f1: 90, dur: 0.22, vol: 0.05 });
    app.sfx.tone({ type: 'sine', f0: 300, f1: 1400, dur: 0.35, vol: 0.06, delay: 0.25 });
  },

  // HUD reactions to what the repulsors do.
  onRepulsor(type, T, app) {
    const hud = S.hud, P = hud.pal, t = app.frame ? app.frame.t : 0;
    if (type === 'fire') { hud.say('REPULSOR DISCHARGE', P.alert, t, 1.1); hud.dip = Math.min(1, hud.dip + 0.35); }
    else if (type === 'fizzle') hud.say('CHARGE ABORTED', P.main, t, 1.0);
    else if (type === 'uniStart') hud.say('UNIBEAM ALIGNED · HOLD STEADY', P.accent, t, 1.2);
    else if (type === 'unibeam') { hud.say('UNIBEAM DISCHARGE', P.alert, t, 1.8); hud.dip = 1; }
    else if (type === 'ready' && t - S.lastReadyMsg > 5 && !S.rep.uni.on) {
      S.lastReadyMsg = t;
      hud.say('REPULSOR READY · PUSH TO FIRE', P.accent, t, 1.4);
    }
  },

  update(frame, app) {
    const dt = Math.min(frame.dt, 0.1);
    S.hud.update(dt, frame.t, app);
    S.rep.pal = S.hud.pal;
    S.rep.update(frame, app);
    S.on = Math.min(1, S.on + dt * 1.5);
    copyGL(S.gl, S.hud.pal, Math.min(1, dt * 3));
  },

  renderGL(gfx, frame) {
    const st = S.rep.glState(frame);
    const on = S.on * S.on * (3 - 2 * S.on);
    const G = S.gl;
    renderSuit(gfx, {
      grade: on, lo: G.lo, hi: G.hi, sat: lerp(1, G.sat, on), expo: lerp(1, G.expo, on),
      visor: on, hud: G.hud, beam: G.beam,
      flash: st.flash, shake: S.rep.shake, blast: st.blast, lights: st.lights,
    });
  },

  draw2D(ctx, frame, app) {
    const P = S.hud.pal;
    const g = S.hud.begin(frame, app);
    S.hud.draw(g, frame, S.rep.info(frame));
    drawSkeletons(g, frame, P);
    S.rep.drawReticles(g, frame, P);
    S.hud.composite(ctx, frame, S.rep.shake);
    S.rep.drawEnergy(ctx, frame, P);
  },

  simScenarios: {
    // Right palm held up, still: charges, then fires by holding (every ~1.9 s).
    charge: (t) => [
      { id: 'R', hand: 'right', pose: 'open', x: 0.66 + Math.sin(t * 0.7) * 0.015, y: 0.8 + Math.sin(t * 1.1) * 0.01, size: 0.17, rot: -0.12 },
    ],
    // Charge, then a quick push toward the camera (the palm grows) fires.
    push: (t) => {
      const u = t < 1 ? 1.8 : (t - 1) % 2;   // starts with a fist while the page loads
      let size = 0.15, pose = 'open';
      if (u >= 1 && u < 1.18) size = 0.15 + 0.065 * clamp((u - 1) / 0.12);
      else if (u >= 1.18 && u < 1.6) size = 0.215 - 0.065 * clamp((u - 1.18) / 0.42);
      if (u >= 1.6) pose = 'fist';
      return [{ id: 'R', hand: 'right', pose, x: 0.66, y: 0.8, size, rot: -0.1 }];
    },
    // Two hands far apart taking turns: charge → push → fist.
    dual: (t) => {
      const hand = (id, side, x, rot, phase) => {
        const u = t < 1.2 ? 2 : (t - 1.2 + phase) % 2.6;   // fists while the page loads
        let size = 0.15, pose = u < 1.3 ? 'open' : 'fist';
        if (u >= 0.95 && u < 1.1) size = 0.15 + 0.06 * clamp((u - 0.95) / 0.1);
        else if (u >= 1.1 && u < 1.3) size = 0.21;
        return { id, hand: side, pose, x, y: 0.8, size, rot };
      };
      return [hand('L', 'left', 0.22, 0.15, 0), hand('R', 'right', 0.78, -0.15, 1.3)];
    },
    // Both palms come together, hold → unibeam, then apart and rest.
    unibeam: (t) => {
      const u = t % 5;
      const k = clamp((u - 0.6) / 0.8) * (1 - clamp((u - 2.6) / 0.6));
      const pose = u < 0.6 || u > 3.25 ? 'fist' : 'open';
      const e = k * k * (3 - 2 * k);
      return [
        { id: 'L', hand: 'left', pose, x: 0.3 + 0.13 * e, y: 0.82, size: 0.16, rot: 0.1 + 0.15 * e },
        { id: 'R', hand: 'right', pose, x: 0.7 - 0.13 * e, y: 0.82, size: 0.16, rot: -0.1 - 0.15 * e },
      ];
    },
    // Charge up, then close the fist: the charge fizzles.
    cancel: (t) => {
      const u = t % 2.2;
      return [{ id: 'R', hand: 'right', pose: u < 1.05 ? 'open' : 'fist', x: 0.64, y: 0.8, size: 0.16, rot: -0.1 }];
    },
    // Hands come and go: reticles snap on (LOCK) and release (LOST).
    lock: (t) => {
      const u = t % 4, out = [];
      if (u < 2.6) out.push({ id: 'R', hand: 'right', pose: 'peace', x: 0.62 + Math.sin(t * 1.3) * 0.1, y: 0.78, size: 0.16, rot: -0.1 });
      if (u > 1.0 && u < 3.6) out.push({ id: 'L', hand: 'left', pose: 'fist', x: 0.3, y: 0.8 + Math.sin(t * 2) * 0.03, size: 0.15, rot: 0.15 });
      return out;
    },
  },
};

