// Mouse / touch fallback that fills the same InputState as hand tracking.
//   move            -> pointer (acts like "point")
//   left drag       -> pinching (grab + rotate)
//   right drag / Shift+drag / touch long-press -> fist (pull in)
//   wheel / two-finger pinch -> zoom

const LONG_PRESS_MS = 450;

export class MouseInput {
  /** @param {HTMLElement} surface element that receives scene interaction (the canvas) */
  constructor(surface) {
    this.surface = surface;
    this.x = 0;
    this.y = 0;
    this.lastMove = -Infinity;
    this.inside = false;
    this.overUi = false;
    this.left = false;
    this.right = false;
    this.shift = false;
    this.zoomAccum = 0;
    this.velocity = { x: 0, y: 0 };
    this.prev = { x: 0, y: 0 };
    this.touches = new Map();
    this.pinchDist = 0;
    this.longPressTimer = 0;
    this.longPress = false;

    const onMove = (e) => {
      this.setFromClient(e.clientX, e.clientY);
      this.overUi = e.target !== surface;
      this.inside = true;
      this.lastMove = performance.now();
      if (e.pointerType === 'touch') this.updateTouch(e);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', (e) => {
      onMove(e);
      if (e.target !== surface) return;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.startLongPress();
        if (this.touches.size === 2) this.pinchDist = this.touchDistance();
        if (this.touches.size === 1) this.left = true;
        else this.left = false;
        return;
      }
      if (e.button === 2 || e.shiftKey) this.right = true;
      else if (e.button === 0) this.left = true;
      surface.setPointerCapture?.(e.pointerId);
    });
    const onUp = (e) => {
      if (e.pointerType === 'touch') {
        this.touches.delete(e.pointerId);
        clearTimeout(this.longPressTimer);
        if (this.touches.size === 0) {
          this.left = false;
          this.longPress = false;
          this.inside = false;
        } else if (this.touches.size === 1) {
          this.left = true;
        }
        return;
      }
      if (e.button === 2 || this.right) this.right = false;
      if (e.button === 0) this.left = false;
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', () => {
      this.left = this.right = this.longPress = false;
      this.touches.clear();
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

  startLongPress() {
    clearTimeout(this.longPressTimer);
    const start = { x: this.x, y: this.y };
    this.longPressTimer = setTimeout(() => {
      if (this.touches.size === 1 && Math.hypot(this.x - start.x, this.y - start.y) < 0.05) {
        this.longPress = true;
      }
    }, LONG_PRESS_MS);
  }

  touchDistance() {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  updateTouch(e) {
    if (!this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const d = this.touchDistance();
      if (this.pinchDist > 0) this.zoomAccum += (d - this.pinchDist) / Math.min(window.innerWidth, window.innerHeight) * 2.5;
      this.pinchDist = d;
    }
  }

  /** Fill an InputState (already reset for this frame). */
  fill(state, dt) {
    const now = performance.now();
    const k = dt > 0 ? 1 / dt : 0;
    const vx = (this.x - this.prev.x) * k;
    const vy = (this.y - this.prev.y) * k;
    const a = Math.min(1, dt * 12);
    this.velocity.x += (vx - this.velocity.x) * a;
    this.velocity.y += (vy - this.velocity.y) * a;
    this.prev.x = this.x;
    this.prev.y = this.y;

    const fist = this.right || this.longPress || ((this.left || this.right) && this.shift);
    const pinching = this.left && !fist;
    state.source = 'mouse';
    state.active = this.inside && (now - this.lastMove < 4000 || this.left || this.right || this.touches.size > 0);
    state.pointer.x = state.palm.x = this.x;
    state.pointer.y = state.palm.y = this.y;
    state.velocity.x = this.velocity.x;
    state.velocity.y = this.velocity.y;
    state.depth = 0.5;
    state.pinching = pinching;
    state.pinch = pinching ? 1 : 0;
    state.fist = fist;
    state.grab = fist ? 1 : 0;
    state.open = state.active && !pinching && !fist;
    state.fingers = state.open ? 1 : 0;
    state.gesture = fist ? 'fist' : pinching ? 'pinch' : state.active ? 'point' : 'none';
    state.roll = 0;
    state.zoom = this.zoomAccum;
    this.zoomAccum = 0;
    state.twoHands = false;
    state.hands = [];
    state.uiCaptured = this.overUi && !this.left && !this.right;
  }
}
