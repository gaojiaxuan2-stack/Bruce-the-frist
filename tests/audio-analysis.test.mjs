// Unit tests for js/audio/analysis.js: the beat detector (on synthetic onset sequences
// with tempo changes, noise, quiet passages and off-beat distractors), the level
// normaliser and the spectrum helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS,
  BeatDetector,
  LevelNormalizer,
  bandDb,
  bandPresence,
  beatPulse,
  binRange,
  makePowerTable,
  smoothK,
  spectralFlux,
} from '../js/audio/analysis.js';
import { mulberry32 } from '../js/audio/dsp.js';

const FPS = 60;

/** Gaussian noise from a seeded uniform PRNG (Box-Muller). */
function gauss(rng) {
  return Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Synthetic per-frame flux: onsets at the given times (spread over two frames like a
 * real kick entering the FFT window), plus optional weaker off-beat hits and noise.
 */
function makeFlux(onsets, { seconds, amp = 40, ampJitter = 0.2, noise = 1.5, offbeats = 0, gain = () => 1, seed = 1 }) {
  const rng = mulberry32(seed);
  const n = Math.round(seconds * FPS);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = Math.abs(gauss(rng)) * noise * gain(i / FPS);
  const add = (t, a) => {
    const i = Math.ceil(t * FPS);
    if (i < n) f[i] += a * 0.65;
    if (i + 1 < n) f[i + 1] += a * 0.35;
  };
  for (let k = 0; k < onsets.length; k++) {
    const t = onsets[k];
    add(t, amp * (1 + (rng() * 2 - 1) * ampJitter) * gain(t));
    if (offbeats && k + 1 < onsets.length) add((t + onsets[k + 1]) / 2, offbeats * gain(t));
  }
  return f;
}

function run(flux, opts) {
  const d = new BeatDetector(opts);
  const beats = [];
  for (let i = 0; i < flux.length; i++) if (d.push(flux[i], i / FPS)) beats.push(i / FPS);
  return beats;
}

/** recall / precision of detected beats against the true onsets (tolerance 2 frames). */
function match(detected, truth, from = 1.6) {
  const tol = 2.5 / FPS;
  const t = truth.filter((x) => x >= from);
  const d = detected.filter((x) => x >= from);
  const hit = t.filter((x) => d.some((y) => Math.abs(y - x) <= tol)).length;
  const good = d.filter((y) => t.some((x) => Math.abs(y - x) <= tol)).length;
  return { recall: hit / t.length, precision: d.length ? good / d.length : 1, detected: d.length, truth: t.length };
}

function grid(start, end, interval) {
  const out = [];
  for (let t = start; t < end; t += interval) out.push(t);
  return out;
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
};

test('beat detector: steady 120 bpm with noise finds every beat on time', () => {
  const onsets = grid(0.3, 20, 0.5);
  const flux = makeFlux(onsets, { seconds: 20, noise: 2 });
  const beats = run(flux);
  const m = match(beats, onsets);
  assert.ok(m.recall >= 0.97, `recall ${m.recall}`);
  assert.ok(m.precision >= 0.97, `precision ${m.precision}`);
  const intervals = beats.slice(1).map((b, i) => b - beats[i]).filter((x) => x > 0.3);
  assert.ok(Math.abs(median(intervals) - 0.5) < 0.02, `median interval ${median(intervals)}`);
});

test('beat detector: follows a tempo change 120 → 90 → 140 bpm', () => {
  const onsets = [...grid(0.3, 10, 60 / 120), ...grid(10.2, 20, 60 / 90), ...grid(20.1, 30, 60 / 140)];
  const flux = makeFlux(onsets, { seconds: 30, noise: 2, seed: 7 });
  const beats = run(flux);
  const m = match(beats, onsets);
  assert.ok(m.recall >= 0.95, `recall ${m.recall}`);
  assert.ok(m.precision >= 0.95, `precision ${m.precision}`);
  const tempoIn = (a, b) => {
    const seg = beats.filter((t) => t >= a && t < b);
    return 60 / median(seg.slice(1).map((t, i) => t - seg[i]));
  };
  assert.ok(Math.abs(tempoIn(2, 10) - 120) < 4, `tempo A ${tempoIn(2, 10)}`);
  assert.ok(Math.abs(tempoIn(12, 20) - 90) < 4, `tempo B ${tempoIn(12, 20)}`);
  assert.ok(Math.abs(tempoIn(22, 30) - 140) < 5, `tempo C ${tempoIn(22, 30)}`);
});

test('beat detector: weaker off-beat hits (hats) are not counted as beats', () => {
  const onsets = grid(0.3, 16, 0.5);
  const flux = makeFlux(onsets, { seconds: 16, noise: 1.5, offbeats: 9, seed: 3 });
  const m = match(run(flux), onsets);
  assert.ok(m.recall >= 0.95, `recall ${m.recall}`);
  assert.ok(m.precision >= 0.9, `precision ${m.precision} (${m.detected} detected for ${m.truth})`);
});

test('beat detector: adapts to a quiet passage and back (adaptive threshold)', () => {
  const onsets = grid(0.3, 30, 0.5);
  // Loud for 10 s, 5x quieter for 10 s, loud again.
  const gain = (t) => (t >= 10 && t < 20 ? 0.2 : 1);
  const flux = makeFlux(onsets, { seconds: 30, amp: 60, noise: 1.5, gain, seed: 11 });
  const beats = run(flux);
  const quiet = match(beats.filter((t) => t >= 11.6 && t < 20), onsets.filter((t) => t >= 11.6 && t < 20), 0);
  const back = match(beats.filter((t) => t >= 20), onsets.filter((t) => t >= 20), 0);
  assert.ok(quiet.recall >= 0.9, `quiet recall ${quiet.recall}`);
  assert.ok(back.recall >= 0.95 && back.precision >= 0.95, `after ${JSON.stringify(back)}`);
});

test('beat detector: steady noise alone (a quiet room) gives (almost) no beats', () => {
  const rng = mulberry32(5);
  for (const sigma of [1, 4, 12]) {
    const n = 60 * FPS;
    const flux = Float32Array.from({ length: n }, () => Math.abs(gauss(rng)) * sigma);
    const beats = run(flux);
    assert.ok(beats.length / 60 < 0.1, `σ=${sigma}: ${beats.length} false beats in 60 s`);
  }
});

test('beat detector: the refractory time stops double triggers', () => {
  // Each onset rings for 6 frames with a second bump 3 frames in.
  const onsets = grid(0.3, 12, 0.5);
  const flux = makeFlux(onsets, { seconds: 12, noise: 1 });
  for (const t of onsets) {
    const i = Math.ceil(t * FPS) + 3;
    if (i < flux.length) flux[i] += 30;
  }
  const beats = run(flux);
  const gaps = beats.slice(1).map((b, i) => b - beats[i]);
  assert.ok(Math.min(...gaps) >= 0.28 - 1e-9, `min gap ${Math.min(...gaps)}`);
  assert.ok(match(beats, onsets).recall >= 0.95);
});

test('beat detector: reset() forgets history', () => {
  const d = new BeatDetector();
  for (let i = 0; i < 100; i++) d.push(i % 30 === 0 ? 50 : 1, i / FPS);
  d.reset();
  assert.equal(d.size, 0);
  assert.equal(d.lastBeat, -Infinity);
  assert.equal(d.push(100, 10), false, 'needs a few frames of history first');
});

// ------------------------------------------------------------------ normaliser

/** Run `seconds` of frames; each frame sees the signal at the frame's end time. */
function feed(norm, dbAt, seconds, dt = 1 / FPS) {
  const out = [];
  const n = Math.round(seconds / dt);
  for (let k = 1; k <= n; k++) out.push(norm.update(dbAt(k * dt), dt));
  return out;
}

const stats = (a) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { mean, min: Math.min(...a), max: Math.max(...a) };
};

test('level normaliser: quiet and loud songs use the same 0..1 range', () => {
  // A "song": a pulse every 0.5 s on top of a steady level, at two loudnesses 30 dB apart.
  const song = (base) => (t) => base + (t % 0.5 < 0.08 ? 12 : 0) + 2 * Math.sin(t * 3.1);
  const quiet = stats(feed(new LevelNormalizer(), song(-60), 12).slice(6 * FPS));
  const loud = stats(feed(new LevelNormalizer(), song(-30), 12).slice(6 * FPS));
  for (const s of [quiet, loud]) {
    assert.ok(s.max > 0.9, `peaks reach the top: ${JSON.stringify(s)}`);
    assert.ok(s.min < 0.5, `falls between pulses: ${JSON.stringify(s)}`);
    assert.ok(s.mean > 0.3 && s.mean < 0.85, `mean ${s.mean}`);
  }
  assert.ok(Math.abs(quiet.mean - loud.mean) < 0.05, `quiet ${quiet.mean} vs loud ${loud.mean}`);
});

test('level normaliser: a steady sound sits in the middle, not pinned at 1', () => {
  const s = stats(feed(new LevelNormalizer(), () => -40, 8).slice(4 * FPS));
  assert.ok(s.mean > 0.35 && s.mean < 0.6, `steady mean ${s.mean}`);
});

test('level normaliser: attack is fast and release slower', () => {
  const norm = new LevelNormalizer({ attack: 0.02, release: 0.2 });
  feed(norm, (t) => (t % 1 < 0.5 ? -60 : -30), 6); // learn the range
  // Rise: time from the step to 90% of the final value.
  const up = feed(norm, () => -30, 0.5);
  const tUp = up.findIndex((v) => v >= 0.9 * up[up.length - 1]) / FPS;
  const down = feed(norm, () => -60, 1);
  const tDown = down.findIndex((v) => v <= 0.1 + 0.9 * down[down.length - 1]) / FPS;
  assert.ok(tUp < 0.08, `attack ${tUp}s`);
  assert.ok(tDown > 2 * tUp && tDown > 0.15, `release ${tDown}s vs attack ${tUp}s`);
});

test('level normaliser: silence and silence() fall to exactly 0', () => {
  const norm = new LevelNormalizer();
  feed(norm, () => -35, 3);
  assert.ok(norm.value > 0.3);
  const gated = feed(norm, () => -120, 3);
  assert.equal(gated[gated.length - 1], 0);
  feed(norm, () => -35, 2);
  let v = 1;
  for (let i = 0; i < 4 * FPS; i++) v = norm.silence(1 / FPS);
  assert.equal(v, 0);
});

test('level normaliser: frame-rate independent', () => {
  // Input that changes slowly compared with one 30 fps frame, so only the smoothing differs.
  const sig = (t) => -40 + 8 * Math.sin((2 * Math.PI * t) / 2);
  const a = new LevelNormalizer();
  const b = new LevelNormalizer();
  const va = feed(a, sig, 6, 1 / 30);
  const vb = feed(b, sig, 6, 1 / 120);
  // Compare after the same elapsed time (frame i at 30 fps = frame 4i+3 at 120 fps).
  let maxDiff = 0;
  for (let i = 0; i < va.length; i++) maxDiff = Math.max(maxDiff, Math.abs(va[i] - vb[Math.min(vb.length - 1, i * 4 + 3)]));
  assert.ok(maxDiff < 0.06, `30 vs 120 fps differ by ${maxDiff}`);
});

test('level normaliser: a sudden louder passage (+15 dB) is learnt within about a second', () => {
  const lastAbove = (vals, x) => (vals.reduce((last, v, i) => (v > x ? i : last), -1) + 1) / FPS;
  const plain = new LevelNormalizer();
  feed(plain, () => -50, 8);
  const up = feed(plain, () => -35, 4);
  assert.ok(lastAbove(up, 0.9) < 1.3, `pinned at the top for ${lastAbove(up, 0.9)} s`);
  assert.ok(up[up.length - 1] < 0.6, 'then back in the middle');
  // The engine re-seeds on a scene / source change: faster still.
  const seeded = new LevelNormalizer();
  feed(seeded, () => -50, 8);
  seeded.reseed();
  const up2 = feed(seeded, () => -35, 4);
  assert.ok(lastAbove(up2, 0.9) < 0.8, `re-seeded: ${lastAbove(up2, 0.9)} s`);
});

test('level normaliser: the first seconds after the sound starts (a fade-in) are already in range', () => {
  // The music fades in from silence over 2.5 s, then plays a pulse every half second.
  const song = (t) => -35 + 30 * Math.log10(Math.min(1, 0.05 + t / 2.5)) + (t % 0.5 < 0.08 ? 10 : 0);
  const v = feed(new LevelNormalizer(), song, 8);
  const pinned = v.filter((x) => x > 0.9).length / v.length;
  assert.ok(pinned < 0.25, `above 0.9 for ${(pinned * 100).toFixed(0)}% of the first 8 s`);
  const late = v.slice(3 * FPS);
  assert.ok(Math.min(...late) < 0.6, 'moves with the music after the fade-in');
});

test('band presence: a band far below the rest of the mix reads low, a full band reads high', () => {
  const ranges = {};
  for (const [name, [lo, hi]] of Object.entries(BANDS)) ranges[name] = binRange(48000, 2048, lo, hi);
  // Mean power per bin: the level band covers ~510 bins, mid ~77, treble ~427.
  const full = { level: -40, bass: -30, mid: -38, treble: -60 };
  assert.ok(bandPresence('bass', full, ranges) > 0.95);
  assert.ok(bandPresence('mid', full, ranges) > 0.95);
  const thinMids = { level: -40, bass: -30, mid: -72, treble: -60 };
  assert.ok(bandPresence('mid', thinMids, ranges) < 0.05, `mid ${bandPresence('mid', thinMids, ranges)}`);
  assert.equal(bandPresence('level', full, ranges), 1);
  // Scales the normalised output.
  const a = new LevelNormalizer();
  const b = new LevelNormalizer();
  const ra = feed(a, (t) => -60 + (t % 0.5 < 0.1 ? 10 : 0), 4);
  let vb = 0;
  for (let k = 1; k <= 4 * FPS; k++) vb = Math.max(vb, b.update(-60 + ((k / FPS) % 0.5 < 0.1 ? 10 : 0), 1 / FPS, 0.2));
  assert.ok(Math.max(...ra) > 0.9 && vb < 0.25, `full ${Math.max(...ra)} vs 20% present ${vb}`);
});

test('level normaliser: a band hovering at the noise gate does not flicker', () => {
  const norm = new LevelNormalizer();
  feed(norm, () => -60, 2);
  let flips = 0;
  let open = norm.open;
  for (let k = 0; k < 4 * FPS; k++) {
    norm.update(k % 2 ? -84 : -87, 1 / FPS); // around the -85 dB gate
    if (norm.open !== open) flips++;
    open = norm.open;
  }
  assert.equal(flips, 0, 'stays open');
  feed(norm, () => -120, 1);
  assert.equal(norm.open, false);
  for (let k = 0; k < 4 * FPS; k++) {
    norm.update(k % 2 ? -84 : -87, 1 / FPS);
    if (norm.open) flips++;
  }
  assert.equal(flips, 0, 'stays closed');
});

// ------------------------------------------------------------------ helpers

test('spectrum helpers: bin ranges, band dB and flux', () => {
  assert.deepEqual(binRange(48000, 2048, 0, 10), [1, 2], 'never the DC bin, at least one bin');
  const [b0, b1] = binRange(48000, 2048, 80, 190);
  assert.ok(b0 === 3 && b1 === 9, `${b0}..${b1}`);
  const table = makePowerTable(-100, -10);
  assert.equal(table[0], 0);
  assert.ok(Math.abs(10 * Math.log10(table[255]) - -10) < 1e-6);
  const bytes = new Uint8Array(64).fill(255);
  assert.ok(Math.abs(bandDb(bytes, 1, 10, table) - -10) < 1e-6);
  assert.ok(bandDb(new Uint8Array(64), 1, 10, table) < -100, 'silence is very low');
  const prev = new Uint8Array(16).fill(100);
  const cur = new Uint8Array(16).fill(100);
  cur[2] = 160;
  cur[3] = 40; // a fall does not count
  assert.equal(spectralFlux(cur, prev, 0, 16), 60 / 16);
});

test('beat pulse: 1 at the beat, gone after its length, smooth', () => {
  assert.equal(beatPulse(0), 1);
  assert.equal(beatPulse(0.25), 0);
  assert.equal(beatPulse(-0.01), 0);
  assert.ok(beatPulse(0.1) < beatPulse(0.05));
  assert.ok(Math.abs(smoothK(1 / 60, 0.1) - (1 - Math.exp(-1 / 6))) < 1e-12);
});
