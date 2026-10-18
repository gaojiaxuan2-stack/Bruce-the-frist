// tracker.js — MediaPipe Tasks (hands always; face + person segmentation on
// demand). Everything is vendored in this repo so it runs without any CDN.

import { FilesetResolver, HandLandmarker, FaceLandmarker, ImageSegmenter } from '../lib/mediapipe/vision_bundle.js';

const WASM_DIR = new URL('../lib/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  hand: new URL('../models/hand_landmarker.task', import.meta.url).href,
  face: new URL('../models/face_landmarker.task', import.meta.url).href,
  segment: new URL('../models/selfie_segmenter.tflite', import.meta.url).href,
};

// fetch() with byte progress (falls back gracefully without Content-Length).
export async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !res.body.getReader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export class Tracker {
  constructor() {
    this.hand = null;
    this.face = null;
    this.segmenter = null;
    this.delegate = 'GPU';
    this.fileset = null;
    this.pending = {};
    this.lastTs = 0;
    this.frame = 0;
    this.maskBytes = null;
    this.errors = 0;
    this.failStreak = 0;
    this.faceMiss = 0;
    this.faceX = null;
    this.recipes = {};  // kind -> { Task, optionsFor } so tasks can be rebuilt on CPU
  }

  // Loads the wasm runtime + hand model. onProgress(fraction 0..1, label).
  async init(onProgress = () => {}) {
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    // Download the big wasm binary ourselves so we can show progress, then
    // hand MediaPipe a blob: URL so it isn't fetched twice.
    const sizes = { wasm: 9.5e6, hand: 7.8e6 };
    const got = { wasm: 0, hand: 0 };
    const report = () => onProgress((got.wasm + got.hand) / (sizes.wasm + sizes.hand), 'Loading hand tracking');
    const [wasm, handModel] = await Promise.all([
      fetchBytes(fileset.wasmBinaryPath, (g, t) => { got.wasm = g; if (t) sizes.wasm = t; report(); }),
      fetchBytes(MODELS.hand, (g, t) => { got.hand = g; if (t) sizes.hand = t; report(); }),
    ]);
    fileset.wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    this.fileset = fileset;
    onProgress(1, 'Starting neural nets');
    this.hand = await this._create('hand', HandLandmarker, (delegate) => ({
      baseOptions: { modelAssetBuffer: handModel, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }));
  }

  // Try the GPU delegate first, fall back to CPU (older iOS, headless, etc).
  async _create(kind, Task, optionsFor) {
    this.recipes[kind] = { Task, optionsFor };
    if (this.delegate === 'GPU') {
      try {
        return await Task.createFromOptions(this.fileset, optionsFor('GPU'));
      } catch (e) {
        console.warn('[tracker] GPU delegate failed, using CPU', e);
        this.delegate = 'CPU';
      }
    }
    return Task.createFromOptions(this.fileset, optionsFor('CPU'));
  }

  // Lazily load the extra models a mode asks for. Returns a promise.
  ensure(kind) {
    if (kind === 'face' && this.face) return Promise.resolve(this.face);
    if (kind === 'segment' && this.segmenter) return Promise.resolve(this.segmenter);
    if (this.pending[kind]) return this.pending[kind];
    const p = (async () => {
      while (!this.fileset) await new Promise((r) => setTimeout(r, 100));
      if (kind === 'face') {
        const buf = await fetchBytes(MODELS.face);
        this.face = await this._create('face', FaceLandmarker, (delegate) => ({
          baseOptions: { modelAssetBuffer: buf, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }));
        return this.face;
      }
      if (kind === 'segment') {
        const buf = await fetchBytes(MODELS.segment);
        this.segmenter = await this._create('segment', ImageSegmenter, (delegate) => ({
          baseOptions: { modelAssetBuffer: buf, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        }));
        return this.segmenter;
      }
      throw new Error(`unknown model ${kind}`);
    })();
    this.pending[kind] = p;
    p.catch((e) => { console.error(`[tracker] failed to load ${kind}`, e); delete this.pending[kind]; });
    return p;
  }

  // Run detectors on one video frame. needs = { face, segment }.
  // Returns { hands: [...], face: {...}|null|undefined, mask: {bytes,w,h}|undefined }
  // (undefined = "not run this frame, keep the previous result").
  detect(source, needs = {}, { hands = true } = {}) {
    const out = { hands: [], face: undefined, mask: undefined };
    if (!this.hand) return out;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 0.01;
    this.lastTs = ts;
    this.frame++;

    if (hands) try {
      const r = this.hand.detectForVideo(source, ts);
      for (let i = 0; i < (r.landmarks || []).length; i++) {
        const cat = r.handedness?.[i]?.[0] || r.handednesses?.[i]?.[0];
        out.hands.push({
          landmarks: r.landmarks[i],
          world: r.worldLandmarks?.[i],
          handedness: cat?.categoryName || 'Right',
          score: cat?.score ?? 1,
        });
      }
      this.failStreak = 0;
    } catch (e) {
      this._error(e);
      // Some mobile GPUs build the GPU task fine but then fail every frame.
      if (++this.failStreak >= 3 && this.delegate === 'GPU') this._fallbackToCPU();
    }

    // Heavier models alternate frames when both are on.
    const both = needs.face && this.face && needs.segment && this.segmenter;
    if (needs.face && this.face && (!both || this.frame % 2 === 0)) {
      try {
        const input = this._faceInput(source);
        const r = this.face.detectForVideo(input.image, ts);
        let lm = r.faceLandmarks?.[0];
        if (lm) {
          if (input.map) lm = lm.map(input.map);
          const shapes = {};
          for (const c of r.faceBlendshapes?.[0]?.categories || []) shapes[c.categoryName] = c.score;
          out.face = { landmarks: lm, blendshapes: shapes };
          this.faceX = (lm[234].x + lm[454].x) / 2;
          this.faceMiss = 0;
        } else {
          out.face = null;
          this.faceMiss = (this.faceMiss || 0) + 1;
        }
      } catch (e) { this._error(e); }
    }
    if (needs.segment && this.segmenter && (!both || this.frame % 2 === 1)) {
      try {
        const r = this.segmenter.segmentForVideo(source, ts);
        const m = r.confidenceMasks?.[0];
        if (m) {
          const f = m.getAsFloat32Array();
          const n = m.width * m.height;
          if (!this.maskBytes || this.maskBytes.length !== n) this.maskBytes = new Uint8Array(n);
          const b = this.maskBytes;
          for (let i = 0; i < n; i++) b[i] = f[i] * 255;
          out.mask = { bytes: b, w: m.width, h: m.height };
        }
        r.close?.();
      } catch (e) { this._error(e); }
    }
    return out;
  }

  // Rebuild every loaded task on the CPU delegate (slower, but works everywhere).
  async _fallbackToCPU() {
    if (this._fallingBack) return;
    this._fallingBack = true;
    console.warn('[tracker] GPU inference keeps failing; switching to CPU');
    this.delegate = 'CPU';
    const rebuild = async (key, kind) => {
      const old = this[key];
      const r = this.recipes[kind];
      if (!old || !r) return;
      this[key] = null;
      try { old.close(); } catch (e) { /* already broken */ }
      try { this[key] = await r.Task.createFromOptions(this.fileset, r.optionsFor('CPU')); } catch (e) { console.error(`[tracker] CPU ${kind} failed`, e); }
    };
    await Promise.all([rebuild('hand', 'hand'), rebuild('face', 'face'), rebuild('segmenter', 'segment')]);
    this.failStreak = 0;
  }

  // The face detector is short-range: in a wide 16:9 frame a seated user's
  // face is often too small for it. So on landscape frames we look at a
  // square crop around the last face (or the centre) and map points back.
  // Every few misses we try the full frame in case the face is off to a side.
  _faceInput(source) {
    const vw = source.videoWidth || source.width, vh = source.videoHeight || source.height;
    if (!vw || !vh || vw < vh * 1.2 || (this.faceMiss % 4 === 3)) return { image: source, map: null };
    const side = vh;
    const want = (this.faceX ?? 0.5) * vw;
    // Re-centre only when the face drifts far, so tracking stays steady.
    if (this.cropX === undefined || Math.abs(want - (this.cropX + side / 2)) > side * 0.22) {
      this.cropX = Math.round(Math.max(0, Math.min(vw - side, want - side / 2)));
    }
    const S = 512;
    if (!this.cropCanvas) {
      this.cropCanvas = document.createElement('canvas');
      this.cropCanvas.width = this.cropCanvas.height = S;
      this.cropCtx = this.cropCanvas.getContext('2d');
    }
    const x0 = this.cropX;
    this.cropCtx.drawImage(source, x0, 0, side, side, 0, 0, S, S);
    return {
      image: this.cropCanvas,
      map: (p) => ({ x: (x0 + p.x * side) / vw, y: p.y, z: (p.z * side) / vw }),
    };
  }

  _error(e) {
    this.errors++;
    if (this.errors < 5) console.error('[tracker]', e);
  }
}
