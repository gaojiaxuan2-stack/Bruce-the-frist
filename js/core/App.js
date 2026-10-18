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
const MAX_PIXELS = 3.5e6;

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
    /** Scene a switch is currently heading to (null when none is in flight). */
    this.pendingId = null;
    this.navToken = 0;
    /** Bumped when quality changes, so scenes still loading at the old quality get thrown away. */
    this.generation = 0;
    /** The user picked a quality in the panel: never lower it automatically. */
    this.userQuality = false;
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
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].pixelRatio);
    // Big HiDPI screens: keep the drawing buffer around 3.5 megapixels at most.
    return Math.max(1, Math.min(pr, Math.sqrt(MAX_PIXELS / (this.width * this.height))));
  }

  // ---------------------------------------------------------------- scenes

  next() {
    return this.step(1);
  }

  prev() {
    return this.step(-1);
  }

  /** Move through the tabs, counting from a switch that is still loading so quick presses add up. */
  step(dir) {
    const list = VISIBLE_SCENES;
    const i = list.findIndex((s) => s.id === (this.pendingId ?? this.activeId));
    return this.goTo(list[(i + dir + list.length) % list.length].id);
  }

  async loadScene(id) {
    if (this.scenes.has(id)) return this.scenes.get(id);
    if (!this.loading.has(id)) {
      const entry = SCENES.find((s) => s.id === id);
      const generation = this.generation;
      const p = (async () => {
        const mod = await entry.load();
        const SceneClass = mod.default;
        const instance = new SceneClass(this);
        await instance.init();
        if (generation !== this.generation) {
          // Quality changed while this was loading: build it again at the new quality.
          instance.dispose();
          return this.loadScene(id);
        }
        instance.resize(this.width, this.height);
        await this.precompile(instance);
        const folder = this.gui.addFolder(SceneClass.meta.title);
        instance.buildGui(folder);
        folder.hide();
        const rec = { instance, folder };
        this.scenes.set(id, rec);
        return rec;
      })().finally(() => {
        if (this.loading.get(id) === p) this.loading.delete(id);
      });
      this.loading.set(id, p);
    }
    return this.loading.get(id);
  }

  /**
   * Compile every shader of a scene (hidden objects too) during the fade, so the first frame
   * and the first gesture don't stall. The composer's target must be bound, or three.js
   * builds a different shader variant than the one it renders with.
   */
  async precompile(instance) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.composer.renderTarget1);
      const done = r.compileAsync(instance.scene, instance.camera);
      r.setRenderTarget(prev);
      await done;
    } catch (err) {
      r.setRenderTarget(prev);
      console.warn('Shader precompile skipped', err);
    }
  }

  /** Switch to a scene by id (fades out, lazy-loads, fades in). Latest call wins. */
  async goTo(id) {
    if (!SCENES.some((s) => s.id === id)) id = SCENES[0].id;
    const fade = document.getElementById('fade');
    if (id === this.activeId) {
      // Cancel any switch still loading (e.g. swiped away and straight back).
      this.navToken++;
      this.pendingId = null;
      fade.classList.remove('on');
      this.hud.setActive(id, this.active.meta);
      return;
    }
    if (id === this.pendingId) return; // already on the way there
    const token = ++this.navToken;
    this.pendingId = id;
    const first = !this.active;
    if (!first) fade.classList.add('on');
    const entry = SCENES.find((s) => s.id === id);
    this.hud.setActive(id, this.scenes.get(id)?.instance.meta ?? { ...entry, subtitle: 'Loading…' });

    let rec;
    try {
      [rec] = await Promise.all([this.loadScene(id), first ? null : wait(FADE_MS)]);
    } catch (err) {
      console.error(`Scene "${id}" failed to load`, err);
      if (token !== this.navToken) return; // the user already went somewhere else
      this.pendingId = null;
      const title = SCENES.find((s) => s.id === id).title;
      this.hud.toast(`Couldn't open ${title}. Check your connection and try again.`, 4000);
      fade.classList.remove('on');
      if (this.activeId) this.hud.setActive(this.activeId, this.active.meta);
      return;
    }
    if (token !== this.navToken) return;
    this.pendingId = null;

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
    this.revealPending = true; // lift the fade after this scene's first frame is drawn
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
    for (const p of s.postPasses) this.composer.addPass(p);
    this.composer.addPass(this.outputPass);
    this.bloomController?.setValue(this.bloomPass.strength);
  }

  /** Drop every built scene and rebuild the active one (used when quality changes). */
  async rebuildScenes() {
    const id = this.pendingId ?? this.activeId;
    this.pendingId = null;
    this.generation++;
    this.loading.clear();
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
      if (this.active) this.hud.setActive(this.activeId, this.active.meta);
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
    // Already starting (e.g. 'h' pressed twice): wait for that start instead of starting again.
    if (this.input.handStarting) return this.input.handStarting.then(() => true, () => false);
    if (this.input.handsRunning) {
      this.input.stopHands();
      this.hud.setCameraState(false);
      this.hud.setStatus('');
      if (this.active) this.hud.setActive(this.activeId, this.active.meta);
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
    // Swipes come only from an open, moving hand, so they are not blocked by the cursor being over UI.
    if (this.settings.swipe) {
      if (input.events.has('swipeleft')) this.next();
      else if (input.events.has('swiperight')) this.prev();
    }
    this.updateStatus(dt, input);

    if (this.active) {
      this.active.update(dt, this.elapsed, input);
      this.composer.render(dt);
      if (this.revealPending) {
        this.revealPending = false;
        document.getElementById('fade').classList.remove('on');
      }
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
    if (this.quality === 'low' || this.params.get('quality') || this.userQuality) return;
    if (this.pendingId) {
      // Loading and shader compiles stall frames; don't count them.
      this.fpsSamples.length = 0;
      return;
    }
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length < 90) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples.length = 0;
    const minFps = this.quality === 'high' ? 40 : 28;
    this.lowFpsTime = 1 / avg < minFps ? this.lowFpsTime + 1 : 0;
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
    if (this.isMobile || this.width < 1000) this.gui.close();
    const g = this.gui.addFolder('Global');
    this.qualityController = g
      .add(this, 'quality', Object.keys(QUALITY))
      .name('Quality')
      .onChange((q) => {
        this.userQuality = true;
        this.setQuality(q);
      });
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
    if (window.innerWidth < 1000 && this.width >= 1000) this.gui.close();
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.applySize();
    for (const { instance } of this.scenes.values()) instance.resize(this.width, this.height);
  }

  onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    else if (/^[1-9]$/.test(e.key) && VISIBLE_SCENES[+e.key - 1]) this.goTo(VISIBLE_SCENES[+e.key - 1].id);
    else if (e.key.toLowerCase() === 'h') this.toggleHands();
    else if (e.key.toLowerCase() === 'g') this.gui.open(this.gui._closed);
  }
}

const GESTURE_LABEL = {
  open: 'open hand',
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
