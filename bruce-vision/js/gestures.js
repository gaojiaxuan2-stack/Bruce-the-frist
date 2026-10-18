// gestures.js — turns raw MediaPipe hand landmarks into smoothed, tracked
// hands with poses (open / fist / point / peace / spider / thumbsUp),
// pinch state, velocity, and one-shot events (pose, pinch, swipe, enter/leave).

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export const FINGER_TIPS = [4, 8, 12, 16, 20];
const CHAINS = {
  index: [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring: [0, 13, 14, 15, 16],
  pinky: [0, 17, 18, 19, 20],
};

// One Euro filter (Casiez et al.) — low lag when moving, low jitter when still.
class OneEuro {
  constructor(minCutoff = 2.0, beta = 0.012, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0;
  }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x === null || dt <= 0) { this.x = v; this.dx = 0; return v; }
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const len3 = (v) => Math.hypot(v.x, v.y, v.z);
const dist3 = (a, b) => len3(sub(a, b));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function angle3(u, v) {
  const d = (u.x * v.x + u.y * v.y + u.z * v.z) / (len3(u) * len3(v) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Total bend (radians) along a finger chain of 5 world landmarks.
function chainBend(w, chain) {
  let total = 0;
  for (let i = 1; i < chain.length - 1; i++) {
    total += angle3(sub(w[chain[i]], w[chain[i - 1]]), sub(w[chain[i + 1]], w[chain[i]]));
  }
  return total;
}

const POSE_CONFIRM_MS = 70;   // a new pose must hold this long before it counts
const GHOST_MS = 140;         // keep a lost hand alive this long (bridges blinks)
const SWIPE_WINDOW_MS = 260;

export class TrackedHand {
  constructor(id, t) {
    this.id = id;
    this.born = t;
    this.seen = t;
    this.filters = Array.from({ length: 21 }, () => [new OneEuro(), new OneEuro(), new OneEuro(1.0, 0.004)]);
    this.lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    this.world = null;
    this.ext = { thumb: false, index: false, middle: false, ring: false, pinky: false };
    this.curl = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
    this.pose = 'none';
    this.poseSince = t;
    this._cand = null; this._candSince = t; this._candFrames = 0;
    this.pinching = false;
    this.pinch = 0;
    this.pinchPoint = { x: 0, y: 0 };
    this.palm = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.speed = 0;
    this.size = 100;
    this.angle = -Math.PI / 2;
    this.dir = { x: 0, y: -1 };
    this.handedness = 'Right';
    this.score = 1;
    this.ghost = false;
    this.overUI = false;
    this.history = [];   // [{t, x, y}] palm positions for swipe detection
    this._swipeCooldown = 0;
  }

  get pointer() { return this.lm[LM.INDEX_TIP]; }
  get poseTime() { return (this._now - this.poseSince) / 1000; }
  get age() { return (this._now - this.born) / 1000; }
  is(pose) { return !this.ghost && this.pose === pose; }
}

export class GestureEngine {
  constructor() {
    this.hands = [];
    this.nextId = 1;
    this.lastT = 0;
  }

  // detections: [{ landmarks:[{x,y,z}] normalized (unmirrored), world:[...], handedness:'Left'|'Right', score }]
  // view: { toScreen(nx, ny) -> {x, y}, dw (px width of video on screen), W, H }
  update(detections, t, view) {
    const events = [];
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 1 / 30;
    this.lastT = t;

    // Screen-space wrist for matching.
    const dets = detections.map((d) => ({ ...d, wrist: view.toScreen(d.landmarks[0].x, d.landmarks[0].y) }));

    // Greedy nearest matching of detections to tracked hands.
    const pairs = [];
    for (const h of this.hands) {
      for (let i = 0; i < dets.length; i++) {
        let dd = dist2(h.lm[0], dets[i].wrist);
        if (h.handedness !== dets[i].handedness) dd *= 1.35;
        pairs.push({ h, i, dd });
      }
    }
    pairs.sort((a, b) => a.dd - b.dd);
    const maxJump = Math.max(view.W, view.H) * 0.45;
    const usedH = new Set(), usedD = new Set();
    const matched = [];
    for (const p of pairs) {
      if (usedH.has(p.h) || usedD.has(p.i) || p.dd > maxJump) continue;
      usedH.add(p.h); usedD.add(p.i);
      matched.push([p.h, dets[p.i]]);
    }
    for (let i = 0; i < dets.length; i++) {
      if (usedD.has(i)) continue;
      const h = new TrackedHand(this.nextId++, t);
      this.hands.push(h);
      matched.push([h, dets[i]]);
      h._fresh = true;
    }

    for (const [h, d] of matched) this._ingest(h, d, t, dt, view, events);

    // Ghosting / removal.
    this.hands = this.hands.filter((h) => {
      h._now = t;
      if (h.seen === t) { h.ghost = false; return true; }
      h.ghost = true;
      if (t - h.seen > GHOST_MS) {
        if (h.pinching) events.push({ type: 'pinchend', hand: h, x: h.pinchPoint.x, y: h.pinchPoint.y });
        events.push({ type: 'handleave', hand: h });
        return false;
      }
      return true;
    });

    // Stable left-to-right order on screen, and a side label.
    this.hands.sort((a, b) => a.palm.x - b.palm.x);
    for (const h of this.hands) h.side = h.palm.x < view.W / 2 ? 'left' : 'right';
    if (this.hands.length === 2) { this.hands[0].side = 'left'; this.hands[1].side = 'right'; }

    return { hands: this.hands, events };
  }

  _ingest(h, d, t, dt, view, events) {
    const fresh = h._fresh; h._fresh = false;
    h._now = t;
    h.seen = t;
    h.score = d.score ?? 1;
    // MediaPipe labels handedness for mirrored input; we feed raw camera
    // frames, so flip it to get the user's real hand.
    h.handedness = d.handedness === 'Left' ? 'Right' : 'Left';
    h.world = d.world;

    for (let i = 0; i < 21; i++) {
      const n = d.landmarks[i];
      const s = view.toScreen(n.x, n.y);
      const f = h.filters[i];
      h.lm[i].x = f[0].filter(s.x, dt);
      h.lm[i].y = f[1].filter(s.y, dt);
      h.lm[i].z = f[2].filter(n.z * view.dw, dt);
    }
    const lm = h.lm;

    // Palm, size, orientation.
    const px = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
    const py = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
    if (!fresh && dt > 0) {
      const vx = (px - h.palm.x) / dt, vy = (py - h.palm.y) / dt;
      h.vel.x += (vx - h.vel.x) * 0.5;
      h.vel.y += (vy - h.vel.y) * 0.5;
    }
    h.palm.x = px; h.palm.y = py;
    h.speed = Math.hypot(h.vel.x, h.vel.y);
    const size = Math.max(dist2(lm[0], lm[9]), dist2(lm[5], lm[17]) * 1.25);
    h.size = fresh ? size : h.size + (size - h.size) * 0.4;
    const dx = lm[9].x - lm[0].x, dy = lm[9].y - lm[0].y, dl = Math.hypot(dx, dy) || 1;
    h.dir = { x: dx / dl, y: dy / dl };
    h.angle = Math.atan2(dy, dx);

    // Finger states from 3D world landmarks (scale & distance invariant).
    const w = d.world && d.world.length === 21 ? d.world : d.landmarks;
    const ref = dist3(w[0], w[9]) || 1;
    for (const name of ['index', 'middle', 'ring', 'pinky']) {
      const ch = CHAINS[name];
      const bend = chainBend(w, ch);
      const reach = dist3(w[0], w[ch[4]]) / (dist3(w[0], w[ch[2]]) || 1);
      h.curl[name] = clamp01((bend - 0.5) / 2.2);
      const was = h.ext[name];
      h.ext[name] = was ? !(bend > 1.75 || reach < 1.05) : (bend < 1.3 && reach > 1.2);
    }
    const thumbOut = dist3(w[4], w[9]) / (dist3(w[5], w[17]) || 1);
    const thumbBend = angle3(sub(w[2], w[1]), sub(w[3], w[2])) + angle3(sub(w[3], w[2]), sub(w[4], w[3]));
    h.curl.thumb = clamp01(1.4 - thumbOut);
    h.ext.thumb = h.ext.thumb ? thumbOut > 0.92 && thumbBend < 1.5 : thumbOut > 1.08 && thumbBend < 1.2;

    // Pinch (thumb tip ↔ index tip) with hysteresis. In a fist the index tip
    // is tucked against the palm (short reach, close to the middle knuckle),
    // which tells it apart from a real pinch held out in front of the palm.
    const pr = dist3(w[4], w[8]) / ref;
    const indexReach = dist3(w[0], w[8]) / ref;
    const tipFromPalm = dist3(w[8], w[9]) / ref;
    h.pinch = clamp01((0.65 - pr) / 0.4);
    const wasPinching = h.pinching;
    if (wasPinching) {
      h.pinching = pr < 0.52 && indexReach > 0.8;
      h._pinchFrames = 0;
    } else {
      // Must hold for 2 frames / 50 ms so a hand curling into a fist
      // (thumb sweeping past the index tip) doesn't register as a pinch.
      const close = pr < 0.34 && indexReach > 0.95 && tipFromPalm > 0.5;
      h._pinchFrames = close ? (h._pinchFrames || 0) + 1 : 0;
      if (h._pinchFrames === 1) h._pinchSince = t;
      h.pinching = close && h._pinchFrames >= 2 && t - h._pinchSince >= 50;
    }
    h.pinchPoint = { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 };
    if (h.pinching && !wasPinching) events.push({ type: 'pinchstart', hand: h, x: h.pinchPoint.x, y: h.pinchPoint.y });
    if (!h.pinching && wasPinching) events.push({ type: 'pinchend', hand: h, x: h.pinchPoint.x, y: h.pinchPoint.y });

    // Pose with a short confirmation window.
    const raw = classify(h, lm);
    if (fresh) {
      h.pose = raw; h.poseSince = t; h._cand = raw; h._candSince = t;
      events.push({ type: 'handenter', hand: h });
      events.push({ type: 'pose', hand: h, pose: raw, prev: 'none' });
    } else if (raw !== h.pose) {
      if (raw !== h._cand) { h._cand = raw; h._candSince = t; h._candFrames = 0; }
      h._candFrames++;
      if (t - h._candSince >= POSE_CONFIRM_MS && h._candFrames >= 2) {
        const prev = h.pose;
        h.pose = raw; h.poseSince = t;
        events.push({ type: 'pose', hand: h, pose: raw, prev });
      }
    } else {
      h._cand = raw; h._candFrames = 0;
    }

    // Swipe: fast, mostly-horizontal palm travel inside a short window.
    h.history.push({ t, x: px, y: py });
    while (h.history.length && t - h.history[0].t > SWIPE_WINDOW_MS) h.history.shift();
    if (t > h._swipeCooldown && h.history.length >= 3 && h.pose !== 'fist') {
      const a = h.history[0];
      const sx = px - a.x, sy = py - a.y;
      const minDist = Math.min(view.W, view.H) * 0.3;
      if (Math.abs(sx) > minDist && Math.abs(sx) > 2 * Math.abs(sy)) {
        events.push({ type: 'swipe', hand: h, dir: sx > 0 ? 'right' : 'left' });
        h._swipeCooldown = t + 650; h.history.length = 0;
      } else if (Math.abs(sy) > minDist && Math.abs(sy) > 2 * Math.abs(sx)) {
        events.push({ type: 'swipe', hand: h, dir: sy > 0 ? 'down' : 'up' });
        h._swipeCooldown = t + 650; h.history.length = 0;
      }
    }
  }
}

function classify(h, lm) {
  const e = h.ext;
  const four = [e.index, e.middle, e.ring, e.pinky];
  const n = four.filter(Boolean).length;
  if (n === 0) {
    // Thumbs-up: thumb out and its tip clearly above the rest of the hand.
    if (e.thumb) {
      const tip = lm[4];
      let above = true;
      for (let i = 5; i <= 20; i++) if (lm[i].y < tip.y + h.size * 0.15) { above = false; break; }
      if (above && lm[4].y < lm[2].y - h.size * 0.35) return 'thumbsUp';
    }
    return 'fist';
  }
  if (e.index && e.pinky && !e.middle && !e.ring) return 'spider';
  if (e.index && !e.middle && !e.ring && !e.pinky) return 'point';
  if (e.index && e.middle && !e.ring && !e.pinky) return 'peace';
  if (n >= 4 || (n === 3 && e.middle && e.index)) return 'open';
  return 'other';
}
