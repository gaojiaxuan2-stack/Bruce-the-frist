// Tests for js/input/MouseInput.js (through InputManager, so the edge events are real):
// the touch state machine (point / tap / long-press fist / two-finger pinch + zoom) and the
// unchanged mouse mapping. A tiny fake DOM: window / document / surface only collect
// listeners, and the tests call them with synthetic PointerEvent-like objects.
import test from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ fake DOM

let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });

function fakeTarget(name) {
  return {
    name,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    setPointerCapture() {},
  };
}

const W = 400;
const H = 800;
globalThis.window = Object.assign(fakeTarget('window'), { innerWidth: W, innerHeight: H });
globalThis.document = Object.assign(fakeTarget('document'), { documentElement: fakeTarget('html') });

const { InputManager } = await import('../js/input/InputManager.js');

const ndcX = (cx) => (cx / W) * 2 - 1;
const ndcY = (cy) => -((cy / H) * 2 - 1);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** A fresh MouseInput + InputManager on a fresh fake window. */
function setup() {
  window.listeners = {};
  document.listeners = {};
  document.documentElement.listeners = {};
  const surface = fakeTarget('canvas');
  const ui = fakeTarget('button');
  const im = new InputManager({ renderer: { domElement: surface } });
  const fire = (target, type, type2, props) => {
    const e = { type, target, button: 0, shiftKey: false, preventDefault() {}, ...props };
    for (const fn of target.listeners[type] || []) fn(e);
    if (target !== window) for (const fn of window.listeners[type] || []) fn(e);
    return e;
  };
  const touch = (type, id, x, y, target = surface) =>
    fire(target, type, null, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const mouse = (type, x, y, extra = {}, target = surface) =>
    fire(target, type, null, { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, ...extra });
  /** Advance the clock and run one frame; returns a snapshot of the state. */
  const frame = (ms = 16) => {
    clock += ms;
    const s = im.update(ms / 1000);
    return {
      source: s.source, active: s.active, pinching: s.pinching, pinch: s.pinch, fist: s.fist, grab: s.grab,
      open: s.open, fingers: s.fingers, gesture: s.gesture, uiCaptured: s.uiCaptured, zoom: s.zoom,
      pointer: { ...s.pointer }, palm: { ...s.palm }, dragDelta: { ...s.dragDelta }, velocity: { ...s.velocity },
      events: [...s.events],
    };
  };
  const frames = (n, ms = 16) => Array.from({ length: n }, () => frame(ms));
  return { im, surface, ui, touch, mouse, frame, frames, fire };
}

// ------------------------------------------------------------------ one finger

test('one finger = point: active, not pinching, open false, follows the finger', () => {
  const { touch, frame } = setup();
  frame();
  touch('pointerdown', 1, 100, 400);
  const f = frame();
  assert.equal(f.source, 'mouse');
  assert.equal(f.active, true);
  assert.equal(f.pinching, false);
  assert.equal(f.fist, false);
  assert.equal(f.open, false);
  assert.equal(f.gesture, 'point');
  assert.equal(f.fingers, 1);
  assert.equal(f.uiCaptured, false);
  assert.ok(near(f.pointer.x, ndcX(100)) && near(f.pointer.y, ndcY(400)));
  assert.deepEqual(f.palm, f.pointer);
  // landing far from the old pointer is not a fling
  assert.ok(Math.hypot(f.velocity.x, f.velocity.y) < 1e-9, 'no velocity spike when the finger lands');
  assert.equal(f.events.includes('pinchstart'), false);

  const seen = [];
  for (let i = 1; i <= 10; i++) {
    touch('pointermove', 1, 100 + i * 8, 400 - i * 4);
    seen.push(frame());
  }
  for (const s of seen) {
    assert.equal(s.gesture, 'point');
    assert.equal(s.pinching, false);
    assert.equal(s.fist, false);
    assert.deepEqual(s.dragDelta, { x: 0, y: 0 });
  }
  const last = seen.at(-1);
  assert.ok(near(last.pointer.x, ndcX(180)) && near(last.pointer.y, ndcY(360)));
  assert.ok(last.velocity.x > 0.5, 'moving right gives a rightward velocity');

  touch('pointerup', 1, 180, 360);
  const up = frame();
  assert.equal(up.active, false, 'a lifted (moved) finger leaves no pointer');
  assert.equal(up.events.includes('pinchstart'), false);
  assert.equal(up.events.includes('fistend'), false);
});

test('a quick still tap reports pinching for exactly one frame (pinchstart, then pinchend)', () => {
  const { touch, frame, frames } = setup();
  frame();
  touch('pointerdown', 1, 200, 300);
  const down = frames(5);
  assert.ok(down.every((f) => f.gesture === 'point' && !f.pinching));
  touch('pointermove', 1, 202, 301); // a little finger wobble is fine
  touch('pointerup', 1, 202, 301);
  const [click, after, idle] = frames(3);
  assert.equal(click.pinching, true);
  assert.equal(click.pinch, 1);
  assert.equal(click.gesture, 'pinch');
  assert.equal(click.active, true);
  assert.ok(click.events.includes('pinchstart'));
  assert.deepEqual(click.dragDelta, { x: 0, y: 0 });
  assert.equal(after.pinching, false);
  assert.equal(after.active, true, 'still active, so the pinchend comes from the mouse source');
  assert.equal(after.source, 'mouse');
  assert.equal(after.uiCaptured, false);
  assert.ok(after.events.includes('pinchend'));
  assert.ok(near(after.pointer.x, click.pointer.x) && near(after.pointer.y, click.pointer.y), 'no pointer jump');
  assert.equal(idle.active, false);
  assert.equal(idle.pinching, false);
});

test('a tap that starts and ends between two frames still clicks', () => {
  const { touch, frame, frames } = setup();
  frame();
  touch('pointerdown', 1, 120, 500);
  clock += 10;
  touch('pointerup', 1, 120, 500);
  const [click, after, idle] = frames(3);
  assert.ok(click.pinching && click.events.includes('pinchstart'));
  assert.ok(near(click.pointer.x, ndcX(120)) && near(click.pointer.y, ndcY(500)));
  assert.ok(!after.pinching && after.events.includes('pinchend') && after.active);
  assert.equal(idle.active, false);
});

test('the tap length comes from the event times, so a busy frame does not stretch a tap', () => {
  const { fire, surface, frame, frames } = setup();
  const at = (type, stamp) => fire(surface, type, null, { pointerType: 'touch', pointerId: 5, clientX: 200, clientY: 400, timeStamp: stamp });
  frame();
  at('pointerdown', clock);
  clock += 400; // a 400 ms hitch before the pointerup is handled; the finger was down 90 ms
  at('pointerup', clock - 310);
  const [click] = frames(2);
  assert.ok(click.pinching && click.events.includes('pinchstart'));
  // and a 300 ms press handled quickly is not a tap
  at('pointerdown', clock);
  at('pointerup', clock + 300);
  assert.ok(frames(3).every((f) => !f.pinching));
});

test('a slow press, a moved finger or a cancelled touch is not a tap', () => {
  const { touch, frame, frames } = setup();
  const pinchSeen = (fs) => fs.some((f) => f.pinching || f.events.includes('pinchstart'));
  frame();
  // held 300 ms
  touch('pointerdown', 1, 200, 400);
  let fs = frames(19);
  touch('pointerup', 1, 200, 400);
  fs = fs.concat(frames(3));
  assert.equal(pinchSeen(fs), false, 'held too long');
  // quick but moved 0.05 NDC (10 px of 400)
  touch('pointerdown', 2, 200, 400);
  fs = frames(2);
  touch('pointermove', 2, 210, 400);
  touch('pointerup', 2, 210, 400);
  fs = fs.concat(frames(3));
  assert.equal(pinchSeen(fs), false, 'moved too far');
  // moved away and back: still a push, not a tap
  touch('pointerdown', 3, 200, 400);
  touch('pointermove', 3, 220, 400);
  touch('pointermove', 3, 200, 400);
  touch('pointerup', 3, 200, 400);
  assert.equal(pinchSeen(frames(3)), false, 'moved and came back');
  // cancelled by the browser
  touch('pointerdown', 4, 200, 400);
  frame();
  touch('pointercancel', 4, 0, 0);
  assert.equal(pinchSeen(frames(3)), false, 'cancelled');
});

test('long-press = fist; lifting it reports fistend while still active, then goes idle', () => {
  const { touch, frame, frames } = setup();
  frame();
  touch('pointerdown', 1, 200, 400);
  const before = frames(27); // 432 ms
  assert.ok(before.every((f) => !f.fist && f.gesture === 'point'), 'a point until the long-press time');
  const held = frames(3); // 480 ms
  const first = held.findIndex((f) => f.fist);
  assert.ok(first >= 0, 'turns into a fist after ~450 ms');
  assert.ok(held[first].events.includes('fiststart'));
  const f = held.at(-1);
  assert.equal(f.gesture, 'fist');
  assert.equal(f.grab, 1);
  assert.equal(f.pinching, false);
  assert.equal(f.open, false);
  // the fist can be dragged around once it is closed
  touch('pointermove', 1, 260, 300);
  const moved = frame();
  assert.equal(moved.fist, true);
  assert.ok(near(moved.pointer.x, ndcX(260)) && near(moved.pointer.y, ndcY(300)));

  touch('pointerup', 1, 260, 300);
  const [release, idle] = frames(2);
  assert.equal(release.fist, false);
  assert.equal(release.active, true, 'still active in the release frame');
  assert.equal(release.source, 'mouse');
  assert.ok(release.events.includes('fistend'));
  assert.equal(release.open, true, 'letting go is the hand opening');
  assert.equal(release.pinching, false);
  assert.equal(release.events.includes('pinchstart'), false);
  assert.ok(near(release.pointer.x, ndcX(260)) && near(release.pointer.y, ndcY(300)), 'at the lift spot');
  assert.equal(idle.active, false);
  assert.equal(idle.fist, false);
});

test('a finger that moves while held is a push, never a fist', () => {
  const { touch, frames } = setup();
  touch('pointerdown', 1, 200, 400);
  frames(5);
  touch('pointermove', 1, 230, 400); // 0.15 NDC
  frames(5);
  touch('pointermove', 1, 200, 400); // and back
  const fs = frames(60);
  assert.ok(fs.every((f) => !f.fist && f.gesture === 'point'));
});

// ------------------------------------------------------------------ two fingers

test('two fingers = pinch at their midpoint; zoom from the ratio of finger distances', () => {
  const { touch, frame, frames } = setup();
  touch('pointerdown', 1, 150, 400);
  frame();
  touch('pointerdown', 2, 250, 400);
  const start = frame();
  assert.equal(start.pinching, true);
  assert.equal(start.gesture, 'pinch');
  assert.equal(start.open, false);
  assert.equal(start.fist, false);
  assert.equal(start.fingers, 0);
  assert.ok(start.events.includes('pinchstart'));
  assert.ok(near(start.pointer.x, ndcX(200)) && near(start.pointer.y, ndcY(400)), 'pointer at the midpoint');
  assert.deepEqual(start.palm, start.pointer);
  assert.deepEqual(start.dragDelta, { x: 0, y: 0 });
  assert.ok(Math.hypot(start.velocity.x, start.velocity.y) < 1e-9, 'landing a second finger is not a fling');

  // spread to twice the distance in steps: total zoom = ln 2 * 0.6
  let zoom = 0;
  for (let i = 1; i <= 10; i++) {
    touch('pointermove', 1, 150 - i * 5, 400);
    touch('pointermove', 2, 250 + i * 5, 400);
    const f = frame();
    assert.equal(f.pinching, true);
    assert.ok(f.zoom > 0, 'spreading zooms in');
    assert.ok(Math.abs(f.dragDelta.x) < 1e-9 && Math.abs(f.dragDelta.y) < 1e-9, 'a symmetric spread does not drag');
    zoom += f.zoom;
  }
  assert.ok(near(zoom, Math.log(2) * 0.6, 1e-9), `zoom ${zoom}`);

  // squeeze back: zooms out by the same amount
  touch('pointermove', 1, 150, 400);
  touch('pointermove', 2, 250, 400);
  assert.ok(near(frame().zoom, -Math.log(2) * 0.6, 1e-9));

  // move both fingers together: drag (rotate) by the midpoint, no zoom
  touch('pointermove', 1, 190, 360);
  touch('pointermove', 2, 290, 360);
  const drag = frame();
  assert.ok(near(drag.dragDelta.x, 40 / W * 2) && near(drag.dragDelta.y, 40 / H * 2), JSON.stringify(drag.dragDelta));
  assert.ok(near(drag.zoom, 0));
  assert.ok(near(drag.pointer.x, ndcX(240)) && near(drag.pointer.y, ndcY(360)));
  assert.equal(drag.events.includes('openstart'), false);

  touch('pointerup', 1, 190, 360);
  touch('pointerup', 2, 290, 360);
  const fs = frames(3);
  assert.ok(fs[0].events.includes('pinchend'));
  assert.ok(fs.every((f) => !f.pinching && !f.fist), 'lifting a pinch is not a tap or a fist');
  assert.equal(fs.at(-1).active, false);
});

test('pinch zoom is the same for the same finger ratio on any screen size', () => {
  const zoomFor = (scale) => {
    const { touch, frame } = setup();
    touch('pointerdown', 1, 200 - 20 * scale, 400);
    touch('pointerdown', 2, 200 + 20 * scale, 400);
    frame();
    touch('pointermove', 2, 200 + 60 * scale, 400); // distance 40 -> 80 (x scale)
    return frame().zoom;
  };
  assert.ok(near(zoomFor(1), zoomFor(3), 1e-9));
  assert.ok(near(zoomFor(1), Math.log(2) * 0.6, 1e-9));
});

test('two fingers -> one: the pointer resyncs to the remaining finger, no drag or velocity spike', () => {
  for (const lift of [1, 2]) {
    const { touch, frame, frames } = setup();
    touch('pointerdown', 1, 100, 400);
    frame();
    touch('pointerdown', 2, 300, 600);
    frame();
    for (let i = 1; i <= 4; i++) {
      touch('pointermove', 1, 100 - i * 5, 400);
      touch('pointermove', 2, 300 + i * 5, 600);
      frame();
    }
    // finger `lift` leaves; the other stays where it is
    const stay = lift === 1 ? { id: 2, x: 320, y: 600 } : { id: 1, x: 80, y: 400 };
    touch('pointerup', lift, lift === 1 ? 80 : 320, lift === 1 ? 400 : 600);
    const f = frame();
    assert.equal(f.pinching, false);
    assert.ok(f.events.includes('pinchend'));
    assert.equal(f.gesture, 'point');
    assert.equal(f.active, true);
    assert.deepEqual(f.dragDelta, { x: 0, y: 0 });
    assert.ok(near(f.pointer.x, ndcX(stay.x)) && near(f.pointer.y, ndcY(stay.y)), `lift ${lift}: pointer on the finger that stays`);
    assert.ok(Math.hypot(f.velocity.x, f.velocity.y) < 1e-9, 'no velocity spike from the resync');

    // the remaining finger moves a little: the pointer moves by exactly that much
    touch('pointermove', stay.id, stay.x + 4, stay.y);
    const g = frame();
    assert.ok(near(g.pointer.x - f.pointer.x, 4 / W * 2) && near(g.pointer.y, f.pointer.y));
    assert.deepEqual(g.dragDelta, { x: 0, y: 0 });
    assert.ok(Math.abs(g.velocity.x) < 4 / W * 2 / 0.016 + 1e-9, 'velocity only from the small move');
    assert.equal(g.fist, false);

    // no long-press fist from a finger that was part of a pinch, and no tap on lift
    const later = frames(40);
    assert.ok(later.every((s) => !s.fist && s.gesture === 'point'));
    touch('pointerup', stay.id, stay.x + 4, stay.y);
    const end = frames(3);
    assert.ok(end.every((s) => !s.pinching && !s.fist && !s.events.includes('fistend')));
    assert.equal(end.at(-1).active, false);
  }
});

test('three fingers: lifting one of the pinching pair does not jump or end the pinch', () => {
  const { touch, frame } = setup();
  touch('pointerdown', 1, 100, 400);
  touch('pointerdown', 2, 200, 400);
  touch('pointerdown', 3, 300, 500);
  frame();
  const before = frame();
  assert.ok(before.pinching);
  assert.ok(near(before.pointer.x, ndcX(150)), 'pinch between the first two fingers');
  touch('pointerup', 1, 100, 400);
  const f = frame();
  assert.equal(f.pinching, true);
  assert.equal(f.events.includes('pinchend'), false);
  assert.deepEqual(f.dragDelta, { x: 0, y: 0 });
  assert.ok(near(f.pointer.x, before.pointer.x) && near(f.pointer.y, before.pointer.y));
  assert.ok(near(f.zoom, 0));
  // the new pair drags normally
  touch('pointermove', 2, 220, 400);
  touch('pointermove', 3, 320, 500);
  const g = frame();
  assert.ok(near(g.dragDelta.x, 20 / W * 2) && near(g.dragDelta.y, 0));
  assert.ok(near(g.zoom, 0));
});

test('a second finger during a long-press fist turns it into a pinch', () => {
  const { touch, frame, frames } = setup();
  touch('pointerdown', 1, 200, 400);
  assert.ok(frames(32).at(-1).fist);
  touch('pointerdown', 2, 260, 400);
  const f = frame();
  assert.equal(f.fist, false);
  assert.equal(f.pinching, true);
  assert.ok(f.events.includes('fistend') && f.events.includes('pinchstart'));
  touch('pointerup', 1, 200, 400);
  touch('pointerup', 2, 260, 400);
  const end = frames(2);
  assert.ok(end.every((s) => !s.fist && !s.open && !s.pinching));
});

// ------------------------------------------------------------------ UI

test('touches on UI elements never drive the scene', () => {
  const { touch, frame, frames, ui } = setup();
  touch('pointerdown', 1, 50, 50, ui);
  const f = frame();
  assert.equal(f.uiCaptured, true);
  assert.equal(f.pinching, false);
  assert.equal(f.gesture, 'none');
  const held = frames(40); // long enough for a long-press
  assert.ok(held.every((s) => s.uiCaptured && !s.fist && !s.pinching));
  touch('pointerup', 1, 50, 50, ui);
  const up = frames(3);
  assert.ok(up.every((s) => !s.pinching && !s.events.includes('pinchstart')), 'a tap on a button is not a scene tap');
  assert.equal(up.at(-1).active, false);

  // a finger on the scene and one on the UI: the UI finger changes nothing
  touch('pointerdown', 2, 200, 400);
  frame();
  touch('pointerdown', 3, 50, 50, ui);
  touch('pointermove', 3, 60, 60, ui);
  const both = frame();
  assert.equal(both.pinching, false, 'a UI finger does not make a pinch');
  assert.equal(both.gesture, 'point');
  assert.equal(both.uiCaptured, false);
  assert.ok(near(both.pointer.x, ndcX(200)) && near(both.pointer.y, ndcY(400)));
  touch('pointerup', 3, 60, 60, ui);
  touch('pointermove', 2, 210, 400);
  assert.ok(near(frame().pointer.x, ndcX(210)));
});

test('window blur drops every finger', () => {
  const { touch, frame, frames } = setup();
  touch('pointerdown', 1, 200, 400);
  assert.ok(frames(32).at(-1).fist);
  for (const fn of window.listeners.blur) fn({});
  const f = frame();
  assert.equal(f.fist, false);
  assert.equal(f.active, false);
  touch('pointerup', 1, 200, 400); // the late pointerup of a finger we already forgot
  assert.equal(frame().active, false);
});

// ------------------------------------------------------------------ mouse (unchanged)

test('mouse mapping: move = point, left = pinch, right / Shift = fist, wheel = zoom, UI = captured', () => {
  const { mouse, frame, surface, ui, fire } = setup();
  mouse('pointermove', 300, 200);
  let f = frame();
  assert.equal(f.active, true);
  assert.equal(f.gesture, 'point');
  assert.equal(f.open, true);
  assert.equal(f.fingers, 1);
  assert.ok(near(f.pointer.x, 0.5) && near(f.pointer.y, 0.5));

  mouse('pointerdown', 300, 200, { button: 0 });
  f = frame();
  assert.ok(f.pinching && f.events.includes('pinchstart') && f.gesture === 'pinch' && !f.open);
  mouse('pointermove', 340, 200);
  f = frame();
  assert.ok(near(f.dragDelta.x, 40 / W * 2));
  mouse('pointerup', 340, 200, { button: 0 });
  f = frame();
  assert.ok(!f.pinching && f.events.includes('pinchend') && f.open);

  mouse('pointerdown', 340, 200, { button: 2 });
  f = frame();
  assert.ok(f.fist && f.gesture === 'fist' && f.events.includes('fiststart'));
  mouse('pointerup', 340, 200, { button: 2 });
  f = frame();
  assert.ok(!f.fist && f.events.includes('fistend') && f.active && f.open);

  mouse('pointerdown', 340, 200, { button: 0, shiftKey: true });
  assert.ok(frame().fist);
  mouse('pointerup', 340, 200, { button: 0 });
  assert.equal(frame().fist, false);

  fire(surface, 'wheel', null, { deltaY: -100, deltaMode: 0 });
  assert.ok(near(frame().zoom, 0.15));

  mouse('pointermove', 20, 20, {}, ui);
  f = frame();
  assert.equal(f.uiCaptured, true);
  assert.equal(f.active, true);

  // idle for more than 4 s: inactive
  mouse('pointermove', 300, 200);
  frame();
  clock += 4100;
  assert.equal(frame().active, false);
});

test('a touch then the mouse: each drives the pointer without a jump in velocity', () => {
  const { touch, mouse, frame } = setup();
  touch('pointerdown', 1, 100, 100);
  frame();
  touch('pointerup', 1, 100, 100);
  frame();
  frame();
  mouse('pointermove', 300, 700);
  const f = frame();
  assert.equal(f.gesture, 'point');
  assert.equal(f.open, true, 'mouse hover is the mouse mapping again');
  assert.ok(near(f.pointer.x, ndcX(300)) && near(f.pointer.y, ndcY(700)));
  assert.ok(Math.hypot(f.velocity.x, f.velocity.y) < 1e-9);
});
