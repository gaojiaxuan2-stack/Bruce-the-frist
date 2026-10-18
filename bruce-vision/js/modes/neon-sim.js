// neon-sim.js — synthetic-hand scenarios for NEON DRAW (?sim=neon:<name>).
//
// The sim's 'pinch' pose puts the pinch point at a fixed offset from the
// wrist, so a shape is traced by moving the wrist along it minus that offset.
// Every scenario loops and cleans up after itself (✊ or ✌️), so a screenshot
// at any moment shows the effect and strokes never pile up.
//
//   draw     heart, then star, glitter, ✊ shatter        colors   five arcs, one per palette colour
//   clear    spiral + zigzag, then ✊ held                  undo     circle + wave, ✌️ twice
//   point    ☝️ comet cursor                               sparkle  two open hands
//   duo      both hands draw a heart together             brushes  🤏 on the HUD chips to switch brush

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
  spiral: (u) => { const a = u * TAU * 2, r = 0.3 + u * 0.7; return [Math.cos(a) * r, Math.sin(a) * r]; },
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
// A gentle horizontal wave across the middle of the screen at height fy.
const row = (fy) => (u) => {
  const { W, H } = scr(), m = Math.min(W, H), x0 = W * (portrait() ? 0.14 : 0.24), x1 = W - x0;
  return [lerp(x0, x1, u), fy * H + Math.sin(u * TAU * 1.25) * m * 0.05];
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
// Fingers open and the hand travels to the next spot.
const lift = (from, to, dur = 0.5, o) => ({
  dur, fn: (k) => { const a = from(), b = to(), e = smooth(k); return [penAt(lerp(a[0], b[0], e), lerp(a[1], b[1], e), false, o)]; },
});
// A pose held in place (with a little life in it).
const hold = (at, pose, dur, o) => ({ dur, fn: (k, t) => { const p = at(); return [penAt(p[0] + Math.sin(t * 3) * 3, p[1], false, { ...o, pose })]; } });
// An open hand waving gently: fingertip glitter.
const wave = (at, dur, o) => ({ dur, fn: (k, t) => { const p = at(); return [penAt(p[0] + Math.sin(t * 5) * 40, p[1] + Math.cos(t * 4) * 14, false, { ...o, pose: 'open', rot: -0.3 + Math.sin(t * 5) * 0.25 })]; } });
const end = (path) => () => path(1);
const start = (path) => () => path(0);
const at = (fx, fy) => () => { const { W, H } = scr(); return [W * fx, H * fy]; };

// Centre of a HUD option chip (live DOM in the browser, an estimate in node).
let chipCache = { t: -1, map: {} };
function chipAt(id) {
  const { W, H } = scr();
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (now - chipCache.t > 500) {
    chipCache = { t: now, map: {} };
    try {
      for (const b of document.querySelectorAll('#options .chip[data-kind="option"]')) {
        const r = b.getBoundingClientRect();
        if (r.width) chipCache.map[b.dataset.id] = [r.left + r.width / 2, r.top + r.height / 2];
      }
    } catch (e) { /* no DOM */ }
  }
  const order = ['neon', 'rainbow', 'fire', 'stars'];
  return chipCache.map[id] || [W / 2 + (order.indexOf(id) - 1.5) * 110, H - 45];
}

function drawScenario() {
  const p = portrait();
  const heart = p ? place('heart', 0.5, 0.33, 0.3) : place('heart', 0.35, 0.42, 0.27);
  const star = p ? place('star', 0.5, 0.62, 0.3) : place('star', 0.68, 0.43, 0.27);
  const rest = p ? at(0.62, 0.55) : at(0.55, 0.5);
  return [
    hold(start(heart), 'relaxed', 1.0),
    ...stroke(heart, 3.2, undefined, 1.04), lift(end(heart), start(star), 0.6),
    ...stroke(star, 3.0, undefined, 1.03), lift(end(star), rest, 0.5),
    wave(rest, 1.8),
    hold(rest, 'fist', 1.6),
    hold(rest, 'open', 0.6),
    lift(rest, start(heart), 0.5),
  ];
}

export const SCENARIOS = {
  // Heart, then star (one hand), open-hand glitter, then ✊ to shatter.
  draw: (t) => seq(drawScenario())(t),

  // Five separate arcs: one per palette colour, a neon rainbow; ✊ clears.
  colors: (t) => {
    const p = portrait(), cy = p ? 0.5 : 0.66;
    const arcs = [0, 1, 2, 3, 4].map((i) => arc(0.5, cy, (p ? 0.44 : 0.5) - i * (p ? 0.065 : 0.075)));
    const rest = at(0.5, p ? 0.58 : 0.55);
    const steps = [hold(start(arcs[0]), 'relaxed', 0.8)];
    arcs.forEach((a, i) => {
      steps.push(...stroke(a, 1.6 - i * 0.15));
      steps.push(i < 4 ? lift(end(a), start(arcs[i + 1]), 0.45) : lift(end(a), rest, 0.45));
    });
    steps.push(wave(rest, 1.6), hold(rest, 'fist', 1.6), lift(rest, start(arcs[0]), 0.5));
    return seq(steps)(t);
  },

  // Spiral + zigzag, then a fist held until everything shatters.
  clear: (t) => {
    const p = portrait();
    const sp = p ? place('spiral', 0.5, 0.36, 0.3) : place('spiral', 0.37, 0.45, 0.24);
    const zz = p ? place('zig', 0.5, 0.64, 0.32) : place('zig', 0.68, 0.45, 0.2);
    const fistAt = p ? at(0.55, 0.5) : at(0.55, 0.47);
    return seq([
      hold(start(sp), 'relaxed', 0.8),
      ...stroke(sp, 2.8), lift(end(sp), start(zz), 0.45),
      ...stroke(zz, 1.4), lift(end(zz), fistAt, 0.45),
      hold(fistAt, 'fist', 1.6),
      hold(fistAt, 'open', 1.2),
      lift(fistAt, start(sp), 0.4),
    ])(t);
  },

  // Circle, then a wave; ✌️ held removes the wave, the circle stays a moment,
  // then ✌️ again removes the circle too.
  undo: (t) => {
    const p = portrait();
    const ci = p ? place('circle', 0.5, 0.34, 0.24) : place('circle', 0.36, 0.42, 0.22);
    const wv = p ? place('wave', 0.5, 0.6, 0.32) : place('wave', 0.68, 0.42, 0.2);
    const pos = p ? at(0.58, 0.52) : at(0.6, 0.55);
    return seq([
      hold(start(ci), 'relaxed', 0.8),
      ...stroke(ci, 2.0, undefined, 1.05), lift(end(ci), start(wv), 0.45),
      ...stroke(wv, 1.5), lift(end(wv), pos, 0.45),
      hold(pos, 'peace', 1.0),
      hold(pos, 'open', 1.2),
      hold(pos, 'peace', 0.95),
      hold(pos, 'open', 0.8),
      lift(pos, start(ci), 0.45),
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

  // Both hands draw mirrored halves of a heart at once, admire it, ✊ clears.
  duo: (t) => {
    const p = portrait(), cy = p ? 0.42 : 0.44, r = p ? 0.36 : 0.3;
    const right = (u) => place('heart', 0.5, cy, r)(u * 0.5);
    const left = (u) => { const q = right(u); return [scr().W - q[0], q[1]]; };
    const L = { id: 'L', hand: 'left' }, R = { id: 'R', hand: 'right' };
    const both = (fn) => (k, t2) => [...fn(L, left, k, t2), ...fn(R, right, k, t2)];
    // Admire it from beside the heart (well clear of the HUD at the bottom).
    const apart = (o, path, k) => {
      const a = path(1), b = path(0.5), e = smooth(Math.min(1, k * 2));
      return [lerp(a[0], b[0] + (o.hand === 'left' ? -1 : 1) * 70, e), lerp(a[1], b[1] + 40, e)];
    };
    return seq([
      { dur: 0.8, fn: both((o, path) => [penAt(...path(0), false, o)]) },
      { dur: 0.45, fn: both((o, path) => [penAt(...path(0), true, o)]) },
      { dur: 2.8, fn: both((o, path, k) => [penAt(...path(k), true, o)]) },
      { dur: 1.6, fn: both((o, path, k) => [penAt(...apart(o, path, k), false, { ...o, pose: 'open' })]) },
      { dur: 1.6, fn: both((o, path) => [penAt(...apart(o, path, 1), false, { ...o, pose: 'fist' })]) },
      { dur: 0.6, fn: both((o, path, k) => { const a = apart(o, path, 1), b = path(0); return [penAt(lerp(a[0], b[0], smooth(k)), lerp(a[1], b[1], smooth(k)), false, o)]; }) },
    ])(t);
  },

  // Hands-free brush switching: pinch 🤏 a brush chip at the bottom (the HUD
  // takes that pinch, so no ink), then draw a row with it. ✊ clears.
  brushes: (t) => {
    const p = portrait();
    const rows = p ? [0.25, 0.38, 0.51, 0.64] : [0.22, 0.37, 0.52, 0.67];
    const order = ['rainbow', 'fire', 'stars', 'neon'];
    const rest = p ? at(0.55, 0.45) : at(0.5, 0.45);
    const steps = [hold(rest, 'relaxed', 1.4)];
    let prev = rest;
    order.forEach((id, i) => {
      const chip = () => { const c = chipAt(id); return [c[0], c[1]]; };
      const path = row(rows[i]);
      steps.push(
        lift(prev, chip, 0.7),
        hold(chip, 'relaxed', 0.25),
        hold(chip, 'pinch', 0.35),
        hold(chip, 'relaxed', 0.2),
        lift(chip, start(path), 0.6),
        ...stroke(path, 1.7),
      );
      prev = end(path);
    });
    steps.push(lift(prev, rest, 0.5), hold(rest, 'fist', 1.6), hold(rest, 'open', 0.6));
    return seq(steps)(t);
  },
};
