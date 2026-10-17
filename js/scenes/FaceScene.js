// "Your Face": the user's selfie rebuilt as a 3D particle portrait.
//
// ~180k particles (quality "high"), one per sampled pixel of the person with the
// background removed. z comes from a depth map so the head has real relief and
// reads as 3D when it turns. All motion runs in the vertex shader (see
// face/shaders.js); this class only drives a few uniforms from the input.
//
//   ☝️ point          push the dots with a soft trail that springs back
//   🤏 pinch + move   turn the head in 3D (with inertia, eases back to front)
//   ✊ fist           dots are sucked into a swirling glowing ball
//   ✋ open after ✊  the ball explodes into dust, then the face re-assembles
//   ✌️ victory        next colour mode (Photo / Mono / Neon)
//   hand closer / two hands / wheel   zoom
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { loadPortrait, WORLD_HEIGHT } from './face/portrait.js';
import { TouchTrail } from './face/TouchTrail.js';
import { vertexShader, fragmentShader } from './face/shaders.js';
import { createMotes } from './face/motes.js';

const MODES = ['Photo', 'Mono', 'Neon'];
const MODE_TOAST = { Photo: '📷 Photo colours', Mono: '⚪ Mono dots', Neon: '💜 Neon glow' };
const MODE_EXPOSURE = { Photo: 0.6, Mono: 0.9, Neon: 0.72 };
// Dust motes around the head: two colours per mode.
const MOTE_COLORS = {
  Photo: [new THREE.Color('#ffd7ae'), new THREE.Color('#9fd8ff')],
  Mono: [new THREE.Color('#ffffff'), new THREE.Color('#bdbdbd')],
  Neon: [new THREE.Color('#7cf6c8'), new THREE.Color('#8a4dff')],
};
// Glow per mode, relative to the scene / user glow strength (Mono wants crisp dots on black).
const MODE_BLOOM = { Photo: 1, Mono: 0.3, Neon: 1.3 };

const FOV = 40;
const DEPTH_WORLD = 2.4; // world depth of the nearest point at "Depth" = 1
const PIVOT_DEPTH = 0.45; // the head turns around a point inside the skull
const MAX_YAW = THREE.MathUtils.degToRad(70);
const MAX_PITCH = THREE.MathUtils.degToRad(35);
const SWAY_YAW = THREE.MathUtils.degToRad(12);
const SWAY_PITCH = THREE.MathUtils.degToRad(2.5);
const BALL_RADIUS = 0.95;
const FIST_PLANE_Z = 1.3; // world z where the fist ball forms (in front of the face)
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.8;

const clamp = THREE.MathUtils.clamp;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export default class FaceScene extends BaseScene {
  static meta = {
    id: 'face',
    title: 'Your Face',
    subtitle: 'Your selfie, rebuilt from 3D particles',
    icon: '🙂',
    hints: [
      { icon: '☝️', gesture: 'Point', text: 'touch your face, push the dots' },
      { icon: '🤏', gesture: 'Pinch + move', text: 'turn the head in 3D' },
      { icon: '✊', gesture: 'Fist', text: 'pull the dots into a ball' },
      { icon: '✋', gesture: 'Open hand', text: 'after a fist: explode!' },
      { icon: '✌️', gesture: 'Peace', text: 'change the colours' },
      { icon: '↕️', gesture: 'Hand closer / farther', text: 'zoom in / out' },
    ],
    bloom: { strength: 0.5, radius: 0.35, threshold: 0.18 },
  };

  constructor(app) {
    super(app);
    this.camera.fov = FOV;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();

    this.params = {
      mode: 'Photo',
      size: 1,
      depth: 1,
      pushRadius: 0.08,
      pushStrength: 1,
      sway: true,
    };
    this.actions = {
      explode: () => this.explode(this.gather > 0.25),
      reset: () => this.resetView(),
    };

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.scene.add(this.root);

    this.time = 0;
    this.rot = { yaw: 0, pitch: 0, vy: 0, vp: 0, since: 10, showYaw: 0, showPitch: 0 };
    this.look = { yaw: 0, pitch: 0 };
    this.swayAmount = 1;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.handZoom = 1;
    this.modeWeights = new THREE.Vector3(1, 0, 0);

    this.gather = 0;
    this.ballTime = 0;
    this.ballWorld = new THREE.Vector3(0, 0, FIST_PLANE_Z);
    this.fistWasDown = false;
    this.fistUpAt = -Infinity;
    this.burst = null;
    this.introPlayed = false;
    this.bloomBase = null;
    this.bloomSet = 0;
    this.bloomFactor = 1;

    this.raycaster = new THREE.Raycaster();
    this._ray = new THREE.Ray();
    this._inv = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._uv = { u: 0, v: 0 };
    this.baseDistance = 16;
    this.cameraY = 0;
  }

  async init() {
    const portrait = await loadPortrait(this.count(180000));
    this.portrait = portrait;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(portrait.position, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(portrait.color, 3, true));
    g.setAttribute('aInfo', new THREE.BufferAttribute(portrait.info, 4));
    g.setAttribute('aExtra', new THREE.BufferAttribute(portrait.extra, 4));
    g.setAttribute('aSlope', new THREE.BufferAttribute(portrait.slope, 2));

    this.trail = new TouchTrail(192, 256);

    const shared = this.app.sharedUniforms;
    this.uniforms = {
      uTime: shared.uTime,
      uPixelRatio: shared.uPixelRatio,
      uViewportHeight: shared.uViewportHeight,
      uPortrait: { value: new THREE.Vector2(portrait.worldSize.w, portrait.worldSize.h) },
      uPivotUV: { value: new THREE.Vector2(portrait.pivotUV.u, portrait.pivotUV.v) },
      uPivotDepth: { value: PIVOT_DEPTH },
      uDepthWorld: { value: DEPTH_WORLD },
      uSpacing: { value: portrait.spacing },
      uSize: { value: 1 },
      uExposure: { value: MODE_EXPOSURE.Photo },
      uCamLocal: { value: new THREE.Vector3(0, 0, 20) },
      uMode: { value: this.modeWeights },
      uLife: { value: 1 },
      uTouch: { value: this.trail.texture },
      uTouchTexel: { value: new THREE.Vector2(1.5 / this.trail.width, 1.5 / this.trail.height) },
      uPush: { value: 0.9 },
      uGather: { value: 0 },
      uBallCenter: { value: new THREE.Vector3() },
      uBallRadius: { value: BALL_RADIUS },
      uBallTime: { value: 0 },
      uBurstT: { value: 0 },
      uBurstScale: { value: 1 },
      uBurstCenter: { value: new THREE.Vector3() },
      uReform: { value: 0 },
      uNeonNear: { value: new THREE.Color('#7cf6c8') },
      uNeonMid: { value: new THREE.Color('#2ec8ff') },
      uNeonFar: { value: new THREE.Color('#8a4dff') },
      uGlowColor: { value: new THREE.Color('#9fe8ff') },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.root.add(this.points);

    this.motes = createMotes(this.count(2400), this.app.sharedUniforms);
    this.scene.add(this.motes.points);

    // Framing: hair top .. faded bottom edge, centred; the head must fit the width too.
    const top = portrait.bounds.top + 0.015;
    const bottom = 0.06;
    this.contentHeight = (top - bottom) * WORLD_HEIGHT;
    this.contentCenterY = ((top + bottom) / 2 - portrait.pivotUV.v) * WORLD_HEIGHT;
    this.headWidth = (portrait.bounds.headRight - portrait.bounds.headLeft) * portrait.worldSize.w;
    this.resize(this.app.width, this.app.height);
  }

  enter() {
    this.bloomBase = null; // re-read after the App configured the bloom pass for this scene
    this.trail.clear();
    this.playIntro(this.introPlayed ? 1.8 : 2.5);
    this.introPlayed = true;
  }

  exit() {
    this.trail.clear();
    // Leave the shared glow as the App configured it.
    if (this.bloomBase != null && this.app.bloomPass) this.app.bloomPass.strength = this.bloomBase;
    this.bloomBase = null;
  }

  resize(width, height) {
    super.resize(width, height);
    if (!this.contentHeight) return;
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const aspect = width / height;
    const byHeight = this.contentHeight / 0.75 / t;
    const byWidth = this.headWidth / 0.86 / (t * aspect);
    this.baseDistance = Math.max(byHeight, byWidth);
    this.cameraY = this.contentCenterY;
  }

  // ------------------------------------------------------------------ per frame

  update(dt, time, input) {
    if (!this.uniforms) return;
    this.time += dt;
    const U = this.uniforms;
    const usable = input.active && !input.uiCaptured;
    const pinching = usable && input.pinching;
    const fistDown = usable && input.fist;

    if (input.events.has('victorystart') && !input.uiCaptured) this.cycleMode();
    this.updateMode(dt);
    this.updateRotation(dt, input, pinching);
    this.updateZoom(dt, input);

    // Camera + head transform.
    const dist = this.baseDistance / this.zoom;
    const towardFace = smoothstep(1, 2.2, this.zoom);
    const camY = THREE.MathUtils.lerp(this.cameraY, 0.35, towardFace);
    this.camera.position.set(0, camY, dist);
    this.camera.lookAt(0, camY, 0);
    this.camera.updateMatrixWorld();
    this.root.rotation.set(
      this.rot.showPitch + this.look.pitch + SWAY_PITCH * Math.sin(this.time * 0.27 + 1) * this.swayAmount,
      this.rot.showYaw + this.look.yaw + SWAY_YAW * Math.sin(this.time * 0.33) * this.swayAmount,
      0,
    );
    this.root.updateMatrixWorld(true);

    this.root.worldToLocal(U.uCamLocal.value.copy(this.camera.position));
    this.updateGather(dt, input, fistDown);
    this.updateTouch(dt, input);

    // Idle life is calmer while the dots are busy elsewhere.
    const busy = Math.max(this.gather, this.burst ? 1 : 0);
    U.uLife.value += ((1 - busy * 0.7) - U.uLife.value) * damp(3, dt);
    U.uSize.value = this.params.size;
    U.uDepthWorld.value = DEPTH_WORLD * this.params.depth;
    U.uPush.value = 0.65 * this.params.pushStrength;
  }

  updateMode(dt) {
    const target = MODES.indexOf(this.params.mode);
    const w = this.modeWeights;
    const k = damp(5, dt);
    w.x += ((target === 0 ? 1 : 0) - w.x) * k;
    w.y += ((target === 1 ? 1 : 0) - w.y) * k;
    w.z += ((target === 2 ? 1 : 0) - w.z) * k;
    this.uniforms.uExposure.value = w.x * MODE_EXPOSURE.Photo + w.y * MODE_EXPOSURE.Mono + w.z * MODE_EXPOSURE.Neon;

    const mu = this.motes.uniforms;
    const a = mu.uColorA.value.setRGB(0, 0, 0);
    const b = mu.uColorB.value.setRGB(0, 0, 0);
    MODES.forEach((name, i) => {
      const wi = w.getComponent(i);
      const [ca, cb] = MOTE_COLORS[name];
      a.setRGB(a.r + ca.r * wi, a.g + ca.g * wi, a.b + ca.b * wi);
      b.setRGB(b.r + cb.r * wi, b.g + cb.g * wi, b.b + cb.b * wi);
    });
    mu.uOpacity.value = 0.5 - 0.2 * w.y;

    // Scale the shared bloom by mode. If the user moved the global glow slider
    // since our last write, take their value as the new base.
    const bloom = this.app.bloomPass;
    if (!bloom) return;
    const factor = w.x * MODE_BLOOM.Photo + w.y * MODE_BLOOM.Mono + w.z * MODE_BLOOM.Neon;
    const changed = Math.abs(bloom.strength - this.bloomSet) > 1e-6;
    const reconfigured = Math.abs(bloom.strength - (this.meta.bloom.strength ?? 0)) < 1e-6; // App re-applied the meta value
    if (this.bloomBase == null || (changed && reconfigured)) this.bloomBase = bloom.strength;
    else if (changed) this.bloomBase = bloom.strength / this.bloomFactor;
    this.bloomFactor = factor;
    this.bloomSet = bloom.strength = this.bloomBase * factor;
  }

  updateRotation(dt, input, pinching) {
    const r = this.rot;
    if (pinching) {
      const gain = 1.7;
      const dYaw = input.dragDelta.x * gain;
      const dPitch = -input.dragDelta.y * gain;
      r.yaw = clamp(r.yaw + dYaw, -MAX_YAW, MAX_YAW);
      r.pitch = clamp(r.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
      const k = damp(10, dt);
      const inv = 1 / Math.max(dt, 1 / 240);
      r.vy = clamp(r.vy + (dYaw * inv - r.vy) * k, -4, 4);
      r.vp = clamp(r.vp + (dPitch * inv - r.vp) * k, -3, 3);
      r.since = 0;
    } else {
      // Inertia first, then a soft spring back to the front.
      r.since += dt;
      const s = smoothstep(0.5, 1.4, r.since);
      const spring = 14 * s;
      const friction = 2.2 + 3.6 * s;
      r.vy += (-spring * r.yaw - friction * r.vy) * dt;
      r.vp += (-spring * r.pitch - friction * r.vp) * dt;
      r.yaw += r.vy * dt;
      r.pitch += r.vp * dt;
      if (Math.abs(r.yaw) > MAX_YAW) {
        r.yaw = Math.sign(r.yaw) * MAX_YAW;
        r.vy *= -0.3;
      }
      if (Math.abs(r.pitch) > MAX_PITCH) {
        r.pitch = Math.sign(r.pitch) * MAX_PITCH;
        r.vp *= -0.3;
      }
    }
    const k = damp(pinching ? 14 : 30, dt);
    r.showYaw += (r.yaw - r.showYaw) * k;
    r.showPitch += (r.pitch - r.showPitch) * k;

    // The head glances a little toward the hand / cursor.
    const lookOn = input.active && !pinching && !input.fist && !input.uiCaptured;
    const ly = lookOn ? clamp(input.pointer.x, -1, 1) * 0.12 : 0;
    const lp = lookOn ? -clamp(input.pointer.y, -1, 1) * 0.06 : 0;
    this.look.yaw += (ly - this.look.yaw) * damp(2.5, dt);
    this.look.pitch += (lp - this.look.pitch) * damp(2.5, dt);

    const swayOn = this.params.sway && !pinching && r.since > 1.2;
    this.swayAmount += ((swayOn ? 1 : 0) - this.swayAmount) * damp(swayOn ? 0.8 : 4, dt);
  }

  updateZoom(dt, input) {
    if (input.zoom && !input.uiCaptured) {
      this.zoomTarget = clamp(this.zoomTarget * Math.exp(input.zoom), ZOOM_MIN, ZOOM_MAX);
    }
    let hand = 1;
    if (input.source === 'hand' && input.active) {
      const d = input.depth - 0.5;
      const dz = Math.sign(d) * Math.max(0, Math.abs(d) - 0.06); // dead zone against jitter
      hand = clamp(1 + dz * 1.8, 0.7, 1.7);
    }
    this.handZoom += (hand - this.handZoom) * damp(2.5, dt);
    const target = clamp(this.zoomTarget * this.handZoom, ZOOM_MIN, ZOOM_MAX);
    this.zoom += (target - this.zoom) * damp(5, dt);
  }

  updateGather(dt, input, fistDown) {
    const U = this.uniforms;
    if (this.burst) {
      const b = this.burst;
      b.t += dt * (fistDown ? 2.5 : 1); // hurry if the user already wants a new ball
      const reform = clamp((b.t - b.reformStart) / b.reformDur, 0, 1);
      U.uBurstT.value = b.t;
      U.uReform.value = reform;
      if (reform >= 1) {
        this.burst = null;
        this.gather = 0;
        U.uGather.value = 0;
        U.uBurstT.value = 0;
        U.uReform.value = 0;
        this.fistWasDown = false;
      }
      return;
    }

    if (fistDown) {
      // At the hand cursor (the index fingertip / mouse), where the user is looking.
      const target = this.ndcToWorld(input.pointer, FIST_PLANE_Z, this._v);
      if (!this.fistWasDown && this.gather < 0.02) this.ballWorld.copy(target);
      this.ballWorld.lerp(target, damp(8, dt));
      this.gather = Math.min(1, this.gather + dt / 1.4);
      this.ballTime += dt;
    } else {
      if (this.fistWasDown) this.fistUpAt = this.time;
      const since = this.time - this.fistUpAt;
      if (this.gather > 0.25 && since < 1.0 && input.active && input.open) {
        this.explode(true);
        this.fistWasDown = false;
        return;
      }
      if (since > 0.45) this.gather = Math.max(0, this.gather - dt / 1.1);
      if (this.gather > 0) this.ballTime += dt;
    }
    this.fistWasDown = fistDown;
    U.uGather.value = this.gather;
    U.uBallTime.value = this.ballTime;
    U.uBallRadius.value = BALL_RADIUS * (1 + 0.06 * Math.sin(this.time * 5.5));
    this.root.worldToLocal(U.uBallCenter.value.copy(this.ballWorld));
  }

  updateTouch(dt, input) {
    const pointing = input.active && !input.pinching && !input.fist && !input.uiCaptured && !this.burst && this.gather < 0.05;
    this.trail.radius = this.params.pushRadius;
    const uv = pointing ? this.pickUV(input.pointer) : null;
    if (uv) this.trail.move(uv.u, uv.v, dt);
    else this.trail.lift();
    this.trail.update(dt);
  }

  /**
   * Ray-cast a screen point (NDC) onto the 3D relief of the portrait, taking the
   * current head rotation into account. Returns photo uv (v up) or null.
   */
  pickUV(ndc) {
    const p = this.portrait;
    const Ww = p.worldSize.w;
    const Hw = p.worldSize.h;
    const pu = p.pivotUV.u;
    const pv = p.pivotUV.v;
    const D = Math.max(1e-3, this.uniforms.uDepthWorld.value);
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this._ray.copy(this.raycaster.ray).applyMatrix4(this._inv.copy(this.root.matrixWorld).invert());
    const o = ray.origin;
    const d = ray.direction;
    const min = [-pu * Ww, -pv * Hw, -PIVOT_DEPTH * D];
    const max = [(1 - pu) * Ww, (1 - pv) * Hw, (1 - PIVOT_DEPTH) * D];
    let t0 = 0;
    let t1 = Infinity;
    const oa = [o.x, o.y, o.z];
    const da = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) {
        if (oa[a] < min[a] || oa[a] > max[a]) return this.planeUV(ray);
        continue;
      }
      let ta = (min[a] - oa[a]) / da[a];
      let tb = (max[a] - oa[a]) / da[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return this.planeUV(ray);

    const W = p.width;
    const H = p.height;
    const below = (t) => {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const u = x / Ww + pu;
      const v = y / Hw + pv;
      if (u < 0 || u >= 1 || v <= 0 || v > 1) return false;
      const i = Math.floor((1 - v) * H) * W + Math.floor(u * W);
      if (!p.mask[i]) return false;
      return z <= (p.depth[i] - PIVOT_DEPTH) * D;
    };
    const steps = 80;
    const dt = (t1 - t0) / steps;
    let prev = t0;
    for (let s = 1; s <= steps; s++) {
      const t = t0 + dt * s;
      if (below(t)) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          if (below(mid)) hi = mid;
          else lo = mid;
        }
        this._uv.u = (o.x + d.x * hi) / Ww + pu;
        this._uv.v = (o.y + d.y * hi) / Hw + pv;
        return this._uv;
      }
      prev = t;
    }
    return this.planeUV(ray);
  }

  /** Fallback when the ray misses the head: a plane through the face. */
  planeUV(ray) {
    const p = this.portrait;
    const z = (0.7 - PIVOT_DEPTH) * this.uniforms.uDepthWorld.value;
    if (Math.abs(ray.direction.z) < 1e-6) return null;
    const t = (z - ray.origin.z) / ray.direction.z;
    if (t < 0) return null;
    const u = (ray.origin.x + ray.direction.x * t) / p.worldSize.w + p.pivotUV.u;
    const v = (ray.origin.y + ray.direction.y * t) / p.worldSize.h + p.pivotUV.v;
    if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return null;
    this._uv.u = u;
    this._uv.v = v;
    return this._uv;
  }

  // ------------------------------------------------------------------ actions

  /** Burst the particles: from the fist ball if there is one, else from the face. */
  explode(fromBall) {
    const U = this.uniforms;
    if (this.burst) return;
    if (fromBall && this.gather > 0.05) {
      U.uBurstCenter.value.copy(U.uBallCenter.value);
      U.uBurstScale.value = 1;
      this.burst = { t: 0.001, reformStart: 0.85, reformDur: 2.2 };
    } else {
      this.gather = 0;
      U.uGather.value = 0;
      U.uBurstCenter.value.set(0, 0.3, (0.8 - PIVOT_DEPTH) * U.uDepthWorld.value);
      U.uBurstScale.value = 0.75;
      this.burst = { t: 0.001, reformStart: 0.6, reformDur: 2.1 };
    }
    U.uBurstT.value = this.burst.t;
    U.uReform.value = 0;
    this.trail.clear();
  }

  /** Particles fly in from a scattered cloud and assemble the face. */
  playIntro(duration) {
    const U = this.uniforms;
    this.gather = 0;
    U.uGather.value = 0;
    U.uBurstCenter.value.set(0, 0, 0);
    U.uBurstScale.value = 1.55;
    this.burst = { t: 1.4, reformStart: 1.55, reformDur: duration };
    U.uBurstT.value = this.burst.t;
    U.uReform.value = 0;
  }

  cycleMode() {
    const next = MODES[(MODES.indexOf(this.params.mode) + 1) % MODES.length];
    this.setMode(next, true);
  }

  setMode(mode, toast) {
    this.params.mode = mode;
    this.modeController?.updateDisplay();
    if (toast) this.app.hud.toast(MODE_TOAST[mode]);
  }

  resetView() {
    Object.assign(this.rot, { yaw: 0, pitch: 0, vy: 0, vp: 0, since: 10 });
    this.zoomTarget = 1;
    this.trail.clear();
  }

  /**
   * Test helper (smoke runs on software WebGL are only a few fps): advance the
   * animation by `seconds` with the current input held, without rendering.
   */
  fastForward(seconds, step = 1 / 30) {
    const s = this.app.input.state;
    const held = { ...s, dragDelta: { x: 0, y: 0 }, zoom: 0, events: new Set() };
    for (let t = 0; t < seconds; t += step) this.update(step, this.app.elapsed, held);
  }

  buildGui(folder) {
    this.modeController = folder
      .add(this.params, 'mode', MODES)
      .name('Colour mode')
      .onChange((m) => this.setMode(m, false));
    folder.add(this.params, 'size', 0.4, 2.5, 0.01).name('Particle size');
    folder.add(this.params, 'depth', 0, 2, 0.01).name('Depth (3D)');
    folder.add(this.params, 'pushRadius', 0.03, 0.25, 0.005).name('Push radius');
    folder.add(this.params, 'pushStrength', 0, 3, 0.05).name('Push strength');
    folder.add(this.params, 'sway').name('Auto sway');
    folder.add(this.actions, 'explode').name('💥 Explode');
    folder.add(this.actions, 'reset').name('↺ Reset view');
  }

  dispose() {
    super.dispose();
    this.trail?.dispose();
  }
}
