// neon-sim.js — synthetic-hand scenarios for NEON DRAW (?sim=neon:<name>).
//
// The sim's 'pinch' pose puts the pinch point at a fixed offset from the
// wrist, so a shape is traced by moving the wrist along it minus that offset.
// Every scenario loops, so a screenshot at any moment shows the effect.

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (k) => k * k * (3 - 2 * k);
const scr = () => (typeof innerWidth === 'number' && innerWidth > 0 ? { W: innerWidth, H: innerHeight } : { W: 1280, H: 720 });
const portrait = () => { const { W, H } = scr(); return H > W; };
const PINCH_OFF = [-0.278, -1.229];   // pinch point from the wrist, hand units, rot 0 (right hand)

// Hand spec whose pinch point sits at screen px (x, y).
function penAt(x, y, down, { id = 'R', hand = 'right', rot = hand === 'left' ? 0.3 : -0.3, pose } = {}) {
  const { W, H } = scr();
  const size = portrait() ? 0.25 : 0.19, unit = size * Math.min(W, H);
  const ox = hand === 'left' ? -PINCH_OFF[0] : PINCH_OFF[0], oy = PINCH_OFF[1];
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = (ox * c - oy * s) * unit, dy = (ox * s + oy * c) * unit;
  return { id, hand, pose: pose || (down ? 'pinch' : 'relaxed'), x: (x - dx) / W, y: (y - dy) / H, size, rot };
}

// Shapes in unit space (about -1..1), u = 0..1 along the outline.
const SHAPES = {
  heart: (u) => {
    const a = u * TAU, s = Math.sin(a);
    return [(16 * s * s * s) / 17, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17 - 0.15];
  },
  star: (u) => {
    const k = (u * 10) % 10, i = Math.floor(k), f = k - i;
    const v = (j) => { const a = -Math.PI / 2 + (j * Math.PI) / 5, r = j % 2 ? 0.42 : 1; return [Math.cos(a) * r, Math.sin(a) * r]; };
    const p = v(i), q = v(i + 1);
    return [lerp(p[0], q[0], f), lerp(p[1], q[1], f)];
  },
  spiral: (u) => { const a = u * TAU * 2.25, r = 0.12 + u * 0.88; return [Math.cos(a) * r, Math.sin(a) * r]; },
  circle: (u) => [Math.cos(u * TAU - Math.PI / 2), Math.sin(u * TAU - Math.PI / 2)],
  wave: (u) => [u * 2 - 1, Math.sin(u * TAU * 1.5) * 0.3],
  zig: (u) => { const k = u * 6, i = Math.floor(Math.min(5.999, k)), f = k - i; return [u * 2 - 1, ((i % 2 ? 1 - f : f) - 0.5) * 0.7]; },
};

// A shape placed on screen: centre (fractions of W/H) and radius (fraction of min side).
const place = (shape, cx, cy, r) => (u) => {
  const { W, H } = scr(), m = Math.min(W, H), p = SHAPES[shape](u);
  return [cx * W + p[0] * r * m, cy * H + p[1] * r * m];
};
// Arc over the top, left → right.
const arc = (cx, cy, r) => (u) => {
  const { W, H } = scr(), m = Math.min(W, H), a = Math.PI + u * Math.PI;
  return [cx * W + Math.cos(a) * r * m, cy * H + Math.sin(a) * r * m];
};

// Timeline helpers. Each step: { dur, fn: (k 0..1, t) => [handSpec] }.
function seq(steps) {
  const total = steps.reduce((a, s) => a + s.dur, 0);
  return (t) => {
    let ph = t % total;
    for (const s of steps) { if (ph < s.dur) return s.fn(ph / s.dur, t); ph -= s.dur; }
    return [];
  };
}
// Pinch at the start (the nib settles), then trace at an even pace; closed
// shapes overshoot a little so the ends meet despite tracking lag.
const stroke = (path, dur, o, to = 1) => [
  { dur: 0.45, fn: () => [penAt(...path(0), true, o)] },
  { dur, fn: (k) => [penAt(...path((k * 0.85 + smooth(k) * 0.15) * to), true, o)] },
];
// Fingers open and the hand travels to the next start.
const lift = (from, to, dur = 0.5, o) => ({
  dur, fn: (k) => { const a = from(), b = to(), e = smooth(k); return [penAt(lerp(a[0], b[0], e), lerp(a[1], b[1], e), false, o)]; },
});
const hold = (at, pose, dur, o) => ({ dur, fn: (k, t) => { const p = at(); return [penAt(p[0] + Math.sin(t * 3) * 3, p[1], false, { ...o, pose })]; } });
const end = (path) => () => path(1);
const start = (path) => () => path(0);

function drawScenario() {
  const p = portrait();
  const heart = p ? place('heart', 0.5, 0.33, 0.3) : place('heart', 0.35, 0.42, 0.27);
  const star = p ? place('star', 0.5, 0.62, 0.3) : place('star', 0.68, 0.43, 0.27);
  return [
    ...stroke(heart, 3, undefined, 1.04), lift(end(heart), start(star)),
    ...stroke(star, 3, undefined, 1.03), lift(end(star), () => [star(0)[0], star(0)[1] + 60], 0.5),
    hold(() => [star(0)[0], star(0)[1] + 60], 'open', 1.4),
    lift(() => [star(0)[0], star(0)[1] + 60], start(heart), 0.5),
  ];
}

export const SCENARIOS = {
  // Heart, then star (one hand), then an open hand sprinkling glitter.
  draw: (t) => seq(drawScenario())(t),

  // Five separate arcs: one per palette colour, a neon rainbow.
  colors: (t) => {
    const p = portrait(), cy = p ? 0.5 : 0.66;
    const arcs = [0, 1, 2, 3, 4].map((i) => arc(0.5, cy, (p ? 0.44 : 0.5) - i * (p ? 0.065 : 0.075)));
    const steps = [];
    arcs.forEach((a, i) => { steps.push(...stroke(a, 0.9)); steps.push(lift(end(a), start(arcs[(i + 1) % 5]), 0.4)); });
    steps.push(hold(start(arcs[0]), 'open', 1.2));
    return seq(steps)(t);
  },

  // Spiral + zigzag, then a fist held until everything shatters.
  clear: (t) => {
    const p = portrait();
    const sp = p ? place('spiral', 0.5, 0.36, 0.3) : place('spiral', 0.38, 0.45, 0.24);
    const zz = p ? place('zig', 0.5, 0.62, 0.32) : place('zig', 0.66, 0.45, 0.2);
    const fistAt = () => { const { W, H } = scr(); return [W * 0.55, H * (p ? 0.5 : 0.45)]; };
    return seq([
      ...stroke(sp, 1.8), lift(end(sp), start(zz), 0.4),
      ...stroke(zz, 1.2), lift(end(zz), fistAt, 0.4),
      hold(fistAt, 'fist', 1.4),
      hold(fistAt, 'open', 1.6),
    ])(t);
  },

  // Circle, then a wave; ✌️ held once removes the wave.
  undo: (t) => {
    const p = portrait();
    const ci = p ? place('circle', 0.5, 0.34, 0.24) : place('circle', 0.36, 0.42, 0.22);
    const wv = p ? place('wave', 0.5, 0.6, 0.32) : place('wave', 0.66, 0.44, 0.2);
    const at = () => { const { W, H } = scr(); return [W * (p ? 0.55 : 0.6), H * (p ? 0.5 : 0.52)]; };
    return seq([
      ...stroke(ci, 1.8, undefined, 1.05), lift(end(ci), start(wv), 0.4),
      ...stroke(wv, 1.4), lift(end(wv), at, 0.4),
      hold(at, 'peace', 1.05),
      hold(at, 'open', 1.6),
      lift(at, start(ci), 0.4),
    ])(t);
  },

  // ☝️ comet cursor sweeping a figure eight.
  point: (t) => {
    const { W, H } = scr(), m = Math.min(W, H);
    const x = W * 0.5 + Math.sin(t * 1.6) * m * 0.32, y = H * 0.45 + Math.sin(t * 3.2) * m * 0.12;
    return [penAt(x, y, false, { pose: 'point', rot: -0.2 })];
  },

  // Two open hands waving: fingertip glitter.
  sparkle: (t) => {
    const p = portrait(), s = p ? 0.26 : 0.2;
    return [
      { id: 'L', hand: 'left', pose: 'open', x: 0.3 + Math.sin(t * 2.4) * 0.12, y: 0.75 + Math.sin(t * 4.1) * 0.05, size: s, rot: 0.2 + Math.sin(t * 2.4) * 0.3 },
      { id: 'R', hand: 'right', pose: 'open', x: 0.7 + Math.sin(t * 2.1 + 1) * 0.12, y: 0.75 + Math.cos(t * 3.7) * 0.05, size: s, rot: -0.2 + Math.sin(t * 2.1) * 0.3 },
    ];
  },

  // Both hands draw mirrored halves of a heart at once.
  duo: (t) => {
    const p = portrait(), cy = p ? 0.42 : 0.44, r = p ? 0.36 : 0.3;
    const right = (u) => place('heart', 0.5, cy, r)(u * 0.5);
    const left = (u) => { const q = right(u); return [scr().W - q[0], q[1]]; };
    const L = { id: 'L', hand: 'left' }, R = { id: 'R', hand: 'right' };
    const both = (fn) => (k, t2) => [...fn(L, left, k, t2), ...fn(R, right, k, t2)];
    return seq([
      { dur: 0.45, fn: both((o, path) => [penAt(...path(0), true, o)]) },
      { dur: 2.6, fn: both((o, path, k) => [penAt(...path(k), true, o)]) },
      { dur: 1.6, fn: both((o, path, k, t2) => { const q = path(1); return [penAt(q[0] + (o.hand === 'left' ? -1 : 1) * 40 * smooth(Math.min(1, k * 3)), q[1] + 50, false, { ...o, pose: 'open' })]; }) },
    ])(t);
  },
};

// Same strokes, preset brush (the mode reads the scenario name).
SCENARIOS.rainbow = SCENARIOS.draw;
SCENARIOS.fire = SCENARIOS.draw;
SCENARIOS.stars = SCENARIOS.draw;
