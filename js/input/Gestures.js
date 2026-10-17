// Hand-gesture maths. Pure functions and small classes: no DOM, no three.js,
// so everything here runs (and is unit-tested) in Node.
//
// Landmarks are the 21 MediaPipe hand points converted with `toHandSpace()`:
// one unit on every axis (image heights), x to the right as the user sees it
// (selfie-mirrored), y UP and z TOWARD the camera. Every test below compares
// distances or angles between landmarks, so it does not care how the hand is
// rotated, how big it is, or which hand it is.

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

/** Bones of the hand skeleton, as landmark index pairs (for drawing). */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** The four long fingers (index, middle, ring, pinky). */
const LONG_FINGERS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export const GESTURES = ['none', 'open', 'fist', 'point', 'pinch', 'victory', 'thumbsUp'];

/** Tunable thresholds (distances are in hand-scale units, see handScale()). */
export const THRESHOLDS = {
  // A long finger is extended when its tip is this much farther from the wrist than its PIP joint...
  // (measured on real MediaPipe output: extended 1.32-1.44, curled 0.56-0.76).
  fingerReach: 1.1,
  // ...and it is not bent back on itself (cosine between the MCP->PIP and PIP->TIP directions).
  fingerStraight: 0.1,
  // Thumb: tip must be this far from the index knuckle (hand-scale units)...
  thumbReach: 0.5,
  // ...farther from the pinky knuckle than the thumb's IP joint is (extended ~1.17, folded <= 0.82)...
  thumbOut: 1.0,
  // ...and roughly straight.
  thumbStraight: 0.3,
  // Hysteresis: an extended finger / thumb only counts as bent this much below its threshold.
  hysteresis: 0.05,
  // thumbs up: the thumb points within this angle of straight up (radians, ~70 deg).
  thumbUpAngle: 1.22,
  // Pinch distance (thumb tip <-> index tip) / hand scale.
  pinchEnter: 0.33,
  pinchExit: 0.48,
  // Pinch strength ramp: distance where strength is 1 and where it reaches 0.
  pinchFull: 0.18,
  pinchNone: 0.9,
  // In a fist the thumb rests on the curled index, so the tips are close too (0.17-0.24).
  // The index finger decides, with hysteresis (real MediaPipe fists: reach 0.68-0.76,
  // straight -0.41..-0.84, tip 0.53-0.66 from the palm centre; pinches: reach >= 0.95,
  // straight >= 0.3, tip >= 0.99):
  // a pinch can START only while the index is clearly free: reach above this (see fingerState)...
  pinchIndexReach: 0.9,
  // ...or not bent back on itself;
  pinchIndexStraight: -0.1,
  // ...and with its tip away from the palm centre (hand-scale units; while a fist opens,
  // the thumb lies on the uncurling index for a moment);
  pinchIndexTipPalm: 0.8,
  // a pinch ENDS once the index is folded into the palm: reach below this and...
  foldIndexReach: 0.84,
  // ...bent back on itself, or its tip close to the palm centre.
  foldIndexStraight: -0.25,
  foldIndexTipPalm: 0.68,
  // Grab ramp: fingertip -> palm-centre distance (hand-scale units) for an open hand and a fist.
  grabOpen: 1.2,
  grabClosed: 0.6,
};

// ------------------------------------------------------------------ vectors

export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
}

function cosBetween(u, v) {
  const lu = Math.hypot(u.x, u.y, u.z);
  const lv = Math.hypot(v.x, v.y, v.z);
  if (lu < 1e-9 || lv < 1e-9) return 1;
  return (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv);
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Convert MediaPipe normalized landmarks (x right / y down in the raw, un-mirrored
 * camera image, z negative toward the camera, all in image-width units except y)
 * to hand space (isotropic, mirrored, y up, z toward the camera).
 * @param {{x:number,y:number,z:number}[]} raw
 * @param {number} aspect video width / height
 * @param {{x:number,y:number,z:number}[]} [out] reused output array
 */
export function toHandSpace(raw, aspect, out = []) {
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const p = out[i] || (out[i] = { x: 0, y: 0, z: 0 });
    p.x = (1 - r.x) * aspect;
    p.y = 1 - r.y;
    p.z = -(r.z || 0) * aspect;
  }
  out.length = raw.length;
  return out;
}

// ------------------------------------------------------------------ landmark helpers

/** Palm centre: between the wrist and the four knuckles. */
export function palmCenter(lm, out = { x: 0, y: 0, z: 0 }) {
  const w = lm[0];
  const k = [lm[5], lm[9], lm[13], lm[17]];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of k) {
    x += p.x;
    y += p.y;
    z += p.z || 0;
  }
  out.x = w.x * 0.4 + (x / 4) * 0.6;
  out.y = w.y * 0.4 + (y / 4) * 0.6;
  out.z = (w.z || 0) * 0.4 + (z / 4) * 0.6;
  return out;
}

/**
 * Hand size in landmark units: the rigid palm (wrist -> middle knuckle and the
 * knuckle row), averaged so it barely changes with gesture or rotation.
 */
export function handScale(lm) {
  const length = dist(lm[0], lm[9]);
  const width = dist(lm[5], lm[17]) / 0.82;
  return Math.max(1e-6, (length + width) * 0.5);
}

/** Apparent 2D hand size (shrinks when the hand moves away from the camera). */
export function handScale2D(lm) {
  const length = dist2D(lm[0], lm[9]);
  const width = dist2D(lm[5], lm[17]) / 0.82;
  // The larger of the two survives the hand being tilted or turned sideways.
  return Math.max(1e-6, Math.max(length, width * 0.9, (length + width) * 0.5));
}

/** Hand roll in the image plane: 0 = fingers up, + = counter-clockwise (as seen on screen). */
export function rollAngle(lm) {
  const vx = lm[9].x - lm[0].x;
  const vy = lm[9].y - lm[0].y;
  return Math.atan2(-vx, vy);
}

/**
 * Extension of a long finger (0 index .. 3 pinky): {extended, reach, straight}.
 * `wasExtended` adds hysteresis: a finger that was extended last frame stays
 * extended until it is clearly bent, so a half-bent finger does not flicker.
 */
export function fingerState(lm, finger, t = THRESHOLDS, wasExtended = false) {
  const [mcp, pip, , tip] = LONG_FINGERS[finger];
  const w = lm[0];
  const reach = dist(w, lm[tip]) / Math.max(1e-6, dist(w, lm[pip]));
  const straight = cosBetween(sub(lm[pip], lm[mcp]), sub(lm[tip], lm[pip]));
  const h = wasExtended ? t.hysteresis : 0;
  return { extended: reach > t.fingerReach - h && straight > t.fingerStraight - h * 2.5, reach, straight };
}

/** Thumb extension: {extended, reach, out, straight, up}. `wasExtended`: see fingerState. */
export function thumbState(lm, scale = handScale(lm), t = THRESHOLDS, wasExtended = false) {
  const tip = lm[4];
  const ip = lm[3];
  const mcp = lm[2];
  const reach = dist(tip, lm[5]) / scale;
  const out = dist(tip, lm[17]) / Math.max(1e-6, dist(ip, lm[17]));
  const straight = cosBetween(sub(ip, mcp), sub(tip, ip));
  // Direction of the thumb (MCP -> tip) against screen-up, radians.
  const dx = tip.x - mcp.x;
  const dy = tip.y - mcp.y;
  const up = Math.abs(Math.atan2(dx, dy));
  const h = wasExtended ? t.hysteresis : 0;
  const extended = reach > t.thumbReach - h && out > t.thumbOut - h && straight > t.thumbStraight - h * 2.5;
  return { extended, reach, out, straight, up };
}

/** [thumb, index, middle, ring, pinky] extended flags. */
export function extendedFingers(lm, scale = handScale(lm), t = THRESHOLDS) {
  return [
    thumbState(lm, scale, t).extended,
    fingerState(lm, 0, t).extended,
    fingerState(lm, 1, t).extended,
    fingerState(lm, 2, t).extended,
    fingerState(lm, 3, t).extended,
  ];
}

export function countFingers(lm, scale = handScale(lm), t = THRESHOLDS) {
  return extendedFingers(lm, scale, t).filter(Boolean).length;
}

/** Thumb-tip to index-tip distance divided by the hand scale. */
export function pinchDistance(lm, scale = handScale(lm)) {
  return dist(lm[4], lm[8]) / scale;
}

/** 0..1, 1 = thumb and index touching. */
export function pinchStrength(lm, scale = handScale(lm), t = THRESHOLDS) {
  const d = pinchDistance(lm, scale);
  return clamp((t.pinchNone - d) / (t.pinchNone - t.pinchFull), 0, 1);
}

/** 0..1 hand closedness (0 open palm .. 1 fist) from the fingertip -> palm distances. */
export function grabAmount(lm, scale = handScale(lm), t = THRESHOLDS) {
  const c = palmCenter(lm);
  let sum = 0;
  let max = 0;
  for (const f of LONG_FINGERS) {
    const d = dist(lm[f[3]], c) / scale;
    sum += d;
    max = Math.max(max, d);
  }
  // Mostly "how open is the most open finger", so pointing is not grabbing; a little
  // of the mean keeps it continuous while the hand closes.
  const ramp = (d) => clamp((t.grabOpen - d) / (t.grabOpen - t.grabClosed), 0, 1);
  return ramp(max) * 0.8 + ramp(sum / 4) * 0.2;
}

/**
 * Everything the classifier needs, computed once per hand per frame.
 * @param {{x:number,y:number,z:number}[]} lm hand-space landmarks
 * @param {boolean[]|null} [prevExt] last frame's `ext` for this hand (finger hysteresis)
 * @returns {{scale:number, ext:boolean[], fingers:number, pinchDist:number, pinch:number,
 *   pinchAllowed:boolean, indexFolded:boolean, indexOpen:number, grab:number, thumbUp:boolean,
 *   roll:number}}
 *   pinchAllowed: a pinch may start; indexFolded: the index is curled into a fist (ends a
 *   pinch); indexOpen: 0 (folded) .. 1 (free), continuous between the two.
 */
export function analyzeHand(lm, prevExt = null, t = THRESHOLDS) {
  const was = (i) => !!prevExt?.[i];
  const scale = handScale(lm);
  const thumb = thumbState(lm, scale, t, was(0));
  const index = fingerState(lm, 0, t, was(1));
  const ext = [
    thumb.extended,
    index.extended,
    fingerState(lm, 1, t, was(2)).extended,
    fingerState(lm, 2, t, was(3)).extended,
    fingerState(lm, 3, t, was(4)).extended,
  ];
  const pinchDist = pinchDistance(lm, scale);
  const g = indexGrip(lm, index, scale, t);
  const raw = clamp((t.pinchNone - pinchDist) / (t.pinchNone - t.pinchFull), 0, 1);
  return {
    scale,
    ext,
    fingers: ext.filter(Boolean).length,
    pinchDist,
    // Fades out as the index folds into the palm, so a fist never reads as a pinch.
    pinch: raw * g.open,
    pinchAllowed: g.free,
    indexFolded: g.folded,
    indexOpen: g.open,
    grab: grabAmount(lm, scale, t),
    thumbUp: thumb.extended && thumb.up < t.thumbUpAngle,
    roll: rollAngle(lm),
  };
}

/**
 * Is the index finger free to pinch, or folded into a fist? Two thresholds with a gap
 * between them (hysteresis): `free` starts a pinch, `folded` ends one.
 * @returns {{free: boolean, folded: boolean, open: number, tipPalm: number}}
 */
export function indexGrip(lm, index = fingerState(lm, 0), scale = handScale(lm), t = THRESHOLDS) {
  const tipPalm = dist(lm[8], palmCenter(lm)) / scale;
  const free = (index.reach > t.pinchIndexReach || index.straight > t.pinchIndexStraight)
    && tipPalm > t.pinchIndexTipPalm;
  const folded = !free && index.reach < t.foldIndexReach
    && (index.straight < t.foldIndexStraight || tipPalm < t.foldIndexTipPalm);
  const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
  const open = folded ? 0 : Math.min(
    Math.max(ramp(index.reach, t.foldIndexReach, t.pinchIndexReach), ramp(index.straight, t.foldIndexStraight, t.pinchIndexStraight)),
    ramp(tipPalm, t.foldIndexTipPalm, t.pinchIndexTipPalm),
  );
  return { free, folded, open, tipPalm };
}

/** Can a pinch start with this hand shape? (Not while the index is folded into a fist.) */
export function pinchAllowed(info) {
  return info.pinchAllowed;
}

/**
 * Classify a hand shape.
 * @param {ReturnType<typeof analyzeHand>} info
 * @param {boolean} [pinching] stable pinch state (from PinchDetector); when omitted the
 *   raw pinch distance is used.
 * @returns {'open'|'fist'|'point'|'pinch'|'victory'|'thumbsUp'|'none'}
 */
export function classifyGesture(info, pinching, t = THRESHOLDS) {
  const isPinch = pinching ?? (info.pinchDist < t.pinchEnter && info.pinchAllowed);
  if (isPinch) return 'pinch';
  return classifyShape(info);
}

/** Classification that ignores pinching (what the fingers are doing). */
export function classifyShape(info) {
  const [thumb, index, middle, ring, pinky] = info.ext;
  const long = (index ? 1 : 0) + (middle ? 1 : 0) + (ring ? 1 : 0) + (pinky ? 1 : 0);
  // All four long fingers curled: a fist, unless the thumb sticks up.
  if (long === 0) return info.thumbUp ? 'thumbsUp' : 'fist';
  if (long + (thumb ? 1 : 0) >= 4) return 'open';
  if (index && !middle && !ring && !pinky) return 'point';
  if (index && middle && !ring && !pinky) return 'victory';
  return 'none';
}

// ------------------------------------------------------------------ filters & detectors

class LowPass {
  constructor() {
    this.s = 0;
    this.init = false;
  }

  filter(x, alpha) {
    this.s = this.init ? alpha * x + (1 - alpha) * this.s : x;
    this.init = true;
    return this.s;
  }
}

function smoothingFactor(dt, cutoff) {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

/**
 * One Euro filter (Casiez et al. 2012): strong smoothing when the signal is slow
 * (kills jitter), little smoothing when it moves fast (kills lag).
 */
export class OneEuroFilter {
  /**
   * @param {{minCutoff?: number, beta?: number, dCutoff?: number}} [o]
   *   minCutoff Hz (lower = smoother at rest), beta (higher = less lag when fast)
   */
  constructor({ minCutoff = 1.2, beta = 0.6, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
    this.value = 0;
  }

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastTime = null;
  }

  /** @param {number} value @param {number} time seconds (must increase) */
  filter(value, time) {
    if (this.lastTime === null) {
      this.lastTime = time;
      this.x.filter(value, 1);
      this.dx.filter(0, 1);
      this.value = value;
      return value;
    }
    const dt = time - this.lastTime;
    if (dt <= 0) return this.value;
    this.lastTime = time;
    const dValue = (value - this.x.s) / dt;
    const edx = this.dx.filter(dValue, smoothingFactor(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.value = this.x.filter(value, smoothingFactor(dt, cutoff));
    return this.value;
  }
}

/**
 * Pinch on/off with hysteresis so a held pinch never flickers: it starts below
 * `enter` and ends above `exit` (normalised thumb-index distance), or when the
 * hand closes into a fist (in a fist the thumb rests on the curled index, so the
 * distance alone would keep the pinch alive forever).
 */
export class PinchDetector {
  constructor({
    enter = THRESHOLDS.pinchEnter,
    exit = THRESHOLDS.pinchExit,
    enterFrames = 1,
    releaseFrames = 2,
  } = {}) {
    this.enter = enter;
    this.exit = exit;
    this.enterFrames = enterFrames;
    this.releaseFrames = releaseFrames;
    this.pinching = false;
    this.below = 0;
    this.above = 0;
    this.folded = 0;
  }

  reset() {
    this.pinching = false;
    this.below = 0;
    this.above = 0;
    this.folded = 0;
  }

  /**
   * @param {number} d normalised thumb-index distance
   * @param {boolean} [allowed] false blocks a NEW pinch (the index is not clearly free)
   * @param {boolean} [folded] the index is folded into a fist: ends a pinch after
   *   `releaseFrames` such frames in a row
   * @returns {boolean} pinching
   */
  update(d, allowed = true, folded = false) {
    if (!this.pinching) {
      this.below = allowed && !folded && d < this.enter ? this.below + 1 : 0;
      if (this.below >= this.enterFrames) {
        this.pinching = true;
        this.below = 0;
        this.above = 0;
        this.folded = 0;
      }
      return this.pinching;
    }
    this.folded = folded ? this.folded + 1 : 0;
    this.above = d > this.exit ? this.above + 1 : 0;
    // Release after a couple of frames above the exit line (at once when clearly open),
    // or a couple of frames of a closed fist.
    if (this.above >= this.releaseFrames || d > this.exit * 1.6 || this.folded >= this.releaseFrames) {
      this.pinching = false;
      this.above = 0;
      this.folded = 0;
    }
    return this.pinching;
  }
}

/**
 * Where the pointer sits between the index fingertip (0) and the thumb/index midpoint (1).
 * The midpoint barely moves while the fingers meet, so a pinch-click lands where you aimed.
 * Continuous in the pinch distance and damped on the way back (fast in, slow out), so the
 * cursor glides back to the fingertip after a pinch instead of hopping.
 */
export class PinchPointBlend {
  constructor({ near = 0.3, far = 0.8, rise = 30, fall = 9 } = {}) {
    this.near = near;
    this.far = far;
    this.rise = rise;
    this.fall = fall;
    this.w = 0;
    this.init = false;
  }

  reset() {
    this.w = 0;
    this.init = false;
  }

  /**
   * @param {number} d normalised thumb-index distance
   * @param {number} indexOpen 0..1 (analyzeHand().indexOpen)
   * @param {boolean} pinching stable pinch state
   * @param {number} dt seconds since the last update (tracking rate)
   * @returns {number} 0..1
   */
  update(d, indexOpen, pinching, dt) {
    const t = clamp((d - this.near) / (this.far - this.near), 0, 1);
    const target = pinching ? 1 : (1 - t * t * (3 - 2 * t)) * clamp(indexOpen, 0, 1);
    if (!this.init || !(dt > 0)) {
      this.w = target;
      this.init = true;
      return this.w;
    }
    const k = target > this.w ? this.rise : this.fall;
    this.w += (target - this.w) * (1 - Math.exp(-k * Math.min(dt, 0.5)));
    return this.w;
  }
}

/**
 * Debounces a discrete value (gesture name, finger count...): a new value is
 * reported only after it was seen in `minFrames` consecutive updates spanning
 * at least `minMs`.
 */
export class GestureStabilizer {
  constructor({ minFrames = 3, minMs = 80, initial = 'none' } = {}) {
    this.minFrames = minFrames;
    this.minMs = minMs;
    this.value = initial;
    this.candidate = initial;
    this.count = 0;
    this.since = 0;
  }

  reset(value = 'none') {
    this.value = value;
    this.candidate = value;
    this.count = 0;
    this.since = 0;
  }

  /** Accept a value immediately (e.g. after the hand re-appears). */
  force(value) {
    this.reset(value);
    return value;
  }

  /** @param {*} raw @param {number} timeMs */
  update(raw, timeMs) {
    if (raw === this.value) {
      this.candidate = raw;
      this.count = 0;
      return this.value;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.count = 1;
      this.since = timeMs;
    } else {
      this.count++;
    }
    if (this.count >= this.minFrames && timeMs - this.since >= this.minMs) {
      this.value = raw;
      this.count = 0;
    }
    return this.value;
  }
}

/**
 * Horizontal swipe of an open hand: a deliberate flick, not just any sideways move.
 * Feed it one sample per tracking frame (skip frames where the hand was not detected).
 * A swipe:
 *   - starts from rest or a turn (the hand was nearly still, or moving the other way),
 *   - covers at least `minDistance` (NDC) sideways within `maxDuration` ms of that start,
 *   - is fast: `fastSteps` samples in a row at `minSpeed` NDC/s or more,
 *   - is mostly horizontal (|dy| < maxSlope * |dx| along the whole path).
 * 'swipeleft' = toward the left of the (mirrored) screen. After a swipe nothing fires
 * for `cooldown` ms (the hand coming back is not a swipe).
 *
 * `size` scales distance and speeds with the apparent hand size (1 = comfortable
 * distance), so the same physical flick works near and far from the camera.
 * Slow tracking (a few frames per second) cannot time a 200 ms flick: pass the
 * sampling interval and the allowed duration grows to ~1.3 intervals (the distance
 * stays the same, the speed threshold drops to match). At 30 fps nothing changes.
 */
export class SwipeDetector {
  constructor({
    minDistance = 0.8,
    maxDuration = 350,
    minSpeed = 2.5,
    fastSteps = 2,
    restSpeed = 1.0,
    maxSlope = 0.6,
    cooldown = 900,
  } = {}) {
    this.minDistance = minDistance;
    this.maxDuration = maxDuration;
    this.minSpeed = minSpeed;
    this.fastSteps = fastSteps;
    this.restSpeed = restSpeed;
    this.maxSlope = maxSlope;
    this.cooldown = cooldown;
    this.history = [];
    this.lastSwipe = -Infinity;
  }

  /** Forget the motion so far (hand lost, primary hand changed...). */
  reset() {
    this.history.length = 0;
  }

  /**
   * @param {number} timeMs
   * @param {number} x NDC (+ = right of the screen)
   * @param {number} y NDC
   * @param {boolean} [eligible] the hand is a settled open palm (not pinching / fist)
   * @param {number} [intervalMs] typical time between tracking samples
   * @param {number} [size] apparent hand size, 1 = comfortable distance
   * @returns {'swipeleft'|'swiperight'|null}
   */
  update(timeMs, x, y, eligible = true, intervalMs = 0, size = 1) {
    const h = this.history;
    if (!eligible) {
      h.length = 0;
      return null;
    }
    const last = h[h.length - 1];
    if (last && timeMs <= last.t) return null;
    const interval = clamp(intervalMs || 0, 0, 600);
    const duration = Math.max(this.maxDuration, interval * 1.3);
    // A long gap (the hand was lost) breaks the motion.
    if (last && timeMs - last.t > Math.max(duration, interval * 2.5)) h.length = 0;
    // `first`: the hand just became eligible, so this sample may start a flick.
    h.push({ t: timeMs, x, y, first: h.length === 0 });
    // Older samples cannot start a flick that is still running.
    while (h.length > 1 && timeMs - h[0].t > duration) h.shift();
    const n = h.length - 1;
    if (n < 1 || timeMs - this.lastSwipe < this.cooldown) return null;

    const s = clamp(size || 1, 0.5, 1.6);
    const sign = Math.sign(h[n].x - h[n - 1].x);
    if (!sign) return null;
    const need = this.minDistance * s;
    const rest = this.restSpeed * s;
    const fast = this.minSpeed * s * Math.min(1, this.maxDuration / duration);
    const fastNeed = interval > 90 ? 1 : this.fastSteps;
    // Walk back to where this movement started: the last sample where the hand was
    // nearly still or moving the other way.
    let k = n;
    let run = 0;
    let bestRun = 0;
    while (k > 0) {
      const a = h[k - 1];
      const b = h[k];
      const dx = (b.x - a.x) * sign;
      const v = dx / ((b.t - a.t) / 1000);
      if (dx <= 0 || v < rest) break;
      run = v >= fast ? run + 1 : 0;
      bestRun = Math.max(bestRun, run);
      k--;
    }
    // Still moving at the oldest sample we kept: the movement began too long ago
    // (unless the hand only just became eligible there).
    if (k === 0 && !h[0].first) return null;
    const o = h[k];
    const dx = (h[n].x - o.x) * sign;
    if (dx < need || bestRun < fastNeed || h[n].t - o.t > duration) return null;
    for (let i = k + 1; i <= n; i++) {
      if (Math.abs(h[i].y - o.y) >= this.maxSlope * dx) return null;
    }
    this.lastSwipe = timeMs;
    h.length = 0;
    return sign < 0 ? 'swipeleft' : 'swiperight';
  }
}
