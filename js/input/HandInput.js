// Webcam hand tracking: camera -> MediaPipe HandLandmarker -> gestures -> one
// HandFrame per render frame (merged into the InputState by InputManager).
//
// Coordinates: MediaPipe reports the raw (un-mirrored) camera image. We mirror x
// (selfie view) and map the central part of the frame (REGION) onto the whole
// screen, so the user reaches every screen edge without the hand leaving the camera.
import { HandLandmarker } from '@mediapipe/tasks-vision';
import { getVisionFileset, MODEL_URLS } from './vision.js';
import {
  HAND_CONNECTIONS,
  GestureStabilizer,
  OneEuroFilter,
  PinchAim,
  PinchDetector,
  RelativeDepth,
  STRICT_SWIPE,
  SwipeDetector,
  analyzeHand,
  classifyShape,
  clamp,
  handScale2D,
  palmCenter,
  toHandSpace,
} from './Gestures.js';

/**
 * Part of the (mirrored) camera image that maps to the full screen, normalised image
 * coords. Above centre: the pointer is the index fingertip, which sits well above the
 * wrist, so the bottom edge of the screen is reached with the fingertip at 70% of the
 * picture height while the hand (most of it) is still in view; raising the hand reaches
 * the tabs at the top.
 */
const REGION = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.7 };
/** A hand that disappears for less than this is kept (brief tracking dropouts). */
const LOST_MS = 200;
/** A lost hand's filters and gesture state are kept this long, in case it comes back. */
const RETAIN_MS = 1500;
/**
 * A hand is lost only when detection ran and did not find it (for > LOST_MS). A main-thread
 * stall (garbage collection, a scene compiling its shaders) where no detection ran at all
 * is not the hand leaving, up to this long (or 3 detection intervals on a very slow device).
 */
const STALL_MS = 1500;
/** Hand scale (image heights) of a comfortable distance (swipe thresholds are relative to it). */
const DEPTH_NEUTRAL_SCALE = 0.22;
/** Closeness gained per doubling of the apparent hand size (see RelativeDepth). */
const DEPTH_GAIN = 0.6;
const ZOOM_GAIN = 2.5;
const ACCENT = '#7cf6c8';
const SECONDARY = '#8aa8ff';
const PREVIEW_WIDTH = 320;

const GESTURE_LABEL = {
  none: '✋ hand',
  open: '🖐️ open palm',
  fist: '✊ fist',
  point: '☝️ point',
  pinch: '🤏 pinch',
  victory: '✌️ peace',
  thumbsUp: '👍 thumbs up',
};

const ndcX = (mx) => ((mx - REGION.x0) / (REGION.x1 - REGION.x0)) * 2 - 1;
const ndcY = (y) => -(((y - REGION.y0) / (REGION.y1 - REGION.y0)) * 2 - 1);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Apparent hand size of filtered, normalised image landmarks, in image heights. */
function imageHandSize(L, aspect) {
  const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const length = d(L[0], L[9]);
  const width = d(L[5], L[17]) / 0.82;
  return Math.max(1e-4, length, width * 0.9, (length + width) * 0.5);
}

/** Per-hand tracking state, kept across frames while the same hand stays visible. */
class TrackedHand {
  constructor(id, now) {
    this.id = id;
    this.created = now;
    this.lastSeen = now;
    /** detection runs since lastSeen that did not find this hand */
    this.misses = 0;
    this.updates = 0;
    /** tracking frames since the hand (re)appeared; a miss of a frame or two does not reset it */
    this.streak = 0;
    this.handedness = 'Right';
    /** hand space (isotropic, mirrored, y up) - raw, for gesture maths */
    this.space = [];
    /** filtered, mirrored, normalised image coords (x right, y down) - for drawing + pointer */
    this.img = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    // One Euro per coordinate: ~1 px of residual jitter at rest, ~1 frame of lag when moving
    // (units: normalised image coords, so beta is per image-width/second of speed).
    this.filters = Array.from({ length: 21 }, () => [
      new OneEuroFilter({ minCutoff: 1.0, beta: 9, dCutoff: 1 }),
      new OneEuroFilter({ minCutoff: 1.0, beta: 9, dCutoff: 1 }),
    ]);
    this.pinchDetector = new PinchDetector({ enterFrames: 2, releaseFrames: 2 });
    this.stabilizer = new GestureStabilizer({ minFrames: 3, minMs: 80, initial: 'none' });
    this.fingerStabilizer = new GestureStabilizer({ minFrames: 3, minMs: 80, initial: 0 });
    /** latches the pointer where the user aimed while a pinch forms / is held */
    this.aim = new PinchAim();
    this.rawShape = 'none';
    this.shape = 'none';
    this.fingers = 0;
    this.pinching = false;
    this.pinch = 0;
    this.grab = 0;
    this.roll = 0;
    this.scale2D = DEPTH_NEUTRAL_SCALE;
    this.palmImg = { x: 0.5, y: 0.5 };
    this.pointerNdc = { x: 0, y: 0 };
    this.palmNdc = { x: 0, y: 0 };
    this.rawPalmNdc = { x: 0, y: 0 };
    /** HandInfo handed to scenes (objects reused every frame). */
    this.info = {
      handedness: 'Right',
      landmarks: Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })),
      gesture: 'none',
      pinch: 0,
      pinching: false,
      fingers: 0,
      grab: 0,
      pointer: { x: 0, y: 0 },
      palm: { x: 0, y: 0 },
    };
  }

  get gesture() {
    return this.pinching ? 'pinch' : this.shape;
  }

  /**
   * The hand comes back after being lost: start its gesture state fresh. Resuming the old
   * one would first report the shape it had when it left (e.g. a stale fist for ~100 ms,
   * which scenes would act on), and the filters would glide from the old position.
   */
  _restart() {
    this.streak = 0;
    this.stabilizer.reset('none');
    this.fingerStabilizer.reset(0);
    this.shape = 'none';
    this.rawShape = 'none';
    this.fingers = 0;
    this.pinchDetector.reset();
    this.pinching = false;
    this.aim.reset();
    this.analysis = null;
    for (const [fx, fy] of this.filters) {
      fx.reset();
      fy.reset();
    }
  }

  /** Lost: detection kept missing it for > lostMs, or no detection ran for stallMs. */
  isLost(now, lostMs, stallMs = STALL_MS) {
    const gap = now - this.lastSeen;
    return (gap > lostMs && this.misses > 0) || gap > stallMs;
  }

  /**
   * Feed one MediaPipe detection (raw normalised landmarks).
   * @param {number} lostMs see isLost(): a hand that was lost and has come back starts
   *   its gesture, pinch and filter state fresh instead of resuming.
   * @param {number} stallMs see isLost()
   */
  update(raw, handedness, aspect, now, lostMs = LOST_MS, stallMs = STALL_MS) {
    const t = now / 1000;
    if (this.updates > 0 && this.isLost(now, lostMs, stallMs)) this._restart();
    this.lastSeen = now;
    this.misses = 0;
    this.updates++;
    this.streak++;
    const fresh = this.streak === 1;
    this.handedness = handedness;

    // Gesture maths on the raw landmarks (most responsive; debounced below).
    toHandSpace(raw, aspect, this.space);
    const info = analyzeHand(this.space, this.analysis?.ext);
    this.analysis = info;
    this.rawShape = classifyShape(info);
    // indexFolded ends a pinch when the hand closes into a fist (the thumb then rests on
    // the curled index, so the tip distance alone would keep the pinch alive).
    const wasPinching = this.pinching;
    this.pinching = this.pinchDetector.update(info.pinchDist, info.pinchAllowed, info.indexFolded);
    // Shape and finger count are debounced separately (a flickering thumb must not
    // hold back "open"), but switch together when the shape changes.
    let shape = this.stabilizer.update(this.rawShape, now);
    if (wasPinching && !this.pinching && shape !== this.rawShape) {
      // The shape held through the pinch is stale (a pinch with the other fingers curled
      // reads as a fist / thumbs up; closing into a fist ends the pinch a frame before the
      // debounce accepts "fist"). Take the current shape if it has been seen for 2 frames,
      // else report nothing until it settles, so no false fist / open edge fires.
      shape = this.stabilizer.settle(2) === this.rawShape ? this.rawShape : this.stabilizer.force('none');
    }
    if (shape !== this.shape) this.fingerStabilizer.force(info.fingers);
    this.shape = shape;
    this.fingers = this.fingerStabilizer.update(info.fingers, now);
    this.pinch += (info.pinch - this.pinch) * (fresh ? 1 : 0.6);
    this.grab += (info.grab - this.grab) * (fresh ? 1 : 0.5);
    this.roll = info.roll;
    this.scale2D = handScale2D(this.space);

    // Filtered, mirrored image coordinates for the pointer and the skeleton.
    for (let i = 0; i < 21; i++) {
      const r = raw[i];
      const p = this.img[i];
      p.x = this.filters[i][0].filter(1 - r.x, t);
      p.y = this.filters[i][1].filter(r.y, t);
      p.z = r.z || 0;
    }
    const L = this.img;
    const pc = palmCenter(L, this.palmImg);
    this.palmNdc.x = ndcX(pc.x);
    this.palmNdc.y = ndcY(pc.y);
    // Pointer: the index fingertip; while a pinch forms or is held, latched to the palm
    // at the spot the fingertip aimed at before the fingers started to close (see
    // PinchAim), so a pinch-click lands where you aimed and drags move 1:1 with the hand.
    const size = imageHandSize(L, aspect);
    const aim = this.aim.update(now, info.pinchDist, info.pinch, this.pinching,
      (L[8].x - pc.x) / size, (L[8].y - pc.y) / size);
    const px = L[8].x + (pc.x + aim.x * size - L[8].x) * aim.w;
    const py = L[8].y + (pc.y + aim.y * size - L[8].y) * aim.w;
    this.pointerNdc.x = ndcX(px);
    this.pointerNdc.y = ndcY(py);
    // Unfiltered palm for swipe detection (no lag on fast moves).
    const rawPalmX = 1 - (raw[0].x * 0.4 + (raw[5].x + raw[9].x + raw[13].x + raw[17].x) * 0.15);
    const rawPalmY = raw[0].y * 0.4 + (raw[5].y + raw[9].y + raw[13].y + raw[17].y) * 0.15;
    this.rawPalmNdc.x = ndcX(rawPalmX);
    this.rawPalmNdc.y = ndcY(rawPalmY);

    // HandInfo for scenes: landmarks in NDC (unclamped), z + = toward the camera.
    const zScale = 2 / (REGION.x1 - REGION.x0);
    const out = this.info;
    for (let i = 0; i < 21; i++) {
      const q = out.landmarks[i];
      q.x = ndcX(L[i].x);
      q.y = ndcY(L[i].y);
      q.z = -L[i].z * zScale;
    }
    out.handedness = handedness;
    out.gesture = this.gesture;
    out.pinch = this.pinch;
    out.pinching = this.pinching;
    out.fingers = this.fingers;
    out.grab = this.grab;
    out.pointer.x = clamp(this.pointerNdc.x, -1, 1);
    out.pointer.y = clamp(this.pointerNdc.y, -1, 1);
    out.palm.x = clamp(this.palmNdc.x, -1, 1);
    out.palm.y = clamp(this.palmNdc.y, -1, 1);
  }
}

export class HandInput {
  /** @param {import('../core/App.js').App} app */
  constructor(app) {
    this.app = app;
    this._running = false;
    this._starting = null;
    this._video = null;
    this._stream = null;
    this.landmarker = null;
    this._landmarkerPromise = null;
    this.delegate = null;
    this._swapping = false;
    this._cpuOnly = false;

    this.hands = [];
    this.primary = null;
    this._nextId = 1;
    this.swipe = new SwipeDetector();
    /** used instead of `swipe` while the scene asks for strict swipes (meta.swipe === 'strict') */
    this.strictSwipe = new SwipeDetector(STRICT_SWIPE);
    this._swipeInUse = this.swipe;
    /** input.depth relative to the primary hand's resting distance */
    this.relDepth = new RelativeDepth({ deadZone: 0.1, followS: 8, relockMs: RETAIN_MS });
    /**
     * The side of the hand the user controls with ('Left' for a left-handed user): the
     * last primary hand's, once it has been the primary for RETAIN_MS (a quick takeover by
     * the other hand during a dropout does not change it). Preferred when a new primary
     * is chosen.
     */
    this._lastHandedness = null;
    this._primarySince = 0;
    this._pendingEvents = [];
    this._lastVideoTime = -1;
    this._lastTimestamp = 0;
    this._lastDetectAt = 0;
    this._detectMs = 12;
    this._errors = 0;
    this._delegateSince = 0;
    this._pausedUntil = 0;
    this._zoomPending = 0;
    this._pairDistance = null;
    this._displayValid = false;
    this._lastPrimaryId = 0;
    this._lastGesture = 'none';
    this._lastPinching = false;
    this._t0 = performance.now();

    /** The object returned by update(); reused every frame. */
    this.frame = {
      pointer: { x: 0, y: 0 },
      palm: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      depth: 0.5,
      pinch: 0,
      pinching: false,
      grab: 0,
      fist: false,
      open: false,
      fingers: 0,
      gesture: 'none',
      roll: 0,
      zoom: 0,
      twoHands: false,
      hands: [],
      events: [],
    };

    /** Small debug / test surface (read by tools/smoke.mjs). */
    this.debug = {
      delegate: null,
      fps: 0,
      detectMs: 0,
      frames: 0,
      handsVisible: 0,
      gesture: 'none',
      rawGesture: 'none',
      fingers: 0,
      pinchDistance: null,
      video: null,
      errors: 0,
      lastEvents: [],
      /** absolute closeness of the primary hand, and the reference input.depth is relative to */
      depthRaw: null,
      depthRef: null,
      /** 'strict' while the active scene asks for strict swipes */
      swipeMode: 'normal',
      /** last tracking samples of the primary hand: [ms, palm x, palm y, shape] */
      samples: [],
    };

    this.preview = document.getElementById('cam-preview');
    this.canvas = document.getElementById('cam-canvas');
    this.caption = document.getElementById('cam-caption');
    this.ctx = this.canvas?.getContext('2d', { alpha: false }) || null;
    this._captionText = '';
    this._previewShown = false;
  }

  get running() {
    return this._running;
  }

  /** The hidden, playing webcam <video> (null before the first start). */
  get video() {
    return this._video;
  }

  // ------------------------------------------------------------------ start / stop

  /** Open the camera and load the model (in parallel). Idempotent. Rethrows the original error. */
  start() {
    if (this._running) return Promise.resolve();
    if (this._starting) return this._starting;
    this._starting = (async () => {
      const [cam, model] = await Promise.allSettled([this._openCamera(), this._ensureLandmarker()]);
      if (cam.status === 'rejected' || model.status === 'rejected') {
        if (cam.status === 'fulfilled') this._releaseCamera();
        throw cam.status === 'rejected' ? cam.reason : model.reason;
      }
      this._running = true;
      this._resetTracking();
      this._log('start', this.delegate);
    })().finally(() => {
      this._starting = null;
    });
    return this._starting;
  }

  /** Stop the camera (the model stays loaded so a restart is instant). */
  stop() {
    this._running = false;
    this._releaseCamera();
    this._resetTracking();
    this._showPreview(false);
  }

  async _openCamera() {
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      const err = new Error('This browser has no camera access here (it needs https:// or http://localhost).');
      err.name = 'NotSupportedError';
      throw err;
    }
    let stream;
    try {
      stream = await md.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (err) {
      if (err?.name !== 'OverconstrainedError') throw err;
      stream = await md.getUserMedia({ video: true, audio: false });
    }
    this._stream = stream;
    const video = this._ensureVideo();
    video.srcObject = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => this._onTrackEnded(stream), { once: true });
    }
    try {
      await video.play();
    } catch (err) {
      // Autoplay is allowed for muted video; a rejected play() on a live stream is usually
      // an interrupted load. Frames still arrive, which waitForFrames() checks.
      if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError') {
        this._releaseCamera();
        throw err;
      }
    }
    try {
      await waitForFrames(video, 10000);
    } catch (err) {
      this._releaseCamera();
      throw err;
    }
    this.debug.video = { width: video.videoWidth, height: video.videoHeight };
    return stream;
  }

  _ensureVideo() {
    if (this._video) return this._video;
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.setAttribute('autoplay', '');
    v.playsInline = true;
    v.muted = true;
    v.autoplay = true;
    v.setAttribute('aria-hidden', 'true');
    // In the DOM (some mobile browsers only decode attached videos) but invisible.
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(v);
    this._video = v;
    return v;
  }

  _releaseCamera() {
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
      this._stream = null;
    }
    if (this._video) {
      this._video.pause();
      this._video.srcObject = null;
    }
  }

  _onTrackEnded(stream) {
    if (stream !== this._stream || !this._running) return;
    // Camera unplugged / taken by another app / permission revoked.
    this.stop();
    this.app.hud?.setCameraState?.(false);
    this.app.hud?.setStatus?.('');
    this.app.hud?.toast?.('The camera stopped. Press “Hand control” to turn it on again.', 4000);
  }

  _ensureLandmarker() {
    if (this.landmarker) return Promise.resolve(this.landmarker);
    this._landmarkerPromise ??= this._createLandmarker(this._preferredDelegate())
      .then((lm) => (this.landmarker = lm))
      .finally(() => {
        this._landmarkerPromise = null;
      });
    return this._landmarkerPromise;
  }

  /** GPU unless asked otherwise (?delegate=cpu) or WebGL is a software renderer. */
  _preferredDelegate() {
    if (this._cpuOnly) return 'CPU';
    const forced = this.app.params?.get?.('delegate');
    if (forced && /^(cpu|gpu)$/i.test(forced)) return forced.toUpperCase();
    try {
      const gl = this.app.renderer?.getContext?.();
      // Firefox reports the real renderer here; Chromium / Safari mask it ("WebKit WebGL").
      let name = String(gl?.getParameter(gl.RENDERER) || '');
      if (!name || /webkit webgl/i.test(name)) {
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      }
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return 'CPU';
    } catch {
      /* ignore - just use the GPU */
    }
    return 'GPU';
  }

  async _createLandmarker(delegate) {
    const fileset = await getVisionFileset();
    const options = (d) => ({
      baseOptions: { modelAssetPath: MODEL_URLS.hand, delegate: d },
      runningMode: 'VIDEO',
      numHands: 2,
      // MediaPipe's defaults: stricter values never find the hand in a dim room. An
      // occasional false detection is absorbed by the gesture debounce and LOST_MS.
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    if (delegate === 'GPU') {
      try {
        const lm = await HandLandmarker.createFromOptions(fileset, options('GPU'));
        this.delegate = this.debug.delegate = 'GPU';
        return lm;
      } catch (err) {
        console.warn('Hand tracking: GPU delegate unavailable, using CPU.', err);
      }
    }
    const lm = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    this.delegate = this.debug.delegate = 'CPU';
    return lm;
  }

  /** The GPU delegate failed at run time: rebuild on the CPU, keep the camera running. */
  async _fallbackToCpu() {
    if (this._swapping) return;
    this._swapping = true;
    this._cpuOnly = true;
    const old = this.landmarker;
    this.landmarker = null;
    try {
      old?.close();
    } catch {
      /* already broken */
    }
    try {
      this.landmarker = await this._createLandmarker('CPU');
      this._errors = 0;
      this._delegateSince = this.debug.frames;
      this._detectMs = 12;
      this._log('delegate', 'CPU');
    } catch (err) {
      console.warn('Hand tracking: CPU fallback failed', err);
      this._pausedUntil = performance.now() + 3000;
    } finally {
      this._swapping = false;
    }
  }

  _resetTracking() {
    this.hands.length = 0;
    this.primary = null;
    this._resetSwipes();
    this.relDepth.reset();
    this._pendingEvents.length = 0;
    this._lastVideoTime = -1;
    this._lastDetectAt = 0;
    this._zoomPending = 0;
    this._pairDistance = null;
    this._displayValid = false;
    this._lastGesture = 'none';
    this._lastPinching = false;
    this.frame.hands.length = 0;
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Called once per render frame by InputManager.
   * @returns {object|null} HandFrame, or null when no hand has been seen for > 200 ms
   */
  update(dt) {
    if (!this._running) return null;
    const f = this.frame;
    f.events.length = 0;
    f.zoom = 0;

    const detected = this._maybeDetect(performance.now());
    const now = performance.now();
    this._syncPreview(detected, now);

    const p = this.primary;
    if (!p || p.isLost(now, this._lostMs, this._stallMs)) {
      this._displayValid = false;
      this._pairDistance = null;
      this._zoomPending = 0;
      return null;
    }

    // --- primary hand -> frame (targets update at tracking rate, display glides at render rate)
    const snap = !this._displayValid;
    const a = snap ? 1 : damp(32, dt);
    // The frame a pinch starts, the pointer jumps straight to the latched aim, so the
    // click (HandCursor hit-tests this frame) lands exactly where the user aimed.
    const pinchSnap = !snap && p.pinching && !f.pinching;
    const ap = pinchSnap ? 1 : a;
    const tx = clamp(p.pointerNdc.x, -1, 1);
    const ty = clamp(p.pointerNdc.y, -1, 1);
    const prevX = f.pointer.x;
    const prevY = f.pointer.y;
    f.pointer.x += (tx - f.pointer.x) * ap;
    f.pointer.y += (ty - f.pointer.y) * ap;
    f.palm.x += (clamp(p.palmNdc.x, -1, 1) - f.palm.x) * a;
    f.palm.y += (clamp(p.palmNdc.y, -1, 1) - f.palm.y) * a;
    const switched = p.id !== this._lastPrimaryId;
    this._lastPrimaryId = p.id;
    if (snap || switched || dt <= 0) {
      // A new hand / the other hand taking over is not a fling.
      f.velocity.x = f.velocity.y = 0;
    } else if (pinchSnap) {
      // The aim correction is not hand motion: keep the velocity as it was.
    } else {
      const av = damp(14, dt);
      f.velocity.x += ((f.pointer.x - prevX) / dt - f.velocity.x) * av;
      f.velocity.y += ((f.pointer.y - prevY) / dt - f.velocity.y) * av;
    }

    // Depth relative to where this hand rests (users sit at different distances): a new
    // primary hand, or one back after a long loss, anchors a new reference.
    const depthRaw = 0.5 + Math.log2(p.scale2D / DEPTH_NEUTRAL_SCALE) * DEPTH_GAIN;
    if (switched) this.relDepth.reset();
    const depthTarget = this.relDepth.update(depthRaw, now);
    this.debug.depthRaw = Math.round(depthRaw * 1000) / 1000;
    this.debug.depthRef = this.relDepth.ref === null ? null : Math.round(this.relDepth.ref * 1000) / 1000;
    f.depth = snap ? depthTarget : f.depth + (depthTarget - f.depth) * damp(6, dt);
    f.grab = snap ? p.grab : f.grab + (p.grab - f.grab) * damp(16, dt);
    f.pinch = snap ? p.pinch : f.pinch + (p.pinch - f.pinch) * damp(28, dt);
    f.roll = snap ? p.roll : wrapAngle(f.roll + wrapAngle(p.roll - f.roll) * damp(12, dt));
    this._displayValid = true;

    f.pinching = p.pinching;
    f.gesture = p.gesture;
    f.fingers = p.fingers;
    f.fist = !p.pinching && p.shape === 'fist';
    f.open = !p.pinching && p.shape === 'open';

    // --- two hands: zoom from the change of distance between the palms (spread = zoom in)
    const visible = this._visibleHands(now);
    f.twoHands = visible.length >= 2;
    if (f.twoHands) {
      const [h0, h1] = visible;
      const d = Math.hypot(h0.palmNdc.x - h1.palmNdc.x, h0.palmNdc.y - h1.palmNdc.y);
      if (this._pairDistance !== null) this._zoomPending += (d - this._pairDistance) * ZOOM_GAIN;
      this._pairDistance = d;
    } else {
      this._pairDistance = null;
      this._zoomPending *= 0.5;
    }
    // Spread the zoom of each tracking frame over the following render frames.
    const z = this._zoomPending * damp(18, dt);
    this._zoomPending -= z;
    f.zoom = Math.abs(z) < 1e-6 ? 0 : z;

    f.hands.length = 0;
    for (const h of visible) f.hands.push(h.info);

    for (const e of this._pendingEvents) f.events.push(e);
    this._pendingEvents.length = 0;

    if (f.gesture !== this._lastGesture) {
      this._log('gesture', f.gesture);
      this._lastGesture = f.gesture;
    }
    if (f.pinching !== this._lastPinching) {
      this._log(f.pinching ? 'pinchstart' : 'pinchend');
      this._lastPinching = f.pinching;
    }
    this.debug.gesture = f.gesture;
    this.debug.fingers = f.fingers;
    return f;
  }

  /**
   * How long a hand survives detections that miss it: 200 ms, longer when tracking
   * itself runs slowly (CPU delegate on a weak device) so the hand never blinks.
   */
  get _lostMs() {
    const interval = this.debug.fps > 0 ? 1000 / this.debug.fps : 0;
    return Math.min(1000, Math.max(LOST_MS, interval * 2.2));
  }

  /** No detection ran at all for this long: the hand counts as lost (see isLost). */
  get _stallMs() {
    return this.debug.fps > 0 ? Math.max(STALL_MS, 3000 / this.debug.fps) : 4000;
  }

  /** Hands seen recently, primary first. */
  _visibleHands(now) {
    const lost = this._lostMs;
    const stall = this._stallMs;
    const list = this.hands.filter((h) => !h.isLost(now, lost, stall));
    list.sort((a, b) => (a === this.primary ? -1 : b === this.primary ? 1 : 0));
    return list;
  }

  /** Run the landmarker on a new camera frame (if any). Returns true when it ran. */
  _maybeDetect(now) {
    const video = this._video;
    const lm = this.landmarker;
    if (!lm && !this._swapping && !this._landmarkerPromise && now >= this._pausedUntil) {
      // The model went away (failed CPU rebuild): try again every few seconds.
      this._ensureLandmarker().catch((err) => {
        console.warn('Hand tracking: could not reload the model', err);
        this._pausedUntil = performance.now() + 3000;
      });
    }
    if (!lm || !video || this._swapping || document.hidden) return false;
    if (video.readyState < 2 || !video.videoWidth) return false;
    // Only new camera frames (some browsers advance currentTime coarsely for live
    // streams, so re-check at least every 200 ms).
    if (video.currentTime === this._lastVideoTime && now - this._lastDetectAt < 200) return false;
    if (now < this._pausedUntil) return false;
    // Detection runs on the main thread and blocks the render frame it runs in. Give it at
    // most half of the main thread (detection every >= 2x its cost), but never less than
    // 4 detections per second, below which hand control is unusable anyway. So on a device
    // where one detection costs > 125 ms (much slower than any phone's CPU delegate), its
    // share goes above 50%.
    const minInterval = Math.min(250, this._detectMs / 0.5);
    if (now - this._lastDetectAt < minInterval) return false;

    const ts = Math.max(Math.round(now), this._lastTimestamp + 1);
    let result;
    const t0 = performance.now();
    try {
      result = lm.detectForVideo(video, ts);
    } catch (err) {
      this._lastTimestamp = ts;
      this._errors++;
      this.debug.errors++;
      if (this._errors === 1) console.warn('Hand tracking: detection failed', err);
      if (this.delegate === 'GPU' && this._errors >= 3) this._fallbackToCpu();
      else if (this._errors >= 10) this._pausedUntil = now + 1000;
      return false;
    }
    const spent = performance.now() - t0;
    this._errors = 0;
    this._lastTimestamp = ts;
    this._lastVideoTime = video.currentTime;
    const interval = this._lastDetectAt > 0 ? now - this._lastDetectAt : 0;
    this._lastDetectAt = now;
    this._detectMs += (spent - this._detectMs) * 0.1;
    // (Long intervals count too: on an overloaded device the rate itself is that low, and
    // the loss / stall timeouts must grow with it. A hidden tab's pause does not count.)
    if (interval > 0 && interval < 10000) {
      const fps = 1000 / interval;
      this.debug.fps = this.debug.fps ? this.debug.fps + (fps - this.debug.fps) * 0.12 : fps;
    }
    this.debug.detectMs = Math.round(this._detectMs * 10) / 10;
    this.debug.frames++;
    // A GPU delegate this slow after warm-up means software WebGL hiding behind a masked
    // renderer name: the CPU (WASM SIMD) path is several times faster there.
    if (this.delegate === 'GPU' && this.debug.frames - this._delegateSince > 30 && this._detectMs > 90) {
      console.warn(`Hand tracking: GPU delegate is slow (${Math.round(this._detectMs)} ms), switching to CPU.`);
      this._fallbackToCpu();
    }

    // Stamp the hands with the time the result became available.
    this._ingest(result, video.videoWidth / video.videoHeight, performance.now());
    return true;
  }

  /** Match detections to tracked hands, update them, pick the primary, detect swipes. */
  _ingest(result, aspect, now) {
    const marks = result?.landmarks || [];
    const labels = result?.handedness || result?.handednesses || [];
    const lost = this._lostMs;
    const stall = this._stallMs;
    // Forget hands that have been gone for a while. A recently lost one that comes back keeps
    // its identity (so it stays the primary hand) but restarts its gesture state.
    for (let i = this.hands.length - 1; i >= 0; i--) {
      const h = this.hands[i];
      if (h.isLost(now, lost, stall) && now - h.lastSeen > Math.max(RETAIN_MS, lost * 3)) this.hands.splice(i, 1);
    }
    const dets = marks.map((raw, i) => {
      // MediaPipe's labels assume a mirrored image; ours is raw, so swap them.
      const label = labels[i]?.[0]?.categoryName;
      const handedness = label === 'Left' ? 'Right' : label === 'Right' ? 'Left' : 'Right';
      const px = 1 - (raw[0].x * 0.4 + (raw[5].x + raw[9].x + raw[13].x + raw[17].x) * 0.15);
      const py = raw[0].y * 0.4 + (raw[5].y + raw[9].y + raw[13].y + raw[17].y) * 0.15;
      return { raw, handedness, px, py, hand: null };
    });

    // Greedy nearest-palm matching (handedness disagreement costs a little). How far a
    // palm may have moved grows with the time since it was last seen: a fast flick covers
    // a third of the picture between two detections when tracking runs at a few fps.
    const pairs = [];
    for (const d of dets) {
      for (const h of this.hands) {
        const gap = now - h.lastSeen;
        const cost = Math.hypot(d.px - h.palmImg.x, d.py - h.palmImg.y)
          + (d.handedness === h.handedness ? 0 : 0.08)
          + (h.isLost(now, lost, stall) ? 0.05 : 0);
        const reach = 0.3 + 2.0 * Math.min(0.25, gap / 1000);
        pairs.push({ d, h, cost, reach });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const used = new Set();
    for (const { d, h, cost, reach } of pairs) {
      if (d.hand || used.has(h) || cost > reach) continue;
      d.hand = h;
      used.add(h);
    }
    // ~3 frames / 80 ms to accept a new gesture; 2 frames when tracking runs slowly.
    const minFrames = this.debug.fps > 0 && this.debug.fps < 14 ? 2 : 3;
    for (const h of this.hands) if (!used.has(h)) h.misses++;
    for (const d of dets) {
      if (!d.hand) {
        d.hand = new TrackedHand(this._nextId++, now);
        this.hands.push(d.hand);
      }
      d.hand.stabilizer.minFrames = minFrames;
      d.hand.fingerStabilizer.minFrames = minFrames;
      // A miss of a frame or two keeps the hand's state (and its swipe eligibility);
      // after a real loss (see isLost) it starts fresh.
      d.hand.update(d.raw, d.handedness, aspect, now, lost, stall);
    }
    this.debug.handsVisible = dets.length;

    // Primary: keep the same hand while it is tracked, else a hand of the same side as the
    // last primary (left-handed users), else the user's right hand, else the first.
    const prev = this.primary;
    const prevVisible = !!prev && this.hands.includes(prev) && !prev.isLost(now, lost, stall);
    const last = this._lastHandedness;
    if (!prevVisible) {
      const seen = dets.map((d) => d.hand);
      this.primary = (last && seen.find((h) => h.handedness === last))
        || seen.find((h) => h.handedness === 'Right') || seen[0] || null;
      if (this.primary !== prev) {
        this._resetSwipes();
        this._displayValid = this._displayValid && !!prev && !!this.primary;
        this._primarySince = now;
      }
    } else if (last && prev.handedness !== last && now - this._primarySince < RETAIN_MS) {
      // The other hand only took over because the user's own hand dropped out for a
      // moment (it was the only one left): give control back as soon as it is tracked again.
      const back = dets.find((d) => d.hand !== prev && d.hand.handedness === last && d.hand.streak >= minFrames);
      if (back) {
        this.primary = back.hand;
        this._resetSwipes();
        this._primarySince = now;
      }
    }

    const p = this.primary;
    if (p && p.lastSeen === now && (!last || now - this._primarySince >= RETAIN_MS)) {
      this._lastHandedness = p.handedness;
    }
    const swipe = this._swipeDetector();
    if (p && p.lastSeen === now) {
      this.debug.rawGesture = p.rawShape;
      this.debug.pinchDistance = Math.round(p.analysis.pinchDist * 100) / 100;
      const twoHands = this._visibleHands(now).length >= 2;
      // Only a hand that has been tracked for a few frames and is a steady open palm can
      // swipe (a hand entering the picture from the side is not a swipe).
      const eligible = !twoHands && !p.pinching && p.shape === 'open' && p.streak >= minFrames;
      const interval = this.debug.fps > 0 ? 1000 / this.debug.fps : 0;
      // Same physical flick near or far from the camera (the detector takes the square root).
      const size = p.scale2D / DEPTH_NEUTRAL_SCALE;
      const event = swipe.update(now, p.rawPalmNdc.x, p.rawPalmNdc.y, eligible, interval, size);
      const samples = this.debug.samples;
      samples.push([Math.round(now - this._t0), +p.rawPalmNdc.x.toFixed(2), +p.rawPalmNdc.y.toFixed(2), p.rawShape]);
      if (samples.length > 30) samples.shift();
      if (event) {
        this._pendingEvents.push(event);
        this._log(event);
      }
    } else {
      // The primary hand was not found in this camera frame. Fast flicks blur the hand, so
      // MediaPipe often misses a frame mid-swipe: keep the motion through a miss or two
      // (the detector bridges the gap). A longer loss means a jump on re-entry is not a swipe.
      const interval = this.debug.fps > 0 ? 1000 / this.debug.fps : 33;
      if (!p || now - p.lastSeen > Math.max(80, interval * 2.2)) swipe.reset();
      this.debug.samples.push([Math.round(now - this._t0), null]);
      if (this.debug.samples.length > 30) this.debug.samples.shift();
    }
  }

  /**
   * The swipe detector for the active scene: strict in scenes that steer with hand
   * movement (meta.swipe === 'strict'). Switching starts the new one from scratch (but
   * keeps the cooldown of a swipe that just fired, e.g. the one that changed the scene).
   */
  _swipeDetector() {
    const strict = this.app.active?.meta?.swipe === 'strict';
    const det = strict ? this.strictSwipe : this.swipe;
    if (det !== this._swipeInUse) {
      det.reset();
      det.lastSwipe = Math.max(det.lastSwipe, this._swipeInUse.lastSwipe);
      this._swipeInUse = det;
      this.debug.swipeMode = strict ? 'strict' : 'normal';
    }
    return det;
  }

  _resetSwipes() {
    this.swipe.reset();
    this.strictSwipe.reset();
  }

  _log(type, value) {
    const e = { type, t: Math.round(performance.now() - this._t0) };
    if (value !== undefined) e.value = value;
    const list = this.debug.lastEvents;
    list.push(e);
    if (list.length > 20) list.shift();
  }

  // ------------------------------------------------------------------ camera preview

  _showPreview(show) {
    if (!this.preview || show === this._previewShown) return;
    this._previewShown = show;
    this.preview.hidden = !show;
  }

  _syncPreview(detected, now) {
    const show = this._running && !!this.app.settings?.showPreview && !!this.ctx;
    this._showPreview(show);
    if (!show) return;
    if (detected || !this._previewDrawn) this._drawPreview(now);
  }

  _drawPreview(now) {
    const video = this._video;
    const ctx = this.ctx;
    if (!video || !video.videoWidth) return;
    const W = PREVIEW_WIDTH;
    const H = Math.round((PREVIEW_WIDTH * video.videoHeight) / video.videoWidth);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this._previewDrawn = true;

    // Mirrored video, dimmed so the skeleton reads well.
    ctx.setTransform(-1, 0, 0, 1, W, 0);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fillRect(0, 0, W, H);
    // Dark band at the bottom so the caption stays readable on bright rooms.
    if (!this._band || this._band.h !== H) {
      const g = ctx.createLinearGradient(0, H * 0.7, 0, H);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
      this._band = { h: H, g };
    }
    ctx.fillStyle = this._band.g;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);

    // The part of the camera image that covers the whole screen.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(REGION.x0 * W + 0.5, REGION.y0 * H + 0.5, (REGION.x1 - REGION.x0) * W, (REGION.y1 - REGION.y0) * H);
    ctx.setLineDash([]);

    const visible = this._visibleHands(now);
    // Draw the secondary hand first so the primary sits on top.
    for (let i = visible.length - 1; i >= 0; i--) {
      const h = visible[i];
      const primary = h === this.primary;
      const color = primary ? ACCENT : SECONDARY;
      const L = h.img;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = primary ? 0.95 : 0.7;
      ctx.lineWidth = primary ? 2.4 : 1.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = primary ? 8 : 0;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(L[a].x * W, L[a].y * H);
        ctx.lineTo(L[b].x * W, L[b].y * H);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      for (let j = 0; j < 21; j++) {
        const tip = j === 4 || j === 8 || j === 12 || j === 16 || j === 20;
        ctx.beginPath();
        ctx.arc(L[j].x * W, L[j].y * H, tip ? 3 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pinch indicator between thumb and index: a ring that fills when pinching.
      const mx = ((L[4].x + L[8].x) / 2) * W;
      const my = ((L[4].y + L[8].y) / 2) * H;
      if (h.pinching) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(mx, my, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (h.pinch > 0.25) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4 + h.pinch * 0.5;
        ctx.beginPath();
        ctx.arc(mx, my, 6 + (1 - h.pinch) * 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const p = this.primary && visible.includes(this.primary) ? this.primary : null;
    const fps = Math.round(this.debug.fps);
    const label = p ? GESTURE_LABEL[p.gesture] || p.gesture : 'Show your hand';
    const text = `${label}${visible.length > 1 ? ' · 2 hands' : ''} · ${fps} fps`;
    if (text !== this._captionText) {
      this._captionText = text;
      this.caption.textContent = text;
    }
  }
}

/** Resolve once the video has decoded at least one frame. */
function waitForFrames(video, timeoutMs) {
  if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      const err = new Error('The camera did not send any picture.');
      err.name = 'NotReadableError';
      reject(err);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', done);
      video.removeEventListener('canplay', done);
      video.removeEventListener('playing', done);
    };
    video.addEventListener('loadeddata', done);
    video.addEventListener('canplay', done);
    video.addEventListener('playing', done);
  });
}
