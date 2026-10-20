// Small pure helpers shared by the sound code: seeded random numbers, pitch maths and
// generated sample data (noise, vinyl crackle, reverb impulse). No Web Audio here, so
// everything in this file runs (and is unit-tested) in Node too.

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'F#2' → 42, 'Bb3' → 58. Numbers pass through. */
export function note(name) {
  if (typeof name === 'number') return name;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name ${name}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + acc;
}

/** Small, fast, deterministic PRNG (returns floats in [0, 1)). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix any number of strings / integers into one 32-bit seed (FNV-1a style). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f; // separator so ('ab','c') != ('a','bc')
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform white noise in [-1, 1]. */
export function whiteNoise(length, seed = 1) {
  const rng = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/**
 * Lo-fi record texture: very quiet warm hiss plus sparse soft crackles.
 * Peak about 0.5, RMS about 0.03, no DC.
 */
export function vinylNoise(sampleRate, seconds = 4, seed = 3) {
  const n = Math.max(1, Math.round(sampleRate * seconds));
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  // Warm hiss: low-passed noise.
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 3500) / sampleRate);
  for (let i = 0; i < n; i++) {
    lp = lp * a + (rng() * 2 - 1) * (1 - a);
    out[i] = lp * 0.12;
  }
  // Crackles: a few per second, each a tiny decaying ring of alternating sign.
  const crackles = Math.round(seconds * 7);
  for (let c = 0; c < crackles; c++) {
    const at = Math.floor(rng() * (n - 64));
    const amp = (0.12 + rng() * rng() * 0.45) * (rng() < 0.5 ? -1 : 1);
    const len = 6 + Math.floor(rng() * 24);
    for (let k = 0; k < len; k++) out[at + k] += amp * Math.exp(-k / (len * 0.25)) * (k % 2 ? -0.6 : 1);
  }
  removeDc(out);
  // Fade the loop ends so a buffer that starts / stops never clicks.
  const f = Math.min(n >> 1, Math.round(sampleRate * 0.01));
  for (let i = 0; i < f; i++) {
    out[i] *= i / f;
    out[n - 1 - i] *= i / f;
  }
  return out;
}

export function removeDc(data) {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length || 1;
  for (let i = 0; i < data.length; i++) data[i] -= mean;
  return data;
}

/**
 * Stereo reverb impulse response: decorrelated noise with an exponential decay
 * (`decay` = seconds to fall 60 dB), getting darker over time like a real room,
 * a short pre-delay and a soft onset. Each channel is normalised to unit energy, so
 * a send at gain g gives a wet signal about as loud as the dry one times g.
 * @returns {[Float32Array, Float32Array]}
 */
export function makeImpulse(sampleRate, seconds = 2.6, { decay = 2.4, predelay = 0.015, seed = 11 } = {}) {
  const n = Math.max(2, Math.round(sampleRate * seconds));
  const pre = Math.round(sampleRate * predelay);
  const channels = [];
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(seed * 31 + ch * 7 + 1);
    const out = new Float32Array(n);
    let lp = 0;
    let c = 0;
    let comp = 1;
    let env = 1;
    const fall = Math.pow(10, -3 / (decay * sampleRate)); // per-sample decay factor
    const fadeIn = Math.max(1, Math.round(sampleRate * 0.006));
    for (let i = pre; i < n; i++) {
      const k = i - pre;
      if (k % 32 === 0) {
        // Damping: the one-pole low-pass closes from ~11 kHz to ~1.5 kHz across the tail
        // (updated every 32 samples: cheap, and smooth enough).
        const cutoff = 11000 * Math.pow(1500 / 11000, Math.min(1, k / sampleRate / seconds));
        c = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
        // The low-pass loses level as it closes; compensate so the decay stays exponential.
        comp = Math.sqrt((1 + c) / Math.max(1e-6, 1 - c));
      }
      lp = lp * c + (rng() * 2 - 1) * (1 - c);
      out[i] = lp * comp * env * (k < fadeIn ? k / fadeIn : 1);
      env *= fall;
    }
    removeDc(out);
    // Fade the very end to exactly zero.
    const tail = Math.min(n >> 2, Math.round(sampleRate * 0.05));
    for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
    let e = 0;
    for (let i = 0; i < n; i++) e += out[i] * out[i];
    const k = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) out[i] *= k;
    channels.push(out);
  }
  return channels;
}
