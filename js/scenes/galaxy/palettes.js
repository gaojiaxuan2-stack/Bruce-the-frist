// Curated inside -> outside colour pairs for random galaxies (✌️ gesture).
// Every pair keeps a warm / bright core and a cooler / deeper rim so the
// spiral always reads well against black.

export const PALETTES = [
  { name: 'Ember & Ocean', inside: '#ff6030', outside: '#1b3984' },
  { name: 'Rose Nebula', inside: '#ff7eb3', outside: '#3b1fa3' },
  { name: 'Solar Teal', inside: '#ffb347', outside: '#0f8f9a' },
  { name: 'Magenta Sky', inside: '#ff3cac', outside: '#2b6fd6' },
  { name: 'Andromeda', inside: '#ffe8c2', outside: '#3657c9' },
  { name: 'Violet Fire', inside: '#ffa62b', outside: '#6a1bb5' },
  { name: 'Aurora', inside: '#d4ff6b', outside: '#0a7d8c' },
  { name: 'Candy', inside: '#ff9a8b', outside: '#5c6cf2' },
  { name: 'Plasma', inside: '#ff2f6d', outside: '#7928ca' },
  { name: 'Ice Crown', inside: '#e6fbff', outside: '#2a77d4' },
  { name: 'Golden Hour', inside: '#ffd36b', outside: '#c2185b' },
  { name: 'Emerald', inside: '#fff3a0', outside: '#0d8a5f' },
];

/** Small deterministic PRNG (mulberry32) so a galaxy is stable across regenerations. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (a, b) => a + Math.random() * (b - a);
const round = (v, step) => +(Math.round(v / step) * step).toFixed(3);

/**
 * A fresh random galaxy recipe that is guaranteed to look different from `current`
 * (another palette and, usually, another number of arms).
 */
export function randomGalaxy(current) {
  let palette;
  do palette = pick(PALETTES);
  while (palette.inside === current.insideColor && PALETTES.length > 1);
  let branches;
  do branches = pick([2, 2, 3, 3, 4, 4, 5, 6]);
  while (branches === current.branches && Math.random() < 0.7);
  return {
    palette,
    branches,
    spin: round(between(0.55, 1.9), 0.01),
    randomness: round(between(0.13, 0.42), 0.001),
    randomnessPower: round(between(2.2, 3.8), 0.1),
  };
}
