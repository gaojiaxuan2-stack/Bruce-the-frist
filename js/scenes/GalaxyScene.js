// Galaxy: an interactive spiral-galaxy generator (Three.js-Journey style, upgraded).
//   ☝️ point      -> gravity well on the galactic plane, stars orbit your fingertip
//   🤏 pinch+move -> turn / tilt the galaxy (with inertia)
//   ✊ fist       -> the whole galaxy spirals into the core
//   ✋ open hand  -> (after a fist) Big Bang: explode and re-form the spiral
//   ✌️ victory    -> a brand-new random galaxy with a smooth morph
//   hand near/far, wheel, two hands -> zoom
// All star motion runs in the vertex shader (js/scenes/galaxy/shaders.js).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BaseScene } from '../core/BaseScene.js';
import { buildGalaxyGeometry, buildDustGeometry, buildBackgroundGeometry } from './galaxy/build.js';
import * as S from './galaxy/shaders.js';
import { randomGalaxy } from './galaxy/palettes.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const BASE_COUNT = 200000;
const PITCH_IDLE = 35 * DEG;
const PITCH_MIN = -70 * DEG;
const PITCH_MAX = 84 * DEG;
const MORPH_TIME = 2.6;
const BANG_TIME = 2.7;
const REFORM_TIME = 2.0;
const COLLAPSE_TIME = 1.3;
const RELEASE_GRACE = 0.9;
const IDLE_AFTER = 2.5;     // seconds without input before the slow idle spin + bob
const VIEW_RESET_AFTER = 30; // seconds without any input before a user's tilt / zoom eases back
const POINT_HOLD = 0.35;    // a ☝️ well survives this long through a blurry 'none' pose
const CORE_WHITE = new THREE.Color(1, 0.93, 0.85);
// Filmic tone mapping (this scene only, restored on exit): a dense core of saturated
// stars plus its bloom rolls off to white-hot instead of clipping into a flat orange plateau.
const TONE_MAPPING = THREE.ACESFilmicToneMapping;
const TONE_EXPOSURE = 1.1;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (x, target, k, dt) => x + (target - x) * (1 - Math.exp(-k * dt));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (v, m) => ((v % m) + m) % m;

export default class GalaxyScene extends BaseScene {
  static meta = {
    id: 'galaxy',
    title: 'Galaxy',
    subtitle: 'Your own spiral galaxy',
    icon: '🌌',
    hints: [
      { icon: '☝️', gesture: 'Point', text: 'gravity well: stars swirl to your finger' },
      { icon: '🤏', gesture: 'Pinch + move', text: 'turn and tilt the galaxy' },
      { icon: '✊', gesture: 'Fist', text: 'pull all stars into the centre' },
      { icon: '✋', gesture: 'Open hand after fist', text: 'Big Bang!' },
      { icon: '✌️', gesture: 'Peace', text: 'make a new galaxy' },
      { icon: '↕️', gesture: 'Hand closer / farther', text: 'zoom in / out' },
    ],
    // Mouse users have no ✌️: a double click makes a new galaxy (see init).
    mouseHint: 'double-click = new galaxy',
    bloom: { strength: 0.9, radius: 0.55, threshold: 0.05 },
  };

  async init() {
    this.params = {
      count: this.count(BASE_COUNT),
      size: 1,
      radius: 5,
      branches: 3,
      spin: 1,
      randomness: 0.2,
      randomnessPower: 3,
      insideColor: '#ff6030',
      outsideColor: '#1b3984',
      rotationSpeed: 0.15,
    };

    this.u = {
      uRotTime: { value: 0 },
      uLifeTime: { value: 0 },
      uDir: { value: -1 },
      uRadius: { value: 5 },
      uParA: { value: new THREE.Vector4() },
      uParB: { value: new THREE.Vector4() },
      uInA: { value: new THREE.Color() },
      uOutA: { value: new THREE.Color() },
      uInB: { value: new THREE.Color() },
      uOutB: { value: new THREE.Color() },
      uMorph: { value: 1 },
      uWell: { value: new THREE.Vector3() },
      uWellStrength: { value: 0 },
      uWellRadius: { value: 1 },
      uWellPhase: { value: 0 },
      uCollapse: { value: 0 },
      uCollapseSpin: { value: 0 },
      uPulse: { value: 0 },
      uBang: { value: -1 },
      uBangPower: { value: 1 },
      uBangC: { value: 0 },
      uBangSpin: { value: 0 },
      uSize: { value: 1 },
      uBright: { value: 1 },
      uDust: { value: 0.65 },
    };
    const uniforms = { ...this.app.sharedUniforms, ...this.u };

    // ---- stars (disk + bulge + bright stars + haze), additive
    this.starMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: S.starVertex,
      fragmentShader: S.starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(buildGalaxyGeometry(this.params.count), this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // ---- dark dust lanes: multiply the frame by (1 - alpha), drawn after the stars
    this.dustMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: S.dustVertex,
      fragmentShader: S.dustFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.dust = new THREE.Points(buildDustGeometry(this.params.count), this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 3;
    this.scene.add(this.dust);

    // ---- background star field
    this.bgUniforms = { ...this.app.sharedUniforms, uBgBright: { value: 1 } };
    this.background = new THREE.Points(
      buildBackgroundGeometry(this.count(9000)),
      new THREE.ShaderMaterial({
        uniforms: this.bgUniforms,
        vertexShader: S.bgVertex,
        fragmentShader: S.bgFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.background.frustumCulled = false;
    this.background.renderOrder = -1;
    this.scene.add(this.background);

    // ---- glowing core, gravity-well marker, Big Bang shock wave
    const quad = new THREE.PlaneGeometry(1, 1);
    this.core = this.makeBillboard(quad, S.coreFragment, {
      uColor: { value: new THREE.Color() },
      uIntensity: { value: 0.5 },
      uNucleus: { value: 0 },
    });
    this.core.renderOrder = 1;
    this.wellMarker = this.makeBillboard(quad.clone(), S.wellFragment, {
      uColor: { value: new THREE.Color(1, 0.85, 0.7) },
      uIntensity: { value: 0 },
      uTime: this.app.sharedUniforms.uTime,
    });
    this.wellMarker.renderOrder = 4;
    this.wellRing = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: this.wellMarker.material.uniforms.uColor,
          uIntensity: { value: 0 },
          uTime: this.app.sharedUniforms.uTime,
          uDir: this.u.uDir,
        },
        vertexShader: S.shockVertex,
        fragmentShader: S.wellRingFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.wellRing.frustumCulled = false;
    this.wellRing.renderOrder = 4;
    this.scene.add(this.wellRing);

    this.shock = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uIntensity: { value: 0 } },
        vertexShader: S.shockVertex,
        fragmentShader: S.shockFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shock.visible = false;
    this.shock.frustumCulled = false;
    this.shock.renderOrder = 2;
    this.scene.add(this.shock);

    // ---- highlight roll-off before bloom: a dense core turns white-hot instead of clipping flat
    this.highlightPass = new ShaderPass(S.highlightShader);
    this.passes.push(this.highlightPass);

    // ---- state
    this.morph = 1;
    this.collapse = 0;
    this.collapseSpin = 0;
    this.releaseTimer = -1;
    this.bang = -1;
    this.bangPower = 1;
    this.bangDuration = BANG_TIME;
    this.shockT = -1;
    this.flash = 0;
    this.shake = 0;
    this.wellStrength = 0;
    this.wellEdge = 1;
    this.wellPos = new THREE.Vector3();
    this.wellHit = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.yaw = 0.35;
    this.pitchIdle = PITCH_IDLE;
    this.pitch = PITCH_IDLE;
    this.pitchHome = PITCH_IDLE; // idle bob centre: the user's last tilt, back to pitchIdle after a long rest
    this.userView = false;       // the user tilted or zoomed on purpose
    this.yawVel = 0;
    this.pitchVel = 0;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.depthZoom = 1;
    this.radiusFit = 1;
    this.fistSource = 'none';
    this.pointHold = 0;
    this.idleTime = 10;
    this.baseDist = 9;
    this.camDist = 10;
    this.lookTarget = new THREE.Vector3();
    this.coreColor = new THREE.Color();
    this.coreTarget = new THREE.Color();
    this.entered = false;
    this.regenTimer = 0;
    this.disposed = false;

    this.applyParams();
    this.u.uBright.value = brightnessFor(this.params.count);
    this.coreColor.copy(this.coreTarget);
    this.radiusFit = clamp(this.params.radius / 5, 0.3, 2);

    // Mouse users have no ✌️ - a double click makes a new galaxy instead.
    this.onDblClick = (e) => {
      if (this.app.active === this && e.target === this.app.renderer.domElement) this.newGalaxy();
    };
    window.addEventListener('dblclick', this.onDblClick);
  }

  makeBillboard(geometry, fragmentShader, extraUniforms) {
    const uniforms = { uScale: { value: 1 }, ...extraUniforms };
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: S.billboardVertex,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ params

  /** Push GUI params into the shader. During a morph only the target (B) changes. */
  applyParams() {
    const p = this.params;
    const u = this.u;
    u.uParB.value.set(Math.round(p.branches), p.spin, p.randomness, p.randomnessPower);
    u.uInB.value.set(p.insideColor);
    u.uOutB.value.set(p.outsideColor);
    if (this.morph >= 1) this.settleMorph();
    u.uRadius.value = p.radius;
    u.uSize.value = p.size;
    u.uWellRadius.value = 0.18 * p.radius;
    // keep the core glow in the galaxy's own colour (a white glow washes the centre out)
    this.coreTarget.set(p.insideColor).lerp(CORE_WHITE, 0.15);
  }

  settleMorph() {
    const u = this.u;
    u.uParA.value.copy(u.uParB.value);
    u.uInA.value.copy(u.uInB.value);
    u.uOutA.value.copy(u.uOutB.value);
    u.uMorph.value = 1;
  }

  scheduleRegen() {
    clearTimeout(this.regenTimer);
    this.regenTimer = setTimeout(() => this.regenerate(), 150);
  }

  regenerate() {
    if (this.disposed) return;
    const n = Math.max(1000, Math.round(this.params.count));
    const oldStars = this.stars.geometry;
    const oldDust = this.dust.geometry;
    this.stars.geometry = buildGalaxyGeometry(n);
    this.dust.geometry = buildDustGeometry(n);
    oldStars.dispose();
    oldDust.dispose();
    this.u.uBright.value = brightnessFor(n);
  }

  /** ✌️ a new random galaxy: old stars scatter and fade while the new spiral forms. */
  newGalaxy() {
    if (this.morph < 1) return false;
    const g = randomGalaxy(this.params);
    Object.assign(this.params, {
      branches: g.branches,
      spin: g.spin,
      randomness: g.randomness,
      randomnessPower: g.randomnessPower,
      insideColor: g.palette.inside,
      outsideColor: g.palette.outside,
    });
    this.morph = 0;
    this.u.uMorph.value = 0;
    this.applyParams();
    this.folder?.controllersRecursive().forEach((c) => c.updateDisplay());
    this.app.hud.toast(`✌️ New galaxy: ${g.palette.name} · ${g.branches} arms`);
    return true;
  }

  // ------------------------------------------------------------------ fist / Big Bang

  startBang(power) {
    const u = this.u;
    u.uBangC.value = this.collapse;
    u.uBangSpin.value = this.collapseSpin;
    u.uBangPower.value = power;
    this.collapse = 0;
    this.collapseSpin = 0;
    this.releaseTimer = -1;
    this.bang = 0;
    this.bangPower = power;
    this.bangDuration = power > 0.5 ? BANG_TIME : REFORM_TIME;
    if (power > 0.5) {
      this.shockT = 0;
      this.flash = 1;
      this.shake = 1;
      this.app.hud.toast('💥 Big Bang!');
    }
  }

  updateCollapse(dt, time, input) {
    const fist = input.active && input.fist && !input.uiCaptured;
    // Mouse / touch have no "open hand": letting go of the right button or the
    // long-press is the open hand. (A touch release also makes input inactive.)
    const released = this.fistSource === 'mouse' && input.events.has('fistend');
    if (fist) {
      this.fistSource = input.source;
      this.releaseTimer = -1;
      if (this.bang >= 0) this.bang += dt / 0.35; // finish a running bang fast, then collapse
      else this.collapse = Math.min(1, this.collapse + dt / COLLAPSE_TIME);
    } else if (this.collapse > 0) {
      if (this.collapse < 0.3) {
        // a short squeeze: just relax back
        this.collapse = Math.max(0, this.collapse - dt / 0.5);
        if (this.collapse === 0) this.collapseSpin = 0;
      } else {
        if (this.releaseTimer < 0) this.releaseTimer = 0;
        this.releaseTimer += dt;
        if ((input.active && input.open && !input.uiCaptured) || released) this.startBang(1);
        else if (this.releaseTimer > RELEASE_GRACE) this.startBang(0.22);
      }
    }
    if (this.collapse > 0) this.collapseSpin += dt * (0.5 + 7 * this.collapse * this.collapse);

    if (this.bang >= 0) {
      this.bang += dt / this.bangDuration;
      if (this.bang >= 1) {
        this.bang = -1;
        this.u.uBangC.value = 0;
        this.u.uBangSpin.value = 0;
      }
    }
    this.u.uCollapse.value = this.collapse;
    this.u.uCollapseSpin.value = this.collapseSpin;
    this.u.uPulse.value = this.collapse > 0 ? 0.1 * Math.sin(time * 11) * this.collapse * this.collapse : 0;
    this.u.uBang.value = this.bang;
  }

  // ------------------------------------------------------------------ lifecycle

  enter() {
    const r = this.app.renderer;
    if (!this.savedTone) this.savedTone = { mapping: r.toneMapping, exposure: r.toneMappingExposure };
    r.toneMapping = TONE_MAPPING;
    r.toneMappingExposure = TONE_EXPOSURE;
    this.yawVel = this.pitchVel = 0;
    if (!this.entered) {
      // first visit: the galaxy unfurls out of its core
      this.entered = true;
      this.pitch = this.pitchIdle;
      this.collapse = 1;
      this.collapseSpin = 6;
      this.startBang(0.35);
    }
  }

  exit() {
    this.restoreTone();
  }

  restoreTone() {
    if (!this.savedTone) return;
    this.app.renderer.toneMapping = this.savedTone.mapping;
    this.app.renderer.toneMappingExposure = this.savedTone.exposure;
    this.savedTone = null;
  }

  resize(width, height) {
    super.resize(width, height);
    const tanH = Math.tan((this.camera.fov * DEG) / 2);
    const aspect = width / height;
    // fit the default galaxy (radius 5) with a little margin for the UI;
    // portrait screens get a more face-on view so the galaxy uses the height too
    this.baseDist = Math.max(10, (aspect < 1 ? 5.8 : 6.2) / (tanH * aspect), 3.9 / tanH);
    this.pitchIdle = aspect < 1 ? 58 * DEG : PITCH_IDLE;
    if (!this.userView) this.pitchHome = this.pitchIdle;
  }

  update(dt, time, input) {
    const u = this.u;
    const p = this.params;
    const ui = input.uiCaptured;
    const active = input.active;

    // ---- ✌️ new galaxy (not while a fist is held / being released: a hand that
    // opens slowly from ✊ to ✋ passes through ☝️ and ✌️ on the way)
    const bangStarting = this.bang >= 0 && this.bang < 0.15;
    if (input.events.has('victorystart') && !ui && this.collapse === 0 && !bangStarting) this.newGalaxy();
    if (this.morph < 1) {
      this.morph = Math.min(1, this.morph + dt / MORPH_TIME);
      u.uMorph.value = this.morph;
      if (this.morph >= 1) this.settleMorph();
    }

    // ---- ✊ collapse / ✋ Big Bang
    this.updateCollapse(dt, time, input);

    // ---- 🤏 pinch + drag: turn / tilt with inertia
    const dragging = active && input.pinching && !ui && !input.fist;
    if (dragging) {
      const ys = -input.dragDelta.x * 2.6;
      const ps = -input.dragDelta.y * 2.0;
      this.yaw += ys;
      this.pitch += ps;
      const inv = 1 / Math.max(dt, 1 / 240);
      this.yawVel = damp(this.yawVel, ys * inv, 16, dt);
      this.pitchVel = damp(this.pitchVel, ps * inv, 16, dt);
    } else {
      this.yaw += this.yawVel * dt;
      this.pitch += this.pitchVel * dt;
      this.yawVel *= Math.exp(-1.7 * dt);
      this.pitchVel *= Math.exp(-2.6 * dt);
    }
    if (this.pitch < PITCH_MIN || this.pitch > PITCH_MAX) {
      this.pitch = clamp(this.pitch, PITCH_MIN, PITCH_MAX);
      this.pitchVel = 0;
    }
    // a tilt the user made becomes the new resting view (idle only bobs around it)
    if (dragging || Math.abs(this.pitchVel) > 0.01) {
      this.pitchHome = this.pitch;
      this.userView = true;
    }

    // ---- ☝️ gravity well at the fingertip's projection onto the galactic plane
    this.updateWell(dt, input);

    // ---- camera: idle drift, zoom (wheel / two hands) and hand distance
    const zooming = input.zoom !== 0 && !ui;
    this.idleTime = active || zooming ? 0 : this.idleTime + dt;
    const idle = this.idleTime > IDLE_AFTER;
    if (!dragging) this.yaw += dt * (idle ? 0.04 : 0.015);
    if (this.idleTime > VIEW_RESET_AFTER && this.userView) {
      // nobody around for a long time: ease back to the default view
      this.pitchHome = damp(this.pitchHome, this.pitchIdle, 0.35, dt);
      this.zoomTarget = damp(this.zoomTarget, 1, 0.35, dt);
      if (Math.abs(this.pitchHome - this.pitchIdle) < 0.002 && Math.abs(this.zoomTarget - 1) < 0.002) {
        this.userView = false;
      }
    }
    if (idle) this.pitch = damp(this.pitch, this.pitchHome + 0.07 * Math.sin(time * 0.17), 0.45, dt);
    if (zooming) {
      this.zoomTarget = clamp(this.zoomTarget * Math.exp(-input.zoom * 1.1), 0.4, 2.4);
      this.userView = true;
    }
    this.zoom = damp(this.zoom, this.zoomTarget, 8, dt);
    const depthTarget = input.source === 'hand' && active ? clamp(1 - (input.depth - 0.5) * 1.1, 0.5, 1.6) : 1;
    this.depthZoom = damp(this.depthZoom, depthTarget, 2.2, dt);
    // keep the whole galaxy framed when the Radius slider changes
    this.radiusFit = damp(this.radiusFit, clamp(p.radius / 5, 0.3, 2), 4, dt);
    this.placeCamera(dt, time);

    // ---- galaxy rotation (rigid + bounded differential, see shader)
    const dir = p.spin >= 0 ? -1 : 1;
    u.uDir.value = damp(u.uDir.value, dir, 3, dt);
    u.uRotTime.value = wrap(u.uRotTime.value + dt * p.rotationSpeed * dir, TAU);
    u.uLifeTime.value = wrap(u.uLifeTime.value + dt * Math.min(p.rotationSpeed, 0.25) * dir, TAU);
    u.uWellPhase.value = wrap(u.uWellPhase.value + dt, 400);

    this.updateEffects(dt);
  }

  updateWell(dt, input) {
    const p = this.params;
    let target = 0;
    let edge = this.wellEdge;
    // ☝️ point (or the mouse pointer) = gravity well. Only a pose that was just
    // 'point' may blur into 'none' for a moment without dropping the well.
    const g = input.gesture;
    if (g === 'point') this.pointHold = POINT_HOLD;
    else this.pointHold = g === 'none' ? Math.max(0, this.pointHold - dt) : 0;
    const power = g === 'point' || this.pointHold > 0 ? 1 : 0;
    const pointing = power > 0 && input.active && !input.uiCaptured && !input.pinching && !input.fist
      && this.collapse === 0;
    if (pointing) {
      this.raycaster.setFromCamera(input.pointer, this.camera);
      const ray = this.raycaster.ray;
      const dy = ray.direction.y;
      if (Math.abs(dy) > 1e-3) {
        const t = -ray.origin.y / dy;
        if (t > 0) {
          this.wellHit.copy(ray.origin).addScaledVector(ray.direction, t);
          this.wellHit.y = 0;
          // Keep the well on the disk: a fingertip over empty sky pulls on the nearest
          // rim (the clamp point lies on the screen line from the core to the finger).
          // The marker fades there, so no swirl decal floats alone in black space.
          const R = p.radius;
          const len = Math.hypot(this.wellHit.x, this.wellHit.z);
          if (len > 0.95 * R) this.wellHit.multiplyScalar((0.95 * R) / len);
          edge = 1 - smoothstep(0.85 * R, 1.15 * R, len);
          target = power * smoothstep(0.03, 0.2, Math.abs(dy)) * (1 - 0.45 * smoothstep(1.0 * R, 2.2 * R, len));
        }
      }
    }
    if (target > 0) {
      if (this.wellStrength < 0.03) this.wellPos.copy(this.wellHit);
      else this.wellPos.lerp(this.wellHit, 1 - Math.exp(-11 * dt));
    }
    this.wellEdge = damp(this.wellEdge, edge, 6, dt);
    this.wellStrength = damp(this.wellStrength, target, target > this.wellStrength ? 2.4 : 3.5, dt);
    if (this.wellStrength < 1e-3 && target === 0) this.wellStrength = 0;
    this.u.uWell.value.copy(this.wellPos);
    this.u.uWellStrength.value = this.wellStrength;
  }

  placeCamera(dt, time) {
    const dist = this.baseDist * this.zoom * this.depthZoom * this.radiusFit;
    this.camDist = this.baseDist * this.zoom * this.depthZoom; // in "radius 5" units (core glow fade)
    const cp = Math.cos(this.pitch);
    const cam = this.camera;
    cam.position.set(Math.sin(this.yaw) * cp * dist, Math.sin(this.pitch) * dist, Math.cos(this.yaw) * cp * dist);
    // gentle drift so the view never feels frozen
    this.lookTarget.set(Math.sin(time * 0.13) * 0.12, Math.sin(time * 0.1) * 0.06, Math.cos(time * 0.11) * 0.12);
    cam.position.add(this.lookTarget);
    if (this.shake > 0.001) {
      const a = this.shake * this.shake * 0.12 * (dist / 9);
      cam.position.x += Math.sin(time * 61) * a;
      cam.position.y += Math.sin(time * 47 + 1.3) * a;
      this.shake *= Math.exp(-2.8 * dt);
    }
    cam.lookAt(this.lookTarget);
  }

  updateEffects(dt) {
    const p = this.params;
    this.coreColor.lerp(this.coreTarget, 1 - Math.exp(-3 * dt));

    // glowing core: brighter while collapsed, flashes on the Big Bang
    const cu = this.core.material.uniforms;
    const pulse = 1 + this.u.uPulse.value * 2.5;
    this.flash *= Math.exp(-2.2 * dt);
    const bangGlow = this.bang >= 0 ? (1 - smoothstep(0, 0.45, this.bang)) * this.u.uBangC.value : 0;
    cu.uColor.value.copy(this.coreColor);
    // the glow is a soft halo seen from afar: it fades out as the camera flies into the core
    const near = smoothstep(2.0, 8.0, this.camDist);
    // a small Size makes the stars fainter: the resting glow follows so the core stays in balance
    const sizeLight = 0.4 + 0.6 * Math.min(p.size, 1);
    cu.uIntensity.value = (0.11 * sizeLight + 0.5 * this.collapse + 0.4 * bangGlow + 0.75 * this.flash) * pulse * near;
    cu.uScale.value = p.radius * (0.75 - 0.25 * this.collapse + 0.7 * this.flash);
    // the hot nucleus belongs to the settled galaxy (the collapsed knot has its own heat)
    const settled = (1 - this.collapse) * (this.bang >= 0 ? smoothstep(0.4, 1, this.bang) : 1);
    cu.uNucleus.value = 0.32 * sizeLight * settled * near * (1 - 0.6 * this.wellStrength * this.wellNearCore());
    this.core.visible = cu.uIntensity.value + cu.uNucleus.value > 0.002;

    // gravity-well marker
    const wu = this.wellMarker.material.uniforms;
    this.wellMarker.position.copy(this.wellPos);
    this.wellMarker.visible = this.wellStrength > 0.002;
    // marker + swirl are a hint seen from afar; close up they would cover the screen
    wu.uIntensity.value = this.wellStrength * this.wellEdge * 0.8 * (0.15 + 0.85 * near);
    wu.uScale.value = this.u.uWellRadius.value * 2.2;
    wu.uColor.value.copy(this.coreColor);
    this.wellRing.position.copy(this.wellPos);
    this.wellRing.position.y -= this.u.uWellRadius.value * 0.25 * this.wellStrength;
    this.wellRing.visible = this.wellMarker.visible;
    this.wellRing.scale.setScalar(this.u.uWellRadius.value * 2.4);
    this.wellRing.material.uniforms.uIntensity.value = this.wellStrength * this.wellEdge * 0.18 * near * near;

    // Big Bang shock wave on the galactic plane
    if (this.shockT >= 0) {
      this.shockT += dt / 1.25;
      const t = this.shockT;
      const su = this.shock.material.uniforms;
      this.shock.visible = t < 1;
      this.shock.scale.setScalar(p.radius * (0.08 + 1.05 * (1 - Math.pow(1 - Math.min(t, 1), 3))));
      su.uProgress.value = Math.min(t, 1);
      su.uIntensity.value = Math.pow(Math.max(0, 1 - t), 3) * 0.5;
      su.uColor.value.copy(this.coreColor);
      if (t >= 1) this.shockT = -1;
    }
  }

  // ------------------------------------------------------------------ GUI

  buildGui(folder) {
    this.folder = folder;
    const p = this.params;
    const apply = () => this.applyParams();
    folder.add(p, 'count', 1000, this.count(250000), 1000).name('Count (stars)').onChange(() => this.scheduleRegen());
    folder.add(p, 'size', 0.2, 3, 0.01).name('Size').onChange(apply);
    folder.add(p, 'radius', 1, 10, 0.1).name('Radius').onChange(apply);
    folder.add(p, 'branches', 1, 12, 1).name('Branches (arms)').onChange(apply);
    folder.add(p, 'spin', -5, 5, 0.01).name('Spin').onChange(apply);
    folder.add(p, 'randomness', 0, 2, 0.001).name('Randomness').onChange(apply);
    folder.add(p, 'randomnessPower', 1, 10, 0.1).name('Randomness power').onChange(apply);
    folder.addColor(p, 'insideColor').name('Inside color').onChange(apply);
    folder.addColor(p, 'outsideColor').name('Outside color').onChange(apply);
    folder.add(p, 'rotationSpeed', 0, 1, 0.01).name('Rotation speed');
  }

  /** 1 when the gravity well sits on the core (it then pulls the nucleus apart). */
  wellNearCore() {
    const d = Math.hypot(this.wellPos.x, this.wellPos.z);
    return 1 - smoothstep(0.05, 0.25, d / Math.max(this.params.radius, 0.1));
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.regenTimer);
    window.removeEventListener('dblclick', this.onDblClick);
    this.restoreTone();
    this.highlightPass.dispose();
    super.dispose();
  }
}

/** Keep the overall brightness similar when the star count changes. */
function brightnessFor(n) {
  return clamp(Math.pow(BASE_COUNT / n, 0.45), 0.45, 3.5);
}
