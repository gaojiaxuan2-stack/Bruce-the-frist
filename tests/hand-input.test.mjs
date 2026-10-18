// Integration tests: the real HandInput + InputManager, driven by synthetic hands
// through a fake MediaPipe (no browser, no camera). Each test plays a short scene at a
// 30 fps camera / 60 fps render rate with a deterministic clock and checks what the
// scenes would receive (InputState fields and edge events).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ------------------------------------------------------------------ environment

// '@mediapipe/tasks-vision' is a browser import-map name: stub it (tests drive detection).
const HOOKS = `
const STUB = 'export class HandLandmarker { static async createFromOptions() { return { detectForVideo: () => ({ landmarks: [], handedness: [] }), close() {} }; } }\\n'
  + 'export class FilesetResolver { static async forVisionTasks() { return {}; } }\\n';
export async function resolve(specifier, context, next) {
  if (specifier === '@mediapipe/tasks-vision') return { url: 'stub:mediapipe', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'stub:mediapipe') return { format: 'module', source: STUB, shortCircuit: true };
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

let clock = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const noop = () => {};
const fakeEl = { addEventListener: noop, setPointerCapture: noop };
globalThis.window = { addEventListener: noop, innerWidth: 1280, innerHeight: 800 };
globalThis.document = { hidden: false, getElementById: () => null, addEventListener: noop, documentElement: fakeEl };

const { HandInput } = await import('../js/input/HandInput.js');
const { InputManager } = await import('../js/input/InputManager.js');

// ------------------------------------------------------------------ synthetic hands

const DEG = Math.PI / 180;
const FINGERS = [
  { mcp: [-0.34, 0.93], spread: -9, len: [0.45, 0.27, 0.22] },
  { mcp: [-0.1, 1.0], spread: -2, len: [0.5, 0.3, 0.23] },
  { mcp: [0.13, 0.95], spread: 5, len: [0.46, 0.28, 0.22] },
  { mcp: [0.33, 0.84], spread: 12, len: [0.36, 0.22, 0.2] },
];
const norm = (v) => v.map((x) => x / Math.hypot(...v));

/** Same kinematic model as gestures.test.mjs: hand space, palm facing the camera, palm length ~1. */
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
    set(2, [-0.38, 0.45, 0.22]);
    set(3, [-0.27, 0.66, 0.46]);
    set(4, [-0.02, 0.73, 0.52]);
  } else if (thumb === 'pinch') {
    const tip = pts[8];
    set(2, [-0.36, 0.47, 0.13]);
    set(3, [(tip.x - 0.36) / 2 - 0.06, (tip.y + 0.47) / 2, (tip.z + 0.13) / 2 + 0.03]);
    set(4, [tip.x + 0.02, tip.y - 0.02, tip.z]);
  } else {
    const dirs = [norm([-0.75, 0.62, 0.1]), norm([-0.62, 0.78, 0.05]), norm([-0.5, 0.86, 0])];
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
const POSES = {
  open: { fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], thumb: 'out', spread: 1.6 },
  fist: { fingers: [CURLED, CURLED, CURLED, CURLED], thumb: 'folded' },
  pointL: { fingers: [STRAIGHT, CURLED, CURLED, CURLED], thumb: 'out' },
  pinch: { fingers: [[38, 48, 22], STRAIGHT, STRAIGHT, STRAIGHT], thumb: 'pinch', spread: 1.3 },
  pinchClosed: { fingers: [[45, 50, 25], CURLED, CURLED, CURLED], thumb: 'pinch' },
};

/** Place a hand in the (mirrored) picture: `at` in hand space (image heights, y up). */
function place(pose, { at = [0.66, 0.45], scale = 0.2 } = {}) {
  return makeHand(POSES[pose]).map(({ x, y, z }) => ({ x: at[0] + x * scale, y: at[1] + y * scale, z: z * scale }));
}
const mix = (a, b, k) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k, z: p.z + (b[i].z - p.z) * k }));
const ease = (k) => k * k * (3 - 2 * k);

const ASPECT = 640 / 480;
/** Hand space -> raw MediaPipe landmarks (un-mirrored, y down, image-width units). */
const toRaw = (pts) => pts.map((p) => ({ x: 1 - p.x / ASPECT, y: 1 - p.y, z: -p.z / ASPECT }));

// ------------------------------------------------------------------ simulator

/**
 * @param {{camFps?: number, renderFps?: number}} [o]
 * @returns {{hi: HandInput, run(ms: number, scene: (t: number) => object[]|null): object[]}}
 *   scene(t) returns the hands in the camera frame at t ms: [{pts, label?}] (label is
 *   MediaPipe's, i.e. 'Left' for the user's right hand).
 */
function makeSim({ camFps = 30, renderFps = 60 } = {}) {
  clock = 10000;
  const t0 = clock;
  const app = { settings: { showPreview: false }, params: new URLSearchParams(), renderer: { domElement: fakeEl } };
  const hi = new HandInput(app);
  hi._running = true;
  hi.delegate = 'CPU';
  let current = { landmarks: [], handedness: [] };
  hi.landmarker = { detectForVideo: () => current, close: noop };
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 };
  hi._video = video;
  const im = new InputManager(app);
  im.hand = hi;
  let nextCam = clock;
  const log = [];
  return {
    hi,
    log,
    /** The main thread is blocked for `ms` (GC, shader compile): no update() runs at all. */
    stall(ms) {
      clock += ms;
    },
    run(ms, scene) {
      const end = clock + ms;
      while (clock < end) {
        if (clock >= nextCam) {
          video.currentTime += 1 / camFps;
          const hands = scene(clock - t0) || [];
          current = {
            landmarks: hands.map((h) => toRaw(h.pts)),
            handedness: hands.map((h) => [{ categoryName: h.label || 'Left', score: 0.98 }]),
          };
          nextCam += 1000 / camFps;
        }
        const s = im.update(1 / renderFps);
        log.push({
          t: Math.round(clock - t0), source: s.source, active: s.active, gesture: s.gesture, pinching: s.pinching,
          fist: s.fist, open: s.open, pointer: { ...s.pointer }, zoom: s.zoom, twoHands: s.twoHands,
          dragDelta: { ...s.dragDelta }, events: [...s.events],
        });
        clock += 1000 / renderFps;
      }
      return log;
    },
  };
}

const events = (log) => log.flatMap((r) => r.events.map((e) => ({ t: r.t, e, gesture: r.gesture })));
const firstEvent = (log, name) => log.find((r) => r.events.includes(name));
const W = 1280;
const H = 800;
const px = (p) => ({ x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H });

// ------------------------------------------------------------------ tests

test('pinch, then close the hand into a fist: the pinch ends and the fist starts', () => {
  const sim = makeSim();
  const open = place('open');
  const pinch = place('pinch');
  const fist = place('fist');
  const log = sim.run(3300, (t) => {
    let pts;
    if (t < 500) pts = open;
    else if (t < 750) pts = mix(open, pinch, (t - 500) / 250);
    else if (t < 1350) pts = pinch;
    else if (t < 1650) pts = mix(pinch, fist, (t - 1350) / 300);
    else pts = fist;
    return [{ pts }];
  });
  const start = firstEvent(log, 'pinchstart');
  const end = firstEvent(log, 'pinchend');
  const fistStart = firstEvent(log, 'fiststart');
  assert.ok(start && start.t < 900, 'pinch recognised');
  assert.ok(end, 'the pinch ended when the hand closed');
  assert.ok(fistStart, 'fiststart fired');
  assert.ok(fistStart.t - end.t < 150, `the fist follows the pinch end at once (${end.t} -> ${fistStart.t})`);
  const last = log[log.length - 1];
  assert.equal(last.gesture, 'fist');
  assert.equal(last.pinching, false);
  assert.equal(last.fist, true);
  // No flicker on the way: the gesture goes pinch -> fist without an "open" blip.
  const after = events(log).filter((e) => e.t >= end.t);
  assert.ok(!after.some((e) => e.e === 'openstart'), JSON.stringify(after));
});

test('releasing a pinch made with the other fingers curled gives no false fist / thumbs up', () => {
  const sim = makeSim();
  const point = place('pointL');
  const pinch = place('pinchClosed');
  const log = sim.run(2400, (t) => {
    if (t < 500) return [{ pts: point }];
    if (t < 700) return [{ pts: mix(point, pinch, (t - 500) / 200) }];
    if (t < 1300) return [{ pts: pinch }];
    if (t < 1500) return [{ pts: mix(pinch, point, (t - 1300) / 200) }];
    return [{ pts: point }];
  });
  const end = firstEvent(log, 'pinchend');
  assert.ok(firstEvent(log, 'pinchstart') && end, 'pinch on and off');
  const after = log.filter((r) => r.t >= end.t);
  assert.ok(!after.some((r) => r.fist || r.gesture === 'thumbsUp' || r.gesture === 'fist'),
    after.map((r) => r.gesture).filter((g, i, a) => g !== a[i - 1]).join(' -> '));
  assert.equal(log[log.length - 1].gesture, 'point');
});

test('a pinch-click lands where the finger aimed, and a pinch-drag follows the hand 1:1', () => {
  const sim = makeSim();
  const at = [0.66, 0.45];
  const point = place('pointL', { at });
  const pinch = place('pinch', { at });
  const log = sim.run(1000, (t) => {
    if (t < 500) return [{ pts: point }];
    if (t < 750) return [{ pts: mix(point, pinch, (t - 500) / 250) }];
    return [{ pts: pinch }];
  });
  const aimed = px(log.find((r) => r.t >= 480).pointer);
  const start = firstEvent(log, 'pinchstart');
  assert.ok(start, 'pinch recognised');
  const clicked = px(start.pointer);
  const err = Math.hypot(clicked.x - aimed.x, clicked.y - aimed.y);
  assert.ok(err < 8, `click ${err.toFixed(1)} px from the aim (${JSON.stringify(aimed)} vs ${JSON.stringify(clicked)})`);
  // During the whole forming phase the cursor stays near the aim (no visible dip).
  for (const r of log.filter((q) => q.t >= 500 && q.t <= start.t)) {
    const p = px(r.pointer);
    assert.ok(Math.hypot(p.x - aimed.x, p.y - aimed.y) < 25, `t ${r.t}: ${JSON.stringify(p)}`);
  }
  // Drag: move the pinching hand 0.1 image heights right (mirrored view) over 300 ms.
  const before = log[log.length - 1].pointer;
  let drag = 0;
  sim.run(600, (t) => [{ pts: place('pinch', { at: [at[0] + 0.1 * ease(Math.min(1, (t - 1000) / 300)), at[1]] }) }]);
  const tail = sim.log.slice(-36);
  for (const r of tail) drag += r.dragDelta.x;
  const moved = tail[tail.length - 1].pointer.x - before.x;
  const expected = (0.1 / ASPECT / (0.88 - 0.12)) * 2; // image widths -> NDC through REGION
  assert.ok(Math.abs(moved - expected) < 0.03, `moved ${moved.toFixed(3)} NDC, expected ${expected.toFixed(3)}`);
  assert.ok(drag > expected * 0.8, `dragDelta summed ${drag.toFixed(3)}`);
  assert.ok(sim.log.slice(-36).every((r) => r.pinching), 'still pinching');
});

test('a swipe survives a camera frame where the hand was not found', () => {
  for (const drop of [0.3, 0.5, 0.7]) {
    let fired = 0;
    for (let phase = 0; phase < 6; phase++) {
      const sim = makeSim();
      let dropped = false;
      const log = sim.run(1600, (t) => {
        const s = t - 600 - phase * 5;
        const k = s < 0 ? 0 : s > 250 ? 1 : ease(s / 250);
        if (!dropped && k >= drop) {
          dropped = true;
          return [];
        }
        return [{ pts: place('open', { at: [0.95 - k * 0.4 * ASPECT, 0.5] }) }];
      });
      if (log.some((r) => r.events.includes('swipeleft'))) fired++;
    }
    assert.equal(fired, 6, `one missed frame at ${drop * 100}% of the move: ${fired}/6 fired`);
  }
});

test('swipes: a ~0.6 NDC flick fires (toward the screen side the hand moved), slow moves do not', () => {
  // 0.24 of the image width = 0.63 NDC through the mapping region, in 250 ms.
  const run = (dir, ms, dist = 0.24) => {
    const sim = makeSim();
    const log = sim.run(600 + ms + 700, (t) => {
      const s = t - 600;
      const k = s < 0 ? 0 : s > ms ? 1 : ease(s / ms);
      return [{ pts: place('open', { at: [(0.7 + dir * (k - 0.5) * dist) * ASPECT, 0.5] }) }];
    });
    return log.flatMap((r) => r.events.filter((e) => e.startsWith('swipe')));
  };
  assert.deepEqual(run(-1, 250), ['swipeleft']);
  assert.deepEqual(run(+1, 250), ['swiperight']);
  assert.deepEqual(run(-1, 900), [], 'a slow move is not a swipe');
  assert.deepEqual(run(-1, 250, 0.12), [], 'a short flick is not a swipe');
});

test('the hand coming back after a dropout reports no stale gesture', () => {
  for (const gap of [300, 600, 1200]) {
    const sim = makeSim();
    const fist = place('fist');
    const open = place('open');
    const log = sim.run(2000 + gap + 500, (t) => {
      if (t < 1000) return [{ pts: fist }];
      if (t < 1000 + gap) return [];
      return [{ pts: open }];
    });
    const back = log.filter((r) => r.t >= 1000 + gap);
    const evs = events(back).map((e) => e.e);
    assert.ok(!evs.includes('fiststart'), `gap ${gap}: ${evs.join(' ')}`);
    assert.ok(!back.some((r) => r.fist), `gap ${gap}: no fist after the return`);
    assert.ok(evs.includes('openstart'), `gap ${gap}: the open hand is reported`);
  }
});

test('a short tracking dropout (< 200 ms) keeps the hand and its gesture', () => {
  const sim = makeSim();
  const fist = place('fist');
  const log = sim.run(1600, (t) => (t >= 800 && t < 900 ? [] : [{ pts: fist }]));
  const held = log.filter((r) => r.t >= 300);
  assert.ok(held.every((r) => r.source === 'hand' && r.fist), 'stays a fist through the dropout');
  assert.equal(events(held).length, 0, JSON.stringify(events(held)));
});

test('a main-thread stall (no detection ran) is not a lost hand', () => {
  const sim = makeSim();
  const fist = place('fist');
  sim.run(1000, () => [{ pts: fist }]);
  sim.stall(600);
  const n = sim.log.length;
  sim.run(800, () => [{ pts: fist }]);
  const after = sim.log.slice(n);
  assert.ok(after.every((r) => r.source === 'hand' && r.gesture === 'fist'), after.map((r) => r.gesture).join(' '));
  assert.equal(events(after).length, 0, JSON.stringify(events(after)));
});

test('two hands spreading apart zoom in, closing zoom out', () => {
  const sim = makeSim();
  // MediaPipe labels assume a mirrored picture: the user's right hand comes as 'Left'.
  const both = (spread) => [
    { pts: place('open', { at: [(0.5 + spread) * ASPECT, 0.45], scale: 0.16 }), label: 'Left' },
    { pts: place('open', { at: [(0.5 - spread) * ASPECT, 0.45], scale: 0.16 }), label: 'Right' },
  ];
  let log = sim.run(500, () => both(0.15));
  assert.ok(log[log.length - 1].twoHands);
  log = sim.run(1000, (t) => both(0.15 + 0.1 * Math.min(1, (t - 500) / 400)));
  const zoomIn = log.slice(30).reduce((a, r) => a + r.zoom, 0);
  // The palms moved 0.2 image widths further apart = 0.53 NDC; x2.5.
  const expected = ((0.2 * 2) / (0.88 - 0.12)) * 2.5;
  assert.ok(Math.abs(zoomIn - expected) < expected * 0.15, `zoom ${zoomIn.toFixed(3)} vs ${expected.toFixed(3)}`);
  const n = sim.log.length;
  sim.run(1000, (t) => both(0.25 - 0.1 * Math.min(1, (t - 1500) / 400)));
  const zoomOut = sim.log.slice(n).reduce((a, r) => a + r.zoom, 0);
  assert.ok(zoomOut < -expected * 0.85, `zoom out ${zoomOut.toFixed(3)}`);
  assert.equal(sim.hi.primary.handedness, 'Right', "the user's right hand leads");
});
