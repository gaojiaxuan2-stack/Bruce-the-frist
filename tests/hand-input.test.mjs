// Integration tests: the real HandInput + InputManager, driven by synthetic hands
// through a fake MediaPipe (no browser, no camera). Each test plays a short scene at a
// 30 fps camera / 60 fps render rate with a deterministic clock and checks what the
// scenes would receive (InputState fields and edge events).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ------------------------------------------------------------------ environment

// '@mediapipe/tasks-vision' and 'three' are browser import-map names: stub them (tests
// drive detection / segmentation; the landmarker stub records the options it was made with).
const HOOKS = `
const STUB = 'export class HandLandmarker { static async createFromOptions(fileset, options) { globalThis.__handOptions = options; return { detectForVideo: () => ({ landmarks: [], handedness: [] }), setOptions(o) { (globalThis.__setOptions ||= []).push(o); return Promise.resolve(); }, close() {} }; } }\\n'
  + 'export class ImageSegmenter { static async createFromOptions() { return { segmentForVideo() {}, close() {} }; } }\\n'
  + 'export class FilesetResolver { static async forVisionTasks() { return {}; } }\\n';
const THREE = 'export class DataTexture { constructor(data, width, height) { this.image = { data, width, height }; } dispose() {} }\\n'
  + 'export const RedFormat = 1028, UnsignedByteType = 1009, LinearFilter = 1006, ClampToEdgeWrapping = 1001;\\n';
export async function resolve(specifier, context, next) {
  if (specifier === '@mediapipe/tasks-vision') return { url: 'stub:mediapipe', shortCircuit: true };
  if (specifier === 'three') return { url: 'stub:three', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'stub:mediapipe') return { format: 'module', source: STUB, shortCircuit: true };
  if (url === 'stub:three') return { format: 'module', source: THREE, shortCircuit: true };
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

let clock = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const noop = () => {};
const fakeEl = { addEventListener: noop, setPointerCapture: noop };
globalThis.window = { addEventListener: noop, innerWidth: 1280, innerHeight: 800 };
globalThis.document = {
  hidden: false,
  getElementById: () => null,
  addEventListener: noop,
  documentElement: fakeEl,
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: noop }) }),
};

const { HandInput, VISION_SHARE } = await import('../js/input/HandInput.js');
const { InputManager } = await import('../js/input/InputManager.js');
const { PersonSegmenter } = await import('../js/scenes/mirror/PersonSegmenter.js');

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
function makeSim({ camFps = 30, renderFps = 60, app: extra = {} } = {}) {
  clock = 10000;
  const t0 = clock;
  const app = { settings: { showPreview: false }, params: new URLSearchParams(), renderer: { domElement: fakeEl }, ...extra };
  const hi = new HandInput(app);
  hi._running = true;
  hi.delegate = 'CPU';
  let current = { landmarks: [], handedness: [] };
  /** times (ms since the start) at which detection ran */
  const detections = [];
  hi.landmarker = {
    detectForVideo: () => {
      detections.push(Math.round(clock - t0));
      return current;
    },
    close: noop,
  };
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 };
  hi._video = video;
  const im = new InputManager(app);
  im.hand = hi;
  let nextCam = clock;
  const log = [];
  return {
    hi,
    log,
    detections,
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

test("strict swipes (meta.swipe = 'strict'): moving the open hand to steer is not a swipe, a flick is", () => {
  // dist in NDC through the mapping region (0.76 image widths = 2 NDC), centred in the picture.
  const run = (strict, dist, ms) => {
    const sim = makeSim();
    if (strict) sim.hi.app.active = { meta: { swipe: 'strict' } };
    const perNdc = (0.76 / 2) * ASPECT;
    const x0 = 0.5 * ASPECT - (dist * perNdc) / 2;
    const log = sim.run(600 + ms + 800, (t) => {
      const s = t - 600;
      const k = s < 0 ? 0 : s > ms ? 1 : ease(s / ms);
      return [{ pts: place('open', { at: [x0 + k * dist * perNdc, 0.3] }) }];
    });
    assert.equal(sim.hi.debug.swipeMode, strict ? 'strict' : 'normal');
    return log.flatMap((r) => r.events.filter((e) => e.startsWith('swipe')));
  };
  for (const [d, ms] of [[0.6, 400], [0.8, 500], [1.0, 600], [1.2, 700]]) {
    assert.deepEqual(run(true, d, ms), [], `strict: ${d} NDC in ${ms} ms is a move`);
  }
  assert.deepEqual(run(false, 1.0, 600), ['swiperight'], 'the default still takes it (other scenes are unchanged)');
  for (const [d, ms] of [[0.63, 250], [0.8, 300], [1.0, 350]]) {
    assert.deepEqual(run(true, d, ms), ['swiperight'], `strict: a ${d} NDC / ${ms} ms flick still swipes`);
  }
});

test('depth is relative to where the hand rests: neutral at any distance, closer / farther from there', () => {
  for (const scale of [0.09, 0.2, 0.4]) {
    const sim = makeSim();
    sim.run(1500, () => [{ pts: place('open', { scale }) }]);
    assert.ok(Math.abs(sim.hi.frame.depth - 0.5) < 0.01, `hand at scale ${scale}: depth ${sim.hi.frame.depth.toFixed(3)}`);
    // Bring it 1.6x closer (0.6 per doubling = +0.41 closeness, 0.31 past the dead zone).
    sim.run(1200, (t) => [{ pts: place('open', { scale: scale * (1 + 0.6 * Math.min(1, (t - 1500) / 400)) }) }]);
    const closer = sim.hi.frame.depth;
    assert.ok(closer > 0.74 && closer < 0.86, `scale ${scale} -> x1.6: depth ${closer.toFixed(3)}`);
  }
  // A far user (the hand is 0.42x the "comfortable" size) moving 1.5x farther still zooms out.
  const sim = makeSim();
  sim.run(1500, () => [{ pts: place('open', { scale: 0.09 }) }]);
  sim.run(1200, (t) => [{ pts: place('open', { scale: 0.09 / (1 + 0.5 * Math.min(1, (t - 1500) / 400)) }) }]);
  assert.ok(sim.hi.frame.depth < 0.32, `farther: ${sim.hi.frame.depth.toFixed(3)}`);
});

test('depth: a short loss keeps the reference, a long one (or a different hand) starts a new one', () => {
  const sim = makeSim();
  sim.run(1500, () => [{ pts: place('open', { scale: 0.15 }) }]);
  // Gone for 600 ms, back 1.6x closer: still a zoom relative to before.
  sim.run(600, () => []);
  sim.run(1000, () => [{ pts: place('open', { scale: 0.24 }) }]);
  assert.ok(sim.hi.frame.depth > 0.74, `after a short loss: ${sim.hi.frame.depth.toFixed(3)}`);
  // Gone for 2.5 s, back at another distance: neutral again.
  sim.run(2500, () => []);
  sim.run(1000, () => [{ pts: place('open', { scale: 0.4 }) }]);
  assert.ok(Math.abs(sim.hi.frame.depth - 0.5) < 0.01, `after a long loss: ${sim.hi.frame.depth.toFixed(3)}`);
});

test("left-handed users: after a dropout the user's left hand gets control back", () => {
  // MediaPipe labels assume a mirrored picture: the user's left hand comes as 'Right'.
  const left = (x = 0.45) => ({ pts: place('open', { at: [x, 0.45], scale: 0.16 }), label: 'Right' });
  const right = { pts: place('open', { at: [0.95, 0.45], scale: 0.16 }), label: 'Left' };
  const sim = makeSim();
  sim.run(1500, () => [left()]);
  assert.equal(sim.hi.primary.handedness, 'Left');
  sim.run(2000, () => [left(), right]);
  assert.equal(sim.hi.primary.handedness, 'Left', 'the left hand keeps control with both in view');
  // The left hand drops out for 400 ms (the right one takes over meanwhile), then is back.
  sim.run(400, () => [right]);
  sim.run(600, () => [left(), right]);
  assert.equal(sim.hi.primary.handedness, 'Left', 'control went back to the left hand');
  // Both drop out and come back together: the left hand again (not "right first").
  sim.run(500, () => []);
  sim.run(600, () => [right, left()]);
  assert.equal(sim.hi.primary.handedness, 'Left', 'both back at once: the left hand leads');
  // The user really switches hands: the left one away for long, the right one in control
  // for a while. When the left one comes back the right keeps control.
  sim.run(2500, () => [right]);
  sim.run(800, () => [left(), right]);
  assert.equal(sim.hi.primary.handedness, 'Right', 'a deliberate switch of hands sticks');
});

// ------------------------------------------------------------------ main-thread budget

/** Detections per second in [a, b) ms, and the shortest gap between two of them there. */
function rate(times, a, b) {
  const inside = times.filter((t) => t >= a && t < b);
  let minGap = Infinity;
  for (let i = 1; i < inside.length; i++) minGap = Math.min(minGap, inside[i] - inside[i - 1]);
  return { hz: (inside.length * 1000) / (b - a), minGap, count: inside.length };
}

test('no hand in view: detection idles at <= ~9 Hz, and is back at the camera rate as soon as a hand shows', () => {
  const sim = makeSim();
  const open = place('open');
  sim.run(3000, () => []);
  const idle = rate(sim.detections, 0, 3000);
  assert.ok(idle.minGap >= 110, `idle detections at least 110 ms apart (${idle.minGap} ms)`);
  assert.ok(idle.hz <= 9.1 && idle.hz >= 6, `idle rate ${idle.hz.toFixed(1)} Hz`);
  assert.equal(sim.hi.debug.idle, true);
  // A hand comes into view at 3 s: found by the next idle detection, then tracked at 30 Hz.
  sim.run(1500, () => [{ pts: open }]);
  const found = sim.log.find((r) => r.t >= 3000 && r.source === 'hand');
  assert.ok(found && found.t <= 3000 + 110 + 34, `hand picked up at ${found?.t} ms`);
  const back = rate(sim.detections, found.t + 1, 4500);
  assert.ok(back.hz >= 28, `tracking rate ${back.hz.toFixed(1)} Hz`);
  assert.equal(sim.hi.debug.idle, false);
  // The tracking-rate average starts afresh (it drives the loss timeouts and the debounce).
  const fps = sim.hi.debug.fps;
  assert.ok(fps > 27 && fps < 33, `debug.fps ${fps.toFixed(1)}`);
  assert.ok(firstEvent(sim.log, 'openstart').t - found.t < 150, 'the gesture is recognised at the usual speed');
});

test('a hand gone for more than ~1 s slows detection to the idle rate; a shorter dropout does not', () => {
  const sim = makeSim();
  const fist = place('fist');
  sim.run(1000, () => [{ pts: fist }]);
  sim.run(3000, () => []);
  // The first second without the hand: full rate (a hand that comes right back is picked up at once).
  const lost = rate(sim.detections, 1000, 1900);
  assert.ok(lost.hz >= 28, `just lost: ${lost.hz.toFixed(1)} Hz`);
  const idle = rate(sim.detections, 2200, 4000);
  assert.ok(idle.minGap >= 110 && idle.hz <= 9.1, `long gone: ${idle.hz.toFixed(1)} Hz, gaps >= ${idle.minGap} ms`);
  // Back: tracked again at the camera rate, the fist reported fresh.
  const n = sim.log.length;
  sim.run(1000, () => [{ pts: fist }]);
  const after = sim.log.slice(n);
  assert.ok(after.slice(9).every((r) => r.source === 'hand'), 'tracked within ~150 ms');
  assert.ok(rate(sim.detections, 4300, 5000).hz >= 28, 'back at the camera rate');
  assert.ok(after[after.length - 1].fist);
});

test('two-hand tracking only on a desktop at high quality; a later quality change switches it', async () => {
  const cases = [
    [{ quality: 'high', isMobile: false }, 2],
    [{ quality: 'medium', isMobile: false }, 1],
    [{ quality: 'low', isMobile: false }, 1],
    [{ quality: 'high', isMobile: true }, 1],
  ];
  for (const [extra, n] of cases) {
    const hi = new HandInput({ settings: {}, params: new URLSearchParams(), renderer: null, ...extra });
    await hi._createLandmarker('CPU');
    assert.equal(globalThis.__handOptions.numHands, n, JSON.stringify(extra));
    assert.equal(hi.numHands, n);
  }
  // Quality lowered while tracking (e.g. the automatic step-down): one hand from then on.
  const sim = makeSim({ app: { quality: 'high', isMobile: false } });
  const calls = [];
  sim.hi.landmarker.setOptions = (o) => {
    calls.push(o);
    return Promise.resolve();
  };
  sim.hi.numHands = 2;
  const open = place('open');
  sim.run(500, () => [{ pts: open }]);
  assert.equal(calls.length, 0);
  sim.hi.app.quality = 'medium';
  sim.run(500, () => [{ pts: open }]);
  assert.deepEqual(calls, [{ numHands: 1 }]);
  assert.equal(sim.hi.numHands, 1);
  assert.ok(sim.log.slice(-20).every((r) => r.source === 'hand' && r.open), 'tracking goes on');
});

/**
 * The Live Mirror case: hand detection (InputManager) then segmentation (the scene) in every
 * render frame, with each model blocking the main thread for its cost. Frames take the next
 * vsync after their work (like requestAnimationFrame).
 */
function makeMirrorSim({ detCost, segCost, renderFps = 60, camFps = 30 }) {
  clock = 10000;
  const t0 = clock;
  const frameMs = 1000 / renderFps;
  const app = {
    quality: 'high', isMobile: false, settings: { showPreview: false },
    params: new URLSearchParams(), renderer: { domElement: fakeEl },
  };
  const hi = new HandInput(app);
  hi._running = true;
  hi.delegate = 'CPU';
  hi.numHands = 2;
  const busy = []; // [start ms, cost ms, 'hand' | 'seg']
  let current = { landmarks: [], handedness: [] };
  hi.landmarker = {
    detectForVideo: () => {
      busy.push([clock - t0, detCost, 'hand']);
      clock += detCost;
      return current;
    },
    close: noop,
  };
  const video = { readyState: 4, videoWidth: 640, videoHeight: 480, currentTime: 0 };
  hi._video = video;
  const im = new InputManager(app);
  im.hand = hi;
  app.input = im;
  const seg = new PersonSegmenter(app);
  const mask = { width: 16, height: 16, getAsFloat32Array: () => new Float32Array(256).fill(0.7) };
  seg.segmenter = {
    segmentForVideo: (_canvas, _ts, cb) => {
      busy.push([clock - t0, segCost, 'seg']);
      clock += segCost;
      cb({ confidenceMasks: [mask] });
    },
    close: noop,
  };
  let lastCam = -1;
  const frames = [];
  return {
    hi, seg, busy, frames,
    run(ms, scene) {
      const end = clock + ms;
      while (clock < end) {
        const start = clock;
        const cam = Math.floor((clock - t0) / (1000 / camFps));
        if (cam !== lastCam) {
          lastCam = cam;
          video.currentTime = cam / camFps;
          const hands = scene(clock - t0) || [];
          current = {
            landmarks: hands.map((h) => toRaw(h.pts)),
            handedness: hands.map(() => [{ categoryName: 'Left', score: 0.98 }]),
          };
        }
        const n = busy.length;
        const s = im.update(frameMs / 1000);
        seg.update(video, performance.now());
        frames.push({ t: start - t0, ran: busy.slice(n).map((b) => b[2]), source: s.source });
        clock = start + Math.max(1, Math.ceil((clock - start) / frameMs - 1e-9)) * frameMs;
      }
    },
  };
}

/** Share of [a, b) ms the models kept the main thread busy, and each one's rate in Hz. */
function load(busy, a, b) {
  const inside = busy.filter(([t]) => t >= a && t < b);
  const sum = (k) => inside.filter((x) => x[2] === k).reduce((acc, x) => acc + x[1], 0);
  const hz = (k) => (inside.filter((x) => x[2] === k).length * 1000) / (b - a);
  return { share: (sum('hand') + sum('seg')) / (b - a), hand: hz('hand'), seg: hz('seg') };
}

test('Live Mirror: segmentation never runs in a detection frame, <= 10 Hz while a hand is tracked, both within half the main thread', () => {
  // laptop GPU, laptop CPU, phone CPU, a slow phone
  for (const [detCost, segCost] of [[6, 4], [15, 8], [35, 20], [70, 45]]) {
    const sim = makeMirrorSim({ detCost, segCost });
    const open = place('open');
    const label = `detect ${detCost} ms, segment ${segCost} ms`;
    sim.run(6000, () => []); // nobody's hand in view
    sim.run(8000, () => [{ pts: open }]); // a hand is tracked
    assert.ok(sim.frames.every((f) => f.ran.length <= 1), `${label}: a frame ran both`);
    const idle = load(sim.busy, 3000, 6000);
    const tracked = load(sim.busy, 9000, 14000);
    const slack = 0.03; // EMA noise
    assert.ok(idle.share <= VISION_SHARE + slack, `${label}: no hand: ${(idle.share * 100).toFixed(0)}% busy`);
    assert.ok(tracked.share <= VISION_SHARE + slack, `${label}: tracking: ${(tracked.share * 100).toFixed(0)}% busy`);
    assert.ok(tracked.seg <= 10.2, `${label}: segmentation ${tracked.seg.toFixed(1)} Hz while tracking`);
    assert.ok(idle.hand <= 9.1, `${label}: idle detection ${idle.hand.toFixed(1)} Hz`);
    // Both still do their job: the mask keeps following (near 10 Hz on a laptop, >= 2 Hz on
    // the slowest phone), the hand stays usable.
    const minSeg = segCost <= 8 ? 8 : 2;
    assert.ok(tracked.seg >= minSeg && idle.seg >= minSeg, `${label}: mask at ${tracked.seg.toFixed(1)} / ${idle.seg.toFixed(1)} Hz`);
    assert.ok(tracked.hand >= Math.min(25, 1000 / (detCost / 0.35) - 1), `${label}: hand at ${tracked.hand.toFixed(1)} Hz`);
    assert.ok(sim.frames.slice(-60).every((f) => f.source === 'hand'), `${label}: hand tracked`);
    assert.ok(sim.seg.hasMask);
  }
});

test('Live Mirror on slow rendering (detection due every frame): segmentation still gets frames', () => {
  const sim = makeMirrorSim({ detCost: 8, segCost: 6, renderFps: 30 });
  const open = place('open');
  sim.run(6000, () => [{ pts: open }]);
  const tracked = load(sim.busy, 2000, 6000);
  assert.ok(sim.frames.every((f) => f.ran.length <= 1), 'never both in one frame');
  assert.ok(tracked.seg >= 8 && tracked.seg <= 10.2, `segmentation ${tracked.seg.toFixed(1)} Hz`);
  assert.ok(tracked.hand >= 18, `hand detection ${tracked.hand.toFixed(1)} Hz`);
});
