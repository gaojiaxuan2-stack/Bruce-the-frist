// sim.js — synthetic hands for testing without a camera.
//
//   index.html?sim=<mode>[:<scenario>]       synthetic hands, procedural background
//   index.html?sim=<mode>:<scenario>&cam=1   synthetic hands over the real camera
//
// A scenario is a function (t seconds) -> [handSpec], where a handSpec is
//   { id, hand: 'right'|'left', pose, x, y, size, rot }
//   x, y : wrist position, 0..1 of the screen
//   size : wrist→middle-knuckle length as a fraction of min(screen W, H)
//   rot  : radians, 0 = fingers pointing up, positive = clockwise
//   pose : open | fist | point | spider | peace | thumbsUp | pinch | relaxed
// Modes may export `simScenarios: { name: (t) => [...] }`.

// Curl per finger: [thumb, index, middle, ring, pinky]; 0 straight, 1 curled.
const POSES = {
  open: [0, 0, 0, 0, 0],
  relaxed: [0.25, 0.12, 0.15, 0.22, 0.28],
  fist: [1, 1, 1, 1, 1],
  point: [1, 0, 1, 1, 1],
  spider: [0, 0, 1, 1, 0],
  peace: [1, 0, 0, 1, 1],
  thumbsUp: [0, 1, 1, 1, 1],
  pinch: [0.45, 0.42, 0.05, 0.05, 0.05],
};

// Right hand, palm facing the camera, as seen on the (mirrored) screen.
// Units: wrist→middle MCP = 1. x right, y down, z toward the viewer is negative.
const MCP = { index: [-0.33, -0.95], middle: [-0.06, -1.0], ring: [0.19, -0.95], pinky: [0.41, -0.82] };
const DIR = { index: -99, middle: -91, ring: -83, pinky: -74 };
const SEG = { index: [0.45, 0.27, 0.22], middle: [0.5, 0.3, 0.24], ring: [0.46, 0.28, 0.22], pinky: [0.36, 0.22, 0.2] };
const JOINT = [70, 100, 65];  // max flexion (deg) at MCP, PIP, DIP
const D2R = Math.PI / 180;

function buildHand(curls, mirror) {
  const P = new Array(21);
  P[0] = [0, 0, 0];
  // Thumb: from CMC, swings across the palm as it curls.
  const tc = curls[0];
  const cmc = [-0.28, -0.22, -0.05];
  P[1] = cmc;
  const tAngle = (-140 + tc * 105) * D2R;
  const tLift = tc * 35 * D2R;
  const tSeg = [0.38, 0.3, 0.26];
  let p = cmc;
  for (let k = 0; k < 3; k++) {
    const a = tAngle + k * tc * 25 * D2R;
    const lift = tLift * (1 + k * 0.5);
    const d = [Math.cos(a) * Math.cos(lift), Math.sin(a) * Math.cos(lift), -Math.sin(lift)];
    p = [p[0] + d[0] * tSeg[k], p[1] + d[1] * tSeg[k], p[2] + d[2] * tSeg[k]];
    P[2 + k] = p;
  }
  const fingers = ['index', 'middle', 'ring', 'pinky'];
  fingers.forEach((name, fi) => {
    const c = curls[fi + 1];
    const base = 5 + fi * 4;
    const m = MCP[name];
    P[base] = [m[0], m[1], 0];
    const dirA = (DIR[name] + (name === 'index' ? 1 : name === 'pinky' ? -1 : 0) * c * 8) * D2R;
    const d2 = [Math.cos(dirA), Math.sin(dirA)];
    let q = P[base], theta = 0;
    for (let k = 0; k < 3; k++) {
      theta += JOINT[k] * c * D2R;
      const s = SEG[name][k];
      q = [q[0] + d2[0] * Math.cos(theta) * s, q[1] + d2[1] * Math.cos(theta) * s, q[2] - Math.sin(theta) * s];
      P[base + 1 + k] = q;
    }
  });
  if (mirror) for (const q of P) q[0] = -q[0];
  return P;
}

export function handLandmarks(spec, view, curls) {
  const pts = buildHand(curls, spec.hand === 'left');
  if (spec.pose === 'pinch' || spec.pinch) {
    const a = pts[4], b = pts[8];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    pts[4] = m.slice(); pts[8] = m.slice();
  }
  const rot = spec.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
  const unit = (spec.size ?? 0.17) * Math.min(view.W, view.H);
  const wx = spec.x * view.W, wy = spec.y * view.H;
  const landmarks = [], world = [];
  for (const q of pts) {
    const rx = q[0] * c - q[1] * s, ry = q[0] * s + q[1] * c;
    const sx = wx + rx * unit, sy = wy + ry * unit;
    // screen px -> raw (unmirrored) normalized video coords
    const nx = 1 - (sx - view.ox) / view.dw;
    const ny = (sy - view.oy) / view.dh;
    landmarks.push({ x: nx, y: ny, z: (q[2] * unit) / view.dw });
    world.push({ x: rx * 0.085, y: ry * 0.085, z: q[2] * 0.085 });
  }
  // MediaPipe reports handedness for mirrored input; raw frames flip it.
  return { landmarks, world, handedness: spec.hand === 'left' ? 'Right' : 'Left', score: 0.99 };
}

// Default scenario: a tour of the poses with both hands.
export const BASE_SCENARIOS = {
  idle: () => [],
  demo: (t) => {
    const poses = ['open', 'point', 'spider', 'fist', 'peace', 'pinch', 'thumbsUp'];
    const pose = poses[Math.floor(t / 2) % poses.length];
    return [
      { id: 'R', hand: 'right', pose, x: 0.68 + Math.sin(t) * 0.05, y: 0.8, size: 0.16, rot: 0.1 },
      { id: 'L', hand: 'left', pose: 'open', x: 0.3, y: 0.8 + Math.sin(t * 1.3) * 0.03, size: 0.16, rot: -0.1 },
    ];
  },
  frame: (t) => [
    { id: 'L', hand: 'left', pose: 'open', x: 0.22 + Math.sin(t * 0.8) * 0.04, y: 0.72, size: 0.17, rot: 0.15 },
    { id: 'R', hand: 'right', pose: 'open', x: 0.78 - Math.sin(t * 0.8) * 0.04, y: 0.72, size: 0.17, rot: -0.15 },
  ],
  point: (t) => [{ id: 'R', hand: 'right', pose: 'point', x: 0.55 + Math.sin(t) * 0.2, y: 0.55, size: 0.17, rot: 0 }],
};

export class Sim {
  constructor(spec, modes) {
    const [modeId, scenario = 'demo'] = (spec || '').split(':');
    this.modeId = modeId || null;
    const mode = modes.find((m) => m.id === modeId);
    this.scenario = (mode?.simScenarios && mode.simScenarios[scenario]) || BASE_SCENARIOS[scenario] || BASE_SCENARIOS.demo;
    this.scenarioName = scenario;
    this.curls = new Map();
    this.t0 = performance.now();
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280; this.canvas.height = 720;
    this.g = this.canvas.getContext('2d');
    this.lastT = 0;
  }

  time(now) { return (now - this.t0) / 1000; }

  hands(now, view) {
    const t = this.time(now);
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const specs = this.scenario(t) || [];
    const out = [];
    for (const spec of specs) {
      const target = POSES[spec.pose] || POSES.open;
      let cur = this.curls.get(spec.id);
      if (!cur) { cur = target.slice(); this.curls.set(spec.id, cur); }
      const k = Math.min(1, dt * 14);
      for (let i = 0; i < 5; i++) cur[i] += (target[i] - cur[i]) * k;
      out.push(handLandmarks(spec, view, cur));
    }
    return out;
  }

  // A stand-in "camera" picture: a room and a person-ish silhouette.
  drawBackground(now) {
    const t = this.time(now);
    const g = this.g, W = 1280, H = 720;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#d9d4cc'); sky.addColorStop(1, '#a89f94');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // curtain stripes on one side, poster on the other
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#bdb6ad' : '#cfc8bf';
      g.fillRect(i * 22, 0, 22, H);
    }
    g.fillStyle = '#2b6cb0'; g.fillRect(1000, 120, 160, 220);
    g.fillStyle = '#f6ad55'; g.beginPath(); g.arc(1080, 200, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e53e3e'; g.fillRect(1020, 280, 120, 30);
    // person: torso + neck + head + hair
    const cx = 640 + Math.sin(t * 0.7) * 12;
    g.fillStyle = '#1a1a1f';
    g.beginPath(); g.ellipse(cx, 760, 330, 260, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c9906b'; g.fillRect(cx - 45, 360, 90, 120);
    g.fillStyle = '#d9a27a';
    g.beginPath(); g.ellipse(cx, 300, 105, 135, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1b14';
    g.beginPath(); g.ellipse(cx, 220, 125, 90, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillRect(cx - 125, 220, 30, 170); g.fillRect(cx + 95, 220, 30, 170);
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(cx - 38, 295, 16, 8, 0, 0, Math.PI * 2); g.ellipse(cx + 38, 295, 16, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3b2a20';
    g.beginPath(); g.arc(cx - 38, 295, 6, 0, Math.PI * 2); g.arc(cx + 38, 295, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a4b3c'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, 345, 30, 0.2, Math.PI - 0.2); g.stroke();
  }
}
