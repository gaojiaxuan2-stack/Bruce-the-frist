// Live Mirror ("Particleify"): the webcam - or the user's photo, or any image /
// video file - rebuilt from ~110k glowing particles. Brightness becomes depth, so
// the picture is a 3D relief; MediaPipe removes the background so the person
// floats in front while the rest drifts away as dust.
//
// Hand:  point = push a hole, pinch + move = tilt the relief, fist = pull all
// particles into a swirling ball, open palm after a fist = explode,
// hand closer / farther = more / less depth, peace sign = next style.
import * as THREE from 'three';
import { BaseScene } from '../core/BaseScene.js';
import { vertexShader, fragmentShader, VOID_COUNT, STYLE_IDS } from './mirror/shaders.js';
import { PersonSegmenter } from './mirror/PersonSegmenter.js';
import { MirrorUi } from './mirror/ui.js';

const STYLES = Object.keys(STYLE_IDS);
const PHOTO_URL = new URL('../../assets/face/color.jpg', import.meta.url).href;
const PHOTO_DATA_URL = new URL('../../assets/face/data.png', import.meta.url).href;

/** Settings live at module level so they survive a quality change (which rebuilds the scene). */
const PARAMS = { style: 'Matrix', removeBg: true, depth: 1, size: 1, brightness: 1 };
/** The last image / video the user loaded (the File, not its object URL) - reopened after a rebuild. */
let lastFile = null;

const BASE_COUNT = 110000;
const BASE_DEPTH = 2.2; // world units of relief at "3D depth" = 1
const INTRO_SECONDS = 1.8;
const CHARGE_SECONDS = 1.6; // after a fist, an open palm within this time explodes
const BLAST_SECONDS = 5;
const BALL_Z = 1.2; // the ball floats this far in front of the sheet
// Background removal switches on only when a real person (head + shoulders ~ 0.3 of
// the frame) has been seen for a moment; a hand alone (<= ~0.12) never triggers it.
const PERSON_ON = { coverage: 0.16, seconds: 0.5 };
const PERSON_OFF = { coverage: 0.08, seconds: 1.5 };

const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _v3b = new THREE.Vector3();
const _v2a = new THREE.Vector2();
const _v3 = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const damp = (x, target, k, dt) => x + (target - x) * (1 - Math.exp(-k * dt));

/**
 * Webcam / file video as a texture. Mipmaps are on so the shader can read a cheap,
 * smooth blur (relief) and an anti-aliased colour for any particle density.
 */
function videoTexture(video) {
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Damped spring (semi-implicit Euler with fixed sub-steps so it is stable at any frame rate). */
class Spring {
  constructor(stiffness, damping, value = 0) {
    this.k = stiffness;
    this.c = damping;
    this.x = value;
    this.v = 0;
  }

  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.k * (target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

export default class MirrorScene extends BaseScene {
  static meta = {
    id: 'mirror',
    title: 'Live Mirror',
    subtitle: 'You, made of particles — live from your camera',
    icon: '🪞',
    hints: [
      { icon: '☝️', gesture: 'Point', text: 'push a hole in the particles' },
      { icon: '🤏', gesture: 'Pinch + move', text: 'tilt the 3D picture' },
      { icon: '✊', gesture: 'Fist', text: 'pull all particles into a ball' },
      { icon: '✋', gesture: 'Open hand', text: 'after a fist: explode!' },
      { icon: '↕️', gesture: 'Hand closer / farther', text: 'more / less 3D depth' },
      { icon: '✌️', gesture: 'Peace', text: 'change the color style' },
    ],
    bloom: { strength: 0.7, radius: 0.45, threshold: 0.85 },
  };

  constructor(app) {
    super(app);
    this.params = PARAMS;
    this.actions = {
      load: () => this.ui.pickFile(),
      camera: () => this.useCamera(),
    };

    /** 'auto' = live camera when available, else the photo; 'file' = the loaded file. */
    this.mode = 'auto';
    this.current = null;
    this.photo = null;
    this.cam = null;
    this.camVideo = null;
    this.file = null;
    this.isActive = false;
    this.layoutDirty = true;
    this.grid = null;
    this.viewH = 9.3;

    // interaction state
    this.tiltX = new Spring(38, 7.5);
    this.tiltY = new Spring(38, 7.5);
    this.tiltTarget = new THREE.Vector2();
    this.voidPos = new THREE.Vector2();
    this.voidLast = new THREE.Vector2();
    this.voidStrength = new Spring(90, 11);
    this.voidSeen = false;
    this.pointHold = 0;
    this.ghostTimer = 0;
    this.ghostIndex = 0;
    this.ghosts = Array.from({ length: VOID_COUNT - 1 }, () => ({ x: 0, y: 0, r: 1, s0: 0, age: 99 }));
    this.collapse = 0;
    this.fistPos = new THREE.Vector3();
    this.fistSeen = false;
    this.wasFist = false;
    this.charged = 0;
    this.blastT = -1;
    this.blastCenter = new THREE.Vector3();
    this.depthF = 1;
    this.wave = 1;
    this.intro = 0;
    this.maskOn = 0;
    this.cameraBusy = false;
    this.segWarned = false;
    this.personSeen = false;
    this.personTimer = 0;
  }

  // ------------------------------------------------------------------ setup

  async init() {
    const loader = new THREE.TextureLoader();
    const [photoTex, dataTex] = await Promise.all([loader.loadAsync(PHOTO_URL), loader.loadAsync(PHOTO_DATA_URL)]);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    dataTex.colorSpace = THREE.NoColorSpace;
    this.photo = {
      kind: 'photo',
      texture: photoTex,
      width: photoTex.image.width,
      height: photoTex.image.height,
      flipX: false,
      linear: true,
      mask: dataTex,
    };

    this.segmenter = new PersonSegmenter();
    this.ui = new MirrorUi({ onCamera: () => this.useCamera(), onFile: (f) => this.loadFile(f) });

    const voids = Array.from({ length: VOID_COUNT }, () => new THREE.Vector4(0, 0, 1, 0));
    this.uniforms = {
      ...this.app.sharedUniforms,
      uFovScale: { value: 1 / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) },
      uTanHalf: { value: Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) },
      uCamDist: { value: this.camera.position.z },
      uMap: { value: photoTex },
      uMapLinear: { value: 1 },
      uLod: { value: 0 },
      uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFlipX: { value: 0 },
      uMaskA: { value: dataTex },
      uMaskB: { value: dataTex },
      uMaskBlend: { value: 0 },
      uMaskSel: { value: new THREE.Vector4(0, 1, 0, 0) },
      uMaskFlipY: { value: 0 },
      uMaskOn: { value: 0 },
      uSheet: { value: new THREE.Vector2(10, 7) },
      uGrid: { value: new THREE.Vector2(100, 100) },
      uSpacing: { value: 0.03 },
      uSize: { value: 1.6 },
      uGain: { value: 1 },
      uDepth: { value: BASE_DEPTH },
      uPop: { value: 0.6 },
      uWave: { value: 1 },
      uIntro: { value: 0 },
      uStyle: { value: STYLE_IDS[this.params.style] },
      uFacing: { value: 1 },
      uVoids: { value: voids },
      uVoidOn: { value: 0 },
      uFist: { value: new THREE.Vector4(0, 0, 1, 1.2) },
      uCollapse: { value: 0 },
      uBlast: { value: new THREE.Vector4(0, 0, 0, 0) },
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
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.camera.updateMatrixWorld();
    this.setSource(this.photo);
    // a quality change rebuilds the scene: bring back the file the user had open
    if (lastFile) this.loadFile(lastFile, true);
  }

  buildGui(folder) {
    this.styleCtrl = folder
      .add(this.params, 'style', STYLES)
      .name('Style')
      .onChange((s) => (this.uniforms.uStyle.value = STYLE_IDS[s]));
    folder.add(this.params, 'removeBg').name('Remove background');
    this.depthCtrl = folder.add(this.params, 'depth', 0, 3, 0.01).name('3D depth');
    folder.add(this.params, 'size', 0.4, 2.5, 0.01).name('Particle size');
    folder.add(this.params, 'brightness', 0.2, 2.5, 0.01).name('Brightness');
    folder.add(this.actions, 'load').name('Load image or video…');
    folder.add(this.actions, 'camera').name('Use camera');
  }

  enter() {
    this.isActive = true;
    this.intro = 0;
    this.layoutDirty = true;
    if (this.file?.video) this.file.video.play().catch(() => {});
  }

  exit() {
    this.isActive = false;
    this.ui.setCtaVisible(false, true);
    this.file?.video?.pause();
  }

  resize(width, height) {
    super.resize(width, height);
    this.layoutDirty = true;
  }

  dispose() {
    this.disposed = true;
    super.dispose();
    this.ui?.dispose();
    this.segmenter?.close();
    this.photo?.texture.dispose();
    this.photo?.mask.dispose();
    this.dropCamera();
    this.dropFile();
  }

  // ---------------------------------------------------------------- sources

  /** GUI / CTA: go (back) to the live camera, starting it if needed. */
  useCamera() {
    this.mode = 'auto';
    lastFile = null;
    if (this.app.input.video || this.cameraBusy) return;
    this.cameraBusy = true;
    this.ui.setBusy(true);
    Promise.resolve()
      .then(() => this.app.startHands())
      .then(() => this.ui.setNote(null))
      .catch(() => {
        // App.startHands has already explained why in a toast; only update the note under the button
        this.ui.setNote('No camera yet — this is your photo. The mouse works too.');
      })
      .finally(() => {
        this.cameraBusy = false;
        this.ui.setBusy(false);
      });
  }

  /** @param {File} file @param {boolean} [quiet] reopening after a rebuild: no toast */
  async loadFile(file, quiet = false) {
    const url = URL.createObjectURL(file);
    try {
      let src;
      if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = url;
        await new Promise((resolve, reject) => {
          video.addEventListener('loadeddata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('unsupported video')), { once: true });
        });
        await video.play().catch(() => {});
        const tex = videoTexture(video);
        src = { kind: 'file', texture: tex, video, width: video.videoWidth, height: video.videoHeight, flipX: false, linear: false, url };
      } else {
        const img = new Image();
        img.src = url;
        await img.decode();
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        src = { kind: 'file', texture: tex, width: img.naturalWidth, height: img.naturalHeight, flipX: false, linear: true, url };
      }
      if (!src.width || !src.height) throw new Error('empty picture');
      if (this.disposed) {
        src.texture.dispose();
        src.video?.removeAttribute('src');
        URL.revokeObjectURL(url);
        return;
      }
      this.dropFile();
      this.file = src;
      lastFile = file;
      if (!this.isActive) src.video?.pause();
      this.mode = 'file';
      if (!quiet) this.app.hud.toast(`Showing “${file.name}” — “Use camera” goes back`, 3000);
    } catch (err) {
      URL.revokeObjectURL(url);
      console.warn('Mirror: could not open file', err);
      if (quiet) lastFile = null;
      else this.app.hud.toast('Sorry, that file could not be opened. Try a JPG, PNG or MP4.', 3500);
    }
  }

  dropFile() {
    const f = this.file;
    if (!f) return;
    if (this.current === f) this.current = null;
    f.texture.dispose();
    if (f.video) {
      f.video.pause();
      f.video.removeAttribute('src');
      f.video.load();
    }
    URL.revokeObjectURL(f.url);
    this.file = null;
  }

  dropCamera() {
    if (!this.cam) return;
    if (this.current === this.cam) this.current = null;
    this.cam.texture.dispose();
    this.cam = null;
  }

  /** Follow the webcam (cheap: a couple of comparisons per frame) and pick the source to show. */
  syncSources() {
    const video = this.app.input.video;
    if (video !== this.camVideo) {
      this.dropCamera();
      this.camVideo = video;
      this.segmenter.reset();
    }
    if (video && !this.cam && video.videoWidth > 0 && video.readyState >= 2) {
      // (no toast here: App.startHands already says the camera is on)
      this.cam = { kind: 'camera', texture: videoTexture(video), video, width: video.videoWidth, height: video.videoHeight, flipX: true, linear: false };
    }
    if (this.cam && (this.cam.width !== video.videoWidth || this.cam.height !== video.videoHeight) && video.videoWidth > 0) {
      this.cam.width = video.videoWidth;
      this.cam.height = video.videoHeight;
      this.layoutDirty = true;
    }
    if (this.mode === 'file' && !this.file) this.mode = 'auto';
    const want = this.mode === 'file' ? this.file : this.cam || this.photo;
    if (want !== this.current) this.setSource(want);
  }

  setSource(src) {
    const changed = this.current !== src;
    this.current = src;
    const u = this.uniforms;
    u.uMap.value = src.texture;
    u.uMapLinear.value = src.linear ? 1 : 0;
    u.uFlipX.value = src.flipX ? 1 : 0;
    this.layoutDirty = true;
    if (changed) {
      this.intro = Math.min(this.intro, 0.15);
      this.maskOn = 0; // a mask belongs to its own source
      this.personSeen = false;
      this.personTimer = 0;
    }
  }

  // ---------------------------------------------------------------- layout

  /** Cover-fit the source into the view and (re)build the particle grid for the visible part. */
  layout() {
    const src = this.current;
    if (!src) return;
    const cam = this.camera;
    const vh = 2 * cam.position.z * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const vw = vh * cam.aspect;
    this.viewH = vh;
    const as = src.width / src.height;
    let w0 = vw;
    let h0 = vw / as;
    if (h0 > vh) {
      h0 = vh;
      w0 = vh * as;
    }
    const cover = Math.max(vw / w0, vh / h0);
    const k = Math.min(cover, cam.aspect < 1 ? 1.6 : 1.3);
    const W = w0 * k;
    const H = h0 * k;
    const cw = Math.min(W, vw);
    const ch = Math.min(H, vh);
    const aspect = cw / ch;
    const n = this.count(BASE_COUNT);
    if (!this.grid || this.grid.n !== n || Math.abs(aspect - this.grid.aspect) / aspect > 0.01) {
      // rebuilding 110k particles is cheap but not free: at most ~4x a second while a window is resized
      const now = performance.now();
      if (!this.grid || now - this.grid.builtAt > 250) this.buildGrid(n, aspect);
      else this.layoutDirty = true;
    }

    const u = this.uniforms;
    const { cols, rows } = this.grid;
    u.uSheet.value.set(cw, ch);
    u.uGrid.value.set(cols, rows);
    u.uUvRect.value.set((1 - cw / W) / 2, (1 - ch / H) / 2, cw / W, ch / H);
    u.uSpacing.value = cw / cols;
    // mip level where one texel ~ one particle (keeps big photos from sparkling)
    const texelsPerParticle = ((cw / W) * src.width) / cols;
    u.uLod.value = Math.max(0, Math.log2(texelsPerParticle));
  }

  buildGrid(n, aspect) {
    const cols = Math.max(16, Math.round(Math.sqrt(n * aspect)));
    const rows = Math.max(16, Math.round(n / cols));
    const total = cols * rows;
    const pos = new Float32Array(total * 3);
    const rnd = new Float32Array(total * 4);
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        // jittered grid: even coverage without visible rows
        pos[i * 3] = clamp((x + 0.5 + (Math.random() - 0.5) * 0.9) / cols, 0, 1);
        pos[i * 3 + 1] = clamp((y + 0.5 + (Math.random() - 0.5) * 0.9) / rows, 0, 1);
        rnd[i * 4] = Math.random();
        rnd[i * 4 + 1] = Math.random();
        rnd[i * 4 + 2] = Math.random();
        rnd[i * 4 + 3] = Math.random();
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    this.points.geometry.dispose();
    this.points.geometry = geo;
    this.grid = { n, aspect, cols, rows, builtAt: performance.now() };
  }

  /**
   * NDC -> point on the (tilted) sheet's plane z = planeZ, in the sheet's own
   * coordinates: something placed there shows up exactly under the cursor.
   */
  toSheet(ndc, planeZ, target) {
    _ray.origin.copy(this.camera.position);
    _ray.direction.set(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    _inv.copy(this.points.matrixWorld).invert();
    _ray.applyMatrix4(_inv);
    _plane.constant = -planeZ;
    if (!_ray.intersectPlane(_plane, _v3b)) this.ndcToWorld(ndc, planeZ, _v3b);
    return target.set(_v3b.x, _v3b.y, planeZ);
  }

  // ---------------------------------------------------------------- frame

  update(dt, time, input) {
    if (!this.uniforms) return;
    this.syncSources();
    if (this.layoutDirty) {
      this.layoutDirty = false;
      this.layout();
    }
    const u = this.uniforms;
    const vs = this.viewH / 9.326; // world units scale with the view
    // hand-sized effects (void, ball) follow the short side so they fit on a phone held upright
    const hs = Math.max(0.6, Math.min(1, this.camera.aspect)) * vs;

    // ---- input
    const ui = input.uiCaptured;
    const hand = input.source === 'hand';
    const on = input.active;
    const pinching = on && input.pinching && !ui;
    const fist = on && input.fist && !ui;
    const pointLike = hand ? input.gesture === 'point' : input.source === 'mouse';
    this.pointHold = on && !ui && !pinching && !fist && pointLike && this.collapse < 0.08 ? 0.15 : Math.max(0, this.pointHold - dt);
    const pointing = this.pointHold > 0;

    // ---- pinch + drag: tilt the sheet, springs back on release
    if (pinching) {
      this.tiltTarget.x = clamp(this.tiltTarget.x - input.dragDelta.y * 2, -0.95, 0.95);
      this.tiltTarget.y = clamp(this.tiltTarget.y + input.dragDelta.x * 2, -0.95, 0.95);
    } else {
      this.tiltTarget.set(0, 0);
    }
    this.wave = damp(this.wave, on ? 0.2 : 1, 1.5, dt);
    const swayX = Math.sin(time * 0.37) * 0.07 * this.wave;
    const swayY = Math.sin(time * 0.23 + 1.3) * 0.13 * this.wave;
    this.points.rotation.x = this.tiltX.step(this.tiltTarget.x + swayX, dt);
    this.points.rotation.y = this.tiltY.step(this.tiltTarget.y + swayY, dt);
    this.points.updateMatrixWorld();
    const tiltAmount = Math.min(1, Math.hypot(this.points.rotation.x, this.points.rotation.y) * 2);
    u.uFacing.value = Math.max(0.35, Math.cos(this.points.rotation.x) * Math.cos(this.points.rotation.y));

    // ---- point: a big soft void that follows the fingertip, with a springy trail.
    // Voids live in screen units (NDC x aspect, y) - the shader compares each particle's
    // projected position, so the hole is exactly under the finger at any depth / tilt.
    const R = (1.35 * hs * 2) / this.viewH;
    if (pointing) {
      const p = _v2a.set(input.pointer.x * this.camera.aspect, input.pointer.y);
      if (!this.voidSeen) {
        this.voidPos.copy(p);
        this.voidLast.copy(p);
        this.voidSeen = true;
      }
      this.voidPos.x = damp(this.voidPos.x, p.x, 22, dt);
      this.voidPos.y = damp(this.voidPos.y, p.y, 22, dt);
    } else if (this.voidStrength.x < 0.02 && Math.abs(this.voidStrength.v) < 0.05) {
      this.voidSeen = false;
    }
    const strength = this.voidStrength.step(pointing ? 1 : 0, dt);
    this.ghostTimer += dt;
    if (strength > 0.3 && this.ghostTimer > 0.035 && this.voidPos.distanceTo(this.voidLast) > R * 0.28) {
      const g = this.ghosts[this.ghostIndex];
      this.ghostIndex = (this.ghostIndex + 1) % this.ghosts.length;
      g.x = this.voidLast.x;
      g.y = this.voidLast.y;
      g.r = R * 0.92;
      g.s0 = strength * 0.85;
      g.age = 0;
      this.voidLast.copy(this.voidPos);
      this.ghostTimer = 0;
    }
    if (!pointing) this.voidLast.copy(this.voidPos);
    const voids = u.uVoids.value;
    voids[0].set(this.voidPos.x, this.voidPos.y, R, strength);
    let voidOn = Math.abs(strength) > 1e-3;
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      g.age += dt;
      const s = g.age < 1.8 ? g.s0 * Math.exp(-3.2 * g.age) * Math.cos(5.5 * g.age) : 0;
      voids[i + 1].set(g.x, g.y, g.r, s);
      if (Math.abs(s) > 1e-3) voidOn = true;
    }
    u.uVoidOn.value = voidOn ? 1 : 0;

    // ---- fist: pull everything into a swirling ball; open palm afterwards: explode
    if (fist) {
      // centred on the hand cursor (input.pointer), on the plane where the ball floats
      const p = this.toSheet(input.pointer, BALL_Z * vs, _v3);
      if (!this.fistSeen) this.fistPos.copy(p);
      this.fistSeen = true;
      this.fistPos.x = damp(this.fistPos.x, p.x, 10, dt);
      this.fistPos.y = damp(this.fistPos.y, p.y, 10, dt);
      this.fistPos.z = BALL_Z * vs;
      this.collapse = Math.min(1, this.collapse + dt * 0.9);
      this.charged = 0;
    } else {
      this.fistSeen = false;
      if (this.wasFist && this.collapse > 0.25) {
        if (input.source === 'mouse') this.explode();
        else this.charged = CHARGE_SECONDS;
      }
      if (this.charged > 0 && on && (input.open || input.events.has('openstart'))) this.explode();
      this.charged = Math.max(0, this.charged - dt);
      const release = this.blastT >= 0 ? 1.1 : this.charged > 0 ? 0.15 : 0.7;
      this.collapse = Math.max(0, this.collapse - dt * release);
    }
    this.wasFist = fist;
    u.uCollapse.value = this.collapse;
    u.uFist.value.set(this.fistPos.x, this.fistPos.y, this.fistPos.z, 1.25 * hs * (1 + 0.05 * Math.sin(time * 5)));

    if (this.blastT >= 0) {
      this.blastT += dt;
      const b = (1 - Math.exp(-this.blastT * 9)) * Math.exp(-this.blastT * 1.25);
      u.uBlast.value.set(this.blastCenter.x, this.blastCenter.y, this.blastCenter.z, b * vs);
      if (this.blastT > BLAST_SECONDS) {
        this.blastT = -1;
        u.uBlast.value.w = 0;
      }
    }

    // ---- depth: GUI slider (also moved by the wheel / two-hand zoom) x hand distance (+ a bit more while tilting)
    if (input.zoom && !ui) {
      const d = this.params.depth;
      const next = clamp(d + Math.max(d, 0.3) * (Math.exp(input.zoom * 1.5) - 1), 0, 3);
      if (next !== d) {
        this.params.depth = next;
        this.depthCtrl?.updateDisplay();
      }
    }
    this.depthF = damp(this.depthF, hand ? 0.3 + 1.4 * clamp(input.depth, 0, 1) : 1, 3, dt);
    u.uDepth.value = BASE_DEPTH * vs * this.params.depth * this.depthF * (1 + 0.5 * tiltAmount);

    // ---- peace sign: next style
    if (input.events.has('victorystart')) {
      const next = STYLES[(STYLES.indexOf(this.params.style) + 1) % STYLES.length];
      this.params.style = next;
      u.uStyle.value = STYLE_IDS[next];
      this.styleCtrl?.updateDisplay();
      this.app.hud.toast(`✌️ Style: ${next}`);
    }

    // ---- background removal
    const src = this.current;
    let maskReady = false;
    if (this.params.removeBg && src.kind === 'camera') {
      if (this.isActive) this.segmenter.update(src.video, performance.now());
      if (this.segmenter.failed && !this.segWarned) {
        this.segWarned = true;
        this.app.hud.toast('Background removal is not available on this device', 3500);
      }
      // nobody in the picture (e.g. only a hand): show everything instead of an empty screen.
      // Time-based hysteresis so the wall does not fade in and out with every gesture.
      if (this.segmenter.hasMask) {
        const cov = this.segmenter.coverage;
        const rule = this.personSeen ? PERSON_OFF : PERSON_ON;
        const flipping = this.personSeen ? cov < rule.coverage : cov > rule.coverage;
        this.personTimer = flipping ? this.personTimer + dt : 0;
        if (this.personTimer >= rule.seconds) {
          this.personSeen = !this.personSeen;
          this.personTimer = 0;
        }
      }
      maskReady = this.segmenter.hasMask && this.personSeen;
      if (maskReady) {
        u.uMaskA.value = this.segmenter.prev;
        u.uMaskB.value = this.segmenter.next;
        u.uMaskBlend.value = this.segmenter.blend;
        u.uMaskSel.value.set(1, 0, 0, 0);
        u.uMaskFlipY.value = 1;
      }
    } else if (this.params.removeBg && src.kind === 'photo') {
      maskReady = true;
      u.uMaskA.value = u.uMaskB.value = src.mask;
      u.uMaskBlend.value = 0;
      u.uMaskSel.value.set(0, 1, 0, 0);
      u.uMaskFlipY.value = 0;
    }
    this.maskOn = maskReady ? damp(this.maskOn, 1, 2.5, dt) : damp(this.maskOn, 0, 4, dt);
    if (!maskReady && this.maskOn < 0.002) this.maskOn = 0;
    u.uMaskOn.value = this.maskOn;
    u.uPop.value = 0.7 * vs * this.params.depth * this.depthF;

    // ---- look
    this.intro = Math.min(1, this.intro + dt / INTRO_SECONDS);
    u.uIntro.value = this.intro;
    u.uWave.value = this.wave;
    u.uSize.value = 1.25 * this.params.size;
    // keep the overall brightness the same whatever the particle size / density
    const coverage = 0.37 * u.uSize.value * u.uSize.value;
    u.uGain.value = (this.params.brightness * 0.66) / Math.max(coverage, 0.3);

    // ---- camera call-to-action while only the photo is showing
    this.ui.setCtaVisible(this.isActive && src.kind === 'photo' && !this.app.input.video);
    if (!this.cameraBusy) this.ui.setBusy(!!this.app.input.handStarting);
  }

  explode() {
    this.blastT = 0;
    this.charged = 0;
    this.blastCenter.copy(this.fistPos);
  }
}

