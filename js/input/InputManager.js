import { createInputState, assignInput } from './InputState.js';
import { MouseInput } from './MouseInput.js';

// Boolean fields that produce "<name>start" / "<name>end" edge events.
const EDGES = [
  ['pinching', 'pinch'],
  ['fist', 'fist'],
  ['open', 'open'],
];

/**
 * Owns every input source and produces one InputState per frame.
 * Hand tracking is loaded lazily (MediaPipe is ~10 MB) the first time
 * `startHands()` is called.
 */
export class InputManager {
  constructor(app) {
    this.app = app;
    this.state = createInputState();
    this.mouse = new MouseInput(app.renderer.domElement);
    /** @type {import('./HandInput.js').HandInput|null} */
    this.hand = null;
    /** @type {import('./HandCursor.js').HandCursor|null} */
    this.cursor = null;
    this.override = null;
    this.prev = { pinching: false, fist: false, open: false, gesture: 'none' };
    this.prevPointer = { x: 0, y: 0 };
    this.handStarting = null;
  }

  get handsRunning() {
    return !!this.hand?.running;
  }

  /** Start the camera + hand tracking. Resolves true on success. Safe to call repeatedly. */
  startHands() {
    if (this.handsRunning) return Promise.resolve(true);
    if (this.handStarting) return this.handStarting;
    this.handStarting = (async () => {
      const [{ HandInput }, { HandCursor }] = await Promise.all([
        import('./HandInput.js'),
        import('./HandCursor.js'),
      ]);
      this.hand ??= new HandInput(this.app);
      this.cursor ??= new HandCursor(this.app);
      await this.hand.start();
      return true;
    })().finally(() => {
      this.handStarting = null;
    });
    return this.handStarting;
  }

  stopHands() {
    this.hand?.stop();
    this.cursor?.hide();
  }

  /** The playing webcam <video>, or null if the camera is off. */
  get video() {
    return this.hand?.running ? this.hand.video : null;
  }

  /**
   * Test / debug hook: force fields of the input state every frame
   * (e.g. `app.input.setOverride({ pointer: {x: .2, y: 0}, pinching: true })`). Pass null to clear.
   */
  setOverride(partial) {
    this.override = partial;
  }

  update(dt) {
    const s = this.state;
    s.events.clear();
    s.dragDelta.x = s.dragDelta.y = 0;
    s.zoom = 0;
    s.uiCaptured = false;

    const frame = this.hand?.running ? this.hand.update(dt) : null;
    if (frame) {
      s.source = 'hand';
      s.active = true;
      assignInput(s, frame);
    } else {
      this.mouse.fill(s, dt);
      if (this.hand?.running && !s.active) s.source = 'none';
    }

    if (this.override) {
      s.active = true;
      if (s.source === 'none') s.source = 'mouse';
      assignInput(s, this.override);
    }

    if (s.source === 'hand' && this.cursor) this.cursor.update(s, dt);
    else this.cursor?.hide();

    for (const [key, name] of EDGES) {
      if (s[key] && !this.prev[key]) s.events.add(`${name}start`);
      if (!s[key] && this.prev[key]) s.events.add(`${name}end`);
      this.prev[key] = s[key];
    }
    if (s.gesture !== this.prev.gesture && s.gesture === 'victory') s.events.add('victorystart');
    this.prev.gesture = s.gesture;

    if (s.pinching && !s.uiCaptured && s.active && !s.events.has('pinchstart')) {
      s.dragDelta.x = s.pointer.x - this.prevPointer.x;
      s.dragDelta.y = s.pointer.y - this.prevPointer.y;
    }
    this.prevPointer.x = s.pointer.x;
    this.prevPointer.y = s.pointer.y;
    return s;
  }
}
