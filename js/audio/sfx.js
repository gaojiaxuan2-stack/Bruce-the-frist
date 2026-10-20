// Gesture / UI sound effects, all synthesised: short, soft, in the key of the music.
// Each name is rate-limited so a burst of events can't stack into noise, and the
// number of effects sounding at once is capped.

import { clamp, mtof } from './dsp.js';
import { adsr, perc } from './instruments.js';

/** Minimum time between two plays of the same effect (seconds). */
export const MIN_GAP = { click: 0.06, whoosh: 0.15, chime: 0.25, boom: 0.25, pop: 0.07, morph: 0.4, sparkle: 0.09 };
const MAX_VOICES = 10;
const REVERB_SEND = { click: 0.04, pop: 0.08, whoosh: 0.15, chime: 0.35, boom: 0.35, morph: 0.3, sparkle: 0.35 };

export class SfxPlayer {
  /** @param {import('./graph.js').AudioGraph} graph */
  constructor(graph) {
    this.graph = graph;
    this.ctx = graph.ctx;
    this.last = {};
    this.ends = [];
    this.played = 0;
    this.dropped = 0;
  }

  /** Can `name` play at audio time t? (rate limit + voice cap) */
  allow(name, t) {
    const gap = MIN_GAP[name] ?? 0.08;
    if (t - (this.last[name] ?? -Infinity) < gap) return false;
    this.ends = this.ends.filter((e) => e > t);
    if (this.ends.length >= MAX_VOICES) return false;
    return true;
  }

  /**
   * @param {string} name
   * @param {{intensity?: number, pan?: number}} opts
   * @param {{root?: number, scale?: number[]}} key musical key of the current mood
   * @returns {boolean} whether it played
   */
  play(name, opts = {}, key = {}) {
    const fn = SFX[name];
    if (!fn) return false;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    if (!this.allow(name, t)) {
      this.dropped++;
      return false;
    }
    this.last[name] = t;
    const intensity = clamp(Number.isFinite(opts.intensity) ? opts.intensity : 0.6);
    const pan = Number.isFinite(opts.pan) ? clamp(opts.pan, -1, 1) : null;
    const voice = this.voice(pan ?? 0, REVERB_SEND[name] ?? 0.2);
    const end = fn(this.graph, voice, t, { intensity, pan, root: key.root ?? 62, scale: key.scale ?? [0, 2, 4, 7, 9] });
    this.ends.push(end);
    this.played++;
    if (name === 'boom') this.graph.duckMusic(0.3 + 0.3 * intensity, 0.15, 0.8);
    // Disconnect the voice's output nodes once it is silent.
    const ms = Math.max(0, (end - ctx.currentTime) * 1000 + 3000);
    setTimeout(() => voice.release(), ms);
    return true;
  }

  /** Per-effect output: gain → stereo pan → sfx bus, plus a reverb send. */
  voice(pan, wet) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 1;
    let p = null;
    if (ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.graph.sfxBus);
    } else g.connect(this.graph.sfxBus);
    const send = ctx.createGain();
    send.gain.value = wet;
    g.connect(send).connect(this.graph.sfxWet);
    return {
      in: g,
      pan: p ? p.pan : null,
      release() {
        for (const n of [g, p, send]) {
          try {
            n?.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }
}

// ---------------------------------------------------------------- the effects

function noiseSource(graph, t, end, rate = 1) {
  const s = graph.ctx.createBufferSource();
  s.buffer = graph.kit.noise;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, (t * 5.13) % 1.5);
  s.stop(end);
  return s;
}

function o(ctx, type, f, t, end) {
  const n = ctx.createOscillator();
  n.type = type;
  n.frequency.value = f;
  n.start(t);
  n.stop(end);
  return n;
}

function g(ctx, v = 0) {
  const n = ctx.createGain();
  n.gain.value = v;
  return n;
}

function bq(ctx, type, f, q = 0.7) {
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

/** Notes of the mood's scale around `octaveRoot`, ascending. */
function scaleNotes(root, scale, from, count) {
  const out = [];
  for (let m = from; out.length < count && m < from + 48; m++) if (scale.includes((((m - root) % 12) + 12) % 12)) out.push(m);
  return out;
}

export const SFX = {
  /** Soft wooden tick for buttons. */
  click(graph, v, t, { intensity }) {
    const ctx = graph.ctx;
    const a = g(ctx);
    const end = perc(a.gain, t, 0.5 * (0.4 + 0.6 * intensity), 0.0015, 0.045);
    const s = o(ctx, 'sine', 1500, t, end);
    s.frequency.setValueAtTime(1500, t);
    s.frequency.exponentialRampToValueAtTime(950, t + 0.03);
    s.connect(a).connect(v.in);
    const n = noiseSource(graph, t, t + 0.03);
    const bp = bq(ctx, 'bandpass', 3800, 3);
    const b = g(ctx);
    perc(b.gain, t, 0.15 * intensity, 0.0008, 0.012);
    n.connect(bp).connect(b).connect(v.in);
    return end;
  },

  /** Filtered noise sweep; moves left → right (or by `pan` direction). */
  whoosh(graph, v, t, { intensity, pan }) {
    const ctx = graph.ctx;
    const dur = 0.45 + 0.25 * intensity;
    const a = g(ctx);
    const peak = 0.42 * (0.5 + 0.5 * intensity);
    a.gain.setValueAtTime(0, t);
    a.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    a.gain.linearRampToValueAtTime(0, t + dur + 0.01);
    const end = t + dur + 0.02;
    const n = noiseSource(graph, t, end);
    const bp = bq(ctx, 'bandpass', 350, 1.4);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2600 + 1400 * intensity, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(700, t + dur);
    n.connect(bp).connect(a).connect(v.in);
    if (v.pan) {
      const dir = pan == null ? 1 : Math.sign(pan) || 1;
      const width = pan == null ? 0.6 : Math.min(0.9, 0.4 + Math.abs(pan) * 0.5);
      v.pan.setValueAtTime(-dir * width, t);
      v.pan.linearRampToValueAtTime(dir * width, t + dur);
    }
    return end;
  },

  /** Bell-like FM chime: three notes going up, in the key of the music. */
  chime(graph, v, t, { intensity, root, scale }) {
    const ctx = graph.ctx;
    const notes = scaleNotes(root, scale, root + 12, 6);
    const seq = [notes[0], notes[2], notes[4]];
    let end = t;
    seq.forEach((m, k) => {
      const tt = t + k * 0.085;
      const f = mtof(m);
      const a = g(ctx);
      const e = perc(a.gain, tt, (0.13 + 0.07 * intensity) * (k === 2 ? 1.1 : 1), 0.003, 1.4);
      const car = o(ctx, 'sine', f, tt, e);
      const mod = o(ctx, 'sine', f * 3.5, tt, e);
      const mg = g(ctx);
      mg.gain.setValueAtTime(f * 1.4, tt);
      mg.gain.exponentialRampToValueAtTime(f * 0.05, tt + 0.6);
      mod.connect(mg).connect(car.frequency);
      car.connect(a).connect(v.in);
      end = Math.max(end, e);
    });
    return end;
  },

  /** Sub thump + noise burst + reverb tail; intensity scales size. */
  boom(graph, v, t, { intensity }) {
    const ctx = graph.ctx;
    const size = 0.5 + 0.5 * intensity;
    const a = g(ctx);
    const end = perc(a.gain, t, 0.55 * size, 0.004, 0.7 + 0.6 * intensity);
    const s = o(ctx, 'sine', 95, t, end);
    s.frequency.setValueAtTime(95, t);
    s.frequency.exponentialRampToValueAtTime(34, t + 0.35 + 0.2 * intensity);
    s.connect(a).connect(v.in);
    // Body an octave up, so the thump is heard on small speakers too.
    const h = o(ctx, 'triangle', 220, t, t + 0.4);
    h.frequency.setValueAtTime(220, t);
    h.frequency.exponentialRampToValueAtTime(80, t + 0.25);
    const hg = g(ctx);
    perc(hg.gain, t, 0.38 * size, 0.003, 0.32);
    h.connect(hg).connect(v.in);
    const nEnd = t + 0.5 + 0.5 * intensity;
    const n = noiseSource(graph, t, nEnd, 0.7);
    const lp = bq(ctx, 'lowpass', 900 + 2200 * intensity, 0.7);
    lp.frequency.setValueAtTime(900 + 2200 * intensity, t);
    lp.frequency.exponentialRampToValueAtTime(200, nEnd);
    const b = g(ctx);
    perc(b.gain, t, 0.6 * size, 0.003, 0.4 + 0.4 * intensity);
    n.connect(lp).connect(b).connect(v.in);
    return Math.max(end, nEnd);
  },

  /** Bubble pop: quick upward blip. */
  pop(graph, v, t, { intensity }) {
    const ctx = graph.ctx;
    const base = 380 + 260 * Math.random();
    const a = g(ctx);
    const end = perc(a.gain, t, 0.65 * (0.5 + 0.5 * intensity), 0.002, 0.08);
    const s = o(ctx, 'sine', base, t, end);
    s.frequency.setValueAtTime(base, t);
    s.frequency.exponentialRampToValueAtTime(base * 2.6, t + 0.045);
    s.connect(a).connect(v.in);
    return end;
  },

  /** Rising shimmer sweep (~0.8 s) for shape changes. */
  morph(graph, v, t, { intensity, root }) {
    const ctx = graph.ctx;
    const dur = 0.8;
    const f0 = mtof(root);
    const out = g(ctx);
    const end = adsr(out.gain, t, 0.4 * (0.6 + 0.4 * intensity), { a: 0.35, d: 0, s: 1, r: 0.4 }, dur - 0.4);
    const bp = bq(ctx, 'bandpass', 500, 2.5);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    for (const [ratio, det] of [[1, -8], [1.5, 6], [2, 0]]) {
      const s = o(ctx, 'sawtooth', f0 * ratio, t, end);
      s.detune.value = det;
      s.frequency.setValueAtTime(f0 * ratio, t);
      s.frequency.exponentialRampToValueAtTime(f0 * ratio * 2, t + dur);
      const sg = g(ctx, 0.33);
      s.connect(sg).connect(bp);
    }
    bp.connect(out).connect(v.in);
    // Glints along the way.
    for (let k = 0; k < 4; k++) {
      const tt = t + 0.15 + k * 0.16;
      const f = f0 * 4 * Math.pow(2, k / 4);
      const a = g(ctx);
      const e = perc(a.gain, tt, 0.1 * (0.6 + 0.4 * intensity), 0.002, 0.25);
      o(ctx, 'sine', f, tt, e).connect(a).connect(v.in);
    }
    return end;
  },

  /** A few tiny high glints in the key of the music. */
  sparkle(graph, v, t, { intensity, root, scale }) {
    const ctx = graph.ctx;
    const notes = scaleNotes(root, scale, root + 24, 8);
    const count = 3 + Math.round(2 * intensity);
    let end = t;
    for (let k = 0; k < count; k++) {
      const tt = t + k * (0.03 + 0.03 * Math.random());
      const m = notes[Math.floor(Math.random() * notes.length)];
      const a = g(ctx);
      const e = perc(a.gain, tt, 0.13 * (0.5 + 0.5 * intensity), 0.0015, 0.14 + 0.08 * Math.random());
      const s = o(ctx, 'sine', mtof(m), tt, e);
      s.connect(a).connect(v.in);
      end = Math.max(end, e);
    }
    return end;
  },
};

/**
 * The "charging" hum while a fist gathers particles: one persistent voice of detuned
 * oscillators through a low-pass that opens (and a pitch that rises a little) with the
 * level, with a slow wobble. Level 0 fades it out; it stops itself after a quiet second.
 */
export class ChargeHum {
  constructor(graph) {
    this.graph = graph;
    this.ctx = graph.ctx;
    this.voice = null;
    this.level = 0;
    this.sent = -1;
    this.quietSince = null;
  }

  set(level, root = 57) {
    const ctx = this.ctx;
    const lv = clamp(Number(level) || 0);
    this.level = lv;
    const t = ctx.currentTime;
    if (lv > 0.001 && !this.voice) this.voice = this.build(root, t);
    const v = this.voice;
    if (!v) return;
    if (Math.abs(lv - this.sent) < 0.01 && !(lv === 0 && this.sent !== 0)) return;
    this.sent = lv;
    const tau = lv > 0 ? 0.08 : 0.15;
    const p = (param, value) => {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(value, t, tau);
    };
    p(v.out.gain, 0.1 * Math.pow(lv, 0.8));
    p(v.lp.frequency, 160 + 2000 * Math.pow(lv, 1.5));
    p(v.lp.Q, 2 + 5 * lv);
    for (const d of v.detunes) p(d.param, d.base + 500 * lv);
    p(v.lfo.frequency, 3 + 6 * lv);
    p(v.lfoDepth.gain, 40 + 260 * lv);
  }

  build(root, t) {
    const ctx = this.ctx;
    const f = mtof(root - 12);
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    lp.Q.value = 2;
    lp.connect(out).connect(this.graph.sfxBus);
    const send = ctx.createGain();
    send.gain.value = 0.15;
    out.connect(send).connect(this.graph.sfxWet);
    const oscs = [];
    const detunes = [];
    for (const [type, ratio, det, lvl] of [['sawtooth', 1, -7, 0.45], ['sawtooth', 1, 7, 0.45], ['sine', 0.5, 0, 0.2], ['triangle', 1.5, 3, 0.2]]) {
      const n = ctx.createOscillator();
      n.type = type;
      n.frequency.value = f * ratio;
      n.detune.value = det;
      const gg = ctx.createGain();
      gg.gain.value = lvl;
      n.connect(gg).connect(lp);
      n.start(t);
      oscs.push(n);
      detunes.push({ param: n.detune, base: det });
    }
    // Wobble: an LFO on the filter cutoff.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 40;
    lfo.connect(lfoDepth).connect(lp.frequency);
    lfo.start(t);
    oscs.push(lfo);
    this.sent = -1;
    return { out, lp, send, oscs, detunes, lfo, lfoDepth, gains: [] };
  }

  /** Per frame: stop the voice after it has been silent for a second. */
  update(now) {
    if (!this.voice) return;
    if (this.level > 0.001) {
      this.quietSince = null;
      return;
    }
    if (this.quietSince === null) this.quietSince = now;
    else if (now - this.quietSince > 1.2) this.stop();
  }

  stop() {
    const v = this.voice;
    if (!v) return;
    const t = this.ctx.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.03);
    for (const n of v.oscs) n.stop(t + 0.25);
    setTimeout(() => {
      for (const n of [v.out, v.lp, v.send, v.lfoDepth]) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 400);
    this.voice = null;
    this.quietSince = null;
    this.sent = -1;
    this.level = 0;
  }
}
