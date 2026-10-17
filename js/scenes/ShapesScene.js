// Shapes: ~120k glowing particles that morph between 3D forms.
// Hold up 1–5 fingers (or 👍) to pick a shape — no typing needed.
//   ☝️ point      push the particles (springy hole with a wake that ripples back)
//   🤏 pinch+drag rotate with inertia          ✊ fist → ✋ open   squeeze into a core, then explode
//   tilt hand     rotate around the view axis  hand closer / wheel  scale
//   mouse click   next shape                   GUI                  shape list + your own text
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { createShapeMaterial, createStarMaterial, TRAIL_SLOTS } from './shapes/shaders.js';
import {
  mulberry32,
  sphereTarget,
  knotTarget,
  heartTarget,
  dnaTarget,
  planetTarget,
  textTarget,
  cloudTarget,
} from './shapes/targets.js';

const TAU = Math.PI * 2;
const SPREAD = 0.45; // share of the morph used for the per-particle stagger (must match uSpread)
const PUFF = 0.16; // outward bloom mid-flight (must match uPuff)
const SWEEP_MIX = 0.7; // how much the shape's own order drives the stagger
const HOLD_TIME = 0.6; // seconds a finger count must be held
const HEART = 2;
const TEXT = 5;
const WAKE = TRAIL_SLOTS - 1;

/** tilt: presentation tilt (x, y, z radians), spin: auto-rotation factor, sway: face the viewer. */
const SHAPES = [
  { name: 'Sphere', icon: '🔮', fingers: 1, tilt: [0.35, 0, 0.18], spin: 1 },
  { name: 'Torus knot', icon: '➰', fingers: 2, tilt: [0.45, 0, 0], spin: 1 },
  { name: 'Heart', icon: '❤️', fingers: 3, tilt: [0, 0, 0], sway: 0.6 },
  { name: 'DNA helix', icon: '🧬', fingers: 4, tilt: [0, 0, 0.32], spin: 1.6 },
  { name: 'Planet', icon: '🪐', fingers: 5, tilt: [0.4, 0, -0.32], spin: 0.8 },
  { name: 'Text', icon: '🔤', fingers: 0, tilt: [0, 0, 0], sway: 0.38 },
];
const FINGER_ICON = ['', '☝️', '✌️', '🤟', '🖖', '🖐️'];

/** Settings survive a quality change (the App rebuilds the scene then). */
let savedSettings = null;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();

/** Critically-ish damped spring, sub-stepped so it stays stable at low frame rates. */
function spring(state, target, omega, zeta, dt) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    state.v += (omega * omega * (target - state.x) - 2 * zeta * omega * state.v) * h;
    state.x += state.v * h;
  }
  return state.x;
}

export default class ShapesScene extends BaseScene {
  static meta = {
    id: 'shapes',
    title: 'Shapes',
    subtitle: 'Hold up fingers to change the shape (mouse: click)',
    icon: '💠',
    hints: [
      { icon: '✌️', gesture: '1 · 2 fingers', text: 'Sphere · Torus knot' },
      { icon: '🖐️', gesture: '3 · 4 · 5 fingers', text: 'Heart · DNA · Planet' },
      { icon: '👍', gesture: 'Thumbs up', text: 'your text' },
      { icon: '☝️', gesture: 'Point + move', text: 'push the particles' },
      { icon: '🤏', gesture: 'Pinch + drag', text: 'rotate (tilt hand: turn)' },
      { icon: '✊', gesture: 'Fist, then open ✋', text: 'squeeze, then explode' },
    ],
    bloom: { strength: 0.9, radius: 0.5, threshold: 0.05 },
  };

  async init() {
    const n = this.count(120000);
    this.n = n;
    this.settings = {
      shape: 0,
      text: 'HELLO',
      autoRotate: 0.3,
      size: 1,
      morphTime: 1.6,
      swirl: 1,
      pushSize: 1,
      autoDemo: true,
      ...savedSettings,
    };
    savedSettings = this.settings;

    const rand = mulberry32(20261017);
    this.rand = rand;
    this.targets = [
      sphereTarget(n, rand),
      knotTarget(n, rand),
      heartTarget(n, rand),
      dnaTarget(n, rand),
      planetTarget(n, rand),
      textTarget(n, this.settings.text, rand),
    ];
    this.settings.text = this.targets[TEXT].text;

    // ---- particles
    const geo = new THREE.BufferGeometry();
    const attr = (array, size) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.attr = {
      to: attr(new Float32Array(n * 3), 3),
      from: attr(new Float32Array(n * 3), 3),
      cTo: attr(new Float32Array(n * 3), 3),
      cFrom: attr(new Float32Array(n * 3), 3),
      delay: attr(new Float32Array(n), 1),
      carry: attr(new Float32Array(n), 1),
    };
    this.rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const sparkle = rand() < 0.025;
      this.rnd[i * 4] = rand();
      this.rnd[i * 4 + 1] = sparkle ? 2.2 + rand() * 1.4 : 0.55 + 0.85 * rand() * rand();
      this.rnd[i * 4 + 2] = rand();
      this.rnd[i * 4 + 3] = rand();
    }
    geo.setAttribute('position', this.attr.to);
    geo.setAttribute('aFrom', this.attr.from);
    geo.setAttribute('aColorTo', this.attr.cTo);
    geo.setAttribute('aColorFrom', this.attr.cFrom);
    geo.setAttribute('aDelay', this.attr.delay);
    geo.setAttribute('aCarry', this.attr.carry);
    geo.setAttribute('aRand', new THREE.BufferAttribute(this.rnd, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);

    this.material = createShapeMaterial(this.app.sharedUniforms);
    this.material.uniforms.uSpread.value = SPREAD;
    this.material.uniforms.uPuff.value = PUFF;
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;

    // root (roll + scale) > user (drag rotation) > tilt (per-shape pose) > auto (spin) > points
    this.root = new THREE.Group();
    this.userGroup = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.autoGroup = new THREE.Group();
    this.root.add(this.userGroup);
    this.userGroup.add(this.tiltGroup);
    this.tiltGroup.add(this.autoGroup);
    this.autoGroup.add(this.points);
    this.scene.add(this.root);
    this.tiltTargets = SHAPES.map((s) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.tilt)));

    this.buildStars(rand);

    // ---- state
    this.current = clamp(Math.round(this.settings.shape) || 0, 0, SHAPES.length - 1);
    this.settings.shape = this.current;
    this.progress = 0;
    this.morphAge = 0;
    this.swirlEnv = 1;
    this.swirlBoost = 0;
    this.autoYaw = 0;
    this.swayBase = null;
    this.rotVel = new THREE.Vector2();
    this.roll = 0;
    this.rollTarget = 0;
    this.prevRoll = 0;
    this.zoom = 1;
    this.scale = 1;
    this.collapse = 0;
    this.collapseRate = 2;
    this.fistState = 'idle';
    this.fistWait = 0;
    this.explodeAge = 100;
    this.suppressOpen = false;
    this.suppressT = 0;
    this.holdCand = -1;
    this.holdT = 0;
    this.holdLost = 0;
    this.charge = 0;
    this.beatW = 0;
    this.click = null;
    this.idleT = 0;
    this.demoT = 0;
    this.shake = 0;
    this.camDist = 10;
    this.repel = { x: 0, v: 0 };
    this.ptrX = { x: 0, v: 0 };
    this.ptrY = { x: 0, v: 0 };
    this.ptrLive = false;
    this.wake = Array.from({ length: WAKE }, () => ({ x: 0, y: 0, t: -10, s: 0 }));
    this.wakeHead = 0;
    this.lastWake = { x: 9, y: 9 };

    // Intro: fly in from a wide cloud and assemble the first shape.
    const first = this.targets[this.current];
    this.attr.from.array.set(cloudTarget(n, rand));
    this.attr.to.array.set(first.pos);
    this.attr.cTo.array.set(first.col);
    const cf = this.attr.cFrom.array;
    for (let i = 0; i < cf.length; i++) cf[i] = first.col[i] * 0.35;
    this.writeDelays(first);
    this.attr.carry.array.fill(0);

    this.buildIndicator();
  }

  buildStars(rand) {
    const n = Math.round(2600 * Math.max(0.5, this.app.particleScale));
    const pos = new Float32Array(n * 3);
    const star = new Float32Array(n * 3);
    const d = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      d.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
      d.normalize().multiplyScalar(40 + rand() * 60);
      pos.set([d.x, d.y, d.z], i * 3);
      const big = rand() < 0.06;
      star[i * 3] = big ? 2.4 + rand() * 1.6 : 1 + rand() * 1.3;
      star[i * 3 + 1] = rand();
      star[i * 3 + 2] = big ? 0.8 : 0.25 + rand() * 0.45;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aStar', new THREE.BufferAttribute(star, 3));
    this.stars = new THREE.Points(g, createStarMaterial(this.app.sharedUniforms));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildIndicator() {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'z-index:12', 'pointer-events:none',
      'padding:9px 16px 10px', 'border-radius:16px', 'background:rgba(18,20,28,0.78)',
      'border:1px solid rgba(255,255,255,0.16)', 'color:#f2f4f8', 'font:600 15px/1.2 var(--font, system-ui, sans-serif)',
      'text-align:center', 'min-width:170px', 'opacity:0', 'transition:opacity 160ms ease',
      '-webkit-backdrop-filter:blur(8px)', 'backdrop-filter:blur(8px)', 'white-space:nowrap',
    ].join(';');
    const label = document.createElement('div');
    const track = document.createElement('div');
    track.style.cssText = 'height:4px;margin-top:7px;border-radius:2px;background:rgba(255,255,255,0.15);overflow:hidden';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:0;border-radius:2px;background:linear-gradient(90deg,#7cf6c8,#8aa8ff)';
    track.appendChild(bar);
    el.append(label, track);
    this.indicator = { el, label, bar, shown: false, text: '', pct: -1 };
  }

  // ------------------------------------------------------------------ lifecycle

  enter() {
    if (!this.indicator.el.isConnected) document.body.appendChild(this.indicator.el);
    this.holdCand = -1;
    this.holdT = 0;
    this.holdLost = 0;
    this.click = null;
    this.idleT = 0;
  }

  exit() {
    this.showIndicator(false);
    this.indicator.el.remove();
  }

  resize(width, height) {
    super.resize(width, height);
    const aspect = width / Math.max(1, height);
    // Keep the shapes (≈ ±3 units) inside narrow portrait screens.
    this.camDist = 10 * Math.max(1, 0.8 / aspect);
    this.camera.position.set(0, 0, this.camDist);
    this.material.uniforms.uFocus.value = this.camDist;
    this.mobileLayout = width <= 720;
    this.indicator.el.style.bottom = this.mobileLayout ? '140px' : '72px';
  }

  dispose() {
    this.indicator?.el.remove();
    super.dispose();
  }

  buildGui(folder) {
    const s = this.settings;
    const options = Object.fromEntries(SHAPES.map((sh, i) => [sh.name, i]));
    this.shapeCtrl = folder.add(s, 'shape', options).name('Shape').onChange((v) => this.setShape(Number(v)));
    this.textCtrl = folder.add(s, 'text').name('Text (👍)').onFinishChange((v) => this.setText(v));
    folder.add(s, 'size', 0.4, 2.5, 0.05).name('Dot size');
    folder.add(s, 'autoRotate', 0, 1.5, 0.01).name('Spin speed');
    folder.add(s, 'morphTime', 0.6, 4, 0.1).name('Morph time (s)');
    folder.add(s, 'swirl', 0, 2.5, 0.05).name('Swirl');
    folder.add(s, 'pushSize', 0.3, 2.5, 0.05).name('Push size');
    folder.add(s, 'autoDemo').name('Auto demo when idle');
  }

  // ------------------------------------------------------------------ shapes

  writeDelays(target) {
    const del = this.attr.delay.array;
    const rnd = this.rnd;
    for (let i = 0; i < this.n; i++) del[i] = rnd[i * 4] + (target.sweep[i] - rnd[i * 4]) * SWEEP_MIX;
  }

  /** Start morphing from wherever the particles are right now to `target`. */
  startMorph(target) {
    const { from, to, cFrom, cTo, delay, carry } = this.attr;
    const f = from.array;
    const t = to.array;
    const cf = cFrom.array;
    const ct = cTo.array;
    const del = delay.array;
    const car = carry.array;
    const rnd = this.rnd;
    const P = this.progress;
    const decay = Math.exp(-this.morphAge * 3);
    for (let i = 0; i < this.n; i++) {
      const lp = clamp((P - del[i] * SPREAD) / (1 - SPREAD), 0, 1);
      const e = ease(lp);
      const mid = Math.sin(Math.PI * lp);
      const k = 1 + PUFF * mid * (0.5 + rnd[i * 4 + 3]);
      const j = i * 3;
      f[j] = (f[j] + (t[j] - f[j]) * e) * k;
      f[j + 1] = (f[j + 1] + (t[j + 1] - f[j + 1]) * e) * k;
      f[j + 2] = (f[j + 2] + (t[j + 2] - f[j + 2]) * e) * k;
      cf[j] += (ct[j] - cf[j]) * e;
      cf[j + 1] += (ct[j + 1] - cf[j + 1]) * e;
      cf[j + 2] += (ct[j + 2] - cf[j + 2]) * e;
      car[i] = Math.max(mid, car[i] * decay);
    }
    t.set(target.pos);
    ct.set(target.col);
    this.writeDelays(target);
    for (const a of Object.values(this.attr)) a.needsUpdate = true;
    this.progress = 0;
    this.morphAge = 0;
  }

  setShape(idx, { toast = true } = {}) {
    idx = clamp(Math.round(idx) || 0, 0, SHAPES.length - 1);
    if (idx === this.current) return;
    this.current = idx;
    this.settings.shape = idx;
    this.shapeCtrl?.updateDisplay();
    this.startMorph(this.targets[idx]);
    this.swayBase = null;
    this.holdT = 0;
    if (toast) {
      const sh = SHAPES[idx];
      this.app.hud.toast(`${sh.icon} ${idx === TEXT ? `“${this.settings.text}”` : sh.name}`, 1600);
    }
  }

  nextShape() {
    this.setShape((this.current + 1) % SHAPES.length);
  }

  setText(value) {
    const str = String(value ?? '');
    if (this.targets[TEXT].text === str.replace(/\s+/g, ' ').trim().slice(0, 24) && this.current === TEXT) {
      this.settings.text = this.targets[TEXT].text;
      this.textCtrl?.updateDisplay();
      return;
    }
    const target = textTarget(this.n, str, this.rand);
    this.targets[TEXT] = target;
    this.settings.text = target.text;
    this.textCtrl?.updateDisplay();
    if (this.current === TEXT) this.startMorph(target);
    else this.setShape(TEXT);
  }

  // ------------------------------------------------------------------ frame

  update(dt, time, input) {
    const u = this.material.uniforms;
    const s = this.settings;

    this.updateCounting(dt, input);
    this.updateClick(time, input);
    this.updateIdle(dt, input);
    this.updateFist(dt, input);

    // morph progress + swirl envelope
    this.morphAge += dt;
    if (this.progress < 1) this.progress = Math.min(1, this.progress + dt / Math.max(0.2, s.morphTime));
    const travelling = this.progress < 0.8;
    this.swirlEnv += ((travelling ? 1 : 0) - this.swirlEnv) * damp(travelling ? 6 : 2, dt);
    this.swirlBoost *= Math.exp(-dt * 1.4);
    u.uProgress.value = this.progress;
    u.uCarryDecay.value = Math.exp(-this.morphAge * 3);
    u.uSwirl.value = (this.swirlEnv * 0.7 + this.swirlBoost) * s.swirl;

    // fist core + explosion
    this.collapse += ((this.fistState === 'squeeze' || this.fistState === 'wait' ? 1 : 0) - this.collapse) *
      damp(this.fistState === 'squeeze' ? 3.2 : this.fistState === 'wait' ? 0 : this.collapseRate, dt);
    this.explodeAge = Math.min(100, this.explodeAge + dt);
    u.uCollapse.value = this.collapse;
    u.uExplodeT.value = this.explodeAge;

    this.updatePointer(dt, time, input);
    this.updateTransform(dt, time, input);

    // heartbeat while the heart is showing
    const beatOn = this.current === HEART && this.progress > 0.7 ? 1 : 0;
    this.beatW += (beatOn - this.beatW) * damp(3, dt);
    const ph = (time % 1.05) / 1.05;
    const beat = 0.06 * Math.exp(-(((ph - 0.08) / 0.045) ** 2)) + 0.035 * Math.exp(-(((ph - 0.27) / 0.05) ** 2));
    u.uBeat.value = beat * this.beatW;

    // looks
    const q = this.app.particleScale;
    const tremble = this.charge * this.charge;
    u.uTremble.value = tremble;
    u.uSize.value = 2.5 * s.size * Math.pow(1 / q, 0.45);
    u.uIntensity.value = 0.9 * Math.pow(1 / q, 0.25) * (1 + u.uBeat.value * 3 + this.collapse * 0.2);
    u.uRepelRadius.value = 0.62 * s.pushSize;

    // camera shake after an explosion
    this.shake *= Math.exp(-dt * 5);
    const sh = this.shake;
    this.camera.position.set(Math.sin(time * 53) * 0.08 * sh, Math.cos(time * 47) * 0.08 * sh, this.camDist);

    this.stars.rotation.y = time * 0.01 + this.autoYaw * 0.04;
    this.stars.rotation.x = Math.sin(time * 0.05) * 0.05;
  }

  /** Finger count → shape, with a short hold and a visible "charging" phase. */
  updateCounting(dt, input) {
    const hand = input.source === 'hand' && input.active;
    let cand = -1;
    if (
      hand && !input.uiCaptured && !input.pinching && !input.fist &&
      input.gesture !== 'fist' && input.gesture !== 'pinch' &&
      this.fistState === 'idle' && this.collapse < 0.1 && this.explodeAge > 1.2
    ) {
      // The hand stack counts the thumb too: pointing with the thumb out is still "1",
      // a peace sign is "2" whatever the thumb does.
      if (input.gesture === 'thumbsUp') cand = TEXT;
      else if (input.gesture === 'point') cand = 0;
      else if (input.gesture === 'victory') cand = 1;
      else if (input.fingers >= 1 && input.fingers <= 5) cand = input.fingers - 1;
    }
    // After "fist → open palm" the palm is still up; don't let it switch to DNA / planet
    // until the hand has clearly changed shape.
    if (this.suppressOpen) {
      const open = hand && (input.open || input.gesture === 'open' || input.fingers >= 4);
      if (open) {
        this.suppressT = 0;
        cand = -1;
      } else if ((this.suppressT += dt) > 0.25 || !hand) {
        this.suppressOpen = false;
      } else {
        cand = -1;
      }
    }

    const speed = Math.hypot(input.velocity.x, input.velocity.y);
    const rollRate = dt > 0 ? Math.abs(input.roll - this.prevRoll) / dt : 0;
    this.prevRoll = input.roll;
    // Finger counts need an upright, still hand (a tilted hand is turning the shape);
    // a thumbs-up is naturally sideways, so only stillness matters for it.
    const upright = cand === TEXT || (Math.abs(input.roll) < 0.6 && rollRate < 2.5);
    const steady = speed < 0.9 && upright;

    // A tracking hiccup of a few frames must not restart the hold: keep the old candidate
    // for a short grace period before accepting a different one.
    if (cand !== this.holdCand) {
      this.holdLost += dt;
      if (this.holdLost > 0.25 || this.holdCand < 0) {
        this.holdCand = cand;
        this.holdT = 0;
        this.holdLost = 0;
      }
    } else {
      this.holdLost = 0;
      if (cand >= 0 && cand !== this.current) {
        this.holdT = steady ? this.holdT + dt : Math.max(0, this.holdT - dt * 2);
        if (this.holdT >= HOLD_TIME) {
          this.setShape(cand);
          this.holdT = 0;
        }
      } else {
        this.holdT = 0;
      }
    }
    cand = this.holdCand;

    const charging = cand >= 0 && cand !== this.current;
    const target = charging ? clamp(this.holdT / HOLD_TIME, 0, 1) : 0;
    this.charge += (target - this.charge) * damp(charging ? 14 : 8, dt);

    if (charging && this.holdT > 0.04) {
      const sh = SHAPES[cand];
      const text = cand === TEXT ? `👍 → ${sh.name}` : `${FINGER_ICON[sh.fingers]} ${sh.fingers} → ${sh.name}`;
      this.showIndicator(true, text, this.holdT / HOLD_TIME);
    } else {
      this.showIndicator(false);
    }
  }

  showIndicator(on, text = '', frac = 0) {
    const ind = this.indicator;
    if (!ind) return;
    if (on) {
      if (ind.text !== text) {
        ind.text = text;
        ind.label.textContent = text;
      }
      const pct = Math.round(clamp(frac, 0, 1) * 100);
      if (pct !== ind.pct) {
        ind.pct = pct;
        ind.bar.style.width = `${pct}%`;
      }
    }
    if (on !== ind.shown) {
      ind.shown = on;
      ind.el.style.opacity = on ? '1' : '0';
    }
  }

  /** Mouse: a click without dragging → next shape. */
  updateClick(time, input) {
    if (input.events.has('pinchstart')) {
      this.click = { t: time, moved: 0, mouse: input.source === 'mouse' };
    } else if (this.click && input.pinching) {
      this.click.moved += Math.hypot(input.dragDelta.x, input.dragDelta.y);
    }
    if (input.events.has('pinchend') && this.click) {
      const c = this.click;
      this.click = null;
      if (c.mouse && input.source === 'mouse' && c.moved < 0.02 && time - c.t < 0.45 && !input.uiCaptured) this.nextShape();
    }
  }

  updateIdle(dt, input) {
    if (input.active) {
      this.idleT = 0;
      this.demoT = 0;
      return;
    }
    this.idleT += dt;
    if (!this.settings.autoDemo || this.idleT < 14) return;
    this.demoT += dt;
    if (this.demoT > 8) {
      this.demoT = 0;
      this.setShape((this.current + 1) % SHAPES.length);
    }
  }

  updateFist(dt, input) {
    const fistOn = input.active && !input.uiCaptured && input.fist;
    switch (this.fistState) {
      case 'idle':
        if (fistOn) this.fistState = 'squeeze';
        break;
      case 'squeeze':
        if (!fistOn) {
          this.fistState = this.collapse > 0.3 ? 'wait' : 'idle';
          this.fistWait = 0;
          this.collapseRate = 2.5;
        }
        break;
      case 'wait': {
        // Hold the core briefly: an open palm now makes it explode.
        if (fistOn) {
          this.fistState = 'squeeze';
          break;
        }
        this.fistWait += dt;
        const opened = input.active && (input.source === 'mouse' || input.open || input.gesture === 'open' || input.fingers >= 4);
        if (opened) this.explode(input);
        else if (this.fistWait > 1.0) {
          this.fistState = 'idle';
          this.collapseRate = 2.2;
        }
        break;
      }
      default:
        this.fistState = 'idle';
    }
  }

  explode(input) {
    this.fistState = 'idle';
    this.collapseRate = 8;
    this.explodeAge = 0;
    this.swirlBoost = 0.6;
    this.shake = 1;
    if (input.source === 'hand') {
      this.suppressOpen = true;
      this.suppressT = 0;
    }
  }

  /** Fingertip push: a springy head plus a short wake that ripples closed. */
  updatePointer(dt, time, input) {
    const pointing = input.active && !input.uiCaptured && input.gesture === 'point' && !input.pinching && !input.fist;
    if (pointing && !this.ptrLive) {
      this.ptrX.x = input.pointer.x;
      this.ptrY.x = input.pointer.y;
      this.ptrX.v = this.ptrY.v = 0;
      this.lastWake.x = this.lastWake.y = 9;
    }
    this.ptrLive = pointing || this.repel.x > 0.02;
    if (input.active) {
      spring(this.ptrX, input.pointer.x, 24, 0.75, dt);
      spring(this.ptrY, input.pointer.y, 24, 0.75, dt);
    }
    spring(this.repel, pointing ? 1 : 0, 13, 0.42, dt);
    const head = clamp(this.repel.x, -0.25, 1.3);

    if (pointing) {
      const dx = this.ptrX.x - this.lastWake.x;
      const dy = this.ptrY.x - this.lastWake.y;
      if (dx * dx + dy * dy > 0.03 * 0.03) {
        const w = this.wake[this.wakeHead];
        this.wakeHead = (this.wakeHead + 1) % WAKE;
        w.x = this.ptrX.x;
        w.y = this.ptrY.x;
        w.t = time;
        w.s = head;
        this.lastWake.x = w.x;
        this.lastWake.y = w.y;
      }
    }

    const trail = this.material.uniforms.uTrail.value;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const aspect = this.camera.aspect;
    const setRay = (v, x, y, strength) => {
      const rx = x * tanHalf * aspect;
      const ry = y * tanHalf;
      const len = Math.hypot(rx, ry, 1);
      v.set(rx / len, ry / len, -1 / len, strength);
    };
    setRay(trail[0], this.ptrX.x, this.ptrY.x, Math.abs(head) < 0.002 ? 0 : head);
    for (let i = 0; i < WAKE; i++) {
      const w = this.wake[i];
      const age = time - w.t;
      // decays like a damped spring → the hole closes with a small ripple
      const str = age < 1.4 ? w.s * Math.exp(-age * 5) * Math.cos(age * 8) : 0;
      setRay(trail[i + 1], w.x, w.y, Math.abs(str) < 0.003 ? 0 : str * 0.85);
    }
  }

  updateTransform(dt, time, input) {
    const s = this.settings;
    const sh = SHAPES[this.current];
    const hand = input.source === 'hand' && input.active;

    // ---- tilt the hand → rotate around the view axis
    if (hand && (input.open || input.gesture === 'open' || input.gesture === 'point')) {
      const dz = 0.12;
      const r = Math.abs(input.roll) < dz ? 0 : input.roll - Math.sign(input.roll) * dz;
      this.rollTarget = clamp(r * 1.15, -1.5, 1.5);
    } else if (!input.active) {
      this.rollTarget *= Math.exp(-dt * 0.8);
    }
    this.roll += (this.rollTarget - this.roll) * damp(5, dt);
    this.root.quaternion.setFromAxisAngle(AXIS_Z, this.roll);

    // ---- pinch + drag → rotate with inertia (axes follow the screen, even when rolled)
    const dragging = input.active && input.pinching && !input.uiCaptured;
    let yaw;
    let pitch;
    if (dragging && dt > 0) {
      yaw = input.dragDelta.x * 2.8;
      pitch = -input.dragDelta.y * 2.8;
      const k = damp(20, dt);
      this.rotVel.x += (yaw / dt - this.rotVel.x) * k;
      this.rotVel.y += (pitch / dt - this.rotVel.y) * k;
      this.rotVel.clampLength(0, 9);
    } else {
      yaw = this.rotVel.x * dt;
      pitch = this.rotVel.y * dt;
      this.rotVel.multiplyScalar(Math.exp(-dt * 1.7));
    }
    if (yaw || pitch) {
      _qi.copy(this.root.quaternion).invert();
      _ay.copy(AXIS_Y).applyQuaternion(_qi);
      _ax.copy(AXIS_X).applyQuaternion(_qi);
      _q1.setFromAxisAngle(_ay, yaw);
      _q2.setFromAxisAngle(_ax, pitch);
      this.userGroup.quaternion.premultiply(_q1.multiply(_q2)).normalize();
    }
    // Text reads best from the front: drift back once the user lets go.
    if (this.current === TEXT && !dragging && this.rotVel.lengthSq() < 0.05) {
      this.userGroup.quaternion.slerp(IDENTITY, damp(1.2, dt));
    }

    // ---- per-shape presentation tilt + auto spin / sway
    this.tiltGroup.quaternion.slerp(this.tiltTargets[this.current], damp(2.2, dt));
    if (sh.sway) {
      if (this.swayBase === null) this.swayBase = Math.round(this.autoYaw / TAU) * TAU;
      const target = this.swayBase + sh.sway * Math.sin(time * 0.5) * Math.min(1, s.autoRotate / 0.3);
      const step = (target - this.autoYaw) * damp(1.8, dt);
      this.autoYaw += clamp(step, -1.4 * dt, 1.4 * dt);
    } else {
      this.autoYaw += dt * s.autoRotate * sh.spin;
    }
    this.autoGroup.rotation.y = this.autoYaw;

    // ---- size: wheel / two-hand zoom, and hand distance from the camera
    if (input.zoom) this.zoom = clamp(this.zoom * Math.exp(input.zoom * 1.2), 0.45, 2.4);
    const depthF = hand ? 1 + (clamp(input.depth, 0, 1) - 0.5) * 0.9 : 1;
    this.scale += (this.zoom * depthF - this.scale) * damp(4, dt);
    this.root.scale.setScalar(this.scale);
  }
}
