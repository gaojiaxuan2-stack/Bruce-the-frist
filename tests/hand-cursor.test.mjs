// Tests for js/input/HandCursor.js with a tiny fake DOM: which hand poses may take the UI
// (hover highlight, uiCaptured, dwell-click on a tab) and which pass through to the scene.
import test from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ fake DOM

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }
  get set() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this.owner.className = [...set].join(' ');
  }
  add(c) {
    const s = this.set;
    s.add(c);
    this._write(s);
  }
  remove(c) {
    const s = this.set;
    s.delete(c);
    this._write(s);
  }
  toggle(c, on) {
    const s = this.set;
    const want = on === undefined ? !s.has(c) : !!on;
    if (want) s.add(c);
    else s.delete(c);
    this._write(s);
    return want;
  }
  contains(c) {
    return this.set.has(c);
  }
}

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = {};
    this.attrs = {};
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.id = '';
    this.clicks = 0;
    this.events = [];
  }
  get isConnected() {
    return true;
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  closest(sel) {
    for (let e = this; e; e = e.parent) {
      if (sel === '[data-hand-clickable]' && 'handClickable' in e.dataset) return e;
      if (sel === '.lil-gui' && e.classList.contains('lil-gui')) return e;
    }
    return null;
  }
  querySelector() {
    return null;
  }
  click() {
    this.clicks++;
  }
  dispatchEvent(e) {
    this.events.push(e.type);
    return true;
  }
}

const W = 1280;
const H = 800;
const layer = new FakeEl('div');
const canvas = new FakeEl('canvas');
const tab = new FakeEl('button');
tab.dataset.handClickable = '';
tab.dataset.scene = 'galaxy';
tab.textContent = 'Galaxy';
const TAB = { x0: 600, x1: 700, y0: 10, y1: 50 };

globalThis.window = { innerWidth: W, innerHeight: H, addEventListener() {} };
globalThis.document = {
  head: new FakeEl('head'),
  body: new FakeEl('body'),
  getElementById: (id) => (id === 'hand-layer' ? layer : null),
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
  elementFromPoint: (x, y) => (x >= TAB.x0 && x < TAB.x1 && y >= TAB.y0 && y < TAB.y1 ? tab : canvas),
};
globalThis.MouseEvent = class {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init);
  }
};
globalThis.PointerEvent = globalThis.MouseEvent;

const { HandCursor } = await import('../js/input/HandCursor.js');

// ------------------------------------------------------------------ helpers

/** NDC of a screen point. */
const ndc = (x, y) => ({ x: (x / W) * 2 - 1, y: 1 - (y / H) * 2 });
const ON_TAB = ndc(650, 30);
const IN_SCENE = ndc(640, 500);

function makeCursor(meta = {}) {
  tab.clicks = 0;
  tab.className = '';
  tab.events = [];
  const app = { active: { meta } };
  return { app, cursor: new HandCursor(app) };
}

function state(o = {}) {
  return {
    source: 'hand', active: true, pointer: { ...ON_TAB }, palm: { ...IN_SCENE }, pinching: false, pinch: 0,
    gesture: 'point', fist: false, open: false, twoHands: false, hands: [], uiCaptured: false, ...o,
  };
}

/** Run the cursor for `s` seconds at 60 fps with the state from `fn(t)`; returns per-frame uiCaptured. */
function run(cursor, s, fn) {
  const captured = [];
  const n = Math.round(s * 60);
  for (let i = 0; i < n; i++) {
    const st = fn(i / 60);
    cursor.update(st, 1 / 60);
    captured.push(st.uiCaptured);
  }
  return captured;
}

// ------------------------------------------------------------------ tests

test('pointing at a tab for ~1.1 s clicks it (dwell), and the UI takes the hand meanwhile', () => {
  const { cursor } = makeCursor();
  const cap = run(cursor, 1.0, () => state());
  assert.equal(tab.clicks, 0, 'not yet');
  assert.ok(cap.every(Boolean), 'uiCaptured while pointing at the tab');
  assert.ok(tab.classList.contains('hand-hover'), 'highlighted');
  run(cursor, 0.2, () => state());
  assert.equal(tab.clicks, 1, 'clicked once');
  run(cursor, 2, () => state());
  assert.equal(tab.clicks, 1, 'no repeat while staying on it');
});

for (const gesture of ['open', 'fist', 'victory', 'thumbsUp', 'none']) {
  test(`a ${gesture} hand whose fingertip is over a tab passes through to the scene`, () => {
    const { cursor } = makeCursor();
    const cap = run(cursor, 3, () => state({ gesture, open: gesture === 'open', fist: gesture === 'fist' }));
    assert.equal(tab.clicks, 0, 'no dwell click');
    assert.ok(cap.every((c) => !c), 'uiCaptured stays false');
    assert.ok(!tab.classList.contains('hand-hover'), 'no highlight');
    assert.equal(cursor.debug.hover, null);
  });
}

test('a pinch over a tab clicks it whatever the pose before (pinch-click)', () => {
  const { cursor } = makeCursor();
  run(cursor, 0.5, () => state({ gesture: 'open', open: true }));
  const cap = run(cursor, 0.3, () => state({ gesture: 'pinch', pinching: true, pinch: 1 }));
  assert.ok(cap.every(Boolean), 'uiCaptured during the press');
  assert.ok(tab.events.includes('mousedown'));
  const rel = run(cursor, 1 / 60, () => state({ gesture: 'open', open: true }));
  assert.equal(tab.clicks, 1, 'released over the tab: clicked');
  assert.ok(rel[0], 'the release frame still belongs to the UI');
  assert.ok(run(cursor, 0.5, () => state({ gesture: 'open', open: true })).every((c) => !c), 'then the scene again');
});

test('opening the hand mid-dwell stops it; pointing again starts over', () => {
  const { cursor } = makeCursor();
  run(cursor, 0.8, () => state());
  run(cursor, 0.5, () => state({ gesture: 'open', open: true }));
  run(cursor, 0.8, () => state());
  assert.equal(tab.clicks, 0, '0.8 s + 0.8 s with an open hand between is no click');
  run(cursor, 0.4, () => state());
  assert.equal(tab.clicks, 1);
});

test('a short flicker of the point pose (gesture debounce) does not restart the dwell', () => {
  const { cursor } = makeCursor();
  run(cursor, 0.6, () => state());
  run(cursor, 0.1, () => state({ gesture: 'none' }));
  run(cursor, 0.6, () => state());
  assert.equal(tab.clicks, 1);
});

test("palm cursor (meta.cursor = 'palm'): drawn and hit-tested at the palm", () => {
  // The fingertip is on the tab but the palm is in the scene: nothing happens.
  let { cursor } = makeCursor({ cursor: 'palm' });
  let cap = run(cursor, 2, () => state());
  assert.equal(cursor.debug.mode, 'palm');
  assert.equal(tab.clicks, 0);
  assert.ok(cap.every((c) => !c));
  assert.equal(cursor.x, 640);
  assert.equal(cursor.y, 500);
  // The palm on the tab while pointing: dwell click.
  ({ cursor } = makeCursor({ cursor: 'palm' }));
  cap = run(cursor, 1.3, () => state({ pointer: { ...IN_SCENE }, palm: { ...ON_TAB } }));
  assert.equal(tab.clicks, 1);
  assert.ok(cap.every(Boolean));
  // Other scenes: the fingertip.
  ({ cursor } = makeCursor({}));
  run(cursor, 1 / 60, () => state());
  assert.equal(cursor.debug.mode, 'finger');
  assert.equal(cursor.x, 650);
});
