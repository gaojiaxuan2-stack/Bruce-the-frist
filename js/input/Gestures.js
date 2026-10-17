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
  // In a fist the thumb rests on the curled index, so the tips are close too (0.18-0.24):
  // a pinch needs the index finger NOT folded into the palm (reach above this, see fingerState)...
  pinchIndexReach: 0.86,
  // ...or not bent back on itself.
  pinchIndexStraight: -0.25,
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
 *   pinchAllowed:boolean, grab:number, thumbUp:boolean, roll:number}}
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
  const indexFree = index.reach > t.pinchIndexReach || index.straight > t.pinchIndexStraight;
  // Fade the strength out as the index folds into the palm, so a fist never reads as a pinch.
  const indexOpen = clamp((index.reach - (t.pinchIndexReach - 0.08)) / 0.12, 0, 1);
  const raw = clamp((t.pinchNone - pinchDist) / (t.pinchNone - t.pinchFull), 0, 1);
  return {
    scale,
    ext,
    fingers: ext.filter(Boolean).length,
    pinchDist,
    pinch: indexFree ? raw * Math.max(indexOpen, index.straight > t.pinchIndexStraight ? 1 : 0) : 0,
    pinchAllowed: indexFree,
    grab: grabAmount(lm, scale, t),
    thumbUp: thumb.extended && thumb.up < t.thumbUpAngle,
    roll: rollAngle(lm),
  };
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
 * `enter` and only ends above `exit` (normalised thumb-index distance).
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
  }

  reset() {
    this.pinching = false;
    this.below = 0;
    this.above = 0;
  }

  /**
   * @param {number} d normalised thumb-index distance
   * @param {boolean} [allowed] false blocks a NEW pinch (e.g. the hand is a fist)
   * @returns {boolean} pinching
   */
  update(d, allowed = true) {
    if (!this.pinching) {
      this.below = allowed && d < this.enter ? this.below + 1 : 0;
      if (this.below >= this.enterFrames) {
        this.pinching = true;
        this.below = 0;
        this.above = 0;
      }
    } else if (d > this.exit) {
      // Release after a couple of frames above the exit line, or at once when clearly open.
      this.above++;
      if (this.above >= this.releaseFrames || d > this.exit * 1.6) {
        this.pinching = false;
        this.above = 0;
      }
    } else {
      this.above = 0;
    }
    return this.pinching;
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
 * Horizontal swipe of an open hand. Feed it one sample per tracking frame.
 * A swipe = the hand travelled at least `minDistance` (NDC) sideways within
 * `maxDuration` ms, mostly horizontally. 'swipeleft' = toward the left of the
 * (mirrored) screen.
 *
 * Slow tracking (a few frames per second) cannot time a 200 ms flick: pass the
 * sampling interval and the allowed duration grows to ~1.3 intervals (the
 * distance threshold stays the same). At 30 fps nothing changes.
 */
export class SwipeDetector {
  constructor({ minDistance = 0.55, maxDuration = 350, maxSlope = 0.6, cooldown = 900 } = {}) {
    this.minDistance = minDistance;
    this.maxDuration = maxDuration;
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
   * @param {boolean} [eligible] the hand is an open palm (not pinching / fist)
   * @param {number} [intervalMs] typical time between tracking samples
   * @returns {'swipeleft'|'swiperight'|null}
   */
  update(timeMs, x, y, eligible = true, intervalMs = 0) {
    const h = this.history;
    if (!eligible) {
      h.length = 0;
      return null;
    }
    const interval = Math.min(600, Math.max(0, intervalMs));
    const duration = Math.max(this.maxDuration, interval * 1.3);
    const window = Math.max(duration, interval * 2.5);
    const last = h[h.length - 1];
    if (last && (timeMs - last.t > window || timeMs <= last.t)) h.length = 0;
    h.push({ t: timeMs, x, y });
    while (h.length && timeMs - h[0].t > window) h.shift();
    if (timeMs - this.lastSwipe < this.cooldown) return null;

    const minSpeed = this.minDistance / duration;
    for (let i = 0; i < h.length - 1; i++) {
      const dx = x - h[i].x;
      const dy = y - h[i].y;
      const dt = timeMs - h[i].t;
      const adx = Math.abs(dx);
      if (adx >= this.minDistance && adx / dt >= minSpeed && Math.abs(dy) < this.maxSlope * adx) {
        this.lastSwipe = timeMs;
        h.length = 0;
        return dx < 0 ? 'swipeleft' : 'swiperight';
      }
    }
    return null;
  }
}
