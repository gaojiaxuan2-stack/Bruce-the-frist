// Black Hole — a Gargantua-style black hole made of particles.
//
// A Keplerian accretion disk (all motion computed in the vertex shader from a
// clock uniform), relativistic Doppler beaming, gravitational lensing that
// bends the far side of the disk over and under the shadow, a thin photon
// ring, infalling streams, dust, background stars and optional jets.
// The hand orbits the camera, a fist feeds the hole, opening the hand
// (mouse / touch: letting go) releases a shock wave, a victory sign changes the colours.
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import {
  diskVertex,
  pointFragment,
  starVertex,
  starFragment,
  dustVertex,
  jetVertex,
  billboardVertex,
  ringFragment,
} from './blackhole/shaders.js';
import { ShadowPasses } from './blackhole/ShadowPasses.js';

const RS = 1; // event-horizon radius (world units)
const R_IN = 2.6; // inner edge of the disk
const R_OUT = 12; // outer edge of the disk
const RING = 1.5; // photon ring radius
const ORBIT_K = 7.5; // omega = K * r^-1.5  (inner edge: one turn every ~3.5 s)
const BASE_DIST = 21;

const DEG = Math.PI / 180;
const IDLE_INCL = 8 * DEG; // Interstellar: nearly edge-on
const HAND_MIN_INCL = 2 * DEG;
const HAND_MAX_INCL = 60 * DEG;
const MIN_INCL = -40 * DEG;
const MAX_INCL = 82 * DEG;
// Palm height (NDC) for the highest and the lowest view. The top stays well below
// the tab bar, so looking down on the disk never parks the hand cursor on a tab.
const PALM_TOP = 0.45;
const PALM_BOTTOM = -0.6;

// hot inner edge -> mid -> outer -> rim. gain evens out how bright the palettes
// look (saturated blue and red carry much less light than gold).
const PALETTES = [
  { name: 'Interstellar gold', colors: ['#e4eeff', '#ffd27a', '#ff8426', '#5c0c03'], gain: 1 },
  { name: 'Blue-white', colors: ['#eef6ff', '#b0d8ff', '#68a6ff', '#3060e0'], gain: 1.25 },
  { name: 'Crimson', colors: ['#fff1d8', '#ff3a1c', '#c4001c', '#4a0008'], gain: 1.1 },
];

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Palm height -> camera height above the disk (centre = the idle, near edge-on view). */
function inclFromPalm(y) {
  if (y >= 0) return IDLE_INCL + Math.min(y / PALM_TOP, 1) * (HAND_MAX_INCL - IDLE_INCL);
  return IDLE_INCL - Math.min(y / PALM_BOTTOM, 1) * (IDLE_INCL - HAND_MIN_INCL);
}

function gauss() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export default class BlackHoleScene extends BaseScene {
  static meta = {
    id: 'blackhole',
    title: 'Black Hole',
    subtitle: 'Gargantua — gravity bends the light',
    icon: '🕳️',
    hints: [
      // (no Point here: the whole hand steers, so "Move hand" takes the Point row's place)
      { icon: '🖐️', gesture: 'Move hand', text: 'fly around the black hole' },
      { icon: '🤏', gesture: 'Pinch + move', text: 'spin the view' },
      { icon: '✊', gesture: 'Fist', text: 'feed it — more gravity' },
      { icon: '✋', gesture: 'Open hand after fist', text: 'release a big flash' },
      { icon: '✌️', gesture: 'Peace', text: 'change the colours' },
      { icon: '↕️', gesture: 'Hand closer / farther', text: 'zoom in / out' },
    ],
    bloom: { strength: 1.25, radius: 0.6, threshold: 0.3 },
    // The palm steers the orbit: show the hand cursor at the palm, and only count fast flicks as swipes.
    cursor: 'palm',
    swipe: 'strict',
  };

  async init() {
    this.settings = {
      size: 1,
      brightness: 1,
      spin: 1,
      lensing: 1,
      tilt: 0,
      jets: false,
      palette: PALETTES[0].name,
    };
    this.paletteIndex = 0;

    this.camera.fov = 45;
    this.camera.near = 0.1;
    this.camera.far = 3000;
    this.camera.updateProjectionMatrix();

    // ---------------------------------------------------------- shared uniforms
    const pal = PALETTES[0].colors.map((c) => new THREE.Color(c));
    this.paletteTarget = pal.map((c) => c.clone());
    this.paletteGain = PALETTES[0].gain;
    this.u = {
      ...this.app.sharedUniforms,
      uClock: { value: 0 },
      uHoleView: { value: new THREE.Vector3(0, 0, -BASE_DIST) },
      uRing: { value: RING },
      uRin: { value: R_IN },
      uRout: { value: R_OUT },
      uRs: { value: RS },
      uOrbitK: { value: ORBIT_K },
      uSize: { value: 7 },
      uBright: { value: 1 },
      uFeed: { value: 0 },
      uLensA: { value: 3 },
      uLensStar: { value: 5 },
      uViewGain: { value: 1 },
      uFlash: { value: 0 },
      uStreams: { value: 0.5 },
      uBeam: { value: 1 },
      uShock: { value: new THREE.Vector4(0, 0, 1, 0) },
      uShockDust: { value: new THREE.Vector4(0, 0, 1, 0) },
      uCol0: { value: pal[0] },
      uCol1: { value: pal[1] },
      uCol2: { value: pal[2] },
      uCol3: { value: pal[3] },
      uStarBright: { value: 1 },
      uDust: { value: 0.065 },
      uJet: { value: 0 },
      uJetClock: { value: 0 },
      uRingBright: { value: 1 },
      uBeamDir: { value: new THREE.Vector2(1, 0) },
    };

    const additive = (vertexShader, fragmentShader, defines = {}) =>
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader,
        fragmentShader,
        defines,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      });

    // ---------------------------------------------------------- event horizon
    this.horizon = new THREE.Mesh(
      new THREE.SphereGeometry(RS, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    this.horizon.renderOrder = -10;
    this.scene.add(this.horizon);
    // The shadow seen from outside is wider than the horizon (light passing closer
    // than the photon sphere is captured): a camera-facing black disc at the
    // hole's centre plane hides everything BEHIND the hole inside the photon ring,
    // while the near side of the disk still passes in front of it.
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 128), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.shadow.renderOrder = -9;
    this.scene.add(this.shadow);

    // ---------------------------------------------------------- accretion disk
    this.diskGeometry = this.buildDisk(this.count(220000));
    this.disk = new THREE.Points(this.diskGeometry, additive(diskVertex, pointFragment));
    this.disk.frustumCulled = false;
    this.scene.add(this.disk);

    // Secondary (under-the-hole) image: same particles, second draw, half of them.
    const secondaryGeometry = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(this.diskGeometry.attributes)) secondaryGeometry.setAttribute(name, attr);
    secondaryGeometry.setDrawRange(0, Math.floor(this.diskGeometry.attributes.position.count * 0.5));
    this.diskSecondary = new THREE.Points(secondaryGeometry, additive(diskVertex, pointFragment, { SECONDARY: 1 }));
    this.diskSecondary.frustumCulled = false;
    this.scene.add(this.diskSecondary);

    // ---------------------------------------------------------- stars, dust, jets
    this.stars = new THREE.Points(this.buildStars(this.count(15000)), additive(starVertex, starFragment));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    this.dust = new THREE.Points(this.buildDust(this.count(16000)), additive(dustVertex, pointFragment));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    this.jets = new THREE.Points(this.buildJets(this.count(10000)), additive(jetVertex, pointFragment));
    this.jets.frustumCulled = false;
    this.jets.visible = false;
    this.scene.add(this.jets);

    // ---------------------------------------------------------- photon ring
    // Billboard in world units (vP = local xy), big enough for the grown shadow.
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), additive(billboardVertex, ringFragment));
    this.ring.material.depthTest = false;
    this.ring.renderOrder = 5;
    this.scene.add(this.ring);

    // ---------------------------------------------------------- pure black shadow under the bloom
    this.shadowFx = new ShadowPasses(this.camera, this.u);
    this.passes = [this.shadowFx.copyPass];
    // Passes for after the bloom. The App does not read this list yet, so update()
    // also inserts the mask itself (attach() does nothing once it is in place).
    this.postPasses = [this.shadowFx.maskPass];

    // ---------------------------------------------------------- state
    this.cam = {
      autoAz: 0.9,
      spinAz: 0,
      spinVel: 0,
      dragIncl: 0,
      inclVel: 0,
      handAz: 0,
      handAzTarget: 0,
      handIncl: IDLE_INCL,
      handInclTarget: IDLE_INCL,
      userZoom: 1,
      depthZoom: 1,
      roll: 0,
      az: 0,
      incl: IDLE_INCL,
      dist: BASE_DIST,
      paused: true, // not following the hand (absent, pinch-dragging, on the UI, changing shape)
      keepIncl: false, // when following resumes, keep the height a pinch-drag left
      settle: 0,
    };
    this.fit = 1;
    // Fewer particles at lower quality: make each one a bit bigger and brighter.
    const q = 1 / this.app.particleScale;
    this.sizeComp = Math.pow(q, 0.25);
    this.brightComp = Math.pow(q, 0.45);
    this.clockValue = 0;
    this.jetClock = 0;
    this.feed = 0;
    this.charge = 0;
    this.sinceFist = 99;
    this.fistSource = 'none'; // who made the last fist: 'hand' or 'mouse' (mouse / touch)
    this.mass = 1;
    this.flash = 0;
    this.jetBurst = 0;
    this.jetLevel = 0;
    this.shock = null;
    this.tmp = new THREE.Vector3();
    this.updateCamera(0);
  }

  // ---------------------------------------------------------------- geometry

  buildDisk(n) {
    const nStream = Math.round(n * 0.03);
    const nPlunge = Math.round(n * 0.006);
    const orbit = new Float32Array(n * 4);
    const rand = new Float32Array(n * 4);
    const rEndDisk = R_IN * 0.86;
    const STREAMS = 7;
    const kinds = [];
    for (let i = 0; i < n; i++) kinds.push(i < nStream ? 1 : i < nStream + nPlunge ? 2 : 0);
    // shuffle so any prefix (secondary image draw range) is a fair sample
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    let streamCounter = 0;
    for (let i = 0; i < n; i++) {
      const kind = kinds[i];
      let rOut;
      let theta0;
      let speed;
      let g = gauss();
      if (kind === 1) {
        const id = streamCounter++ % STREAMS;
        rOut = 14.5 + id * 0.8;
        theta0 = id * ((2 * Math.PI) / STREAMS) + 0.4;
        speed = (0.5 + 0.12 * (id % 3)) / (rOut - rEndDisk);
        g = clamp(g, -2.5, 2.5);
      } else if (kind === 2) {
        rOut = R_IN * (0.9 + 0.55 * Math.random());
        theta0 = Math.random() * Math.PI * 2;
        speed = (0.18 + 0.12 * Math.random()) / (rOut - 1.02);
      } else {
        rOut = R_IN + 0.4 + (R_OUT - R_IN - 0.4) * Math.pow(Math.random(), 0.7);
        theta0 = Math.random() * Math.PI * 2;
        speed = (0.07 + 0.12 * Math.random()) / (rOut - rEndDisk);
      }
      orbit.set([rOut, theta0, Math.random(), speed], i * 4);
      rand.set([g, Math.random(), Math.random(), kind], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    // position is unused by the shader but three.js needs it for the vertex count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
    return geo;
  }

  buildStars(n) {
    const pos = new Float32Array(n * 3);
    const star = new Float32Array(n * 4);
    const band = new THREE.Vector3(0.3, 1, 0.2).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(gauss(), gauss(), gauss()).normalize();
      if (i % 3 === 0) {
        // a faint Milky-Way band
        v.addScaledVector(band, -v.dot(band) * (0.85 + Math.random() * 0.15)).normalize();
      }
      const r = 320 + Math.random() * 260;
      pos.set([v.x * r, v.y * r, v.z * r], i * 3);
      const big = Math.pow(Math.random(), 8);
      star.set([1.4 + big * 4.5, 0.05 + Math.pow(Math.random(), 3) * 0.9 + big * 0.8, Math.random(), Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aStar', new THREE.BufferAttribute(star, 4));
    return geo;
  }

  buildDust(n) {
    const dust = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = 3 + Math.pow(Math.random(), 0.75) * 52;
      const h = gauss() * (0.25 + r * 0.11);
      dust.set([r, Math.random() * Math.PI * 2, h, Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aDust', new THREE.BufferAttribute(dust, 4));
    return geo;
  }

  buildJets(n) {
    const jet = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      jet.set([i % 2 ? 1 : -1, Math.random(), Math.random() * Math.PI * 2, Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aJet', new THREE.BufferAttribute(jet, 4));
    return geo;
  }

  // ---------------------------------------------------------------- lifecycle

  enter() {
    this.cam.paused = true;
    this.cam.keepIncl = false;
    this.cam.settle = 0;
  }

  exit() {
    // Forget a feed in progress: coming back later with an open hand must not
    // fire a release flash.
    this.charge = 0;
    this.sinceFist = 99;
    this.fistSource = 'none';
    this.feed = 0;
    this.shock = null;
    this.flash = 0;
    this.jetBurst = 0;
    this.mass = 1;
    this.shadowFx.detach(this.app.composer);
  }

  dispose() {
    this.shadowFx.detach(this.app.composer);
    this.shadowFx.dispose();
    super.dispose();
  }

  resize(width, height) {
    super.resize(width, height);
    const aspect = width / Math.max(height, 1);
    // Pull back a little on tall (phone) screens, but keep the shadow and photon
    // ring big (about 30% of the width); the outer disk may overflow the sides.
    this.fit = aspect < 1.25 ? clamp(0.6 / aspect, 1, 1.3) : 1;
  }

  setPalette(name, announce = false) {
    const i = Math.max(0, PALETTES.findIndex((p) => p.name === name));
    this.paletteIndex = i;
    this.settings.palette = PALETTES[i].name;
    PALETTES[i].colors.forEach((c, k) => this.paletteTarget[k].set(c));
    this.paletteController?.updateDisplay();
    if (announce) this.app.hud.toast(`✌️ Colours: ${PALETTES[i].name}`);
  }

  buildGui(folder) {
    const s = this.settings;
    folder.add(s, 'size', 0.3, 2.5, 0.01).name('Particle size');
    folder.add(s, 'brightness', 0.2, 3, 0.01).name('Disk brightness');
    folder.add(s, 'spin', 0, 3, 0.01).name('Spin speed');
    folder.add(s, 'lensing', 0, 2, 0.01).name('Lensing strength');
    folder.add(s, 'tilt', -45, 45, 1).name('Disk tilt (°)');
    folder.add(s, 'jets').name('Jets');
    this.paletteController = folder
      .add(s, 'palette', PALETTES.map((p) => p.name))
      .name('Colours')
      .onChange((v) => this.setPalette(v));
  }

  // ---------------------------------------------------------------- per frame

  update(dt, time, input) {
    const c = this.cam;
    const active = input.active;
    const ui = input.uiCaptured;
    const pinching = active && input.pinching && !ui;
    const fist = active && input.fist && !ui;

    // ------------------------------------------------ camera: hand orbit
    // The PALM steers (wrist + knuckles), not the fingertip: it stays put when the
    // fingers curl into a fist or open again (mouse: palm = cursor).
    // Horizontal -> azimuth, vertical -> how high above the disk.
    const handAz = clamp(input.palm.x, -1, 1) * 1.3;
    const handIncl = inclFromPalm(clamp(input.palm.y, -1, 1));

    // A hand changing shape jitters a little: hold the view for a moment, then
    // carry on from where it is.
    const ev = input.events;
    if (ev.has('fiststart') || ev.has('fistend') || ev.has('openstart')) c.settle = 0.3;
    c.settle = Math.max(0, c.settle - dt);
    // The hand cursor just hovering the UI does not stop the orbit (a pinch there
    // = clicking / dragging a control does). A mouse over the UI is using the UI.
    const uiBusy = ui && (input.source !== 'hand' || input.pinching);
    const following = active && !pinching && !uiBusy && c.settle <= 0;
    if (!active) {
      c.paused = true;
      c.keepIncl = false;
    } else if (!following) {
      c.paused = true;
      if (pinching) c.keepIncl = true;
    }
    if (following && c.paused) {
      // (Re)starting to follow: re-anchor the azimuth so the view does not swing.
      // The height is absolute (hand up = look from above; it eases there),
      // except after a pinch-drag, which keeps the angle it set.
      c.spinAz += c.handAz - handAz;
      c.handAz = c.handAzTarget = handAz;
      if (c.keepIncl) {
        c.dragIncl += c.handIncl - handIncl;
        c.handIncl = c.handInclTarget = handIncl;
      }
      c.paused = false;
      c.keepIncl = false;
    }
    if (following) {
      c.handAzTarget = handAz;
      c.handInclTarget = handIncl;
    } else if (!active) {
      c.handInclTarget = IDLE_INCL;
    }

    c.handAz += (c.handAzTarget - c.handAz) * damp(3, dt);
    c.handIncl += (c.handInclTarget - c.handIncl) * damp(2.5, dt);

    // ------------------------------------------------ camera: pinch + drag with inertia
    if (pinching) {
      const dAz = -input.dragDelta.x * 2.8;
      const dIn = -input.dragDelta.y * 1.6;
      c.spinAz += dAz;
      c.dragIncl += dIn;
      if (dt > 0) {
        c.spinVel += (clamp(dAz / dt, -3.5, 3.5) - c.spinVel) * damp(10, dt);
        c.inclVel += (clamp(dIn / dt, -1.5, 1.5) - c.inclVel) * damp(10, dt);
      }
    } else {
      c.spinAz += c.spinVel * dt;
      c.dragIncl += c.inclVel * dt;
      c.spinVel *= Math.exp(-1.4 * dt);
      c.inclVel *= Math.exp(-3 * dt);
      if (!active) c.dragIncl *= Math.exp(-0.5 * dt);
    }
    c.dragIncl = clamp(c.dragIncl, MIN_INCL - c.handIncl, MAX_INCL - c.handIncl);

    // ------------------------------------------------ camera: zoom
    c.userZoom = clamp(c.userZoom * Math.exp(-input.zoom * 1.2), 0.5, 2.2);
    const depthTarget = input.source === 'hand' && active ? clamp(Math.exp(-(input.depth - 0.5) * 1.8), 0.6, 1.6) : 1;
    c.depthZoom += (depthTarget - c.depthZoom) * damp(2.5, dt);

    // idle: slow orbit; with a hand present the orbit almost stops so the hand is in charge
    c.autoAz += dt * 0.055 * (active ? 0.25 : 1);

    // ------------------------------------------------ feed (fist) and release (open hand)
    if (fist) {
      this.fistSource = input.source;
      this.charge = Math.min(1, this.charge + dt / 2.2);
      this.sinceFist = 0;
    } else {
      this.sinceFist += dt;
      if (this.sinceFist > 3) this.charge = Math.max(0, this.charge - dt * 0.6);
    }
    this.feed += ((fist ? 1 : 0) - this.feed) * damp(fist ? 2.2 : 1.1, dt);
    // (Open hand and victory are whole-hand poses, not clicks, so they work even
    // while the hand cursor happens to hover the UI.)
    // Mouse / touch have no open hand: letting go of the right button or of the
    // long-press is the release (a lifted finger may leave the input inactive).
    const letGo = this.fistSource === 'mouse' && input.events.has('fistend');
    const opened = (active && input.open) || letGo;
    if (!fist && opened && this.charge > 0.12 && this.sinceFist < 3) this.release(this.charge);
    if (input.events.has('victorystart')) {
      this.setPalette(PALETTES[(this.paletteIndex + 1) % PALETTES.length].name, true);
    }

    // ------------------------------------------------ simulation clocks
    const spin = this.settings.spin;
    this.clockValue += dt * spin * (1 + 3 * this.feed);
    this.flash *= Math.exp(-4 * dt);
    this.jetBurst *= Math.exp(-1.1 * dt);
    this.jetClock += dt * (0.6 + 2.5 * this.jetBurst) * Math.max(spin, 0.2);
    const jetTarget = (this.settings.jets ? 0.45 : 0) + this.jetBurst * 1.6;
    this.jetLevel += (jetTarget - this.jetLevel) * damp(4, dt);
    this.jets.visible = this.jetLevel > 0.004;

    const massTarget = 1 + 0.16 * this.feed + 0.06 * this.charge;
    this.mass += (massTarget - this.mass) * damp(1.5, dt);

    // Release shock: a thick white-hot front sweeps the disk in ~1.6 s (still
    // rolling after the flash has faded), the blast carries on through the dust.
    const shock = this.u.uShock.value;
    const shockDust = this.u.uShockDust.value;
    if (this.shock) {
      const s = this.shock;
      s.t += dt;
      const kd = Math.min(s.t / 1.6, 1);
      shock.set(R_IN + (R_OUT + 6 - R_IN) * (1 - Math.pow(1 - kd, 1.6)), s.power * Math.pow(1 - kd, 1.3), 0.6 + 0.5 * kd, 0);
      const ku = Math.min(s.t / 2.8, 1);
      shockDust.set(R_IN + 42 * (1 - Math.pow(1 - ku, 2)), s.power * Math.pow(1 - ku, 1.6), 1.4 + 3 * s.t, 0);
      if (ku >= 1) this.shock = null;
    } else {
      shock.set(0, 0, 1, 0);
      shockDust.set(0, 0, 1, 0);
    }

    this.updateCamera(dt);
    this.updateUniforms(dt);

    // Shadow passes: only needed while the bloom is on. The mask has to run
    // after the bloom; the App rebuilds its pass list on scene / glow changes,
    // so (re)attach it every frame (no-op when already there).
    const bloom = this.app.bloomPass;
    this.shadowFx.enabled = !!bloom?.enabled;
    this.shadowFx.attach(this.app.composer, bloom);
  }

  release(power) {
    const p = Math.max(0.45, power);
    this.shock = { t: 0, power: 1.2 * p };
    this.flash = Math.max(this.flash, p);
    this.jetBurst = Math.max(this.jetBurst, p);
    this.charge = 0;
    this.sinceFist = 99;
  }

  updateCamera(dt) {
    const c = this.cam;
    const az = c.autoAz + c.spinAz + c.handAz;
    const incl = clamp(c.handIncl + c.dragIncl, MIN_INCL, MAX_INCL);
    c.az = az;
    c.incl = incl;
    const targetDist = clamp(BASE_DIST * this.fit * c.userZoom * c.depthZoom, 13, 80);
    c.dist += (targetDist - c.dist) * (dt > 0 ? damp(4, dt) : 1);
    c.roll += (this.settings.tilt * DEG - c.roll) * (dt > 0 ? damp(4, dt) : 1);

    const d = c.dist;
    this.camera.position.set(d * Math.cos(incl) * Math.sin(az), d * Math.sin(incl), d * Math.cos(incl) * Math.cos(az));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotateZ(c.roll);
    this.camera.updateMatrixWorld();
  }

  updateUniforms(dt) {
    const u = this.u;
    const s = this.settings;
    const cam = this.camera;

    u.uClock.value = this.clockValue;
    u.uJetClock.value = this.jetClock;
    u.uHoleView.value.set(0, 0, 0).applyMatrix4(cam.matrixWorldInverse);
    u.uFeed.value = this.feed;
    u.uFlash.value = this.flash;
    u.uSize.value = 7 * s.size * this.sizeComp;
    u.uBright.value = s.brightness * this.brightComp * this.paletteGain;
    u.uDust.value = 0.075 * this.brightComp;
    u.uRs.value = RS * this.mass;
    u.uRing.value = RING * this.mass;
    u.uLensA.value = 3 * s.lensing * this.mass * this.mass;
    u.uLensStar.value = 2.5 * s.lensing;
    u.uStreams.value = 0.45 + 1.6 * this.feed;
    u.uJet.value = this.jetLevel;
    u.uRingBright.value = (0.9 + 0.6 * this.feed + 1.6 * this.flash) * Math.sqrt(s.brightness);

    // Edge-on, the disk piles up along the line of sight: tone it down a bit.
    const sinI = Math.abs(Math.sin(this.cam.incl));
    u.uViewGain.value = 0.27 + 0.73 * THREE.MathUtils.smoothstep(sinI, 0.02, 0.8);

    // Side of the disk that moves toward us (for the photon ring's Doppler tint).
    const az = this.cam.az;
    this.tmp.set(Math.cos(az), 0, -Math.sin(az)).transformDirection(cam.matrixWorldInverse);
    u.uBeamDir.value.set(this.tmp.x, this.tmp.y);
    if (u.uBeamDir.value.lengthSq() > 1e-6) u.uBeamDir.value.normalize();

    // Palette cross-fade.
    const k = damp(4, dt);
    [u.uCol0, u.uCol1, u.uCol2, u.uCol3].forEach((uc, i) => uc.value.lerp(this.paletteTarget[i], k));
    this.paletteGain += (PALETTES[this.paletteIndex].gain - this.paletteGain) * k;

    // Billboards (photon ring, shadow disc) face the camera; horizon grows with the mass.
    for (const m of [this.ring, this.shadow]) m.quaternion.copy(cam.quaternion);
    this.shadow.scale.setScalar(RING * this.mass * 0.985);
    this.horizon.scale.setScalar(this.mass);
    // On-screen radius of the shadow (it sits at the centre of the screen).
    const depth = Math.max(-u.uHoleView.value.z, 1);
    this.shadowFx.radiusNdc = (RING * this.mass) / (depth * Math.tan((cam.fov * DEG) / 2));
  }
}
