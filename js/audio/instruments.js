// Synthesised instruments for the generated music. Each instrument is a function
//   (kit, out, time, event, stepDur) => endTime
// that builds a few short-lived Web Audio nodes for one note and lets them go: the
// oscillators stop themselves after the release, then the browser frees them. It
// returns the audio time when the note is fully silent (the mood bus uses it to know
// when it can be disconnected).
// Every envelope starts at 0 and ends at 0 with ramps, so nothing clicks.
//
// kit = { ctx, noise: AudioBuffer, vinyl: AudioBuffer }
// out = { in, inL, inR }: the instrument's channel strip (mono in, or left / right).

import { mtof } from './dsp.js';

const EPS = 1e-4;

/** Percussive envelope: 0 → peak in `attack`, exponential fall over `decay`. Returns the stop time. */
export function perc(param, t, peak, attack, decay) {
  const p = Math.max(peak, 2 * EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p, t + attack);
  param.exponentialRampToValueAtTime(EPS, t + attack + decay);
  param.linearRampToValueAtTime(0, t + attack + decay + 0.005);
  return t + attack + decay + 0.01;
}

/**
 * ADSR envelope for a note held `hold` seconds. Decay is exponential toward the
 * sustain level `s` (fraction of peak, 0 = percussive); the release starts at
 * max(hold, attack). Returns the time when the sound is fully silent.
 */
export function adsr(param, t, peak, { a = 0.005, d = 0.2, s = 0.6, r = 0.2 }, hold) {
  const p = Math.max(peak, 2 * EPS);
  const tA = t + Math.max(a, 0.002);
  const tRel = Math.max(t + hold, tA);
  const sus = Math.max(p * s, EPS);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(p, tA);
  let level = p;
  if (tRel > tA + 0.001 && d > 0 && sus < p) {
    const tD = Math.min(tA + d, tRel);
    level = p * Math.pow(sus / p, (tD - tA) / d);
    param.exponentialRampToValueAtTime(Math.max(level, EPS), tD);
  }
  if (tRel > tA + 0.001) param.setValueAtTime(Math.max(level, EPS), tRel);
  param.exponentialRampToValueAtTime(EPS, tRel + Math.max(r, 0.01));
  param.linearRampToValueAtTime(0, tRel + Math.max(r, 0.01) + 0.005);
  return tRel + Math.max(r, 0.01) + 0.01;
}

function gainNode(ctx, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function osc(ctx, type, freq, t, end, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  o.start(t);
  o.stop(end);
  return o;
}

/** Looping white-noise source starting at a varying offset. */
function noise(kit, t, end) {
  const s = kit.ctx.createBufferSource();
  s.buffer = kit.noise;
  s.loop = true;
  const dur = kit.noise.duration;
  s.start(t, (t * 7.31) % (dur * 0.9));
  s.stop(end);
  return s;
}

/** Two identical filter → gain chains feeding left and right, for stereo voices. */
function stereoChains(ctx, out, makeFilter, envelope) {
  const sides = [];
  let end = 0;
  for (const dest of [out.inL, out.inR]) {
    const f = makeFilter();
    const g = gainNode(ctx);
    end = envelope(g.gain);
    f.connect(g).connect(dest);
    sides.push(f);
  }
  return { sides, end };
}

// --------------------------------------------------------------------- drums

function kick(kit, out, t, e) {
  const { ctx } = kit;
  const v = e.vel;
  const house = e.house ? 1 : 0;
  const soft = e.soft ? 1 : 0;
  const f0 = soft ? 92 : house ? 150 : 118;
  // The house kick ends at 56 Hz with a shorter tail: punch, not sub-bass rumble.
  const f1 = soft ? 44 : house ? 56 : 52;
  const g = gainNode(ctx);
  const end = perc(g.gain, t, (soft ? 0.7 : 0.9) * v, 0.003, soft ? 0.5 : house ? 0.32 : 0.36);
  const o = osc(ctx, 'sine', f0, t, end);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + (house ? 0.07 : 0.09));
  o.connect(g).connect(out.in);
  if (!soft) {
    // Soft beater click so the kick is still heard on small speakers.
    const n = noise(kit, t, t + 0.05);
    const lp = filter(ctx, 'lowpass', e.muffle ? 900 : house ? 3200 : 2400, 0.5);
    const cg = gainNode(ctx);
    perc(cg.gain, t, (house ? 0.16 : 0.1) * v * (e.muffle ? 0.4 : 1), 0.001, 0.014);
    n.connect(lp).connect(cg).connect(out.in);
    // A touch of second harmonic for body on laptops.
    const h = osc(ctx, 'triangle', f0 * 2, t, t + 0.16);
    h.frequency.setValueAtTime(f0 * 2, t);
    h.frequency.exponentialRampToValueAtTime(f1 * 2, t + 0.06);
    const hg = gainNode(ctx);
    perc(hg.gain, t, (house ? 0.16 : 0.12) * v * (e.muffle ? 0.3 : 1), 0.002, 0.14);
    h.connect(hg).connect(out.in);
  }
  return Math.max(end, t + 0.16);
}

function hat(kit, out, t, e) {
  const { ctx } = kit;
  const open = !!e.open;
  const n = noise(kit, t, t + (open ? 0.3 : 0.12));
  const f = e.closed ? filter(ctx, 'highpass', 8200, 0.6) : open ? filter(ctx, 'highpass', 7200, 0.7) : filter(ctx, 'bandpass', 7400, 0.8);
  const g = gainNode(ctx);
  perc(g.gain, t, (open ? 0.8 : e.closed ? 0.8 : 1.6) * e.vel, open ? 0.004 : 0.0015, open ? 0.2 : e.closed ? 0.035 : 0.05);
  n.connect(f).connect(g).connect(out.inR);
  return t + (open ? 0.3 : 0.12);
}

function brush(kit, out, t, e) {
  const { ctx } = kit;
  const v = e.vel;
  const n = noise(kit, t, t + 0.35);
  const bp = filter(ctx, 'bandpass', 2300, 0.6);
  const g = gainNode(ctx);
  // A brush sweeps in rather than hitting: slower attack, then a soft tail.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1.0 * v, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.28 * v, t + 0.07);
  g.gain.exponentialRampToValueAtTime(EPS, t + 0.3);
  g.gain.linearRampToValueAtTime(0, t + 0.305);
  n.connect(bp).connect(g).connect(out.inL);
  const body = osc(ctx, 'sine', 190, t, t + 0.12);
  body.frequency.setValueAtTime(190, t);
  body.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  const bg = gainNode(ctx);
  perc(bg.gain, t, 0.3 * v, 0.002, 0.09);
  body.connect(bg).connect(out.in);
  return t + 0.35;
}

function clap(kit, out, t, e) {
  const { ctx } = kit;
  const p = Math.max(1.8 * e.vel, 2 * EPS);
  const n = noise(kit, t, t + 0.3);
  const bp = filter(ctx, 'bandpass', 1350, 1.1);
  const g = gainNode(ctx);
  const gp = g.gain;
  // Three fast bursts (hands) and a short room tail.
  gp.setValueAtTime(0, t);
  for (let k = 0; k < 3; k++) {
    const s = t + k * 0.011;
    gp.linearRampToValueAtTime(p, s + 0.0015);
    gp.exponentialRampToValueAtTime(p * 0.25, s + 0.01);
  }
  gp.linearRampToValueAtTime(p * 0.8, t + 0.034);
  gp.exponentialRampToValueAtTime(EPS, t + 0.24);
  gp.linearRampToValueAtTime(0, t + 0.245);
  n.connect(bp).connect(g).connect(out.in);
  return t + 0.3;
}

function shaker(kit, out, t, e) {
  const { ctx } = kit;
  const n = noise(kit, t, t + 0.1);
  const bp = filter(ctx, 'bandpass', 6200, 1.3);
  const g = gainNode(ctx);
  perc(g.gain, t, 1.2 * e.vel, 0.008, 0.05);
  n.connect(bp).connect(g).connect(out.inR);
  return t + 0.1;
}

/** Soft clock tick (tone 1) / tock (tone 0): a resonant click plus a tiny wooden ping. */
function tick(kit, out, t, e) {
  const { ctx } = kit;
  const hi = e.tone ? 1 : 0;
  const n = noise(kit, t, t + 0.06);
  const bp = filter(ctx, 'bandpass', hi ? 3300 : 2500, 7);
  const g = gainNode(ctx);
  perc(g.gain, t, 1.6 * e.vel, 0.0008, 0.035);
  n.connect(bp).connect(g).connect(hi ? out.inR : out.inL);
  const o = osc(ctx, 'sine', hi ? 1950 : 1450, t, t + 0.07);
  const og = gainNode(ctx);
  perc(og.gain, t, 0.1 * e.vel, 0.001, 0.05);
  o.connect(og).connect(out.in);
  return t + 0.07;
}

function vinyl(kit, out, t, e, sd) {
  const { ctx } = kit;
  const hold = e.len * sd;
  const s = ctx.createBufferSource();
  s.buffer = kit.vinyl;
  s.loop = true;
  const g = gainNode(ctx);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5 * e.vel, t + 0.2);
  g.gain.setValueAtTime(0.5 * e.vel, t + hold);
  g.gain.linearRampToValueAtTime(0, t + hold + 0.25);
  s.start(t, (t * 3.7) % (kit.vinyl.duration * 0.8));
  s.stop(t + hold + 0.3);
  const hp = filter(ctx, 'highpass', 250, 0.5);
  s.connect(hp).connect(g).connect(out.in);
  return t + hold + 0.3;
}

// ------------------------------------------------------------------ keyboards

/** Warm FM electric piano (Rhodes-like): bright attack that mellows. */
function keys(kit, out, t, e, sd) {
  const { ctx } = kit;
  const n = e.notes.length;
  const hold = e.len * sd;
  const per = 1 / Math.sqrt(n);
  let last = t;
  e.notes.forEach((m, j) => {
    const tt = t + j * (e.strum || 0);
    const f = mtof(m);
    const v = e.vel;
    const g = gainNode(ctx);
    const end = adsr(g.gain, tt, 0.8 * v * per, { a: 0.004, d: 1.9, s: 0.2, r: 0.5 }, hold);
    const car = osc(ctx, 'sine', f, tt, end);
    const mod = osc(ctx, 'sine', f, tt, end);
    const mg = gainNode(ctx);
    const index = (0.5 + 1.5 * v) * (e.lead ? 1.2 : 1) * (m > 76 ? 0.65 : 1);
    mg.gain.setValueAtTime(f * index, tt);
    mg.gain.exponentialRampToValueAtTime(f * index * 0.1, tt + 0.8);
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(j % 2 ? out.inR : out.inL);
    last = Math.max(last, end);
  });
  return last;
}

/** Round lo-fi bass: sine + a little triangle, low-passed. */
function bass(kit, out, t, e, sd) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.3 * e.vel, { a: 0.01, d: 0.9, s: 0.45, r: 0.18 }, e.len * sd);
  const lp = filter(ctx, 'lowpass', 520, 0.6);
  const s = osc(ctx, 'sine', f, t, end);
  const tri = osc(ctx, 'triangle', f, t, end);
  const tg = gainNode(ctx, 0.35);
  s.connect(lp);
  tri.connect(tg).connect(lp);
  lp.connect(g).connect(out.in);
  return end;
}

/** Pipe organ swell: stacked detuned saw / square (+ a 4' flute), slow low-pass bloom. */
function organ(kit, out, t, e, sd) {
  const { ctx } = kit;
  const hold = e.len * sd;
  const a = e.attack ?? 2;
  const r = e.release ?? 3;
  const top = 900 + 1500 * (e.bright ?? 0.6);
  const n = e.notes.length;
  const per = 0.4 / Math.sqrt(n);
  const { sides, end } = stereoChains(
    ctx,
    out,
    () => {
      const lp = filter(ctx, 'lowpass', 260, 0.5);
      lp.frequency.setValueAtTime(260, t);
      lp.frequency.linearRampToValueAtTime(top, t + a * 1.15);
      lp.frequency.setValueAtTime(top, t + Math.max(hold, a * 1.15));
      lp.frequency.linearRampToValueAtTime(320, t + Math.max(hold, a * 1.15) + r);
      return lp;
    },
    (param) => adsr(param, t, 1.0 * e.vel, { a, d: 0, s: 1, r }, hold),
  );
  e.notes.forEach((m, j) => {
    const f = mtof(m);
    const low = m < 50 ? 0.7 : 1;
    const saw = osc(ctx, 'sawtooth', f, t, end, -5);
    const sq = osc(ctx, 'square', f, t, end, 6);
    const fl = osc(ctx, 'sine', f * 2, t, end);
    const g1 = gainNode(ctx, per * low);
    const g2 = gainNode(ctx, per * 0.55 * low);
    const g3 = gainNode(ctx, per * 0.5);
    saw.connect(g1).connect(sides[j % 2]);
    sq.connect(g2).connect(sides[(j + 1) % 2]);
    fl.connect(g3).connect(sides[j % 2]);
  });
  return end;
}

/** Deep drone: sine + octave triangle + a dark saw, very slow filter breathing. */
function drone(kit, out, t, e, sd) {
  const { ctx } = kit;
  const hold = e.len * sd;
  const a = e.attack ?? 3;
  const r = e.release ?? 4;
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.3 * e.vel, { a, d: 0, s: 1, r }, hold);
  const lp = filter(ctx, 'lowpass', 180, 1.2);
  lp.frequency.setValueAtTime(170, t);
  lp.frequency.linearRampToValueAtTime(330, t + hold * 0.5);
  lp.frequency.linearRampToValueAtTime(170, t + hold + r);
  const per = 1 / Math.sqrt(e.notes.length);
  for (const m of e.notes) {
    const f = mtof(m);
    const s = osc(ctx, 'sine', f, t, end);
    const tr = osc(ctx, 'triangle', f * 2, t, end, 3);
    const sw = osc(ctx, 'sawtooth', f, t, end, -4);
    const gs = gainNode(ctx, 0.55 * per);
    const gt = gainNode(ctx, 0.14 * per);
    const gw = gainNode(ctx, 0.16 * per);
    s.connect(gs).connect(lp);
    tr.connect(gt).connect(lp);
    sw.connect(gw).connect(lp);
  }
  lp.connect(g).connect(out.in);
  return end;
}

/** Soft organ-flute note for the repeating figure. */
function oarp(kit, out, t, e, sd) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.75 * e.vel, { a: 0.025, d: 0.35, s: 0.55, r: 0.3 }, e.len * sd);
  const lp = filter(ctx, 'lowpass', 2200, 0.5);
  const tri = osc(ctx, 'triangle', f, t, end);
  const s2 = osc(ctx, 'sine', f * 2, t, end);
  const g2 = gainNode(ctx, 0.3);
  tri.connect(lp);
  s2.connect(g2).connect(lp);
  lp.connect(g).connect(e.notes[0] % 2 ? out.inR : out.inL);
  return end;
}

/** Airy pad: two detuned saws per note spread left / right through a soft low-pass. */
function pad(kit, out, t, e, sd) {
  const { ctx } = kit;
  const hold = e.len * sd;
  const a = e.attack ?? 1;
  const r = e.release ?? 2;
  const cut = e.cutoff ?? 1400;
  const per = 0.4 / Math.sqrt(e.notes.length);
  const { sides, end } = stereoChains(
    ctx,
    out,
    () => {
      const lp = filter(ctx, 'lowpass', cut * 0.5, 0.6);
      lp.frequency.setValueAtTime(cut * 0.5, t);
      lp.frequency.linearRampToValueAtTime(cut, t + a);
      lp.frequency.linearRampToValueAtTime(cut * 0.7, t + Math.max(hold, a) + r);
      return lp;
    },
    (param) => adsr(param, t, e.vel, { a, d: 0, s: 1, r }, hold),
  );
  for (const m of e.notes) {
    const f = mtof(m);
    for (let k = 0; k < 2; k++) {
      const o = osc(ctx, 'sawtooth', f, t, end, k ? 9 : -9);
      const g = gainNode(ctx, per);
      o.connect(g).connect(sides[k]);
    }
  }
  return end;
}

/** Sustained sine sub bass. */
function sub(kit, out, t, e, sd) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.27 * e.vel, { a: 0.06, d: 0.8, s: 0.7, r: 0.5 }, e.len * sd);
  const s = osc(ctx, 'sine', f, t, end);
  const tri = osc(ctx, 'triangle', f, t, end);
  const tg = gainNode(ctx, 0.2);
  s.connect(g);
  tri.connect(tg).connect(g);
  g.connect(out.in);
  return end;
}

/** Shimmering air: band-passed noise sweeping slowly, decorrelated left / right. */
function air(kit, out, t, e, sd) {
  const { ctx } = kit;
  const hold = e.len * sd;
  const { sides, end } = stereoChains(
    ctx,
    out,
    () => {
      const bp = filter(ctx, 'bandpass', 2600, 0.9);
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.linearRampToValueAtTime(5600, t + hold * 0.5);
      bp.frequency.linearRampToValueAtTime(3000, t + hold + 2);
      return bp;
    },
    (param) => adsr(param, t, 0.26 * e.vel, { a: 1.6, d: 0, s: 1, r: 2 }, hold),
  );
  for (const side of sides) noise(kit, t, end).connect(side);
  return end;
}

/** Glassy FM bell for the arpeggios. */
function bell(kit, out, t, e) {
  const { ctx } = kit;
  const m = e.notes[0];
  const f = mtof(m);
  const g = gainNode(ctx);
  const end = perc(g.gain, t, 0.7 * e.vel, 0.003, 1.0);
  const car = osc(ctx, 'sine', f, t, end);
  const mod = osc(ctx, 'sine', f * 2, t, end);
  const mg = gainNode(ctx);
  mg.gain.setValueAtTime(f * 1.1, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.04, t + 0.3);
  mod.connect(mg).connect(car.frequency);
  car.connect(g).connect(m % 2 ? out.inR : out.inL);
  return end;
}

/** Tiny high glint (inharmonic partials). */
function glint(kit, out, t, e) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const g = gainNode(ctx);
  const end = perc(g.gain, t, 0.36 * e.vel, 0.002, 1.2);
  const a = osc(ctx, 'sine', f, t, end);
  const b = osc(ctx, 'sine', f * 2.76, t, end);
  const bg = gainNode(ctx, 0.35);
  a.connect(g);
  b.connect(bg).connect(g);
  g.connect(out.inR);
  return end;
}

/** Deep-house bass: two detuned saws + a sine through a resonant low-pass with a quick filter blip. */
function hbass(kit, out, t, e, sd) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const cut = e.cutoff ?? 500;
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.5 * e.vel, { a: 0.004, d: 0.25, s: 0.55, r: 0.07 }, e.len * sd);
  const lp = filter(ctx, 'lowpass', cut, 3.5);
  lp.frequency.setValueAtTime(cut * 3, t);
  lp.frequency.exponentialRampToValueAtTime(cut, t + 0.12);
  const sg = gainNode(ctx, 0.36);
  for (const det of [-6, 6]) osc(ctx, 'sawtooth', f, t, end, det).connect(sg);
  sg.connect(lp);
  const s = osc(ctx, 'sine', f, t, end);
  const ssg = gainNode(ctx, 0.35);
  s.connect(ssg).connect(lp);
  lp.connect(g).connect(out.in);
  return end;
}

/** Short filtered chord stab (deep-house minor 9th). */
function stab(kit, out, t, e) {
  const { ctx } = kit;
  const cut = e.cutoff ?? 1600;
  const per = 0.9 / Math.sqrt(e.notes.length);
  const { sides, end } = stereoChains(
    ctx,
    out,
    () => {
      const lp = filter(ctx, 'lowpass', cut, 2);
      lp.frequency.setValueAtTime(cut * 1.6, t);
      lp.frequency.exponentialRampToValueAtTime(cut * 0.45, t + 0.25);
      return lp;
    },
    (param) => perc(param, t, e.vel, 0.003, 0.48),
  );
  e.notes.forEach((m, j) => {
    const o = osc(ctx, 'sawtooth', mtof(m), t, end, j % 2 ? 5 : -5);
    const g = gainNode(ctx, per);
    o.connect(g).connect(sides[j % 2]);
  });
  return end;
}

/** Playful pluck: triangle + a little square with a fast closing filter. */
function pluck(kit, out, t, e, sd) {
  const { ctx } = kit;
  const per = 1 / Math.sqrt(e.notes.length);
  let last = t;
  e.notes.forEach((m, j) => {
    const f = mtof(m);
    const g = gainNode(ctx);
    const end = adsr(g.gain, t, 0.75 * e.vel * per, { a: 0.004, d: 0.5, s: 0, r: 0.08 }, e.len * sd);
    const lp = filter(ctx, 'lowpass', 2800, 1.4);
    lp.frequency.setValueAtTime(2900, t);
    lp.frequency.exponentialRampToValueAtTime(750, t + 0.14);
    const tri = osc(ctx, 'triangle', f, t, end);
    const sq = osc(ctx, 'square', f, t, end, 4);
    const sg = gainNode(ctx, 0.22);
    tri.connect(lp);
    sq.connect(sg).connect(lp);
    lp.connect(g).connect(j % 2 || m % 2 ? out.inR : out.inL);
    last = Math.max(last, end);
  });
  return last;
}

/** Bouncy bass: triangle + sine with a tiny downward pitch blip. */
function bbass(kit, out, t, e, sd) {
  const { ctx } = kit;
  const f = mtof(e.notes[0]);
  const g = gainNode(ctx);
  const end = adsr(g.gain, t, 0.25 * e.vel, { a: 0.01, d: 0.22, s: 0.35, r: 0.06 }, e.len * sd);
  const lp = filter(ctx, 'lowpass', 1300, 1);
  for (const type of ['triangle', 'sine']) {
    const o = osc(ctx, type, f, t, end);
    o.frequency.setValueAtTime(f * 1.04, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    o.connect(lp);
  }
  lp.connect(g).connect(out.in);
  return end;
}

export const INSTRUMENTS = {
  kick,
  softkick: (kit, out, t, e, sd) => kick(kit, out, t, { ...e, soft: 1 }, sd),
  hat,
  chat: (kit, out, t, e, sd) => hat(kit, out, t, { ...e, closed: 1 }, sd),
  brush,
  clap,
  shaker,
  tick,
  vinyl,
  keys,
  bass,
  organ,
  drone,
  oarp,
  pad,
  sub,
  air,
  bell,
  glint,
  hbass,
  stab,
  pluck,
  comp: pluck,
  bbass,
};
