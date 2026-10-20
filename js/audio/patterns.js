// The built-in music, as data: one mood per scene. `generateBar(mood, bar, seed)` returns
// the notes of one bar (16 steps of a 16th note). It is pure and deterministic: the same
// (mood, bar, seed) always gives the same bar, but every bar draws its small variations
// (fills, re-strikes, ghost notes, melody changes) from its own seeded random numbers,
// and phrases of 8 bars cycle through sections, so the loops never repeat exactly.
//
// Event: { step: 0..15, inst, notes: midi[], vel: 0..1, len: steps, ...instrument options }
// `beats` lists the steps where the particles should "hit": every quarter note, and each
// of them always has an audible accent (kick, snare, tick or an accented note).

import { clamp, hashSeed, mulberry32, note } from './dsp.js';

export const STEPS = 16;
export const BEATS = Object.freeze([0, 4, 8, 12]);

const ns = (...names) => names.map(note);
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const chance = (rng, p) => rng() < p;
const vary = (rng, v, amt) => clamp(v + (rng() * 2 - 1) * amt, 0.02, 1);

/** All notes of a scale (root + intervals) between lo and hi (inclusive), sorted. */
export function scaleRange(root, intervals, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (intervals.includes((((m - root) % 12) + 12) % 12)) out.push(m);
  return out;
}

/** Note in `pool` closest to midi whose pitch class is in `classes` (falls back to any pool note). */
function snapTo(pool, midi, classes) {
  let best = null;
  let bestD = Infinity;
  for (const m of pool) {
    if (classes && !classes.includes(m % 12)) continue;
    const d = Math.abs(m - midi);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best ?? pool.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
}

const pcs = (notes) => [...new Set(notes.map((m) => m % 12))];

/**
 * Random walk over pool indices for a rhythm; strong steps snap to chord tones. The walk
 * bounces off the ends of the range and never plays the same note three times in a row.
 */
function walkMelody(rng, rhythm, pool, start, chordAt, { leap = [-2, -1, -1, 1, 1, 2, 0, 3, -3] } = {}) {
  const top = pool.length - 1;
  let idx = clamp(start, 0, top);
  const out = [];
  for (const [step, len] of rhythm) {
    const d = pick(rng, leap);
    let next = idx + d;
    if (next < 0 || next > top) next = idx - d;
    next = clamp(next, 0, top);
    const n = out.length;
    if (n >= 2 && pool[next] === out[n - 1].midi && out[n - 1].midi === out[n - 2].midi) next = next > 0 ? next - 1 : next + 1;
    idx = next;
    let m = pool[idx];
    if (step % 4 === 0) {
      m = snapTo(pool, m, chordAt(step));
      idx = pool.indexOf(m);
    }
    out.push({ step, len, midi: m });
  }
  return out;
}

// ------------------------------------------------------------------------- moods
// mix: instrument level, rev: reverb send, dly: delay send (per instrument).
// bus.level: overall trim, so every mood plays at about the same loudness (≈ -19.5 LUFS at
// the default volume) and stays as loud on laptop / phone speakers (measured by offline
// renders of every section; see tests/audio-render.test.mjs).

const FACE_PROG = [
  { bass: note('F2'), notes: ns('A3', 'C4', 'E4', 'G4') }, // Fmaj9
  { bass: note('E2'), notes: ns('G3', 'B3', 'D4', 'A4') }, // Em11
  { bass: note('D2'), notes: ns('F3', 'A3', 'C4', 'E4') }, // Dm9
  { bass: note('C2'), notes: ns('E3', 'G3', 'B3', 'D4') }, // Cmaj9
];
const FACE_TURN = { bass: note('G2'), notes: ns('F3', 'A3', 'C4', 'E4') }; // G9sus
const FACE_POOL = scaleRange(note('C4'), [0, 2, 4, 7, 9], note('G4'), note('D6'));
const FACE_RHYTHMS = [
  [[2, 2], [4, 3], [7, 5]],
  [[0, 2], [3, 2], [6, 3], [10, 4]],
  [[8, 2], [10, 1], [11, 3], [14, 2]],
  [[4, 2], [6, 1], [7, 3], [10, 2], [12, 4]],
  [[1, 2], [3, 3], [8, 6]],
];

const GALAXY_PROG = [
  { bass: note('D2'), pad: ns('F#3', 'A3', 'C#4', 'E4') }, // Dmaj9
  { bass: note('D2'), pad: ns('E3', 'G#3', 'B3', 'E4') }, // E/D (lydian)
  { bass: note('B1'), pad: ns('D3', 'F#3', 'A3', 'C#4') }, // Bm9
  { bass: note('G1'), pad: ns('B2', 'F#3', 'A3', 'C#4') }, // Gmaj7#11
  { bass: note('D2'), pad: ns('F#3', 'A3', 'C#4', 'E4') }, // Dmaj9
  { bass: note('D2'), pad: ns('E3', 'G#3', 'B3', 'E4') }, // E/D
  { bass: note('F#1'), pad: ns('E3', 'A3', 'C#4', 'F#4') }, // F#m7
  { bass: note('A1'), pad: ns('E3', 'A3', 'B3', 'D4') }, // Asus2/4
];

const BH_PROGS = [
  [
    { root: note('A2'), notes: ns('A2', 'E3', 'A3', 'C4', 'E4', 'B4'), pair: ns('A4', 'E5') }, // Am(add9)
    { root: note('F2'), notes: ns('F2', 'C3', 'A3', 'C4', 'F4', 'G4'), pair: ns('A4', 'F5') }, // F(add9)
    { root: note('C3'), notes: ns('C3', 'G3', 'C4', 'E4', 'G4', 'D5'), pair: ns('G4', 'E5') }, // C(add9)
    { root: note('G2'), notes: ns('G2', 'D3', 'B3', 'D4', 'G4', 'A4'), pair: ns('B4', 'D5') }, // G(add9)
  ],
  [
    { root: note('A2'), notes: ns('A2', 'E3', 'A3', 'C4', 'E4', 'B4'), pair: ns('A4', 'E5') }, // Am(add9)
    { root: note('F2'), notes: ns('F2', 'C3', 'A3', 'C4', 'F4', 'G4'), pair: ns('C5', 'F5') }, // F(add9)
    { root: note('D3'), notes: ns('D3', 'A3', 'D4', 'E4', 'F4', 'A4'), pair: ns('A4', 'D5') }, // Dm(add9)
    { root: note('E2'), notes: ns('E2', 'B2', 'E3', 'A3', 'B3', 'E4'), pair: ns('B4', 'E5') }, // Esus4
  ],
];

// The bass sits in octave 2-3 (87-147 Hz roots): the kick carries the sub, and the bass
// stays audible on laptop and phone speakers.
const MIRROR_CHORDS = {
  Am: { bass: note('A2'), stab: ns('C4', 'E4', 'G4', 'B4') },
  Dm: { bass: note('D3'), stab: ns('C4', 'E4', 'F4', 'A4') },
  F: { bass: note('F2'), stab: ns('A3', 'C4', 'E4', 'G4') },
  G: { bass: note('G2'), stab: ns('B3', 'D4', 'E4', 'G4') },
};
const MIRROR_PROGS = [
  ['Am', 'Am', 'Dm', 'Dm', 'Am', 'Am', 'Dm', 'Dm'],
  ['Am', 'Am', 'Dm', 'Dm', 'Am', 'Am', 'F', 'G'],
];
// [step, semitones above root, length]
const MIRROR_BASS = [
  [[2, 0, 1], [6, 0, 1], [10, 0, 1], [14, 12, 1]],
  [[3, 0, 1], [6, 0, 1], [7, 12, 1], [10, 0, 1], [14, 7, 1]],
  [[2, 0, 2], [5, 0, 1], [10, 0, 2], [13, -2, 1]],
  [[2, 0, 1], [3, 0, 1], [6, 12, 1], [10, 0, 1], [11, 0, 1], [14, -5, 1]],
];
const MIRROR_STABS = [[3, 11], [6], [3, 7, 14], [10], [7, 15]];

const SHAPES_CHORDS = {
  C: { bass: note('C2'), tones: ns('C4', 'E4', 'G4') },
  Am: { bass: note('A1'), tones: ns('A3', 'C4', 'E4') },
  F: { bass: note('F2'), tones: ns('A3', 'C4', 'F4') },
  G: { bass: note('G1'), tones: ns('B3', 'D4', 'G4') },
  Em: { bass: note('E2'), tones: ns('B3', 'E4', 'G4') },
  Dm: { bass: note('D2'), tones: ns('A3', 'D4', 'F4') },
};
const SHAPES_PROGS = [
  ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G'],
  ['C', 'Am', 'F', 'G', 'Dm', 'G', 'C', 'G'],
  ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
];
const SHAPES_POOL = scaleRange(note('C4'), [0, 2, 4, 7, 9], note('C5'), note('E6'));
const SHAPES_BASS = [
  [[0, 0, 2], [3, 12, 1], [6, 0, 1], [8, 0, 2], [11, 12, 1], [14, 7, 1]],
  [[0, 0, 1], [2, 0, 1], [4, 12, 1], [6, 7, 1], [8, 0, 1], [10, 0, 1], [12, 12, 1], [14, 7, 1]],
  [[0, 0, 3], [4, 7, 1], [6, 12, 1], [8, 0, 3], [12, 7, 1], [14, 12, 1]],
];
// Two-bar melody rhythms: [step 0..31, length]
const SHAPES_RHYTHMS = [
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4], [16, 2], [18, 2], [20, 6], [28, 2]],
  [[0, 3], [3, 3], [6, 2], [8, 4], [14, 2], [16, 3], [19, 3], [22, 2], [24, 6]],
  [[2, 2], [4, 2], [6, 2], [8, 6], [18, 2], [20, 2], [22, 2], [24, 4], [28, 2], [30, 2]],
  [[0, 4], [4, 2], [6, 2], [8, 2], [10, 6], [16, 4], [20, 2], [22, 2], [24, 8]],
];

export const MOODS = {
  // Warm lo-fi: e-piano chords, round bass, soft kick, brushes, a little vinyl.
  face: {
    id: 'face',
    title: 'Lo-fi',
    bpm: 78,
    swing: 0.16,
    root: note('C4'),
    scale: [0, 2, 4, 7, 9],
    bus: { tone: 4200, wow: 0.0016, reverb: 1, delay: null, level: 0.79 },
    mix: { keys: 0.9, bass: 0.85, kick: 0.66, brush: 0.55, hat: 0.38, vinyl: 0.5 },
    rev: { keys: 0.3, brush: 0.15, hat: 0.1, kick: 0.04 },
    dly: {},
    compose(c) {
      const { i, phrase, rng, prng, push } = c;
      const section = phrase % 4;
      const chord = i === 7 && phrase % 2 === 1 ? FACE_TURN : FACE_PROG[i % 4];
      const next = i === 6 && phrase % 2 === 1 ? FACE_TURN : FACE_PROG[(i + 1) % 4];
      // Keys: the chord on the 1, then a lighter re-strike somewhere in the bar.
      push(0, 'keys', chord.notes, vary(rng, 0.62, 0.05), 14, { strum: 0.012 + rng() * 0.012 });
      const comps = section === 2 ? [[10], [6, 14], [3, 10], [7, 11]] : [[], [10], [7], [6, 14], [11]];
      for (const s of pick(rng, comps)) push(s, 'keys', chord.notes.slice(1), vary(rng, 0.36, 0.05), 3 + Math.floor(rng() * 3), { strum: 0.008 });
      // Bass
      push(0, 'bass', [chord.bass], vary(rng, 0.75, 0.04), 7);
      if (chance(rng, 0.65)) push(pick(rng, [10, 11]), 'bass', [chord.bass + pick(rng, [0, 7, 12])], vary(rng, 0.5, 0.05), 4);
      if (i % 4 === 3 && chance(rng, 0.6)) push(14, 'bass', [next.bass - 5], 0.45, 2);
      // Drums: kick on 1 and 3, brushes on 2 and 4, brushed 8th hats with swung ghosts.
      push(0, 'kick', [], vary(rng, 0.86, 0.03));
      push(8, 'kick', [], vary(rng, 0.74, 0.04));
      if (chance(rng, 0.4)) push(pick(rng, [10, 11, 15]), 'kick', [], 0.42);
      push(4, 'brush', [], vary(rng, 0.62, 0.04));
      push(12, 'brush', [], vary(rng, 0.66, 0.04));
      if (i === 7 && chance(rng, 0.6)) push(15, 'brush', [], 0.24);
      for (let s = 0; s < 16; s += 2) push(s, 'hat', [], vary(rng, s % 4 === 0 ? 0.36 : 0.27, 0.04));
      for (let s = 1; s < 16; s += 2) if (chance(rng, 0.18)) push(s, 'hat', [], 0.13);
      push(0, 'vinyl', [], 0.8, 16);
      // Melody licks in the B sections, from the phrase motif with small changes per bar.
      const melodic = section % 2 === 1 ? i % 2 === 1 || chance(rng, 0.3) : section === 2 && i >= 4 && i % 2 === 1;
      if (melodic) {
        const rhythm = pick(prng, FACE_RHYTHMS);
        const start = Math.floor(prng() * FACE_POOL.length * 0.5) + 2;
        const tones = pcs(chord.notes);
        for (const n of walkMelody(prng, rhythm, FACE_POOL, start, () => tones)) {
          let m = n.midi;
          if (chance(rng, 0.25)) m = snapTo(FACE_POOL, m + pick(rng, [-2, 2]), null);
          push(n.step, 'keys', [m], vary(rng, 0.42, 0.06), n.len, { lead: true });
        }
      }
    },
  },

  // "Interstellar": slow pipe-organ chord swells over a deep drone, a ticking clock.
  blackhole: {
    id: 'blackhole',
    title: 'Organ',
    bpm: 60,
    swing: 0,
    root: note('A3'),
    scale: [0, 2, 3, 5, 7, 8, 10],
    bus: { tone: 9000, wow: 0, reverb: 1, delay: null, level: 0.86 },
    mix: { organ: 0.8, drone: 0.75, tick: 0.5, oarp: 0.6 },
    rev: { organ: 0.55, drone: 0.35, tick: 0.25, oarp: 0.5 },
    dly: {},
    compose(c) {
      const { i, phrase, rng, prng, push } = c;
      const section = phrase % 4;
      const prog = BH_PROGS[Math.floor(prng() * BH_PROGS.length)];
      const chord = prog[Math.floor(i / 2)];
      if (i % 2 === 0) {
        let notes = chord.notes.slice();
        if (chance(rng, 0.3)) notes = notes.slice(1);
        if (section === 2) notes.push(notes[notes.length - 2] + 12);
        push(0, 'organ', notes, vary(rng, section === 2 ? 0.74 : 0.64, 0.05), 32, {
          attack: 2.0 + rng() * 0.8,
          release: 3.4,
          bright: section === 2 ? 1 : 0.55 + rng() * 0.2,
        });
      }
      if (i % 4 === 0) push(0, 'drone', ns('A1', 'E2'), 0.75, 64, { attack: 3.5, release: 4.5 });
      // The clock: tick on 1 and 3, a softer tock on 2 and 4.
      for (const s of BEATS) push(s, 'tick', [], vary(rng, s % 8 === 0 ? 0.55 : 0.4, 0.03), 1, { tone: s % 8 === 0 ? 1 : 0 });
      // Quiet sections: now and then a single high organ note floats above the chord.
      if ((section === 0 || section === 3) && i % 2 === 1 && chance(rng, 0.6)) {
        push(pick(rng, [0, 4, 8]), 'oarp', [pick(rng, chord.pair) + pick(rng, [0, 12])], vary(rng, 0.2, 0.04), 8);
      }
      // Repeating organ figure in the middle sections, growing across the phrase.
      if (section === 1 || section === 2) {
        const grow = 0.6 + 0.4 * (i / 7);
        const rate = section === 2 && i >= 4 ? 1 : 2;
        for (let s = 0; s < 16; s += rate) {
          const k = s / rate;
          let m = chord.pair[k % 2];
          if (rate === 1 && k % 4 === 3) m = chord.pair[0] + 12;
          push(s, 'oarp', [m], (s % 4 === 0 ? 0.34 : 0.25) * grow, rate * 1.6);
        }
      }
    },
  },

  // Dreamy: airy pads, shimmering bell arpeggios through a ping-pong delay.
  galaxy: {
    id: 'galaxy',
    title: 'Dream',
    bpm: 96,
    swing: 0,
    root: note('D4'),
    scale: [0, 2, 4, 6, 7, 9, 11],
    bus: { tone: 11000, wow: 0, reverb: 1, delay: { beats: 0.75, feedback: 0.42, tone: 3200 }, level: 1.16 },
    mix: { pad: 0.75, bell: 0.6, sub: 0.6, air: 0.45, softkick: 0.6, glint: 0.45 },
    rev: { pad: 0.45, bell: 0.45, air: 0.6, glint: 0.7, softkick: 0.05 },
    dly: { bell: 0.4, glint: 0.5 },
    compose(c) {
      const { i, phrase, rng, prng, push } = c;
      const section = phrase % 3;
      const chord = GALAXY_PROG[i];
      push(0, 'pad', chord.pad, vary(rng, 0.52, 0.04), 16, { attack: 1.1, release: 2.2 });
      push(0, 'sub', [chord.bass + 12], 0.45, 15);
      if (i % 2 === 0) push(0, 'air', [], 0.5, 32);
      // Arpeggio over the chord tones, two octaves up.
      const pool = [];
      for (const m of chord.pad) for (const o of [12, 24]) if (m + o >= note('C5') && m + o <= note('A6')) pool.push(m + o);
      pool.sort((a, b) => a - b);
      const shape = pick(prng, ['up', 'down', 'updown', 'skip', 'walk']);
      const rate = section === 1 ? 1 : 2;
      const count = STEPS / rate;
      let walk = Math.floor(pool.length / 2);
      for (let k = 0; k < count; k++) {
        const s = k * rate;
        const onBeat = s % 4 === 0;
        if (!onBeat && chance(rng, 0.12)) continue;
        const L = pool.length;
        let idx;
        if (shape === 'up') idx = k % L;
        else if (shape === 'down') idx = L - 1 - (k % L);
        else if (shape === 'updown') idx = (k % (2 * L - 2)) < L ? k % (2 * L - 2) : 2 * L - 2 - (k % (2 * L - 2));
        else if (shape === 'skip') idx = (k * 2 + Math.floor(k / L)) % L;
        else idx = walk = clamp(walk + pick(rng, [-1, 1, 1, -2, 2]), 0, L - 1);
        push(s, 'bell', [pool[idx]], onBeat ? vary(rng, 0.5, 0.03) : vary(rng, 0.27, 0.04), rate * 2);
      }
      if (section >= 1) {
        push(0, 'softkick', [], 0.5);
        push(8, 'softkick', [], 0.4);
      }
      if (section === 2 && chance(rng, 0.35)) push(pick(rng, [6, 10, 14]), 'glint', [pool[pool.length - 1]], 0.35);
    },
  },

  // Minimal deep house: four-on-the-floor, offbeat hats, filtered bass, chord stabs.
  mirror: {
    id: 'mirror',
    title: 'House',
    bpm: 118,
    swing: 0.06,
    root: note('A3'),
    scale: [0, 2, 3, 5, 7, 9, 10],
    bus: { tone: 12000, wow: 0, reverb: 1, delay: { beats: 0.75, feedback: 0.35, tone: 2600 }, level: 1.2 },
    mix: { kick: 0.6, hat: 0.6, chat: 0.6, clap: 0.8, hbass: 0.7, stab: 1, pad: 0.8 },
    rev: { stab: 0.35, clap: 0.2, hat: 0.06, pad: 0.4 },
    dly: { stab: 0.35, chat: 0.12 },
    compose(c) {
      const { i, phrase, bar, rng, prng, push } = c;
      const section = phrase % 4;
      const prog = MIRROR_PROGS[Math.floor(prng() * MIRROR_PROGS.length)];
      const chord = MIRROR_CHORDS[prog[i]];
      const breakdown = section === 3 && i < 2;
      for (const s of BEATS) push(s, 'kick', [], breakdown ? 0.5 : vary(rng, s === 0 ? 0.9 : 0.84, 0.02), 1, { muffle: breakdown ? 1 : 0, house: 1 });
      for (const s of [2, 6, 10, 14]) push(s, 'hat', [], vary(rng, breakdown ? 0.3 : 0.42, 0.04), 1, { open: 1 });
      if (section >= 1 && !breakdown) {
        for (let s = 1; s < 16; s += 2) if (chance(rng, 0.7)) push(s, 'chat', [], vary(rng, 0.16, 0.04));
        push(4, 'clap', [], vary(rng, 0.45, 0.03));
        push(12, 'clap', [], vary(rng, 0.48, 0.03));
        if (i === 7 && chance(rng, 0.5)) push(15, 'clap', [], 0.22);
      }
      if (!breakdown) {
        const pattern = MIRROR_BASS[Math.floor(prng() * MIRROR_BASS.length)];
        const sweep = 0.5 - 0.5 * Math.cos((2 * Math.PI * (bar % 8)) / 8);
        const cutoff = 380 + 650 * sweep + section * 90;
        for (const [s, off, len] of pattern) push(s, 'hbass', [chord.bass + off], vary(rng, 0.72, 0.05), len, { cutoff });
      }
      if (section >= 1 || breakdown) {
        const steps = pick(rng, MIRROR_STABS);
        for (const s of steps) push(s, 'stab', chord.stab, vary(rng, 0.5, 0.04), 2, { cutoff: 1600 + rng() * 1000 });
      }
      if (section >= 1 || breakdown) push(0, 'pad', chord.stab.map((m) => m - 12), breakdown ? 0.46 : section === 1 ? 0.24 : 0.34, 16, { attack: 0.6, release: 1.4, cutoff: 1200 });
    },
  },

  // Playful: bouncy bass, a plucked pentatonic melody, claps and a shaker.
  shapes: {
    id: 'shapes',
    title: 'Play',
    bpm: 108,
    swing: 0.08,
    root: note('C4'),
    scale: [0, 2, 4, 7, 9],
    bus: { tone: 12000, wow: 0, reverb: 1, delay: { beats: 0.75, feedback: 0.28, tone: 3000 }, level: 1.2 },
    mix: { kick: 0.52, clap: 0.65, shaker: 0.4, bbass: 0.62, pluck: 0.95, comp: 0.45 },
    rev: { pluck: 0.25, clap: 0.18, comp: 0.25 },
    dly: { pluck: 0.22, comp: 0.15 },
    compose(c) {
      const { i, phrase, rng, prng, push, seed } = c;
      const section = phrase % 3;
      const prog = SHAPES_PROGS[Math.floor(prng() * SHAPES_PROGS.length)];
      const chordAtBar = (k) => SHAPES_CHORDS[prog[clamp(k, 0, 7)]];
      const chord = chordAtBar(i);
      // Drums
      push(0, 'kick', [], vary(rng, 0.82, 0.03));
      push(8, 'kick', [], vary(rng, 0.74, 0.03));
      if (chance(rng, 0.35)) push(pick(rng, [6, 10]), 'kick', [], 0.45);
      push(4, 'clap', [], vary(rng, 0.5, 0.03));
      push(12, 'clap', [], vary(rng, 0.52, 0.03));
      if (i === 7 && chance(rng, 0.6)) {
        push(14, 'clap', [], 0.26);
        push(15, 'clap', [], 0.32);
      }
      for (let s = 0; s < 16; s++) push(s, 'shaker', [], vary(rng, s % 2 ? 0.1 : s % 4 === 0 ? 0.2 : 0.15, 0.02));
      // Bouncy bass
      const bassPattern = SHAPES_BASS[Math.floor(prng() * SHAPES_BASS.length)];
      // Accents on the beats, a bit lighter where the kick already hits (no kick + bass pile-up).
      for (const [s, off, len] of bassPattern) push(s, 'bbass', [chord.bass + 12 + off], vary(rng, s % 8 === 0 ? 0.68 : s % 4 === 0 ? 0.78 : 0.62, 0.04), len);
      // Melody: a two-bar motif, repeated, varied, then answered.
      const playMelody = section !== 0 || i >= 4;
      if (playMelody) {
        const pair = Math.floor(i / 2);
        const motifRng = mulberry32(hashSeed('shapes-motif', seed, phrase));
        const rhythm = pick(motifRng, SHAPES_RHYTHMS);
        const startIdx = 2 + Math.floor(motifRng() * 3);
        const chordAt = (step) => pcs(chordAtBar(pair * 2 + (step >= 16 ? 1 : 0)).tones);
        let mel = walkMelody(motifRng, rhythm, SHAPES_POOL, startIdx, chordAt);
        if (pair === 1 || pair === 3) {
          // Variation / answer: re-walk the end of the phrase from this pair's own seed.
          const vr = mulberry32(hashSeed('shapes-var', seed, phrase, pair));
          const keep = pair === 1 ? mel.length - 2 : Math.ceil(mel.length / 2);
          const lastIdx = SHAPES_POOL.indexOf(mel[keep - 1].midi);
          const tail = walkMelody(vr, rhythm.slice(keep), SHAPES_POOL, lastIdx, chordAt);
          mel = mel.slice(0, keep).concat(tail);
          if (pair === 3) {
            // End the phrase at home: the last note is the chord root.
            const last = mel[mel.length - 1];
            last.midi = snapTo(SHAPES_POOL, last.midi, [chordAtBar(7).bass % 12]);
          }
        }
        const half = i % 2 === 0 ? 0 : 16;
        for (const n of mel) {
          if (n.step < half || n.step >= half + 16) continue;
          const s = n.step - half;
          push(s, 'pluck', [n.midi], vary(rng, s % 4 === 0 ? 0.55 : 0.45, 0.04), n.len);
          if (section === 2) {
            const under = snapTo(scaleRange(note('C4'), [0, 2, 4, 5, 7, 9, 11], note('G4'), note('C6')), n.midi - 4, null);
            push(s, 'pluck', [under], 0.24, n.len);
          }
        }
      }
      if (section === 2) for (const s of [6, 14]) push(s, 'comp', chord.tones.slice(1), vary(rng, 0.3, 0.04), 1);
    },
  },
};

export const DEFAULT_MOOD = 'galaxy';

/** Scene id → mood id ('test' and unknown scenes get the default). */
export function moodFor(sceneId) {
  return Object.prototype.hasOwnProperty.call(MOODS, sceneId) ? sceneId : DEFAULT_MOOD;
}

/**
 * Compose one bar.
 * @returns {{mood: string, bar: number, phrase: number, beats: readonly number[], events: object[]}}
 */
export function generateBar(moodId, bar, seed = 0) {
  const mood = MOODS[moodFor(moodId)];
  const phrase = Math.floor(bar / 8);
  const i = ((bar % 8) + 8) % 8;
  const events = [];
  const push = (step, inst, notes, vel, len = 1, extra) => {
    events.push({ step, inst, notes, vel: Math.round(vel * 1000) / 1000, len, ...extra });
  };
  mood.compose({
    bar,
    i,
    phrase,
    seed,
    rng: mulberry32(hashSeed(mood.id, seed, 'bar', bar)),
    prng: mulberry32(hashSeed(mood.id, seed, 'phrase', phrase)),
    push,
  });
  events.sort((a, b) => a.step - b.step);
  return { mood: mood.id, bar, phrase, beats: BEATS, events };
}
