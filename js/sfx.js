// sfx.js — every sound is synthesized with WebAudio (no audio files).
// Browsers only allow audio after a tap/click, so unlock() runs on START.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.loops = new Map();
    this._noise = null;
    try { this.enabled = localStorage.getItem('bv.sound') !== 'off'; } catch (e) { /* storage blocked */ }
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.6 : 0;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* audio unavailable */ }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('bv.sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.05);
    if (!on) for (const id of [...this.loops.keys()]) this.stopLoop(id);
  }

  noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 1.5;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  // Generic helpers -----------------------------------------------------
  _env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.3, attack = 0.005, delay = 0 } = {}) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this._env(g, t, attack, vol, dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, attack = 0.003, delay = 0 } = {}) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this._env(g, t, attack, vol, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + attack + dur + 0.05);
  }

  // Named effects -------------------------------------------------------
  play(name, opts = {}) {
    const fn = this['_' + name];
    if (fn && this.ready && this.enabled) fn.call(this, opts);
  }

  _hover() { this.tone({ type: 'sine', f0: 1400, f1: 1800, dur: 0.05, vol: 0.05 }); }
  _select() {
    this.tone({ type: 'triangle', f0: 660, f1: 990, dur: 0.12, vol: 0.18 });
    this.tone({ type: 'sine', f0: 1320, f1: 1980, dur: 0.18, vol: 0.12, delay: 0.06 });
  }
  _mode() {
    this.noise({ dur: 0.35, vol: 0.18, type: 'bandpass', f0: 400, f1: 4000, q: 2 });
    this.tone({ type: 'sawtooth', f0: 110, f1: 440, dur: 0.3, vol: 0.08 });
  }
  _thwip() {
    this.noise({ dur: 0.16, vol: 0.5, type: 'bandpass', f0: 5000, f1: 900, q: 4 });
    this.tone({ type: 'square', f0: 1800, f1: 300, dur: 0.08, vol: 0.06 });
  }
  _splat() { this.noise({ dur: 0.12, vol: 0.25, type: 'lowpass', f0: 1800, f1: 200, q: 1 }); }
  _whoosh() { this.noise({ dur: 0.45, vol: 0.25, type: 'bandpass', f0: 300, f1: 2600, q: 1.5, attack: 0.08 }); }
  _blast() {
    this.noise({ dur: 0.7, vol: 0.7, type: 'lowpass', f0: 6000, f1: 120, q: 0.7 });
    this.tone({ type: 'sawtooth', f0: 220, f1: 40, dur: 0.6, vol: 0.25 });
    this.tone({ type: 'sine', f0: 1600, f1: 3200, dur: 0.15, vol: 0.12 });
  }
  _spark() { this.noise({ dur: 0.08, vol: 0.12, type: 'highpass', f0: 3000 + Math.random() * 3000, q: 0.5 }); }
  _portal() {
    this.noise({ dur: 1.2, vol: 0.35, type: 'bandpass', f0: 200, f1: 1800, q: 3, attack: 0.15 });
    this.tone({ type: 'sawtooth', f0: 55, f1: 110, dur: 1.0, vol: 0.12, attack: 0.1 });
  }
  _shutter() {
    this.noise({ dur: 0.05, vol: 0.4, type: 'highpass', f0: 2000 });
    this.noise({ dur: 0.07, vol: 0.3, type: 'highpass', f0: 1500, delay: 0.08 });
  }
  _pop() { this.tone({ type: 'sine', f0: 300, f1: 900, dur: 0.08, vol: 0.2 }); }
  _error() { this.tone({ type: 'square', f0: 200, f1: 120, dur: 0.18, vol: 0.12 }); }

  // Sustained loop whose pitch/volume a mode can drive every frame.
  // id: any key. level: 0..1. Returns nothing; call stopLoop(id) to end.
  loop(id, level, { type = 'sawtooth', base = 80, range = 240, vol = 0.18, filter = 900 } = {}) {
    if (!this.ready || !this.enabled) return;
    const c = this.ctx;
    let L = this.loops.get(id);
    if (!L) {
      const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = type; o2.type = 'sine';
      f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = 6;
      g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g).connect(this.master);
      o.start(); o2.start();
      L = { o, o2, f, g };
      this.loops.set(id, L);
    }
    const t = c.currentTime;
    L.o.frequency.setTargetAtTime(base + range * level, t, 0.05);
    L.o2.frequency.setTargetAtTime((base + range * level) * 2.01, t, 0.05);
    L.f.frequency.setTargetAtTime(filter + 2400 * level, t, 0.05);
    L.g.gain.setTargetAtTime(vol * Math.min(1, level * 1.5), t, 0.05);
  }

  stopLoop(id) {
    const L = this.loops.get(id);
    if (!L) return;
    this.loops.delete(id);
    const t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(0, t, 0.05);
    L.o.stop(t + 0.3); L.o2.stop(t + 0.3);
  }

  stopAllLoops() { for (const id of [...this.loops.keys()]) this.stopLoop(id); }
}
