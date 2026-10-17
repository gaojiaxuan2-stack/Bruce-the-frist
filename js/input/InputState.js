// The single per-frame input snapshot every scene reads.
// Hand tracking and mouse/touch both fill the same shape, so a scene never
// needs to know which one the user is using.
//
// Coordinates are NDC: x and y in [-1, 1], y up, already mirrored for the
// camera so moving your hand right moves the pointer right.

/**
 * @typedef {{x: number, y: number}} Vec2
 * @typedef {{x: number, y: number, z: number}} Vec3
 *
 * @typedef {object} HandInfo
 * @property {'Left'|'Right'} handedness  as seen by the user (already un-mirrored)
 * @property {Vec3[]} landmarks  21 MediaPipe landmarks in NDC (z: MediaPipe relative depth, + = toward camera)
 * @property {string} gesture
 * @property {number} pinch
 * @property {number} fingers
 *
 * @typedef {object} InputState
 * @property {'hand'|'mouse'|'none'} source
 * @property {boolean} active      a hand is visible / the mouse is over the page
 * @property {Vec2} pointer        index fingertip (hand) or cursor (mouse)
 * @property {Vec2} palm           palm centre (mouse: same as pointer)
 * @property {Vec2} velocity       pointer velocity, NDC units per second (smoothed)
 * @property {Vec2} dragDelta      pointer movement this frame while pinching and not on UI, else 0
 * @property {number} depth        0..1 how close the hand is to the camera (0.5 neutral; mouse 0.5)
 * @property {number} pinch        0..1 pinch strength (1 = thumb and index touching; mouse: button down)
 * @property {boolean} pinching    stable pinch with hysteresis (mouse: left button)
 * @property {number} grab         0..1 hand closedness (0 open palm .. 1 fist)
 * @property {boolean} fist        closed fist (mouse: right button or Shift + button)
 * @property {boolean} open        open palm, 4+ fingers extended
 * @property {number} fingers      extended finger count 0..5
 * @property {'none'|'open'|'fist'|'point'|'pinch'|'victory'|'thumbsUp'} gesture
 * @property {number} roll         hand rotation in the image plane, radians, 0 = fingers up, + = counter-clockwise
 * @property {number} zoom         zoom delta this frame, + = zoom in (two-hand spread or mouse wheel)
 * @property {boolean} twoHands
 * @property {HandInfo[]} hands
 * @property {boolean} uiCaptured  the pointer is over / dragging UI; scenes should ignore pinch + drag
 * @property {Set<string>} events  edge events this frame: pinchstart, pinchend, fiststart, fistend,
 *                                 openstart, openend, victorystart, swipeleft, swiperight
 */

export function createInputState() {
  return {
    source: 'none',
    active: false,
    pointer: { x: 0, y: 0 },
    palm: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    dragDelta: { x: 0, y: 0 },
    depth: 0.5,
    pinch: 0,
    pinching: false,
    grab: 0,
    fist: false,
    open: false,
    fingers: 0,
    gesture: 'none',
    roll: 0,
    zoom: 0,
    twoHands: false,
    hands: [],
    uiCaptured: false,
    events: new Set(),
  };
}

const VEC_KEYS = ['pointer', 'palm', 'velocity', 'dragDelta'];

/** Copy a (possibly partial) state into `target`, cloning the small vector objects. */
export function assignInput(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (VEC_KEYS.includes(key) && value) {
      target[key].x = value.x ?? target[key].x;
      target[key].y = value.y ?? target[key].y;
    } else if (key === 'events') {
      for (const e of value) target.events.add(e);
    } else {
      target[key] = value;
    }
  }
  return target;
}
