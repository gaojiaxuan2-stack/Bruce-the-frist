// Mouse / touch fallback that fills the same InputState as hand tracking.
//
// Mouse:
//   move                      -> pointer (acts like "point")
//   left drag                 -> pinching (grab + rotate)
//   right drag / Shift+drag   -> fist (pull in)
//   wheel                     -> zoom
//
// Touch (fingers that start on the canvas; fingers on the UI never drive the scene):
//   one finger                -> point (push the particles, like the hand's ☝️)
//   quick tap                 -> a one-frame pinch, i.e. a click (pinchstart + pinchend)
//   long-press (held still)   -> fist; lifting the finger is the hand opening (release / explosion)
//   two fingers               -> pinch at their midpoint: drag = rotate, spread / squeeze = zoom

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE = 0.05; // NDC: a finger that moved further than this is pushing, not holding
const TAP_MS = 250;
const TAP_MOVE = 0.03; // NDC
const PINCH_ZOOM = 0.6; // zoom per e-fold of finger distance: a 2x spread ≈ +0.42
const MIN_PINCH_PX = 12; // two fingers are never closer than this; keeps the zoom ratio sane

/** When the event happened (its timeStamp), or now for events without one. */
function eventTime(e) {
  return Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : performance.now();
}

export class MouseInput {
  /** @param {HTMLElement} surface element that receives scene interaction (the canvas) */
  constructor(surface) {
    this.surface = surface;
    // ---- mouse
    this.x = 0;
    this.y = 0;
    this.lastMove = -Infinity;
    this.inside = false;
    this.overUi = false;
    this.left = false;
    this.right = false;
    this.shift = false;
    // ---- shared
    this.zoomAccum = 0;
    this.velocity = { x: 0, y: 0 };
    this.prev = { x: 0, y: 0 };
    this.wasTouch = false;
    this.resync = false; // the pointer jumped (finger landed / lifted): no velocity spike
    // ---- touch
    this.touchMode = false; // the last pointer used was a finger
    /** @type {Map<number, {x: number, y: number}>} fingers that started on the surface (client px) */
    this.touches = new Map();
    /** @type {Set<number>} fingers that started on UI elements */
    this.uiTouches = new Set();
    /** One finger-down-to-all-fingers-up session on the surface. */
    this.session = null;
    /** @type {number[]|null} pointer ids of the two fingers of a pinch */
    this.pair = null;
    this.pinchDist = 0;
    this.pinchOffset = { x: 0, y: 0 }; // keeps the pinch pointer continuous if the pair changes
    this.tapPending = false;
    this.releasePending = false;
    this.linger = 0;
    this.tx = 0; // touch pointer, NDC
    this.ty = 0;
    this.tcx = 0; // touch pointer, client px
    this.tcy = 0;

    const onMove = (e) => {
      if (e.pointerType === 'touch') {
        this.touchMove(e);
        return;
      }
      this.touchMode = false;
      this.setFromClient(e.clientX, e.clientY);
      this.overUi = e.target !== surface;
      this.inside = true;
      this.lastMove = performance.now();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        this.touchDown(e);
        return;
      }
      onMove(e);
      if (e.target !== surface) return;
      if (e.button === 2 || e.shiftKey) this.right = true;
      else if (e.button === 0) this.left = true;
      surface.setPointerCapture?.(e.pointerId);
    });
    const onUp = (e) => {
      if (e.pointerType === 'touch') {
        this.touchUp(e, e.type === 'pointercancel');
        return;
      }
      if (e.button === 2 || this.right) this.right = false;
      if (e.button === 0) this.left = false;
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', () => {
      this.left = this.right = false;
      this.resetTouch();
    });
    document.addEventListener('pointerleave', () => { this.inside = false; });
    document.documentElement.addEventListener('mouseleave', () => { this.inside = false; });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 0.05 : 0.0015;
      this.zoomAccum += -e.deltaY * scale;
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shift = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.shift = false; });
  }

  setFromClient(cx, cy) {
    this.x = (cx / window.innerWidth) * 2 - 1;
    this.y = -((cy / window.innerHeight) * 2 - 1);
  }

  // ------------------------------------------------------------------ touch

  setTouchPointer(cx, cy, jump = false) {
    this.tcx = cx;
    this.tcy = cy;
    this.tx = (cx / window.innerWidth) * 2 - 1;
    this.ty = -((cy / window.innerHeight) * 2 - 1);
    if (jump) this.resync = true;
  }

  /** Anything touch-related still going on (fingers down, or a frame still to report). */
  touchBusy() {
    return this.touches.size > 0 || this.uiTouches.size > 0 || this.tapPending || this.releasePending || this.linger > 0;
  }

  resetTouch() {
    this.touches.clear();
    this.uiTouches.clear();
    this.session = null;
    this.pair = null;
    this.tapPending = this.releasePending = false;
    this.linger = 0;
  }

  touchDown(e) {
    this.touchMode = true;
    if (e.target !== this.surface) {
      // A finger on the UI: the UI handles it; the scene only learns that the UI is busy.
      this.uiTouches.add(e.pointerId);
      if (this.touches.size === 0) this.setTouchPointer(e.clientX, e.clientY, true);
      return;
    }
    if (this.touches.size === 0) {
      this.setTouchPointer(e.clientX, e.clientY, true);
      this.session = {
        t0: performance.now(), // for the long-press, checked every frame
        stamp0: eventTime(e), // for the tap's length, from event times (a busy frame doesn't stretch it)
        sx: this.tx, sy: this.ty, maxMove: 0, multi: false, fist: false,
      };
      this.linger = 0;
      this.velocity.x = this.velocity.y = 0;
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) {
      // A second finger: a pinch (it also ends a long-press fist).
      this.session.multi = true;
      this.session.fist = false;
      if (!this.pair) this.startPinch();
    }
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) {
      if (this.uiTouches.has(e.pointerId) && this.touches.size === 0) this.setTouchPointer(e.clientX, e.clientY);
      return;
    }
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.pair) {
      if (this.pair.includes(e.pointerId)) this.updatePinch();
      return;
    }
    this.setTouchPointer(t.x, t.y);
    const s = this.session;
    s.maxMove = Math.max(s.maxMove, Math.hypot(this.tx - s.sx, this.ty - s.sy));
  }

  touchUp(e, cancelled) {
    const id = e.pointerId;
    if (this.uiTouches.delete(id)) return;
    const t = this.touches.get(id);
    if (!t) return;
    const s = this.session;
    if (!this.pair && !cancelled) {
      // (pointercancel carries no useful position)
      this.setTouchPointer(e.clientX, e.clientY);
      s.maxMove = Math.max(s.maxMove, Math.hypot(this.tx - s.sx, this.ty - s.sy));
    }
    this.touches.delete(id);
    if (this.touches.size === 0) {
      // Last finger up. A long-press fist reports one "hand opened" frame; a quick, still
      // tap reports a one-frame pinch (a click).
      if (s.fist) this.releasePending = true;
      else if (!cancelled && !s.multi && eventTime(e) - s.stamp0 < TAP_MS && s.maxMove < TAP_MOVE) {
        this.tapPending = true;
      }
      this.session = null;
      this.pair = null;
    } else if (this.touches.size === 1) {
      // Pinch over: carry on as a point under the finger that stays, from where it is now.
      this.pair = null;
      const [rest] = this.touches.values();
      this.setTouchPointer(rest.x, rest.y, true);
    } else if (this.pair.includes(id)) {
      // One finger of the pinch left but two or more remain: pinch with the next two
      // without moving the pointer (no drag jump) or the zoom.
      this.pair = [...this.touches.keys()].slice(0, 2);
      const [a, b] = this.pair.map((k) => this.touches.get(k));
      this.pinchOffset.x = this.tcx - (a.x + b.x) / 2;
      this.pinchOffset.y = this.tcy - (a.y + b.y) / 2;
      this.pinchDist = Math.max(MIN_PINCH_PX, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }

  startPinch() {
    this.pair = [...this.touches.keys()].slice(0, 2);
    const [a, b] = this.pair.map((k) => this.touches.get(k));
    this.pinchOffset.x = this.pinchOffset.y = 0;
    this.pinchDist = Math.max(MIN_PINCH_PX, Math.hypot(a.x - b.x, a.y - b.y));
    this.setTouchPointer((a.x + b.x) / 2, (a.y + b.y) / 2, true);
  }

  updatePinch() {
    const [a, b] = this.pair.map((k) => this.touches.get(k));
    this.setTouchPointer((a.x + b.x) / 2 + this.pinchOffset.x, (a.y + b.y) / 2 + this.pinchOffset.y);
    // Zoom from the ratio of finger distances: the same pinch zooms the same on any screen.
    const d = Math.max(MIN_PINCH_PX, Math.hypot(a.x - b.x, a.y - b.y));
    this.zoomAccum += Math.log(d / this.pinchDist) * PINCH_ZOOM;
    this.pinchDist = d;
  }

  // ------------------------------------------------------------------ per frame

  /** Fill an InputState (already reset for this frame). */
  fill(state, dt) {
    const now = performance.now();
    const touch = this.touchMode || this.touchBusy();
    const px = touch ? this.tx : this.x;
    const py = touch ? this.ty : this.y;
    if (this.resync || touch !== this.wasTouch) {
      this.prev.x = px;
      this.prev.y = py;
    }
    this.resync = false;
    this.wasTouch = touch;

    const k = dt > 0 ? 1 / dt : 0;
    const vx = (px - this.prev.x) * k;
    const vy = (py - this.prev.y) * k;
    const a = Math.min(1, dt * 12);
    this.velocity.x += (vx - this.velocity.x) * a;
    this.velocity.y += (vy - this.velocity.y) * a;
    this.prev.x = px;
    this.prev.y = py;

    state.source = 'mouse';
    state.pointer.x = state.palm.x = px;
    state.pointer.y = state.palm.y = py;
    state.velocity.x = this.velocity.x;
    state.velocity.y = this.velocity.y;
    state.depth = 0.5;
    if (touch) this.fillTouch(state, now);
    else this.fillMouse(state, now);
    state.roll = 0;
    state.zoom = this.zoomAccum;
    this.zoomAccum = 0;
    state.twoHands = false;
    state.hands = [];
  }

  fillMouse(state, now) {
    const fist = this.right || ((this.left || this.right) && this.shift);
    const pinching = this.left && !fist;
    state.active = this.inside && (now - this.lastMove < 4000 || this.left || this.right);
    state.pinching = pinching;
    state.pinch = pinching ? 1 : 0;
    state.fist = fist;
    state.grab = fist ? 1 : 0;
    state.open = state.active && !pinching && !fist;
    state.fingers = state.open ? 1 : 0;
    state.gesture = fist ? 'fist' : pinching ? 'pinch' : state.active ? 'point' : 'none';
    state.uiCaptured = this.overUi && !this.left && !this.right;
  }

  fillTouch(state, now) {
    const s = this.session;
    const n = this.touches.size;
    if (s && n === 1 && !s.multi && !s.fist && now - s.t0 >= LONG_PRESS_MS && s.maxMove < LONG_PRESS_MOVE) {
      s.fist = true;
    }
    let pose;
    if (this.tapPending) {
      pose = 'pinch'; // the tap's click: pinching for exactly this frame
      this.tapPending = false;
      this.linger = 1;
    } else if (this.releasePending) {
      pose = 'open'; // the long-press was let go: the "hand" opens, still active
      this.releasePending = false;
    } else if (n >= 2) pose = 'pinch';
    else if (n === 1) pose = s.fist ? 'fist' : 'point';
    else if (this.linger > 0) {
      pose = 'linger'; // the frame after a tap's click: active, so pinchend comes from 'mouse'
      this.linger--;
    } else if (this.uiTouches.size > 0) pose = 'ui';
    else pose = 'none';

    state.active = pose !== 'none';
    state.pinching = pose === 'pinch';
    state.pinch = state.pinching ? 1 : 0;
    state.fist = pose === 'fist';
    state.grab = state.fist ? 1 : 0;
    state.open = pose === 'open';
    state.fingers = pose === 'point' ? 1 : pose === 'open' ? 5 : 0;
    state.gesture = pose === 'pinch' || pose === 'point' || pose === 'fist' || pose === 'open' ? pose : 'none';
    state.uiCaptured = pose === 'ui';
  }
}
