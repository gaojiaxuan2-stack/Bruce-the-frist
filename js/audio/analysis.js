// Music analysis for the particles: band levels from an AnalyserNode spectrum, a level
// normaliser (quiet and loud songs both use 0..1) and an onset/beat detector for songs
// and the microphone (bass-band spectral flux + adaptive threshold + refractory time).
// Everything here is pure maths over arrays, unit-tested in Node.

import { clamp } from './dsp.js';

/** AnalyserNode byte range (getByteFrequencyData maps minDb..maxDb onto 0..255). */
export const ANALYSER_MIN_DB = -100;
export const ANALYSER_MAX_DB = -10;

export const BANDS = {
  level: [30, 12000],
  bass: [30, 180],
  mid: [180, 2000],
  treble: [2000, 12000],
};
/** Bins used for the kick / beat detector: the kick's punch, above most sub-bass notes. */
export const BEAT_BAND = [80, 190];

/**
 * Share of the music's energy (dB, band energy / total energy) at which a band reads as
 * absent → fully present. Treble is naturally ~15 dB below the rest in any music.
 */
export const PRESENCE = { bass: [-26, -12], mid: [-30, -16], treble: [-42, -28] };

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Share of the total energy in a band, in dB (0 = all of it). `db` holds bandDb() per band. */
export function bandShare(name, db, ranges) {
  const [f, t] = ranges[name];
  const [lf, lt] = ranges.level;
  return db[name] - db.level + 10 * Math.log10((t - f) / (lt - lf));
}

/**
 * 0..1: how much a band takes part in the music right now. A band far quieter than the
 * rest of the mix (a house track's mids, the treble between two hi-hats) reads low
 * instead of being stretched over the whole 0..1 range by its normaliser.
 */
export function bandPresence(name, db, ranges) {
  const p = PRESENCE[name];
  if (!p) return 1;
  return smoothstep(p[0], p[1], bandShare(name, db, ranges));
}

/** One normaliser per band (bass and treble are snappier: kicks and hats). */
export function makeBandNormalizers() {
  return {
    level: new LevelNormalizer(),
    bass: new LevelNormalizer({ attack: 0.012, release: 0.16 }),
    mid: new LevelNormalizer(),
    treble: new LevelNormalizer({ attack: 0.012, release: 0.14 }),
  };
}

/** byte (0..255) → linear power, 0 for byte 0 (silence). */
export function makePowerTable(minDb = ANALYSER_MIN_DB, maxDb = ANALYSER_MAX_DB) {
  const t = new Float32Array(256);
  for (let i = 1; i < 256; i++) t[i] = Math.pow(10, (minDb + (i / 255) * (maxDb - minDb)) / 10);
  return t;
}

/** [fromHz, toHz] → [firstBin, lastBin + 1), at least one bin, never the DC bin. */
export function binRange(sampleRate, fftSize, fromHz, toHz) {
  const binHz = sampleRate / fftSize;
  const n = fftSize / 2;
  const from = Math.min(n - 1, Math.max(1, Math.round(fromHz / binHz)));
  const to = Math.min(n, Math.max(from + 1, Math.round(toHz / binHz) + 1));
  return [from, to];
}

/** Mean power of bins [from, to) in dB (≈ -120 for silence). */
export function bandDb(bytes, from, to, powerTable) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += powerTable[bytes[i]];
  return 10 * Math.log10(sum / (to - from) + 1e-12);
}

/**
 * Positive spectral flux of bins [from, to): mean rise since the previous frame, in
 * analyser bytes (a byte is (maxDb-minDb)/255 ≈ 0.35 dB). Rises only, so a note that
 * fades out does not count, but a new kick does.
 */
export function spectralFlux(bytes, prev, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const d = bytes[i] - prev[i];
    if (d > 0) sum += d;
  }
  return sum / (to - from);
}

/** Frame-rate independent one-pole smoothing factor for time constant tau (s). */
export const smoothK = (dt, tau) => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));

/**
 * Turns a band level in dB into a smooth 0..1 value that uses the whole range for any
 * song, quiet or loud:
 * - `avg` follows the band's typical level and maps to `mid`. It rises faster (`avgUp` s)
 *   than it falls (`avgTau` s), so a sudden louder passage (a new scene, a drop) is
 *   learnt within about a second instead of pinning the output at 1;
 * - `peak` follows its recent maxima (rises within ~0.1 s, falls `peakFall` dB/s) and
 *   maps to 1, so kicks and accents reach the top;
 * - `below` dB under the average maps to 0, and under the gate (silence) it is 0. The
 *   gate has hysteresis (opens above `gate` + `hyst`/2, closes below `gate` - `hyst`/2) so
 *   a band hovering at the noise floor does not flicker;
 * - `presence` (0..1, per frame) scales the result, so a band with almost no content
 *   reads low instead of being stretched over the whole range.
 * After `reset()` / `reseed()` it "warms up" for `warmup` seconds of sound: the average
 * and the peak adapt quickly (`warmTau`), so the first seconds of a song, a scene or a
 * source are already in range.
 * The output rises fast (`attack`) and falls slower (`release`): punchy, not jittery.
 */
export class LevelNormalizer {
  constructor({
    attack = 0.025,
    release = 0.22,
    mid = 0.42,
    below = 18,
    minSpread = 4,
    avgTau = 2.5,
    avgUp = 0.6,
    peakRise = 0.08,
    peakFall = 3,
    gate = -85,
    hyst = 6,
    warmup = 1.5,
    warmTau = 0.3,
  } = {}) {
    Object.assign(this, { attack, release, mid, below, minSpread, avgTau, avgUp, peakRise, peakFall, gate, hyst, warmup, warmTau });
    this.reset();
  }

  reset() {
    this.avg = null;
    this.peak = null;
    this.value = 0;
    this.open = false;
    this.warm = this.warmup;
  }

  /** The music changed (scene, source): keep the current output but re-learn the range quickly. */
  reseed() {
    this.warm = this.warmup;
  }

  /** Is `db` above the gate? (with hysteresis) */
  audible(db) {
    const h = this.hyst / 2;
    this.open = db > (this.open ? this.gate - h : this.gate + h);
    return this.open;
  }

  /** Target for this frame (before smoothing). */
  target(db) {
    if (!this.open || this.avg === null) return 0;
    if (db >= this.avg) return clamp(this.mid + ((1 - this.mid) * (db - this.avg)) / Math.max(this.peak - this.avg, this.minSpread));
    return clamp(this.mid * (1 - (this.avg - db) / this.below));
  }

  update(db, dt, presence = 1) {
    if (this.audible(db)) {
      const warming = this.warm > 0;
      if (this.avg === null) {
        this.avg = db;
        this.peak = db;
      }
      if (db > this.peak) this.peak += (db - this.peak) * smoothK(dt, this.peakRise);
      else this.peak = Math.max(this.avg, this.peak - this.peakFall * (warming ? 4 : 1) * dt);
      const goal = Math.max(db, this.avg - this.below);
      const tau = warming ? this.warmTau : goal > this.avg ? this.avgUp : this.avgTau;
      this.avg += (goal - this.avg) * smoothK(dt, tau);
      if (this.peak < this.avg) this.peak = this.avg;
      if (warming) this.warm = Math.max(0, this.warm - dt);
    }
    const t = this.target(db) * clamp(presence);
    this.value += (t - this.value) * smoothK(dt, t > this.value ? this.attack : this.release);
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  }

  /** Nothing is playing: fall to 0 at the release speed (the averages keep their memory). */
  silence(dt) {
    this.value += (0 - this.value) * smoothK(dt, this.release);
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  }
}

/**
 * Onset ("beat") detector over a flux signal sampled once per frame.
 * A frame is a beat when its flux is above an adaptive threshold built from the last
 * `window` seconds — mean + k·σ, `ratio` × the mean, `medianMul` × the median (this one
 * rejects steady noise such as a quiet room on the microphone), and at least `minFlux` —
 * and the previous beat was at least `refractory` seconds ago. The threshold follows the
 * music, so quiet passages, loud drops and tempo changes all work.
 */
export class BeatDetector {
  constructor({ window = 1.5, k = 1.0, ratio = 1.6, medianMul = 6, minFlux = 3, refractory = 0.28, maxFrames = 400 } = {}) {
    Object.assign(this, { window, k, ratio, medianMul, minFlux, refractory });
    this.times = new Float64Array(maxFrames);
    this.values = new Float32Array(maxFrames);
    this.scratch = new Float32Array(maxFrames);
    this.head = 0;
    this.size = 0;
    this.lastBeat = -Infinity;
    this.threshold = minFlux;
  }

  reset() {
    this.head = 0;
    this.size = 0;
    this.lastBeat = -Infinity;
    this.threshold = this.minFlux;
  }

  /** @returns {boolean} true when this frame is a beat */
  push(flux, time) {
    const cap = this.times.length;
    // Statistics of the recent past (not including this frame).
    let n = 0;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < this.size; i++) {
      const j = (this.head - 1 - i + cap) % cap;
      if (time - this.times[j] > this.window) break;
      const v = this.values[j];
      this.scratch[n] = v;
      n++;
      sum += v;
      sum2 += v * v;
    }
    const mean = n ? sum / n : 0;
    const sd = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
    let median = 0;
    if (n) {
      const s = this.scratch.subarray(0, n).sort();
      median = n % 2 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
    }
    this.threshold = Math.max(this.minFlux, mean + this.k * sd, mean * this.ratio, median * this.medianMul);

    // Store this frame.
    this.times[this.head] = time;
    this.values[this.head] = flux;
    this.head = (this.head + 1) % cap;
    if (this.size < cap) this.size++;

    // Need a little history before trusting the threshold.
    if (n < 4) return false;
    if (flux > this.threshold && time - this.lastBeat >= this.refractory) {
      this.lastBeat = time;
      return true;
    }
    return false;
  }
}

/** Beat pulse shape: 1 at the beat, smooth fall to 0 after `length` seconds. */
export function beatPulse(age, length = 0.25) {
  if (!(age >= 0) || age >= length) return 0;
  const x = 1 - age / length;
  return x * x;
}
