import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';
import { SCENES, VISIBLE_SCENES } from './registry.js';
import { InputManager } from '../input/InputManager.js';
import { Hud } from '../ui/Hud.js';

const QUALITY = {
  low: { particles: 0.35, pixelRatio: 1 },
  medium: { particles: 0.65, pixelRatio: 1.5 },
  high: { particles: 1, pixelRatio: 2 },
};
const FADE_MS = 260;

export class App {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const q = this.params.get('quality');
    this.quality = QUALITY[q] ? q : this.isMobile ? 'low' : 'high';
    this.settings = { swipe: true, showPreview: true, bloom: true };

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    /** Uniform objects shared by every particle shader (App keeps them current). */
    this.sharedUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uViewportHeight: { value: this.height },
    };

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.8, 0.4, 0.1);
    this.outputPass = new OutputPass();
    this.applySize();

    this.input = new InputManager(this);
    this.hud = new Hud(this, VISIBLE_SCENES);
    this.buildGui();

    /** @type {Map<string, {instance: import('./BaseScene.js').BaseScene, folder: GUI}>} */
    this.scenes = new Map();
    this.loading = new Map();
    this.activeId = null;
    this.active = null;
    this.navToken = 0;
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.fpsSamples = [];
    this.lowFpsTime = 0;
    this.noHandTime = 0;

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get particleScale() {
    return QUALITY[this.quality].particles;
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio);
  }

  // ---------------------------------------------------------------- scenes

  next() {
    const list = VISIBLE_SCENES;
    const i = list.findIndex((s) => s.id === this.activeId);
    return this.goTo(list[(i + 1) % list.length].id);
  }

  prev() {
    const list = VISIBLE_SCENES;
    const i = list.findIndex((s) => s.id === this.activeId);
    return this.goTo(list[(i - 1 + list.length) % list.length].id);
  }

  async loadScene(id) {
    if (this.scenes.has(id)) return this.scenes.get(id);
    if (!this.loading.has(id)) {
      const entry = SCENES.find((s) => s.id === id);
      const p = (async () => {
        const mod = await entry.load();
        const SceneClass = mod.default;
        const instance = new SceneClass(this);
        await instance.init();
        instance.resize(this.width, this.height);
        const folder = this.gui.addFolder(SceneClass.meta.title);
        instance.buildGui(folder);
        folder.hide();
        const rec = { instance, folder };
        this.scenes.set(id, rec);
        return rec;
      })().finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return this.loading.get(id);
  }

  /** Switch to a scene by id (fades out, lazy-loads, fades in). Latest call wins. */
  async goTo(id) {
    if (!SCENES.some((s) => s.id === id)) id = SCENES[0].id;
    if (id === this.activeId) return;
    const token = ++this.navToken;
    const fade = document.getElementById('fade');
    const first = !this.active;
    if (!first) fade.classList.add('on');
    this.hud.setActive(id, SCENES.find((s) => s.id === id));

    let rec;
    try {
      [rec] = await Promise.all([this.loadScene(id), first ? null : wait(FADE_MS)]);
    } catch (err) {
      console.error(`Scene "${id}" failed to load`, err);
      this.hud.toast(`Couldn't open ${id}: ${err.message || err}`, 4000);
      fade.classList.remove('on');
      if (this.activeId) this.hud.setActive(this.activeId, this.active.meta);
      return;
    }
    if (token !== this.navToken) return;

    if (this.active) {
      this.active.exit();
      this.scenes.get(this.activeId)?.folder.hide();
    }
    this.active = rec.instance;
    this.activeId = id;
    rec.folder.show();
    this.active.resize(this.width, this.height);
    this.active.enter();
    this.configurePasses();
    this.hud.setActive(id, this.active.meta);
    const url = new URL(location.href);
    url.searchParams.set('scene', id);
    history.replaceState(null, '', url);
    fade.classList.remove('on');
    this.fpsSamples.length = 0;
    this.lowFpsTime = 0;
  }

  configurePasses() {
    const s = this.active;
    for (const p of [...this.composer.passes]) this.composer.removePass(p);
    this.renderPass.scene = s.scene;
    this.renderPass.camera = s.camera;
    this.composer.addPass(this.renderPass);
    for (const p of s.passes) this.composer.addPass(p);
    const b = s.meta.bloom || {};
    this.bloomPass.strength = b.strength ?? 0.8;
    this.bloomPass.radius = b.radius ?? 0.4;
    this.bloomPass.threshold = b.threshold ?? 0.1;
    this.bloomPass.enabled = this.settings.bloom && this.bloomPass.strength > 0;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.bloomController?.setValue(this.bloomPass.strength);
  }

  /** Drop every built scene and rebuild the active one (used when quality changes). */
  async rebuildScenes() {
    const id = this.activeId;
    for (const { instance, folder } of this.scenes.values()) {
      if (instance === this.active) instance.exit();
      instance.dispose();
      folder.destroy();
    }
    this.scenes.clear();
    this.active = null;
    this.activeId = null;
    if (id) await this.goTo(id);
  }

  // ---------------------------------------------------------------- hands

  async startHands() {
    this.hud.setCameraState(false, true);
    try {
      await this.input.startHands();
      this.hud.setCameraState(true);
      this.hud.toast('✋ Hand control on — hold your hand up to the camera');
      return true;
    } catch (err) {
      console.error('Hand tracking failed to start', err);
      this.hud.setCameraState(false);
      this.hud.toast(cameraErrorMessage(err), 5000);
      throw err;
    }
  }

  toggleHands() {
    if (this.input.handsRunning) {
      this.input.stopHands();
      this.hud.setCameraState(false);
      this.hud.setStatus('');
      return Promise.resolve(false);
    }
    return this.startHands().catch(() => false);
  }

  // ---------------------------------------------------------------- loop

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
    this.sharedUniforms.uTime.value = this.elapsed;

    const input = this.input.update(dt);
    if (this.settings.swipe && !input.uiCaptured) {
      if (input.events.has('swipeleft')) this.next();
      else if (input.events.has('swiperight')) this.prev();
    }
    this.updateStatus(dt, input);

    if (this.active) {
      this.active.update(dt, this.elapsed, input);
      this.composer.render(dt);
      this.watchFps(dt);
    }
  }

  updateStatus(dt, input) {
    if (!this.input.handsRunning) return;
    if (input.source === 'hand') {
      this.noHandTime = 0;
      const g = GESTURE_LABEL[input.gesture] || '';
      this.hud.setStatus(`✋ Tracking${input.twoHands ? ' 2 hands' : ''}${g ? ' · ' + g : ''}`, 'ok');
    } else {
      this.noHandTime += dt;
      if (this.noHandTime > 0.8) this.hud.setStatus('Show your hand to the camera ✋', 'warn');
    }
  }

  /** Step quality down once if the device clearly can't keep up. */
  watchFps(dt) {
    if (this.quality === 'low' || this.params.get('quality')) return;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 90) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    this.lowFpsTime = 1 / avg < 28 ? this.lowFpsTime + 1 : 0;
    if (this.lowFpsTime >= 3) {
      this.lowFpsTime = 0;
      this.setQuality(this.quality === 'high' ? 'medium' : 'low');
      this.hud.toast(`Lowered quality to “${this.quality}” for smoother motion`);
    }
  }

  setQuality(q) {
    if (!QUALITY[q]) return;
    this.quality = q;
    this.qualityController?.updateDisplay();
    this.applySize();
    this.rebuildScenes();
  }

  // ---------------------------------------------------------------- misc

  buildGui() {
    this.gui = new GUI({ title: 'Controls' });
    if (this.isMobile || this.width < 720) this.gui.close();
    const g = this.gui.addFolder('Global');
    this.qualityController = g
      .add(this, 'quality', Object.keys(QUALITY))
      .name('Quality')
      .onChange((q) => this.setQuality(q));
    g.add(this.settings, 'bloom').name('Glow').onChange(() => this.active && this.configurePasses());
    this.bloomController = g
      .add(this.bloomPass, 'strength', 0, 3, 0.01)
      .name('Glow strength');
    g.add(this.settings, 'swipe').name('Swipe to switch');
    g.add(this.settings, 'showPreview').name('Camera preview');
    g.close();
  }

  applySize() {
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.width, this.height);
    this.sharedUniforms.uPixelRatio.value = pr;
    this.sharedUniforms.uViewportHeight.value = this.height;
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.applySize();
    for (const { instance } of this.scenes.values()) instance.resize(this.width, this.height);
  }

  onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    else if (/^[1-9]$/.test(e.key) && VISIBLE_SCENES[+e.key - 1]) this.goTo(VISIBLE_SCENES[+e.key - 1].id);
    else if (e.key === 'h') this.toggleHands();
    else if (e.key === 'g') this.gui.open(this.gui._closed);
  }
}

const GESTURE_LABEL = {
  open: 'open palm',
  fist: 'fist',
  point: 'pointing',
  pinch: 'pinch',
  victory: 'peace',
  thumbsUp: 'thumbs up',
};

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function cameraErrorMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was blocked. Allow the camera in the address bar, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device.';
  if (name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.';
  if (!window.isSecureContext) return 'The camera needs https:// or http://localhost.';
  return `Hand tracking could not start: ${err?.message || err}`;
}
