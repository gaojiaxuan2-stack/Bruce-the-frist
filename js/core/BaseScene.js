import * as THREE from 'three';

const _dir = new THREE.Vector3();

/**
 * Every scene extends this. The App owns the renderer and post-processing;
 * a scene owns a THREE.Scene + camera and reacts to the shared InputState.
 *
 * Lifecycle: constructor -> init() (once, may be async) -> enter() / exit()
 * each time it becomes (in)active -> update() every frame while active.
 */
export class BaseScene {
  /**
   * Static description shown in the HUD. Override in subclasses.
   * hints: what each gesture does in this scene ({icon, gesture, text}).
   * bloom: UnrealBloom settings used while this scene is active.
   */
  static meta = {
    id: 'base',
    title: 'Scene',
    subtitle: '',
    icon: '*',
    hints: [],
    bloom: { strength: 0.8, radius: 0.4, threshold: 0.1 },
  };

  /** @param {import('./App.js').App} app */
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, app.width / app.height, 0.1, 2000);
    this.camera.position.set(0, 0, 10);
    /** Extra post-processing passes inserted after the render pass, before bloom. */
    this.passes = [];
    /** Extra passes inserted after bloom, before the final output pass. */
    this.postPasses = [];
  }

  get meta() {
    return this.constructor.meta;
  }

  /** Build geometry, load assets. Called once before the first enter(). */
  async init() {}

  /** Called when the scene becomes active (after init). */
  enter() {}

  /** Called when another scene takes over. */
  exit() {}

  /** Viewport size changed. width/height are CSS pixels. */
  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Per frame.
   * @param {number} dt seconds since last frame (clamped to <= 0.1)
   * @param {number} time seconds since app start
   * @param {import('../input/InputState.js').InputState} input
   */
  // eslint-disable-next-line no-unused-vars
  update(dt, time, input) {}

  /**
   * Add this scene's controls to its own lil-gui folder (called once after init).
   * @param {import('lil-gui').GUI} folder
   */
  // eslint-disable-next-line no-unused-vars
  buildGui(folder) {}

  dispose() {
    this.scene.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) m.dispose?.();
    });
  }

  // ---------- helpers for subclasses ----------

  /**
   * Point on the plane z = planeZ (world space) under an NDC position,
   * seen from this scene's camera. Handy for mapping the hand into the scene.
   */
  ndcToWorld(ndc, planeZ = 0, target = new THREE.Vector3()) {
    const dir = _dir.set(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const t = (planeZ - this.camera.position.z) / (Math.abs(dir.z) > 1e-6 ? dir.z : -1e-6);
    return target.copy(this.camera.position).addScaledVector(dir, t);
  }

  /** Scale a base particle count by the app quality setting. */
  count(base) {
    return Math.max(1000, Math.round(base * this.app.particleScale));
  }
}
