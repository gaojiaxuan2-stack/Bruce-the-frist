// Unit tests for js/input/Gestures.js (run: node --test tests/).
// Hands are synthetic: a small kinematic model (per-joint flexion angles), seen
// rolled, tilted, mirrored (left hand) and at different sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GestureStabilizer,
  OneEuroFilter,
  PinchDetector,
  SwipeDetector,
  THRESHOLDS,
  analyzeHand,
  classifyGesture,
  classifyShape,
  countFingers,
  dist,
  fingerState,
  grabAmount,
  handScale,
  palmCenter,
  pinchStrength,
  rollAngle,
  toHandSpace,
} from '../js/input/Gestures.js';

// ------------------------------------------------------------------ hand model

const DEG = Math.PI / 180;
const FINGERS = [
  { mcp: [-0.34, 0.93], spread: -9, len: [0.45, 0.27, 0.22] }, // index
  { mcp: [-0.1, 1.0], spread: -2, len: [0.5, 0.3, 0.23] }, // middle
  { mcp: [0.13, 0.95], spread: 5, len: [0.46, 0.28, 0.22] }, // ring
  { mcp: [0.33, 0.84], spread: 12, len: [0.36, 0.22, 0.2] }, // pinky
];

const norm = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

/**
 * 21 landmarks in hand space (x right, y up, z toward the camera), palm facing the
 * camera, wrist at the origin, palm length ~1. A right hand as seen in the mirror view.
 * @param {{fingers: number[][], thumb: 'out'|'side'|'folded'|'pinch', spread?: number}} pose
 *   fingers: 4 x [MCP, PIP, DIP] flexion in degrees (0 = straight)
 */
function makeHand({ fingers, thumb = 'out', spread = 1 }) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  FINGERS.forEach((f, i) => {
    const base = 5 + i * 4;
    let p = [f.mcp[0], f.mcp[1], 0];
    pts[base] = { x: p[0], y: p[1], z: 0 };
    let flex = 0;
    for (let j = 0; j < 3; j++) {
      flex += fingers[i][j] * DEG;
      const s = f.spread * spread * DEG;
      const d = [Math.sin(s) * Math.cos(flex), Math.cos(s) * Math.cos(flex), Math.sin(flex)];
      p = [p[0] + d[0] * f.len[j], p[1] + d[1] * f.len[j], p[2] + d[2] * f.len[j]];
      pts[base + j + 1] = { x: p[0], y: p[1], z: p[2] };
    }
  });
  const cmc = [-0.22, 0.2, 0.05];
  pts[1] = { x: cmc[0], y: cmc[1], z: cmc[2] };
  const set = (i, v) => (pts[i] = { x: v[0], y: v[1], z: v[2] });
  if (thumb === 'folded') {
    // Across the front of the curled index / middle fingers.
    set(2, [-0.38, 0.45, 0.22]);
    set(3, [-0.27, 0.66, 0.46]);
    set(4, [-0.02, 0.73, 0.52]);
  } else if (thumb === 'pinch') {
    // Thumb tip touching the index fingertip.
    const tip = pts[8];
    set(2, [-0.36, 0.47, 0.13]);
    set(3, [(tip.x - 0.36) / 2 - 0.06, (tip.y + 0.47) / 2, (tip.z + 0.13) / 2 + 0.03]);
    set(4, [tip.x + 0.02, tip.y - 0.02, tip.z]);
  } else {
    // 'out': spread away from the fingers; 'side': straight out sideways (thumbs-up when rolled).
    const dirs = thumb === 'side'
      ? [norm([-0.9, 0.42, 0.12]), norm([-0.97, 0.22, 0.08]), norm([-1, 0.1, 0.04])]
      : [norm([-0.75, 0.62, 0.1]), norm([-0.62, 0.78, 0.05]), norm([-0.5, 0.86, 0])];
    let p = cmc;
    [0.33, 0.3, 0.25].forEach((len, j) => {
      p = [p[0] + dirs[j][0] * len, p[1] + dirs[j][1] * len, p[2] + dirs[j][2] * len];
      set(2 + j, p);
    });
  }
  return pts;
}

const STRAIGHT = [0, 0, 0];
const CURLED = [88, 100, 65];
const RELAXED = [35, 45, 25];
const POSES = {
  open: { fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], thumb: 'out', spread: 1.6 },
  openThumbIn: { fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], thumb: 'folded' },
  fist: { fingers: [CURLED, CURLED, CURLED, CURLED], thumb: 'folded' },
  point: { fingers: [STRAIGHT, CURLED, CURLED, CURLED], thumb: 'folded' },
  pointL: { fingers: [STRAIGHT, CURLED, CURLED, CURLED], thumb: 'out' },
  victory: { fingers: [STRAIGHT, STRAIGHT, CURLED, CURLED], thumb: 'folded', spread: 1.8 },
  thumbsUp: { fingers: [CURLED, CURLED, CURLED, CURLED], thumb: 'side' },
  pinch: { fingers: [[38, 48, 22], STRAIGHT, STRAIGHT, STRAIGHT], thumb: 'pinch', spread: 1.3 },
  pinchRelaxed: { fingers: [[38, 48, 22], RELAXED, RELAXED, RELAXED], thumb: 'pinch' },
  pinchClosed: { fingers: [[45, 50, 25], CURLED, CURLED, CURLED], thumb: 'pinch' },
};

/** Rigid transform: mirror (left hand), pitch, yaw, roll (counter-clockwise), scale, translate. */
function transform(pts, { roll = 0, pitch = 0, yaw = 0, scale = 0.22, mirror = false, at = [0.7, 0.5] } = {}) {
  const [cr, sr] = [Math.cos(roll * DEG), Math.sin(roll * DEG)];
  const [cp, sp] = [Math.cos(pitch * DEG), Math.sin(pitch * DEG)];
  const [cy, sy] = [Math.cos(yaw * DEG), Math.sin(yaw * DEG)];
  return pts.map(({ x, y, z }) => {
    if (mirror) x = -x;
    const y1 = y * cp - z * sp;
    let z1 = y * sp + z * cp;
    const x1 = x * cy + z1 * sy;
    z1 = -x * sy + z1 * cy;
    return { x: at[0] + (x1 * cr - y1 * sr) * scale, y: at[1] + (x1 * sr + y1 * cr) * scale, z: z1 * scale };
  });
}

/** Rolls x tilts x left/right hand x near/far. */
function* variants({ rolls = [0, 40, -40, 90, 180], tilts = [[0, 0], [25, 0], [-20, 15], [0, -28]] } = {}) {
  for (const roll of rolls) {
    for (const [pitch, yaw] of tilts) {
      for (const mirror of [false, true]) {
        for (const scale of [0.12, 0.3]) yield { roll, pitch, yaw, mirror, scale };
      }
    }
  }
}

const label = (v) => `roll ${v.roll} pitch ${v.pitch} yaw ${v.yaw}${v.mirror ? ' left' : ''} scale ${v.scale}`;

function expectGesture(pose, expected, opts) {
  let n = 0;
  for (const v of variants(opts)) {
    const lm = transform(makeHand(POSES[pose]), v);
    const g = classifyGesture(analyzeHand(lm));
    assert.equal(g, expected, `${pose} (${label(v)}) -> ${g}`);
    n++;
  }
  assert.ok(n > 0);
}

// ------------------------------------------------------------------ geometry helpers

test('model sanity: bones keep their length under transforms', () => {
  const a = makeHand(POSES.open);
  const b = transform(a, { roll: 33, pitch: 20, yaw: -15, scale: 2, mirror: true });
  for (const [i, j] of [[5, 6], [6, 7], [7, 8], [17, 18], [2, 3]]) {
    assert.ok(Math.abs(dist(b[i], b[j]) - 2 * dist(a[i], a[j])) < 1e-9);
  }
});

test('handScale follows size and ignores rotation and gesture', () => {
  const s1 = handScale(transform(makeHand(POSES.open), { scale: 0.1 }));
  const s2 = handScale(transform(makeHand(POSES.open), { scale: 0.3, roll: 70, pitch: 20 }));
  assert.ok(Math.abs(s2 / s1 - 3) < 1e-6);
  const fist = handScale(transform(makeHand(POSES.fist), { scale: 0.1 }));
  assert.ok(Math.abs(fist / s1 - 1) < 1e-6, 'the palm is rigid: the same scale for fist and open hand');
});

test('palmCenter sits between the wrist and the knuckles', () => {
  const lm = makeHand(POSES.open);
  const c = palmCenter(lm);
  assert.ok(c.y > 0.4 && c.y < 0.7, `palm y ${c.y}`);
  assert.ok(Math.abs(c.x) < 0.15);
});

test('rollAngle: 0 = fingers up, + = counter-clockwise, works for both hands', () => {
  for (const roll of [0, 30, -45, 90, -120, 170]) {
    for (const mirror of [false, true]) {
      // The model's wrist->middle-knuckle axis leans ~5.7 deg; correct for it.
      const base = rollAngle(transform(makeHand(POSES.open), { mirror }));
      const r = rollAngle(transform(makeHand(POSES.open), { roll, mirror }));
      const d = Math.atan2(Math.sin(r - base - roll * DEG), Math.cos(r - base - roll * DEG));
      assert.ok(Math.abs(d) < 1e-6, `roll ${roll} mirror ${mirror}: ${r}`);
    }
  }
  assert.ok(Math.abs(rollAngle(makeHand(POSES.open))) < 0.12);
});

test('toHandSpace mirrors x, flips y and z, and keeps units isotropic', () => {
  const raw = Array.from({ length: 21 }, (_, i) => ({ x: 0.25, y: 0.5, z: i === 8 ? -0.1 : 0 }));
  raw[9] = { x: 0.25, y: 0.3, z: 0 }; // 0.2 image heights above the wrist
  raw[5] = { x: 0.35, y: 0.5, z: 0 }; // 0.1 image widths to the right in the raw image
  const out = toHandSpace(raw, 4 / 3);
  assert.ok(Math.abs(out[0].x - 0.75 * (4 / 3)) < 1e-9, 'mirrored x in image-height units');
  assert.ok(out[9].y > out[0].y, 'y up');
  assert.ok(Math.abs(dist(out[0], out[9]) - 0.2) < 1e-9);
  assert.ok(Math.abs(dist(out[0], out[5]) - 0.1 * (4 / 3)) < 1e-9);
  assert.ok(out[5].x < out[0].x, 'right in the raw image = left on screen');
  assert.ok(out[8].z > 0, 'MediaPipe -z (closer) becomes +z');
});

// ------------------------------------------------------------------ fingers & gestures

test('countFingers on the basic poses', () => {
  const n = (p) => countFingers(transform(makeHand(POSES[p]), { roll: 20 }));
  assert.equal(n('open'), 5);
  assert.equal(n('openThumbIn'), 4);
  assert.equal(n('fist'), 0);
  assert.equal(n('point'), 1);
  assert.equal(n('pointL'), 2);
  assert.equal(n('victory'), 2);
});

test('open palm is "open" at any rotation, either hand, near or far', () => expectGesture('open', 'open'));
test('open palm with the thumb tucked in is still "open" (4 fingers)', () => expectGesture('openThumbIn', 'open'));
test('fist is "fist" at any rotation', () => expectGesture('fist', 'fist'));
test('index finger up is "point" at any rotation', () => expectGesture('point', 'point'));
test('point with the thumb out ("L") is still "point"', () => expectGesture('pointL', 'point'));
test('two fingers is "victory" at any rotation', () => expectGesture('victory', 'victory'));

test('thumbs up: sideways fist with the thumb up, tilted either way, both hands', () => {
  for (const v of variants({ rolls: [-90, -70, -110, -45], tilts: [[0, 0], [20, 0], [-15, 20], [0, -25]] })) {
    // The thumb sticks out toward -x; mirrored (left) hands point it toward +x.
    const roll = v.mirror ? -v.roll : v.roll;
    const lm = transform(makeHand(POSES.thumbsUp), { ...v, roll });
    const g = classifyGesture(analyzeHand(lm));
    assert.equal(g, 'thumbsUp', `thumbsUp (${label({ ...v, roll })}) -> ${g}`);
  }
});

test('thumb pointing down / sideways with a closed hand counts as a fist, not thumbs up', () => {
  for (const roll of [90, 180, 0]) {
    const lm = transform(makeHand(POSES.thumbsUp), { roll });
    assert.equal(classifyGesture(analyzeHand(lm)), 'fist', `roll ${roll}`);
  }
});

test('pinch: thumb on index tip, other fingers open / relaxed / closed, any rotation', () => {
  for (const pose of ['pinch', 'pinchRelaxed', 'pinchClosed']) expectGesture(pose, 'pinch');
});

test('a fist is never a pinch, even though thumb and index tips are close', () => {
  for (const v of variants()) {
    const info = analyzeHand(transform(makeHand(POSES.fist), v));
    assert.equal(info.pinchAllowed, false, label(v));
    assert.equal(info.pinch, 0, label(v));
  }
});

test('classifyGesture uses the given stable pinch state', () => {
  const info = analyzeHand(makeHand(POSES.pinch));
  assert.equal(classifyGesture(info, true), 'pinch');
  assert.notEqual(classifyGesture(info, false), 'pinch');
  assert.equal(classifyShape(analyzeHand(makeHand(POSES.open))), 'open');
});

test('pinchStrength goes 0 (apart) .. 1 (touching)', () => {
  const open = transform(makeHand(POSES.open), { scale: 0.2 });
  const pinch = transform(makeHand(POSES.pinch), { scale: 0.2 });
  assert.equal(pinchStrength(open), 0);
  assert.equal(pinchStrength(pinch), 1);
  // Halfway: thumb tip moved away from the index tip by ~0.5 hand scales.
  const half = transform(makeHand(POSES.pinch), { scale: 0.2 });
  const s = handScale(half);
  half[4] = { ...half[4], x: half[8].x - 0.55 * s };
  const v = pinchStrength(half);
  assert.ok(v > 0.3 && v < 0.7, `half pinch ${v}`);
});

test('grab: 0 for an open hand, ~1 for a fist, low while pointing', () => {
  const g = (p) => grabAmount(transform(makeHand(POSES[p]), { roll: -30, scale: 0.2 }));
  assert.ok(g('open') < 0.05, `open ${g('open')}`);
  assert.ok(g('fist') > 0.9, `fist ${g('fist')}`);
  assert.ok(g('point') < 0.35, `point ${g('point')}`);
  assert.ok(g('victory') < 0.35, `victory ${g('victory')}`);
  // Closing the hand gradually increases grab monotonically.
  let prev = -1;
  for (let k = 0; k <= 1.0001; k += 0.1) {
    const f = CURLED.map((a) => a * k);
    const v = grabAmount(makeHand({ fingers: [f, f, f, f], thumb: 'out' }));
    assert.ok(v >= prev - 1e-9, `grab not monotonic at ${k}`);
    prev = v;
  }
});

test('finger hysteresis: a half-bent finger near the threshold does not flicker', () => {
  const hand = (k) => makeHand({ fingers: [STRAIGHT, CURLED.map((a) => a * k), STRAIGHT, STRAIGHT], thumb: 'out', spread: 1.4 });
  let edge = -1;
  for (let k = 0; k <= 1; k += 0.005) {
    if (!fingerState(hand(k), 1).extended) {
      edge = k;
      break;
    }
  }
  assert.ok(edge > 0.05 && edge < 0.9, `edge ${edge}`);
  // Without memory, jitter around the edge flips the count...
  const flips = [edge + 0.01, edge - 0.01, edge + 0.015, edge - 0.005].map((k) => analyzeHand(hand(k)).fingers);
  assert.ok(new Set(flips).size > 1, 'the jitter really crosses the threshold');
  // ...with last frame's state it holds steady.
  let prev = analyzeHand(hand(edge - 0.03)).ext;
  assert.equal(prev[2], true);
  for (const k of [edge + 0.01, edge - 0.01, edge + 0.015, edge - 0.005, edge + 0.02]) {
    const info = analyzeHand(hand(k), prev);
    assert.equal(info.ext[2], true, `k=${k.toFixed(3)}`);
    assert.equal(info.fingers, 5);
    prev = info.ext;
  }
  // Clearly bent: it lets go.
  assert.equal(analyzeHand(hand(Math.min(1, edge + 0.3)), prev).ext[2], false);
});

// ------------------------------------------------------------------ PinchDetector

test('PinchDetector: hysteresis between enter (~0.33) and exit (~0.48)', () => {
  const p = new PinchDetector();
  assert.equal(THRESHOLDS.pinchEnter < THRESHOLDS.pinchExit, true);
  const seq = [
    [0.8, false], [0.4, false], [0.34, false], [0.3, true], [0.4, true], [0.47, true],
    // one noisy frame above the exit line does not release...
    [0.5, true], [0.45, true],
    // ...two do
    [0.5, true], [0.52, false],
    [0.4, false], [0.32, true],
    // clearly open releases at once
    [0.9, false],
  ];
  seq.forEach(([d, expected], i) => assert.equal(p.update(d), expected, `step ${i} d=${d}`));
});

test('PinchDetector: a blocked shape (fist) cannot start a pinch; enterFrames debounces', () => {
  const p = new PinchDetector({ enterFrames: 2 });
  assert.equal(p.update(0.2, false), false);
  assert.equal(p.update(0.2, false), false);
  assert.equal(p.update(0.2, true), false, 'first frame below enter');
  assert.equal(p.update(0.2, true), true, 'second frame');
  assert.equal(p.update(0.2, false), true, 'already pinching: stays');
  p.reset();
  assert.equal(p.pinching, false);
  assert.equal(p.update(0.2, true), false);
  assert.equal(p.update(0.4, true), false, 'interrupted');
  assert.equal(p.update(0.2, true), false);
});

// ------------------------------------------------------------------ GestureStabilizer

test('GestureStabilizer: a new gesture must persist 3 frames and 80 ms', () => {
  const s = new GestureStabilizer({ minFrames: 3, minMs: 80 });
  let t = 0;
  const step = (g, dt = 16) => s.update(g, (t += dt));
  assert.equal(step('fist'), 'none');
  assert.equal(step('fist'), 'none');
  assert.equal(step('fist'), 'none', '3 frames but only 32 ms');
  assert.equal(step('fist'), 'none');
  assert.equal(step('fist'), 'none');
  assert.equal(step('fist'), 'fist', '80 ms after it first appeared');
  // At 30 fps: 3 frames span 66 ms -> needs a 4th frame (100 ms).
  const s2 = new GestureStabilizer({ minFrames: 3, minMs: 80, initial: 'open' });
  let t2 = 0;
  assert.equal(s2.update('point', (t2 += 33)), 'open');
  assert.equal(s2.update('point', (t2 += 33)), 'open');
  assert.equal(s2.update('point', (t2 += 33)), 'open');
  assert.equal(s2.update('point', (t2 += 33)), 'point');
});

test('GestureStabilizer: flicker never switches, returning to the stable value cancels', () => {
  const s = new GestureStabilizer({ minFrames: 3, minMs: 80, initial: 'open' });
  let t = 0;
  for (let i = 0; i < 40; i++) assert.equal(s.update(i % 2 ? 'fist' : 'point', (t += 33)), 'open');
  assert.equal(s.update('fist', (t += 33)), 'open');
  assert.equal(s.update('fist', (t += 33)), 'open');
  assert.equal(s.update('open', (t += 33)), 'open');
  assert.equal(s.update('fist', (t += 33)), 'open', 'count restarted');
  assert.equal(s.force('pinch'), 'pinch');
  assert.equal(s.value, 'pinch');
});

// ------------------------------------------------------------------ SwipeDetector

function runSwipe(det, samples) {
  const out = [];
  for (const [t, x, y = 0, ok = true] of samples) {
    const e = det.update(t, x, y, ok);
    if (e) out.push(e);
  }
  return out;
}

const ramp = (t0, x0, x1, ms, fps = 30, y0 = 0, y1 = y0) => {
  const n = Math.max(1, Math.round((ms / 1000) * fps));
  return Array.from({ length: n + 1 }, (_, i) => [t0 + (ms * i) / n, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
};

test('SwipeDetector: fast moves left / right fire once', () => {
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, 0.5, -0.4, 250)), ['swipeleft']);
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, -0.5, 0.4, 250)), ['swiperight']);
});

test('SwipeDetector: slow moves and small moves are not swipes', () => {
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, -0.8, 0.8, 1500)), [], 'slow');
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, 0, 0.4, 150)), [], 'too short');
});

test('SwipeDetector: vertical / diagonal moves are not swipes', () => {
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, 0, 0.1, 250, 30, 0.6, -0.6)), [], 'vertical');
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, -0.4, 0.4, 250, 30, 0.5, -0.4)), [], 'diagonal');
  assert.deepEqual(runSwipe(new SwipeDetector(), ramp(0, -0.4, 0.4, 250, 30, 0.2, -0.1)), ['swiperight'], 'a little slope is fine');
});

test('SwipeDetector: cooldown blocks a second swipe for ~900 ms', () => {
  const d = new SwipeDetector();
  const first = runSwipe(d, ramp(0, 0.6, -0.4, 250));
  const back = runSwipe(d, ramp(300, -0.4, 0.6, 250)); // the hand coming back
  const later = runSwipe(d, ramp(1400, 0.6, -0.4, 250));
  assert.deepEqual(first, ['swipeleft']);
  assert.deepEqual(back, []);
  assert.deepEqual(later, ['swipeleft']);
});

test('SwipeDetector: only an open hand swipes; losing it resets the motion', () => {
  const d = new SwipeDetector();
  const samples = ramp(0, 0.6, -0.4, 250).map(([t, x, y], i) => [t, x, y, i !== 4]);
  assert.deepEqual(runSwipe(d, samples), [], 'gesture broke in the middle');
  const d2 = new SwipeDetector();
  d2.update(0, 0.6, 0);
  d2.reset(); // hand not detected
  assert.equal(d2.update(100, -0.4, 0), null, 'a jump after a reset is not a swipe');
});

test('SwipeDetector: slow tracking (sparse samples) still catches a quick swipe', () => {
  // ~2 tracking frames per second (500 ms apart): the flick happened between two samples.
  const d = new SwipeDetector();
  assert.equal(d.update(0, -1.0, 0, true, 500), null);
  assert.equal(d.update(560, -0.25, 0.02, true, 500), 'swiperight');
  // The same two samples with fast tracking (33 ms) would be a slow drift: no swipe.
  const fast = new SwipeDetector();
  assert.equal(fast.update(0, -1.0, 0, true, 33), null);
  assert.equal(fast.update(560, -0.25, 0.02, true, 33), null);
  // Slow tracking still needs the distance and rejects slow drifts.
  const d2 = new SwipeDetector();
  assert.equal(d2.update(0, -0.3, 0, true, 500), null);
  assert.equal(d2.update(500, 0.1, 0, true, 500), null, 'too short');
  assert.equal(d2.update(1000, 0.4, 0, true, 500), null, '0.7 NDC over 1 s is a drift');
});

// ------------------------------------------------------------------ OneEuroFilter

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('OneEuroFilter: first sample passes through, repeated timestamps are ignored', () => {
  const f = new OneEuroFilter();
  assert.equal(f.filter(0.3, 1), 0.3);
  assert.equal(f.filter(5, 1), 0.3);
  assert.ok(Number.isFinite(f.filter(0.4, 1.033)));
});

test('OneEuroFilter: removes most jitter from a hand held still', () => {
  const f = new OneEuroFilter({ minCutoff: 1.4, beta: 3.5 });
  const rand = rng(7);
  let inVar = 0;
  let outVar = 0;
  for (let i = 0; i < 600; i++) {
    const noise = (rand() - 0.5) * 0.02;
    const y = f.filter(0.2 + noise, i / 30);
    if (i > 60) {
      inVar += noise * noise;
      outVar += (y - 0.2) ** 2;
    }
  }
  assert.ok(outVar < inVar * 0.15, `jitter energy kept: ${(outVar / inVar).toFixed(3)}`);
});

test('OneEuroFilter: follows fast moves with little lag', () => {
  const f = new OneEuroFilter({ minCutoff: 1.4, beta: 3.5 });
  let y = 0;
  for (let i = 0; i <= 30; i++) y = f.filter(0, i / 30);
  // 2 NDC per second for half a second.
  for (let i = 1; i <= 15; i++) y = f.filter((2 * i) / 30, 1 + i / 30);
  const lag = 1.0 - y;
  assert.ok(lag < 0.12, `lag ${lag.toFixed(3)} NDC at 2 NDC/s`);
  // And it settles on the target once the hand stops.
  for (let i = 1; i <= 30; i++) y = f.filter(1.0, 1.5 + i / 30);
  assert.ok(Math.abs(y - 1.0) < 0.01);
});
