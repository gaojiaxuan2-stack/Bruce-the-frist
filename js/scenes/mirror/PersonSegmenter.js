// Background removal for the Live Mirror: MediaPipe selfie segmenter, run on a
// small copy of the webcam frame at most ~20 times a second. Each result is
// copied into a tiny R8 texture; two textures (previous + newest) let the
// vertex shader blend smoothly between updates, so particles never pop.
import * as THREE from 'three';
import { ImageSegmenter } from '@mediapipe/tasks-vision';
import { getVisionFileset, MODEL_URLS } from '../../input/vision.js';

const INTERVAL_MS = 50; // <= 20 Hz
const INPUT_WIDTH = 256; // the model itself works at 256 x 256

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
  constructor() {
    /** @type {ImageSegmenter|null} */
    this.segmenter = null;
    this.loading = null;
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
    this.onResult = this.onResult.bind(this);
  }

  /** Lazily create the MediaPipe task (GPU delegate, CPU fallback). */
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const fileset = await getVisionFileset();
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MODEL_URLS.selfieSegmenter, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      let seg;
      try {
        seg = await ImageSegmenter.createFromOptions(fileset, options('GPU'));
      } catch (err) {
        console.warn('Selfie segmenter: GPU delegate failed, using CPU', err);
        seg = await ImageSegmenter.createFromOptions(fileset, options('CPU'));
      }
      if (this.closed) seg.close();
      else this.segmenter = seg;
    })().catch((err) => {
      this.failed = true;
      console.warn('Background removal is not available', err);
    });
    return this.loading;
  }

  /** Run the model on the newest frame if enough time has passed. Call every frame while needed. */
  update(video, now) {
    if (this.failed || this.closed) return;
    if (!this.segmenter) {
      this.load();
      return;
    }
    if (now - this.lastRun < this.interval) return;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    this.lastRun = now;

    const w = INPUT_WIDTH;
    const h = Math.max(2, Math.round((w * video.videoHeight) / video.videoWidth));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const ts = Math.max(Math.round(now), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const t0 = performance.now();
    try {
      this.segmenter.segmentForVideo(this.canvas, ts, this.onResult);
      this.errors = 0;
    } catch (err) {
      if (++this.errors >= 5) {
        this.failed = true;
        console.warn('Background removal stopped after repeated errors', err);
      }
    }
    // On slow devices back off so segmentation never eats the frame budget.
    const cost = performance.now() - t0;
    this.interval = Math.min(200, Math.max(INTERVAL_MS, cost * 4));
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
