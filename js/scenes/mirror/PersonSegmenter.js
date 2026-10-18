// Background removal for the Live Mirror: MediaPipe selfie segmenter, run on a
// small copy of the webcam frame at most ~20 times a second. Each result is
// copied into a tiny R8 texture; two textures (previous + newest) let the
// vertex shader blend smoothly between updates, so particles never pop.
//
// It runs on the main thread, like hand detection (the camera feed is the hand
// tracker's), and shares its budget: never in a frame where detection ran, at most
// ~10 Hz while a hand is tracked, and both together within VISION_SHARE (half) of
// the main thread, by their measured costs.
import * as THREE from 'three';
import { ImageSegmenter } from '@mediapipe/tasks-vision';
import { getVisionFileset, MODEL_URLS } from '../../input/vision.js';
import { VISION_SHARE, runningHandInput } from '../../input/HandInput.js';

const INTERVAL_MS = 50; // <= 20 Hz while no hand is tracked
const TRACKING_INTERVAL_MS = 100; // <= 10 Hz while a hand is tracked (hand control comes first)
const MAX_INTERVAL_MS = 1000; // the mask still follows (>= 1 Hz) on a device that is short of time
const MAX_SHARE = 0.25; // of the main thread, on its own
const MIN_SHARE = 0.04; // ... and at least this when hand detection takes the whole budget
const INPUT_WIDTH = 256; // the model itself works at 256 x 256
/**
 * A GPU-delegate run this slow after warm-up means software WebGL hiding behind a masked
 * renderer name: the CPU (WASM SIMD) path is many times faster there (SwiftShader: ~300 ms
 * on the GPU delegate, ~12 ms on the CPU).
 */
const SLOW_GPU_MS = 60;

function makeMaskTexture(width, height, fill = 0) {
  const data = new Uint8Array(width * height).fill(fill);
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export class PersonSegmenter {
  /**
   * @param {object} [app] the App (its input.hand is the hand tracker whose main-thread
   *   budget this shares); without it, the page's running hand tracker is used.
   */
  constructor(app = null) {
    this.app = app;
    /** @type {ImageSegmenter|null} */
    this.segmenter = null;
    this.loading = null;
    /** 'GPU' | 'CPU' once loaded */
    this.delegate = null;
    this.swapping = false;
    this.failed = false;
    this.closed = false;
    this.errors = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.width = 1;
    this.height = 1;
    this.prev = makeMaskTexture(1, 1, 255);
    this.next = makeMaskTexture(1, 1, 255);
    this.hasMask = false;
    this.coverage = 0;
    this.lastRun = -Infinity;
    this.lastTimestamp = 0;
    this.updatedAt = 0;
    this.interval = INTERVAL_MS;
    /** measured main-thread cost of one run (ms, running average) and runs so far */
    this.cost = 0;
    this.runs = 0;
    this.onResult = this.onResult.bind(this);
  }

  /** The running hand tracker whose main-thread budget this shares, or null. */
  handInput() {
    const hand = this.app?.input?.hand || runningHandInput();
    return hand?.running ? hand : null;
  }

  /**
   * Time between runs: at most 20 Hz (10 Hz while a hand is tracked), and no more than the
   * share of the main thread that hand detection leaves free (by both measured costs).
   * Hand detection in turn keeps room for this: the share this needs is reserved with it.
   */
  schedule(hand, now) {
    const base = hand?.tracking ? TRACKING_INTERVAL_MS : INTERVAL_MS;
    if (!this.runs) return (this.interval = base);
    const free = VISION_SHARE - (hand ? hand.detectShare : 0);
    const share = Math.max(MIN_SHARE, Math.min(MAX_SHARE, free));
    this.interval = Math.min(MAX_INTERVAL_MS, Math.max(base, this.cost / share));
    hand?.reserveShare(this.cost / base, now);
    return this.interval;
  }

  /**
   * Lazily create the MediaPipe task: the delegate the hand tracker prefers (GPU, or the
   * CPU on a software WebGL renderer), CPU fallback.
   */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const seg = await this.create(this.handInput()?.preferredDelegate?.() || 'GPU');
      if (this.closed) seg.close();
      else this.segmenter = seg;
    })().catch((err) => {
      this.failed = true;
      console.warn('Background removal is not available', err);
    });
    return this.loading;
  }

  async create(delegate) {
    const fileset = await getVisionFileset();
    const options = (d) => ({
      baseOptions: { modelAssetPath: MODEL_URLS.selfieSegmenter, delegate: d },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    if (delegate === 'GPU') {
      try {
        const seg = await ImageSegmenter.createFromOptions(fileset, options('GPU'));
        this.delegate = 'GPU';
        return seg;
      } catch (err) {
        console.warn('Selfie segmenter: GPU delegate failed, using CPU', err);
      }
    }
    const seg = await ImageSegmenter.createFromOptions(fileset, options('CPU'));
    this.delegate = 'CPU';
    return seg;
  }

  /** The GPU delegate is too slow here (see SLOW_GPU_MS): rebuild on the CPU, keep the masks. */
  async switchToCpu() {
    if (this.swapping) return;
    this.swapping = true;
    const old = this.segmenter;
    this.segmenter = null; // update() waits meanwhile (load() is already settled)
    try {
      old?.close();
    } catch {
      /* already broken */
    }
    try {
      const seg = await this.create('CPU');
      if (this.closed) seg.close();
      else {
        this.segmenter = seg;
        this.runs = 0;
        this.cost = 0;
      }
    } catch (err) {
      this.failed = true;
      console.warn('Background removal is not available', err);
    } finally {
      this.swapping = false;
    }
  }

  /** Run the model on the newest frame if enough time has passed. Call every frame while needed. */
  update(video, now) {
    if (this.failed || this.closed) return;
    if (!this.segmenter) {
      if (!this.swapping) this.load();
      return;
    }
    const hand = this.handInput();
    const interval = this.schedule(hand, now);
    if (now - this.lastRun < interval) return;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    // Hand detection already blocked this frame: run in the next one, which detection
    // leaves free (it may otherwise run in every frame when rendering is slow).
    if (hand?.detectedThisFrame) {
      hand.yieldFrame();
      return;
    }
    // Keep to the schedule: a run held back by a frame or two does not delay the next one.
    const due = this.lastRun + interval;
    this.lastRun = now - due < interval * 0.5 ? due : now;

    const t0 = performance.now();
    const w = INPUT_WIDTH;
    const h = Math.max(2, Math.round((w * video.videoHeight) / video.videoWidth));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const ts = Math.max(Math.round(now), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    try {
      this.segmenter.segmentForVideo(this.canvas, ts, this.onResult);
      this.errors = 0;
    } catch (err) {
      if (++this.errors >= 5) {
        this.failed = true;
        console.warn('Background removal stopped after repeated errors', err);
      }
    }
    // Measured cost (copy + model + mask read-back); the first runs include warm-up, so
    // they set it outright before the average takes over.
    const spent = performance.now() - t0;
    this.runs++;
    this.cost = this.runs <= 2 ? spent : this.cost + (spent - this.cost) * 0.2;
    this.schedule(hand, now);
    if (this.delegate === 'GPU' && this.runs > 8 && this.cost > SLOW_GPU_MS) {
      console.warn(`Selfie segmenter: GPU delegate is slow (${Math.round(this.cost)} ms), switching to CPU.`);
      this.switchToCpu();
    }
  }

  /** MediaPipe callback - the mask is only valid inside this call, so copy it now. */
  onResult(result) {
    const mask = result.confidenceMasks?.[0];
    if (!mask) return;
    const src = mask.getAsFloat32Array();
    const w = mask.width;
    const h = mask.height;
    if (w !== this.width || h !== this.height) this.allocate(w, h);

    const tex = this.prev; // recycle the older texture for the newest mask
    this.prev = this.next;
    this.next = tex;
    const dst = tex.image.data;
    const n = w * h;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      sum += v;
      dst[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
    tex.needsUpdate = true;
    /** Share of the frame covered by a person (0..1) - used to skip removal when nobody is there. */
    this.coverage = sum / n;
    if (!this.hasMask) {
      this.prev.image.data.set(dst);
      this.prev.needsUpdate = true;
    }
    this.hasMask = true;
    this.updatedAt = performance.now();
  }

  allocate(w, h) {
    this.prev.dispose();
    this.next.dispose();
    this.prev = makeMaskTexture(w, h, 255);
    this.next = makeMaskTexture(w, h, 255);
    this.width = w;
    this.height = h;
    this.hasMask = false;
  }

  /** 0 -> previous mask, 1 -> newest mask. */
  get blend() {
    if (!this.hasMask) return 1;
    return Math.min(1, Math.max(0, (performance.now() - this.updatedAt) / this.interval));
  }

  /** Forget the last mask (e.g. when the camera restarts) so the next one fades in fresh. */
  reset() {
    this.hasMask = false;
    this.lastRun = -Infinity;
  }

  close() {
    this.closed = true;
    this.segmenter?.close();
    this.segmenter = null;
    this.prev.dispose();
    this.next.dispose();
  }
}
