// Unit tests for the music generator (js/audio/patterns.js) and the DSP helpers
// (js/audio/dsp.js): determinism, variation, musical sanity, audible beats.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BEATS, DEFAULT_MOOD, MOODS, STEPS, generateBar, moodFor, scaleRange } from '../js/audio/patterns.js';
import { INSTRUMENTS } from '../js/audio/instruments.js';
import { hashSeed, makeImpulse, mtof, mulberry32, note, vinylNoise, whiteNoise } from '../js/audio/dsp.js';

const IDS = Object.keys(MOODS);
/** Instruments that make an audible hit, so a beat on that step is heard. */
const HITS = new Set(['kick', 'softkick', 'brush', 'clap', 'tick', 'bell', 'stab', 'pluck', 'keys', 'oarp']);

test('scenes map to their moods; test / unknown scenes get the galaxy mood', () => {
  for (const id of ['face', 'blackhole', 'galaxy', 'mirror', 'shapes']) assert.equal(moodFor(id), id);
  assert.equal(DEFAULT_MOOD, 'galaxy');
  for (const id of ['test', undefined, null, 'nope', 'constructor', '__proto__']) assert.equal(moodFor(id), 'galaxy');
  assert.equal(generateBar('test', 0, 1).mood, 'galaxy');
});

test('tempos match the brief', () => {
  assert.deepEqual(Object.fromEntries(IDS.map((id) => [id, MOODS[id].bpm])), { face: 78, blackhole: 60, galaxy: 96, mirror: 118, shapes: 108 });
});

test('generator is deterministic: same (mood, bar, seed) → same bar', () => {
  for (const id of IDS) {
    for (const bar of [0, 1, 7, 8, 13, 31, 100]) {
      assert.deepEqual(generateBar(id, bar, 42), generateBar(id, bar, 42), `${id} bar ${bar}`);
    }
  }
  // Generating bars out of order does not change them (no hidden state).
  const a = [0, 1, 2, 3].map((b) => generateBar('shapes', b, 9));
  generateBar('shapes', 50, 9);
  const b = [3, 2, 1, 0].map((x) => generateBar('shapes', x, 9)).reverse();
  assert.deepEqual(a, b);
});

test('different seeds give different music; the same seed varies over time', () => {
  for (const id of IDS) {
    const sig = (seed, bar) => JSON.stringify(generateBar(id, bar, seed).events);
    let differs = 0;
    for (let bar = 0; bar < 16; bar++) if (sig(1, bar) !== sig(2, bar)) differs++;
    assert.ok(differs >= 8, `${id}: seeds differ in only ${differs}/16 bars`);
    // Within one seed, 32 bars are not just one bar repeated: many distinct bars.
    const distinct = new Set();
    for (let bar = 0; bar < 32; bar++) distinct.add(sig(1, bar));
    assert.ok(distinct.size >= 24, `${id}: only ${distinct.size} distinct bars of 32`);
  }
});

test('every event is well formed and playable', () => {
  for (const id of IDS) {
    for (let bar = 0; bar < 48; bar++) {
      const r = generateBar(id, bar, 7);
      assert.deepEqual(r.beats, BEATS);
      for (const e of r.events) {
        assert.ok(Number.isInteger(e.step) && e.step >= 0 && e.step < STEPS, `${id} step ${e.step}`);
        assert.ok(typeof INSTRUMENTS[e.inst] === 'function', `${id}: unknown instrument ${e.inst}`);
        assert.ok(e.vel > 0 && e.vel <= 1, `${id} ${e.inst} vel ${e.vel}`);
        assert.ok(e.len > 0, `${id} ${e.inst} len ${e.len}`);
        assert.ok(Array.isArray(e.notes));
        for (const m of e.notes) assert.ok(Number.isInteger(m) && m >= 24 && m <= 100, `${id} ${e.inst} note ${m}`);
        assert.ok(id in MOODS && (e.inst in MOODS[id].mix), `${id}: ${e.inst} has no mix level`);
      }
    }
  }
});

test('every beat is audible: each beat step has a hit (kick, snare, tick or accent)', () => {
  for (const id of IDS) {
    for (let bar = 0; bar < 64; bar++) {
      const { events, beats } = generateBar(id, bar, 3);
      for (const s of beats) {
        const hit = events.some((e) => e.step === s && HITS.has(e.inst));
        assert.ok(hit, `${id} bar ${bar}: nothing audible on beat step ${s}`);
      }
    }
  }
});

test('melodies stay in key and in a pleasant register', () => {
  const inKey = (id, m) => MOODS[id].scale.includes((((m - MOODS[id].root) % 12) + 12) % 12);
  for (const id of ['face', 'shapes', 'galaxy']) {
    const lead = { face: 'keys', shapes: 'pluck', galaxy: 'bell' }[id];
    let total = 0;
    let outOfKey = 0;
    for (let bar = 0; bar < 64; bar++) {
      for (const e of generateBar(id, bar, 5).events) {
        if (e.inst !== lead || e.notes.length !== 1) continue;
        const m = e.notes[0];
        total++;
        if (!inKey(id, m)) outOfKey++;
        assert.ok(m >= note('G4') && m <= note('A6'), `${id} lead note ${m} out of range`);
      }
    }
    assert.ok(total > 20, `${id}: ${total} lead notes`);
    assert.ok(outOfKey / total < 0.1, `${id}: ${outOfKey}/${total} lead notes out of key`);
  }
});

test('the arrangement changes across phrases (sections come and go)', () => {
  const count = (id, inst, bars) => bars.reduce((n, b) => n + generateBar(id, b, 1).events.filter((e) => e.inst === inst).length, 0);
  const phrase = (p) => Array.from({ length: 8 }, (_, i) => p * 8 + i);
  // House: claps and stabs only after the first phrase.
  assert.equal(count('mirror', 'clap', phrase(0)), 0);
  assert.ok(count('mirror', 'clap', phrase(1)) > 0);
  assert.ok(count('mirror', 'stab', phrase(1)) > 0);
  // The repeating organ figure in the middle sections of the black hole (the quiet
  // sections only have a few floating single notes).
  assert.ok(count('blackhole', 'oarp', phrase(0)) <= 4);
  assert.ok(count('blackhole', 'oarp', phrase(1)) >= 32);
  // Lo-fi melody licks come in on the B section.
  const leads = (p) => phrase(p).reduce((n, b) => n + generateBar('face', b, 1).events.filter((e) => e.inst === 'keys' && e.lead).length, 0);
  assert.equal(leads(0), 0);
  assert.ok(leads(1) > 0);
});

test('dsp: notes, frequencies, seeded random numbers', () => {
  assert.equal(note('A4'), 69);
  assert.equal(note('C4'), 60);
  assert.equal(note('F#2'), 42);
  assert.equal(note('Bb3'), 58);
  assert.equal(mtof(69), 440);
  assert.ok(Math.abs(mtof(81) - 880) < 1e-9);
  assert.throws(() => note('H2'));
  const a = mulberry32(5);
  const b = mulberry32(5);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
  assert.notEqual(hashSeed('a', 'bc'), hashSeed('ab', 'c'));
  assert.deepEqual(scaleRange(60, [0, 4, 7], 60, 72), [60, 64, 67, 72]);
});

test('dsp: noise buffers have no DC and sane levels', () => {
  const w = whiteNoise(48000, 3);
  let mean = 0;
  let peak = 0;
  for (const x of w) {
    mean += x;
    peak = Math.max(peak, Math.abs(x));
  }
  assert.ok(Math.abs(mean / w.length) < 0.01);
  assert.ok(peak <= 1);
  const v = vinylNoise(48000, 2, 4);
  let vm = 0;
  let vp = 0;
  let e = 0;
  for (const x of v) {
    vm += x;
    vp = Math.max(vp, Math.abs(x));
    e += x * x;
  }
  assert.ok(Math.abs(vm / v.length) < 1e-4, 'vinyl DC');
  assert.ok(vp < 1, `vinyl peak ${vp}`);
  assert.ok(Math.sqrt(e / v.length) < 0.08, 'vinyl is quiet');
  assert.equal(v[0], 0, 'starts at zero (no click)');
});

test('dsp: reverb impulse decays exponentially, unit energy, no DC, no feedback blow-up', () => {
  const sr = 24000;
  const [L, R] = makeImpulse(sr, 2.6, { decay: 2.4, predelay: 0.015 });
  assert.equal(L.length, Math.round(sr * 2.6));
  for (const ch of [L, R]) {
    let e = 0;
    let m = 0;
    for (const x of ch) {
      e += x * x;
      m += x;
      assert.ok(Number.isFinite(x));
    }
    assert.ok(Math.abs(e - 1) < 1e-3, `energy ${e}`);
    assert.ok(Math.abs(m / ch.length) < 1e-4, 'DC');
    // Silent pre-delay, then energy falls ~25 dB per second (60 dB in 2.4 s).
    for (let i = 0; i < Math.round(sr * 0.014); i++) assert.ok(Math.abs(ch[i]) < 1e-3);
    const energyIn = (a, b) => {
      let s = 0;
      for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) s += ch[i] * ch[i];
      return s;
    };
    const drop = 10 * Math.log10(energyIn(0.1, 0.3) / energyIn(1.1, 1.3));
    assert.ok(drop > 18 && drop < 32, `decay ${drop} dB per second`);
    assert.ok(ch[ch.length - 1] === 0, 'ends at zero');
  }
  // Left and right are decorrelated (wide stereo).
  let lr = 0;
  for (let i = 0; i < L.length; i++) lr += L[i] * R[i];
  assert.ok(Math.abs(lr) < 0.2, `L/R correlation ${lr}`);
});
