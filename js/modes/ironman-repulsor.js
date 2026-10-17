// ironman-repulsor.js — target lock and repulsors for every tracked hand,
// plus the two-palm unibeam.
//
//   open palm ✋      charges the repulsor (0 → 1 in CHARGE_S)
//   push toward cam  fires (palm grows ≥ 12 % within 250 ms), or
//   keep holding     fires by itself after HOLD_FIRE_S at full charge
//   fist ✊          cancels the charge with a fizzle
//   palms together   (both open, < UNI_NEAR hand sizes apart) for UNI_S → unibeam
//
// Line art (reticles, gauges) goes into the HUD's glow layer; light (cores,
// flares, intake streaks, blasts, sparks) is drawn additively on top.

import { Particles } from '../particles.js';
import { TAU, clamp, lerp, easeOutCubic, easeOutBack, drawGlow, ghostRing, starburst } from './ironman-fx.js';

const CHARGE_S = 0.8;
const HOLD_FIRE_S = 0.6;
const COOLDOWN_S = 0.5;
const PUSH_GROW = 1.12;
const PUSH_WINDOW = 0.25;
const PUSH_MIN = 0.7;              // a push fires once the charge is this full
const LOCK_S = 0.32;               // reticle snap-on
const RELEASE_S = 0.45;            // reticle fade after the hand is lost
const UNI_NEAR = 1.7, UNI_FAR = 2.1;
const UNI_S = 1.0, UNI_COOL = 1.5;
const HIST = 40;                   // palm-size samples: covers PUSH_WINDOW even at 120 Hz
const STREAKS = 40;
const LBL = '700 12px Rajdhani, "Segoe UI", sans-serif';
const LBL2 = '600 11px Rajdhani, "Segoe UI", sans-serif';

class Target {
  constructor(h, n, t) {
    this.id = h.id; this.n = n; this.t0 = t; this.hand = h;
    this.x = h.palm.x; this.y = h.palm.y; this.s = clamp(h.size, 20, 420);
    this.side = h.side; this.ghost = false; this.open = false;
    this.alive = true; this.lostT = 0; this.locked = false; this.seen = 0;
    this.charge = 0; this.full = 0; this.cool = 0; this.ready = false; this.readyT = -99;
    this.link = 0;   // 0..1 merged into a unibeam lock
    this.fired = -99; this.fizzled = -99; this.spin = Math.random() * TAU; this.looping = false;
    this.ht = new Float64Array(HIST); this.hs = new Float32Array(HIST); this.hn = 0; this.hi = 0;
    this.intake = Array.from({ length: 18 }, () => ({ on: false, a: 0, r: 0, v: 0, l: 0 }));
  }
}

export class Repulsors {
  constructor() {
    this.targets = new Map();
    this.count = 0;
    this.tick = 0;
    this.blasts = [];
    this.parts = new Particles(700);
    this.uni = { on: false, charge: 0, x: 0, y: 0, s: 100, cool: 0, a: null, b: null, arcs: new Float32Array(2 * 12 * 2), arcT: -1, looping: false };
    this.shakeAmp = 0;
    this.shake = { x: 0, y: 0 };
    this.pal = null;
    this.onEvent = null;   // (type, target) for HUD messages
    this.sndAt = {};
    this.gl = { lights: [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]], blast: [0, 0, 1, 0], flash: 0 };
    this.hudInfo = { targets: [], rpl: [{ label: 'L', charge: 0, state: 'OFFLINE' }, { label: 'R', charge: 0, state: 'OFFLINE' }], steer: 0 };
  }

  reset(app) {
    this.stopSounds(app.sfx);
    this.targets.clear();
    this.blasts.length = 0;
    this.parts.clear();
    Object.assign(this.uni, { on: false, charge: 0, cool: 0, a: null, b: null, arcT: -1 });
    this.shakeAmp = 0; this.shake.x = 0; this.shake.y = 0;
  }

  stopSounds(sfx) {
    for (const T of this.targets.values()) if (T.looping) { sfx.stopLoop('repulsor-' + T.id); T.looping = false; }
    if (this.uni.looping) { sfx.stopLoop('ironman-unibeam'); this.uni.looping = false; }
  }

  // Run fn at most once per gap seconds for a given key.
  snd(key, gap, t, fn) {
    if (t - (this.sndAt[key] ?? -99) < gap) return;
    this.sndAt[key] = t;
    fn();
  }

  // ---------------------------------------------------------------- logic
  update(frame, app) {
    const t = frame.t, dt = Math.min(frame.dt, 0.1), sfx = app.sfx;
    this.tick++;
    for (const h of frame.hands) {
      let T = this.targets.get(h.id);
      if (!T) {
        this.count = (this.count % 99) + 1;
        T = new Target(h, this.count, t);
        this.targets.set(h.id, T);
      }
      T.hand = h;
      T.seen = this.tick;
    }
    for (const T of this.targets.values()) {
      if (T.seen === this.tick) { this.updateTarget(T, dt, t, sfx); continue; }
      if (T.alive) {
        T.alive = false; T.lostT = t;
        if (T.looping) { sfx.stopLoop('repulsor-' + T.id); T.looping = false; }
        if (T.locked) this.snd('lost', 0.2, t, () => sfx.tone({ type: 'sine', f0: 900, f1: 420, dur: 0.12, vol: 0.03 }));
      }
      if (t - T.lostT > RELEASE_S) this.targets.delete(T.id);
    }
    this.updateUni(frame, dt, t, sfx);

    while (this.blasts.length && t - this.blasts[0].t0 > (this.blasts[0].uni ? 1.6 : 1.1)) this.blasts.shift();
    this.shakeAmp *= Math.exp(-dt * 7);
    const a = this.shakeAmp;
    this.shake.x = (Math.sin(t * 91.3) + 0.6 * Math.sin(t * 57.1 + 2)) * a * 0.62;
    this.shake.y = (Math.sin(t * 77.7 + 1) + 0.6 * Math.sin(t * 43.9)) * a * 0.62;
    this.parts.update(dt);
  }

  updateTarget(T, dt, t, sfx) {
    const h = T.hand;
    const s = clamp(h.size, 20, 420);
    T.s = s;
    // the repulsor sits mid-palm, a touch toward the fingers
    T.x = h.palm.x + h.dir.x * s * 0.12;
    T.y = h.palm.y + h.dir.y * s * 0.12;
    T.side = h.side;
    T.ghost = h.ghost;
    if (!T.locked && t - T.t0 >= LOCK_S) {
      T.locked = true;
      this.snd('lock', 0.12, t, () => {
        sfx.tone({ type: 'square', f0: 1500, dur: 0.035, vol: 0.022 });
        sfx.tone({ type: 'square', f0: 2250, dur: 0.05, vol: 0.022, delay: 0.07 });
      });
    }
    T.spin += dt * (0.8 + T.charge * 7);
    const U = this.uni;
    const linked = U.charge > 0.01 && (U.a === T || U.b === T) ? 1 : 0;
    T.link += (linked - T.link) * Math.min(1, dt * 10);
    if (h.ghost) return;   // hold everything while the tracker blinks

    // palm size history, for spotting a push toward the camera
    T.ht[T.hi] = t; T.hs[T.hi] = h.size;
    T.hi = (T.hi + 1) % HIST; T.hn = Math.min(HIST, T.hn + 1);

    const open = h.pose === 'open' && !h.overUI;
    T.open = open;
    if (T.cool > 0) {
      T.cool -= dt;
      T.charge = Math.max(0, T.charge - dt * 3);
    } else if (open) {
      T.charge = Math.min(1, T.charge + dt / CHARGE_S);
      if (T.charge >= 1) {
        if (!T.ready) {
          T.ready = true; T.readyT = t;
          sfx.tone({ type: 'sine', f0: 1900, f1: 2600, dur: 0.1, vol: 0.05 });
          this.onEvent?.('ready', T);
        }
        T.full = U.on ? 0 : T.full + dt;   // no hold-to-fire while linked into a unibeam
      }
      if (!U.on && U.cool <= 0) {
        if (T.charge >= PUSH_MIN && this.pushed(T, t)) this.fire(T, t, sfx, true);
        else if (T.full >= HOLD_FIRE_S) this.fire(T, t, sfx, false);
      }
    } else if (h.pose === 'fist' && T.charge > 0.15) {
      this.fizzle(T, t, sfx);
    } else {
      T.charge = Math.max(0, T.charge - dt * 1.6);
    }
    if (T.charge < 1) { T.ready = false; T.full = 0; }

    // energy streaks being sucked into the palm
    for (const p of T.intake) {
      if (p.on) {
        p.v += dt * s * 10;
        p.r -= p.v * dt;
        p.a += dt * 1.4;
        if (p.r < s * 0.12) p.on = false;
      } else if (T.charge > 0.04 && T.cool <= 0 && Math.random() < dt * (5 + 16 * T.charge)) {
        p.on = true;
        p.a = Math.random() * TAU;
        p.r = s * (0.8 + Math.random() * 0.9);
        p.v = s * (0.4 + Math.random() * 0.8);
        p.l = 0.12 + Math.random() * 0.22;
      }
    }

    // the charging whine
    if (T.charge > 0.02) {
      sfx.loop('repulsor-' + T.id, T.charge, { type: 'sawtooth', base: 70, range: 330, vol: 0.09, filter: 500 });
      T.looping = true;
    } else if (T.looping) {
      sfx.stopLoop('repulsor-' + T.id);
      T.looping = false;
    }
  }

  pushed(T, t) {
    let min = Infinity;
    for (let i = 0; i < T.hn; i++) if (t - T.ht[i] <= PUSH_WINDOW && T.hs[i] < min) min = T.hs[i];
    return min > 1 && min < Infinity && T.hand.size / min >= PUSH_GROW;
  }

  fire(T, t, sfx, pushed) {
    const power = pushed ? 0.8 + 0.3 * T.charge : 1;
    this.addBlast(T.x, T.y, T.s, power, false, t);
    T.charge = 0; T.full = 0; T.ready = false; T.cool = COOLDOWN_S; T.fired = t; T.hn = 0;
    for (const p of T.intake) p.on = false;
    sfx.play('blast');
    sfx.tone({ type: 'sine', f0: 2600, f1: 380, dur: 0.3, vol: 0.1 });
    this.onEvent?.('fire', T);
  }

  fizzle(T, t, sfx) {
    const P = this.pal;
    const s = T.s, n = Math.round(12 + 18 * T.charge);
    this.parts.burst(T.x, T.y, n, (i) => {
      const a = Math.random() * TAU, v = s * (1 + Math.random() * 2.6);
      return {
        x: T.x + Math.cos(a) * s * 0.15, y: T.y + Math.sin(a) * s * 0.15, vx: Math.cos(a) * v, vy: Math.sin(a) * v - s * 0.6,
        life: 0.3 + Math.random() * 0.4, size: 2 + Math.random() * 2, color: i % 3 ? P.line : '#ffffff', drag: 0.1, gravity: s * 5, kind: 'spark',
      };
    });
    T.charge = 0; T.full = 0; T.ready = false; T.fizzled = t; T.hn = 0;
    for (const p of T.intake) p.on = false;
    this.snd('fizzle', 0.2, t, () => {
      sfx.play('spark');
      sfx.noise({ dur: 0.3, vol: 0.12, type: 'bandpass', f0: 2200, f1: 240, q: 2 });
      sfx.tone({ type: 'sawtooth', f0: 420, f1: 60, dur: 0.3, vol: 0.045 });
    });
    this.onEvent?.('fizzle', T);
  }

  addBlast(x, y, s, power, uni, t) {
    const P = this.pal;
    const lines = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i++) {
      lines[i * 3] = Math.random() * TAU;
      lines[i * 3 + 1] = 0.6 + Math.random() * 0.9;
      lines[i * 3 + 2] = 0.3 + Math.random() * 1.2;
    }
    this.blasts.push({ x, y, s, power, uni, t0: t, rot: Math.random() * TAU, seed: 1 + Math.floor(Math.random() * 3), lines, P });
    if (this.blasts.length > 6) this.blasts.shift();
    const kick = clamp(s * 0.09, 5, 14) * power * (uni ? 2 : 1);
    this.shakeAmp = Math.min(uni ? 30 : 16, this.shakeAmp + kick);
    const n = uni ? 120 : 50;
    this.parts.burst(x, y, n, (i) => {
      const a = Math.random() * TAU, v = s * (3 + Math.random() * 10) * (uni ? 1.7 : 1);
      const spark = i % 4 !== 0;
      return {
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.3 + Math.random() * (uni ? 0.9 : 0.55), size: spark ? 1.4 + Math.random() * 2.2 : 3 + Math.random() * 5,
        color: spark ? (i % 3 ? P.line : '#ffffff') : P.beam, drag: spark ? 0.04 : 0.15, kind: spark ? 'spark' : 'glow',
      };
    });
  }

  updateUni(frame, dt, t, sfx) {
    const U = this.uni;
    U.cool = Math.max(0, U.cool - dt);
    let a = null, b = null;
    for (const h of frame.hands) {
      if (!h.is('open') || h.overUI) continue;
      if (!a) a = h; else if (!b) b = h;
    }
    let near = false;
    if (a && b) {
      const s = (clamp(a.size, 20, 420) + clamp(b.size, 20, 420)) / 2;
      const d = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
      near = d < s * (U.on ? UNI_FAR : UNI_NEAR);
      U.x = (a.palm.x + b.palm.x) / 2 + (a.dir.x + b.dir.x) * s * 0.06;
      U.y = (a.palm.y + b.palm.y) / 2 + (a.dir.y + b.dir.y) * s * 0.06;
      U.s = s;
      U.a = this.targets.get(a.id) || null;
      U.b = this.targets.get(b.id) || null;
    }
    // keep the charge while the tracker briefly loses one of the hands
    const blink = U.on && !near && frame.hands.some((h) => h.ghost);
    if (near && U.cool <= 0) {
      if (!U.on) { U.on = true; this.onEvent?.('uniStart', null); }
      U.charge = Math.min(1, U.charge + dt / UNI_S);
      if (U.charge >= 1) this.fireUni(t, sfx);
    } else if (!blink) {
      U.on = false;
      U.charge = Math.max(0, U.charge - dt * 2.5);
    }
    if (U.charge > 0.02) {
      sfx.loop('ironman-unibeam', U.charge, { type: 'square', base: 45, range: 160, vol: 0.12, filter: 300 });
      U.looping = true;
    } else if (U.looping) {
      sfx.stopLoop('ironman-unibeam');
      U.looping = false;
    }
    // re-roll the crackling arcs between the two palms ~16 times a second
    if (U.charge > 0.02 && U.a && U.b && t - U.arcT > 0.06) {
      U.arcT = t;
      const ar = U.arcs;
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < 12; i++) {
          const j = (k * 12 + i) * 2;
          ar[j] = i / 11;
          ar[j + 1] = i === 0 || i === 11 ? 0 : (Math.random() - 0.5) * 0.5;
        }
      }
    }
  }

  fireUni(t, sfx) {
    const U = this.uni;
    this.addBlast(U.x, U.y, U.s * 1.5, 1.4, true, t);
    for (const T of [U.a, U.b]) {
      if (!T) continue;
      T.charge = 0; T.full = 0; T.ready = false; T.cool = UNI_COOL; T.fired = t; T.hn = 0;
      for (const p of T.intake) p.on = false;
    }
    U.charge = 0; U.on = false; U.cool = UNI_COOL;
    sfx.play('blast');
    sfx.play('portal');
    sfx.tone({ type: 'sawtooth', f0: 140, f1: 30, dur: 1.1, vol: 0.14 });
    sfx.tone({ type: 'sine', f0: 3200, f1: 600, dur: 0.5, vol: 0.08 });
    this.onEvent?.('unibeam', null);
  }

  stateOf(T, t) {
    if (!T.alive) return 'OFFLINE';
    if (t - T.fired < 0.35) return 'FIRE';
    if (t - T.fizzled < 0.6) return 'ABORT';
    if (T.cool > 0) return 'COOL';
    if (T.ready) return 'READY';
    if (T.charge > 0.02) return 'CHRG';
    return 'STBY';
  }

  // What the helmet HUD shows: locked targets and a gauge per screen side.
  info(frame) {
    const I = this.hudInfo, t = frame.t;
    I.targets.length = 0;
    let steer = 0;
    for (const r of I.rpl) { r.charge = 0; r.state = 'OFFLINE'; }
    for (const T of this.targets.values()) {
      if (!T.alive) continue;
      I.targets.push(T);
      steer += (T.x / frame.W - 0.5);
      const r = I.rpl[T.side === 'left' ? 0 : 1];
      if (r.state === 'OFFLINE' || T.charge > r.charge) { r.charge = T.charge; r.state = this.stateOf(T, t); }
    }
    I.steer = I.targets.length ? steer / I.targets.length : 0;
    return I;
  }

  // Light for the WebGL grade: charging palms, the strongest blast, the flash.
  glState(frame) {
    const G = this.gl, t = frame.t, m = Math.min(frame.W, frame.H);
    let n = 0;
    for (const T of this.targets.values()) {
      if (n >= 3 || !T.alive) continue;
      const after = Math.max(0, 1 - (t - T.fired) / 0.5);
      const k = Math.max(T.charge * 0.75, after * 0.9);
      if (k < 0.01) continue;
      const L = G.lights[n++];
      L[0] = T.x; L[1] = T.y; L[2] = T.s * (2.2 + T.charge * 1.4); L[3] = k;
    }
    const U = this.uni;
    if (U.charge > 0.01 && n < 3) {
      const L = G.lights[n++];
      L[0] = U.x; L[1] = U.y; L[2] = U.s * (2.5 + 3 * U.charge); L[3] = U.charge * 0.9;
    }
    for (; n < 3; n++) G.lights[n][3] = 0;
    G.blast[3] = 0; G.flash = 0;
    for (const b of this.blasts) {
      const a = t - b.t0, dur = b.uni ? 0.9 : 0.55;
      if (a > dur) continue;
      const k = b.power * Math.pow(1 - a / dur, 2);
      if (k > G.blast[3]) {
        G.blast[0] = b.x; G.blast[1] = b.y;
        G.blast[2] = b.s * 2.5 + m * (b.uni ? 0.7 : 0.35) * easeOutCubic(clamp(a / 0.2));
        G.blast[3] = k;
      }
      const fd = b.uni ? 0.32 : 0.16;
      if (a < fd) G.flash = Math.max(G.flash, Math.pow(1 - a / fd, 2) * (b.uni ? 0.85 : 0.42) * b.power);
    }
    return G;
  }

  // ---------------------------------------------------------------- line art
  drawReticles(g, frame, P) {
    const t = frame.t;
    g.lineCap = 'butt';
    for (const T of this.targets.values()) this.drawReticle(g, T, t, P, frame);
    this.drawUniGauge(g, t, P);
  }

  drawReticle(g, T, t, P, frame) {
    const age = t - T.t0;
    const R = clamp(T.s * 0.9, 30, 230);
    let fade, r, rot;
    if (T.alive) {
      const a = clamp(age / LOCK_S);
      fade = clamp(age / 0.12) * (T.ghost ? 0.5 : 1) * (T.hand.overUI ? 0.35 : 1);
      r = R * (2.1 - 1.1 * easeOutBack(a));
      rot = (1 - easeOutCubic(a)) * Math.PI * 0.5;
    } else {
      const k = clamp((t - T.lostT) / RELEASE_S);
      fade = (1 - k) * (T.locked ? 0.9 : 0.5);
      r = R * (1 + 0.6 * easeOutCubic(k));
      rot = -k * 0.5;
    }
    if (fade <= 0.01) return;
    const since = t - T.fired;
    if (since < 0.35) r *= 1 + 0.28 * Math.pow(1 - since / 0.35, 2);   // recoil
    const firing = since < 0.3, abort = t - T.fizzled < 0.5;
    const col = firing || abort ? P.alert : T.ready ? P.accent : T.charge > 0.02 ? P.line : P.main;
    let blink = 1;
    if (T.alive && age > LOCK_S && age < LOCK_S + 0.3) blink = Math.sin((age - LOCK_S) * 42) > 0 ? 1 : 0.3;
    const { x, y } = T;
    const solo = 1 - T.link * 0.75;   // fades back while merged into the unibeam lock

    // corner brackets
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.globalAlpha = fade * blink * solo;
    g.strokeStyle = col;
    g.lineWidth = 2;
    const leg = R * 0.3;
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const sx = i === 0 || i === 3 ? -1 : 1, sy = i < 2 ? -1 : 1;
      g.moveTo(sx * r, sy * (r - leg)); g.lineTo(sx * r, sy * r); g.lineTo(sx * (r - leg), sy * r);
    }
    g.stroke();
    g.lineWidth = 1;
    g.globalAlpha = fade * 0.55 * solo;
    const tk = R * 0.1;
    g.beginPath();
    g.moveTo(-r, 0); g.lineTo(-r + tk, 0); g.moveTo(r, 0); g.lineTo(r - tk, 0);
    g.moveTo(0, -r); g.lineTo(0, -r + tk); g.moveTo(0, r); g.lineTo(0, r - tk);
    g.stroke();
    g.restore();

    // rotating segmented ring + counter-rotating tick ring
    g.save();
    g.translate(x, y);
    g.rotate(T.spin);
    const rr = r * 0.76;
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.globalAlpha = fade * 0.85 * solo;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a0 = (i * TAU) / 3;
      g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
      g.arc(0, 0, rr, a0, a0 + 1.3);
    }
    g.stroke();
    g.rotate(-T.spin * 2.3);
    const ri = r * 0.56;
    g.lineWidth = 1;
    g.globalAlpha = fade * (0.3 + 0.6 * T.charge) * solo;
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i * TAU) / 24, l = i % 6 === 0 ? 0.84 : 0.92, c = Math.cos(a), s = Math.sin(a);
      g.moveTo(c * ri, s * ri); g.lineTo(c * ri * l, s * ri * l);
    }
    g.stroke();
    g.restore();

    // charge gauge (and the hold-to-fire countdown once full)
    if (T.alive && (T.charge > 0.01 || T.ready) && T.link < 0.95) {
      const rc = r * 0.66, a0 = -Math.PI / 2, gk = 1 - T.link;
      g.globalAlpha = fade * 0.22 * gk;
      g.strokeStyle = P.main;
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(x, y, rc, 0, TAU); g.stroke();
      g.globalAlpha = fade * gk;
      g.strokeStyle = T.ready ? P.accent : P.line;
      g.beginPath(); g.arc(x, y, rc, a0, a0 + TAU * T.charge); g.stroke();
      if (T.ready) {
        g.lineWidth = 1.5;
        g.strokeStyle = P.accent;
        g.globalAlpha = fade * 0.9 * gk;
        g.beginPath(); g.arc(x, y, r * 0.9, a0, a0 + TAU * clamp(T.full / HOLD_FIRE_S)); g.stroke();
      }
    }
    if (T.link < 0.98) this.drawLabel(g, T, t, P, r, fade * (1 - T.link), col, frame);
  }

  // Label on the outer side of the reticle (away from the centre of the
  // view, so two hands never label into each other); without room there it
  // sits centred above the box.
  drawLabel(g, T, t, P, r, fade, col, frame) {
    const LW = 118;
    let sgn = T.x < frame.W / 2 ? -1 : 1;
    if (sgn > 0 ? T.x + r + LW > frame.W - 6 : T.x - r - LW < 6) sgn = 0;
    let x0, y0, lx, ly;
    g.globalAlpha = fade * 0.75;
    g.strokeStyle = col;
    g.lineWidth = 1;
    g.beginPath();
    if (sgn) {
      x0 = T.x + sgn * r; y0 = T.y - r;
      lx = x0 + sgn * 12; ly = y0 - 12;
      g.moveTo(x0, y0); g.lineTo(lx, ly); g.lineTo(lx + sgn * 84, ly);
    } else {
      lx = clamp(T.x, LW / 2 + 6, frame.W - LW / 2 - 6); ly = T.y - r - 30;
      g.moveTo(T.x, T.y - r - 4); g.lineTo(T.x, ly + 14);
      g.moveTo(lx - 42, ly); g.lineTo(lx + 42, ly);
    }
    g.stroke();
    g.textAlign = sgn > 0 ? 'left' : sgn < 0 ? 'right' : 'center';
    g.font = LBL;
    g.fillStyle = col;
    g.globalAlpha = fade;
    g.textBaseline = 'bottom';
    const status = !T.alive ? 'LOST' : T.locked ? 'LOCK' : (Math.sin(t * 30) > 0 ? 'ACQ' : '');
    g.fillText(`TGT ${T.n < 10 ? '0' : ''}${T.n} · ${status}`, lx + sgn * 2, ly - 2);
    g.textBaseline = 'top';
    g.font = LBL2;
    const st = this.stateOf(T, t);
    let sub;
    if (T.link > 0.5 && T.alive) sub = 'UNIBEAM LINK';
    else if (st === 'CHRG') sub = `RPLSR CHARGING ${Math.round(T.charge * 100)}%`;
    else if (st === 'READY') sub = Math.sin(t * 10) > -0.4 ? 'READY · PUSH TO FIRE' : 'READY';
    else if (st === 'COOL') sub = 'RPLSR RECHARGE';
    else if (st === 'FIRE') sub = 'FIRE';
    else if (st === 'ABORT') sub = 'CHARGE ABORTED';
    else if (st === 'OFFLINE') sub = 'SIGNAL LOST';
    else sub = '✋ OPEN PALM TO ARM';
    g.globalAlpha = fade * (st === 'STBY' ? 0.65 : 0.95);
    g.fillText(sub, lx + sgn * 2, ly + 3);
  }

  // One big lock around both palms, the chest-reactor triangle spinning up
  // between them, and a progress ring.
  drawUniGauge(g, t, P) {
    const U = this.uni, c = U.charge;
    if (c <= 0.01 || !U.a || !U.b) return;
    const { x, y, s } = U, A = U.a, B = U.b;
    const k = Math.min(1, c * 3), e = easeOutCubic(k);
    // combined corner brackets, snapping in from 30 % larger
    const R = s * 0.95, grow = 1 + 0.3 * (1 - e);
    const bx = (Math.min(A.x, B.x) + Math.max(A.x, B.x)) / 2, by = (Math.min(A.y, B.y) + Math.max(A.y, B.y)) / 2;
    const hw = (Math.abs(A.x - B.x) / 2 + R * 1.15) * grow, hh = (Math.abs(A.y - B.y) / 2 + R * 1.15) * grow;
    const leg = Math.min(hw, hh) * 0.28;
    g.strokeStyle = P.accent;
    g.lineWidth = 2.5;
    g.globalAlpha = k * (c > 0.85 && Math.sin(t * 40) < 0 ? 0.5 : 1);
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const sx = i === 0 || i === 3 ? -1 : 1, sy = i < 2 ? -1 : 1;
      g.moveTo(bx + sx * hw, by + sy * (hh - leg)); g.lineTo(bx + sx * hw, by + sy * hh); g.lineTo(bx + sx * (hw - leg), by + sy * hh);
    }
    g.stroke();
    // label + segmented bar over the top-left corner
    const lx = bx - hw, ly = by - hh - 10;
    g.font = LBL;
    g.fillStyle = P.accent;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.globalAlpha = k;
    g.fillText(`UNIBEAM · ${Math.round(c * 100)}%`, lx, ly - 6);
    const n = 14, sw = 7, gap = 2.5, on = Math.round(c * n);
    for (let i = 0; i < n; i++) {
      g.globalAlpha = k * (i < on ? 0.95 : 0.2);
      g.fillRect(lx + i * (sw + gap), ly - 3, sw, 4);
    }
    // link between the two palms
    g.lineWidth = 1.2;
    g.globalAlpha = 0.7 * k;
    g.setLineDash([4, 5]);
    g.lineDashOffset = -t * 40;
    g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    g.setLineDash([]);
    // the chest reactor triangle, spinning up
    const tr = s * (0.3 + 0.35 * c);
    g.save();
    g.translate(x, y);
    g.rotate(t * (0.8 + 4 * c));
    for (let j = 0; j < 2; j++) {
      const f = j ? 0.62 : 1;
      g.lineWidth = j ? 1 : 2.2;
      g.globalAlpha = k * (j ? 0.6 : 1);
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 3 + j * Math.PI;
        if (i) g.lineTo(Math.cos(a) * tr * f, Math.sin(a) * tr * f); else g.moveTo(Math.cos(a) * tr * f, Math.sin(a) * tr * f);
      }
      g.closePath();
      g.stroke();
    }
    g.restore();
    // progress ring
    const rr = s * 0.78, a0 = -Math.PI / 2;
    g.lineWidth = 3;
    g.globalAlpha = 0.22 * k;
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
    g.globalAlpha = k;
    g.beginPath(); g.arc(x, y, rr, a0, a0 + TAU * c); g.stroke();
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- light
  drawEnergy(ctx, frame, P) {
    const sh = this.shake;
    ctx.save();
    ctx.translate(sh.x, sh.y);
    ctx.globalCompositeOperation = 'lighter';
    for (const T of this.targets.values()) if (T.alive) this.drawCore(ctx, T, frame, P);
    this.drawUniEnergy(ctx, frame, P);
    for (const b of this.blasts) this.drawBlast(ctx, b, frame);
    ctx.restore();
    ctx.save();
    ctx.translate(sh.x, sh.y);
    this.parts.draw(ctx);
    ctx.restore();
  }

  drawCore(ctx, T, frame, P) {
    const t = frame.t, c = T.charge, s = T.s, { x, y } = T;
    ctx.globalAlpha = 1;
    const since = t - T.fired;
    if (since < 0.5) { const k = 1 - since / 0.5; drawGlow(ctx, x, y, s * 1.1, P.beam, 0.6 * k * k); }
    // fizzle: the core sputters out while a ring collapses into the palm
    const fz = t - T.fizzled;
    if (fz < 0.45) {
      const k = 1 - fz / 0.45, sputter = Math.sin(t * 71) * Math.sin(t * 43) > 0 ? 1 : 0.3;
      drawGlow(ctx, x, y, s * (0.3 + 0.5 * k), P.beam, 0.55 * k * sputter);
      drawGlow(ctx, x, y, s * 0.14 * k + 1, '#ffffff', 0.8 * k * sputter);
      const rr = s * 0.65 * (1 - easeOutCubic(clamp(fz / 0.28)));
      if (rr > 1) {
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.strokeStyle = P.alert;
        ctx.lineWidth = 2;
        ctx.globalAlpha = k;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // a faint pilot light on any open palm, then the charge builds on top
    const pilot = T.open && !T.ghost ? 0.22 : 0;
    const e = Math.max(c, pilot);
    if (e < 0.01) return;
    const fl = 0.86 + 0.14 * Math.sin(t * 47 + T.id * 3) * Math.sin(t * 23 + T.id);
    drawGlow(ctx, x, y, s * (0.45 + 1.5 * c), P.beam, (0.12 + 0.5 * c) * fl);
    drawGlow(ctx, x, y, s * (0.12 + 0.3 * e), P.core, (0.35 + 0.65 * c) * fl);
    drawGlow(ctx, x, y, s * (0.05 + 0.12 * c), '#ffffff', 0.45 + 0.55 * c);
    if (T.ready) drawGlow(ctx, x, y, s * (0.7 + 0.15 * Math.sin(t * 18)), P.core, 0.22);
    // the glowing emitter ring of the palm repulsor
    if (c > 0.03) {
      const rr = s * (0.26 + 0.04 * Math.sin(t * 9 + T.id));
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.strokeStyle = P.beam;
      ctx.lineWidth = s * 0.12;
      ctx.globalAlpha = 0.22 * c * fl;
      ctx.stroke();
      ctx.strokeStyle = P.core;
      ctx.lineWidth = 1.2 + s * 0.02 * c;
      ctx.globalAlpha = 0.85 * c * fl;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const k = c * c;
    if (k > 0.02) {
      // anamorphic streaks
      drawGlow(ctx, x, y, s * (0.8 + 4.6 * k), P.beam, 0.6 * k * fl, s * (0.03 + 0.045 * k));
      drawGlow(ctx, x, y, s * (0.4 + 2.2 * k), '#ffffff', 0.5 * k * fl, s * 0.016 + 0.6);
      drawGlow(ctx, x, y, s * 0.04 + 0.6, P.beam, 0.35 * k, s * (0.25 + 1.1 * k));
      // lens ghosts mirrored through the centre of the view
      const cx = frame.W / 2, cy = frame.H / 2, ring = ghostRing(P.beam);
      const F = [0.35, 0.8, -0.45], SZ = [0.35, 0.6, 0.22];
      for (let i = 0; i < 3; i++) {
        const gx = cx + (cx - x) * F[i], gy = cy + (cy - y) * F[i], gr = s * SZ[i] * (0.6 + k);
        ctx.globalAlpha = 0.28 * k;
        ctx.drawImage(ring, gx - gr, gy - gr, gr * 2, gr * 2);
      }
      ctx.globalAlpha = 1;
    }
    // intake streaks, one stroke per hand
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.25 + 0.6 * c;
    ctx.beginPath();
    for (const p of T.intake) {
      if (!p.on) continue;
      const ca = Math.cos(p.a), sa = Math.sin(p.a), r1 = p.r + s * p.l * (0.5 + c);
      ctx.moveTo(x + ca * p.r, y + sa * p.r);
      ctx.lineTo(x + ca * r1, y + sa * r1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawUniEnergy(ctx, frame, P) {
    const U = this.uni, c = U.charge;
    if (c <= 0.01 || !U.a || !U.b) return;
    const t = frame.t, { x, y, s } = U;
    const fl = 0.8 + 0.2 * Math.sin(t * 53);
    drawGlow(ctx, x, y, s * (0.8 + 2.4 * c), P.beam, 0.55 * c * fl);
    drawGlow(ctx, x, y, s * (0.2 + 0.6 * c), P.core, 0.8 * c);
    drawGlow(ctx, x, y, s * (1 + 6 * c * c), P.beam, 0.5 * c * c, s * 0.06);
    // crackling arcs from each palm into the centre
    const ar = U.arcs;
    for (let k = 0; k < 2; k++) {
      const A = k ? U.b : U.a;
      const dx = x - A.x, dy = y - A.y, nx = -dy, ny = dx;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const j = (k * 12 + i) * 2, f = ar[j], o = ar[j + 1];
        const px = A.x + dx * f + nx * o * 0.6, py = A.y + dy * f + ny * o * 0.6;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.strokeStyle = P.beam;
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.25 * c;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.85 * c;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawBlast(ctx, b, frame) {
    const P = b.P, a = frame.t - b.t0, U = b.uni, pw = b.power;
    const { x, y, s } = b, m = Math.min(frame.W, frame.H);
    // blinding flash at the palm
    const f = clamp(1 - a / (U ? 0.35 : 0.22));
    if (f > 0) drawGlow(ctx, x, y, s * (1.2 + a * 18) * pw, '#ffffff', f * f);
    // the beam coming at the viewer: a disc of light swelling out of the palm
    const grow = easeOutCubic(clamp(a / (U ? 0.3 : 0.16)));
    const R = lerp(s * 0.6, m * (U ? 1.25 : 0.62) * pw, grow);
    const fade = Math.pow(clamp(1 - a / (U ? 1.1 : 0.6)), 1.6);
    drawGlow(ctx, x, y, R, P.beam, 0.85 * fade);
    drawGlow(ctx, x, y, R * 0.42, P.core, 0.95 * fade);
    // radial light streaks
    const k = clamp(a / (U ? 0.9 : 0.5));
    if (k < 1) {
      const sz = s * (1.5 + 9 * easeOutCubic(k)) * (U ? 1.9 : 1) * pw;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.rot + a * 0.4);
      ctx.globalAlpha = Math.pow(1 - k, 1.3);
      ctx.drawImage(starburst(P.beam, b.seed), -sz, -sz, sz * 2, sz * 2);
      ctx.rotate(0.7 - a * 1.2);
      ctx.globalAlpha = Math.pow(1 - k, 1.3) * 0.6;
      ctx.drawImage(starburst(P.beam, b.seed + 3), -sz * 0.7, -sz * 0.7, sz * 1.4, sz * 1.4);
      ctx.restore();
      // speed lines rushing outward
      const L = b.lines;
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.beginPath();
      for (let i = 0; i < STREAKS; i++) {
        const ang = L[i * 3], sp = L[i * 3 + 1], len = L[i * 3 + 2];
        const r0 = s * (0.7 + a * sp * (U ? 22 : 14)), r1 = r0 + s * len * (0.6 + a * 9);
        const c = Math.cos(ang), sn = Math.sin(ang);
        ctx.moveTo(x + c * r0, y + sn * r0);
        ctx.lineTo(x + c * r1, y + sn * r1);
      }
      ctx.stroke();
    }
    // shockwave rings
    const N = U ? 4 : 3, life = U ? 0.95 : 0.6;
    for (let i = 0; i < N; i++) {
      const ra = a - i * 0.07;
      if (ra <= 0) continue;
      const kk = ra / life;
      if (kk >= 1) continue;
      const rr = s * 0.5 + m * (U ? 0.95 : 0.5) * pw * easeOutCubic(kk);
      const w = s * 0.08 * (1 - kk) + 1;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.strokeStyle = P.beam;
      ctx.lineWidth = w * 4;
      ctx.globalAlpha = (1 - kk) * 0.2;
      ctx.stroke();
      ctx.strokeStyle = P.line;
      ctx.lineWidth = w;
      ctx.globalAlpha = (1 - kk) * 0.8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
