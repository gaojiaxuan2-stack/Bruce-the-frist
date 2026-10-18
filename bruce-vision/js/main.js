// main.js — boots the camera + trackers and runs the frame loop.

import { Gfx } from './gfx.js';
import { Tracker } from './tracker.js';
import { GestureEngine } from './gestures.js';
import { Sfx } from './sfx.js';
import { UI } from './ui.js';
import { drawHand } from './draw.js';
import { Sim } from './sim.js';
import { MODES } from './modes/index.js';

const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const video = $('#cam');
const glCanvas = $('#gl');
const fxCanvas = $('#fx');
const ctx = fxCanvas.getContext('2d');

const app = {
  W: 1, H: 1, dpr: 1,
  view: { ox: 0, oy: 0, dw: 1, dh: 1, vw: 1280, vh: 720, W: 1, H: 1 },
  modes: MODES,
  mode: null,
  face: null,
  hasMask: false,
  ready: false,      // hand model loaded
  started: false,    // camera (or sim) running
  t: 0,
  params,
};
app.toScreen = (nx, ny) => ({ x: app.view.ox + (1 - nx) * app.view.dw, y: app.view.oy + ny * app.view.dh });
app.view.toScreen = app.toScreen;

let gfx;
try {
  gfx = new Gfx(glCanvas);
} catch (e) {
  fatal('Your browser does not support WebGL2.', 'Try the latest Chrome, Edge, Firefox or Safari (iOS 15+).');
  throw e;
}
const sfx = new Sfx();
const tracker = new Tracker();
const gestures = new GestureEngine();
const sim = params.has('sim') ? new Sim(params.get('sim'), MODES) : null;
const useCamera = !sim || params.has('cam');
Object.assign(app, { gfx, sfx, tracker, gestures, ctx, sim });

const ui = new UI({
  modes: MODES,
  sfx,
  onMode: (id) => setMode(id),
  onOption: (id) => setOption(id),
  onAction: (id, el) => {
    if (id === 'sound') { sfx.unlock(); sfx.setEnabled(!sfx.enabled); syncSoundChip(); }
    if (id === 'save') saveSnapshot(el.dataset.url);
    if (id === 'opt-prev' || id === 'opt-next') {
      const opts = app.mode?.options || [];
      const i = opts.findIndex((o) => o.id === app.mode.option);
      if (opts.length) setOption(opts[(i + (id === 'opt-next' ? 1 : -1) + opts.length) % opts.length].id);
    }
  },
});
app.ui = ui;
app.setMode = (id) => setMode(id);
app.setOption = (id) => setOption(id);

// ---------------------------------------------------------------------------
// Modes
function setMode(id) {
  const m = MODES.find((x) => x.id === id) || MODES[0];
  if (app.mode === m) return;
  if (app.mode) safe(() => app.mode.exit?.(app), 'exit');
  sfx.stopAllLoops();
  app.mode = m;
  if (!m._inited) { safe(() => m.init?.(app), 'init'); m._inited = true; }
  if (m.option === undefined) m.option = m.options?.[0]?.id;
  safe(() => m.enter?.(app), 'enter');
  ui.setMode(m);
  if (app.started) { ui.toast(m.name, m.tagline || ''); sfx.play('mode'); }
  try { history.replaceState(null, '', location.pathname + location.search + '#' + m.id); } catch (e) { /* file:// */ }
  try { localStorage.setItem('bv.mode', m.id); } catch (e) { /* ignore */ }
  loadNeeds();
}

function setOption(id) {
  const m = app.mode;
  if (!m || m.option === id) return;
  m.option = id;
  safe(() => m.setOption?.(id, app), 'setOption');
  ui.setOption(id);
  loadNeeds();
}

function needs() {
  const m = app.mode;
  if (!m || !m.needs) return {};
  return typeof m.needs === 'function' ? m.needs(app) || {} : m.needs;
}

// Warm up the face + body models in the background a few seconds after
// start, so opening Spider-Man (or its Portal filter) doesn't stall.
function preloadModels() {
  if (sim && !useCamera) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  setTimeout(() => idle(() => {
    tracker.ensure('face').then(() => tracker.ensure('segment')).catch(() => {});
  }), 4000);
}

function loadNeeds() {
  const n = needs();
  if (!n.segment) { gfx.clearMask(); app.hasMask = false; }
  if (!n.face) app.face = null;
  for (const kind of ['face', 'segment']) {
    if (!n[kind] || (kind === 'face' ? tracker.face : tracker.segmenter)) continue;
    app.loading = kind;
    tracker.ensure(kind).then(() => { if (app.loading === kind) app.loading = null; }).catch(() => {
      app.loading = null;
      ui.toast('Could not load', kind === 'face' ? 'face tracking' : 'background tracking');
    });
  }
}

const errored = new Set();
function safe(fn, where) {
  try { return fn(); } catch (e) {
    const key = `${app.mode?.id}:${where}`;
    if (!errored.has(key)) { errored.add(key); console.error(`[mode ${key}]`, e); }
  }
}

// ---------------------------------------------------------------------------
// Layout
// WebGL resolution scale (device px per CSS px). It drops while the frame
// rate is low (phones running heavy effects) and recovers when there is room.
let glScale = 0, glScaleAt = 0;
function glScaleRange() {
  const max = Math.min(app.dpr, 1.5);
  return [Math.max(0.75, max * 0.6), max];
}

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  app.W = W; app.H = H; app.dpr = dpr;
  const [lo, hi] = glScaleRange();
  glScale = glScale ? Math.min(hi, Math.max(lo, glScale)) : hi;
  gfx.resize(W, H, glScale);
  fxCanvas.width = Math.round(W * dpr); fxCanvas.height = Math.round(H * dpr);
  layoutVideo();
}

function layoutVideo() {
  const src = currentSource();
  const vw = (src === video ? video.videoWidth : src.width) || 1280;
  const vh = (src === video ? video.videoHeight : src.height) || 720;
  const s = Math.max(app.W / vw, app.H / vh);  // cover
  const dw = vw * s, dh = vh * s;
  Object.assign(app.view, { vw, vh, dw, dh, ox: (app.W - dw) / 2, oy: (app.H - dh) / 2, W: app.W, H: app.H });
  gfx.setVideoRect(app.view.ox, app.view.oy, dw, dh, vw, vh);
}

function currentSource() { return useCamera ? video : sim.canvas; }

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------------------------------------------------------------------
// Face landmarks -> screen px, lightly smoothed.
function ingestFace(raw, t) {
  if (raw === undefined) return;  // detector skipped this frame
  if (raw === null) {
    if (app.face && t - app.face.seen > 250) app.face = null;
    return;
  }
  const n = raw.landmarks.length;
  const prev = app.face;
  const lm = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = raw.landmarks[i];
    const s = app.toScreen(p.x, p.y);
    lm[i] = { x: s.x, y: s.y, z: p.z * app.view.dw };
  }
  if (prev && prev.lm.length === n) {
    // Adaptive smoothing: follow fast motion, damp jitter when still.
    const move = Math.hypot(lm[1].x - prev.lm[1].x, lm[1].y - prev.lm[1].y);
    const a = Math.min(1, 0.35 + move / 25);
    for (let i = 0; i < n; i++) {
      lm[i].x = prev.lm[i].x + (lm[i].x - prev.lm[i].x) * a;
      lm[i].y = prev.lm[i].y + (lm[i].y - prev.lm[i].y) * a;
      lm[i].z = prev.lm[i].z + (lm[i].z - prev.lm[i].z) * a;
    }
  }
  const L = lm[234], R = lm[454], top = lm[10], chin = lm[152];
  app.face = {
    lm,
    blend: raw.blendshapes || {},
    center: { x: (L.x + R.x) / 2, y: (top.y + chin.y) / 2 },
    width: Math.hypot(R.x - L.x, R.y - L.y),
    height: Math.hypot(chin.x - top.x, chin.y - top.y),
    angle: Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x),
    seen: t,
  };
}

// ---------------------------------------------------------------------------
// Two thumbs up (held) = snapshot.
let snapHold = 0, snapCooldown = 0;
function checkSnapshot(frame) {
  const ups = frame.hands.filter((h) => h.is('thumbsUp'));
  if (ups.length === 2 && frame.t > snapCooldown) {
    snapHold += frame.dt;
    if (snapHold > 0.6) { snapHold = 0; snapCooldown = frame.t + 2.5; takeSnapshot(); }
  } else snapHold = 0;
}

let wantSnapshot = false;
function takeSnapshot() { wantSnapshot = true; }
function captureNow() {
  wantSnapshot = false;
  try {
    const c = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(fxCanvas.width, fxCanvas.height));
    c.width = Math.round(fxCanvas.width * scale); c.height = Math.round(fxCanvas.height * scale);
    const g = c.getContext('2d');
    g.drawImage(glCanvas, 0, 0, c.width, c.height);
    g.drawImage(fxCanvas, 0, 0, c.width, c.height);
    g.font = `700 ${Math.round(c.height * 0.035)}px Orbitron, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.textAlign = 'right';
    g.fillText('BRUCE//VISION', c.width - 16, c.height - 16);
    const url = c.toDataURL('image/jpeg', 0.9);
    ui.addSnapshot(url);
    const f = $('#flash');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    sfx.play('shutter');
    ui.toast('SNAP!', 'Point at the photo to save it');
  } catch (e) { console.error('snapshot failed', e); }
}

function saveSnapshot(url) {
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `bruce-vision-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  ui.toast('SAVED', '');
}

// ---------------------------------------------------------------------------
// Frame loop
function adaptResolution(now) {
  if (sim || now - glScaleAt < 2500) return;
  const [lo, hi] = glScaleRange();
  const next = fps < 42 ? Math.max(lo, glScale - 0.15) : fps > 57 ? Math.min(hi, glScale + 0.15) : glScale;
  if (Math.abs(next - glScale) < 0.01) return;
  glScale = next;
  glScaleAt = now;
  gfx.resize(app.W, app.H, glScale);
}

let lastNow = 0, lastVideoTime = -1, fps = 60, detFps = 30, lastDetAt = 0, statusAt = 0, detMs = 10;
let hands = [];
function loop(now) {
  requestAnimationFrame(loop);
  const realDt = lastNow ? Math.min(0.5, (now - lastNow) / 1000) : 1 / 60;
  const dt = Math.min(0.1, realDt);  // physics-safe step; realDt is for timers
  lastNow = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  app.t = now / 1000;
  if (!app.started || !app.mode) return;

  const src = currentSource();
  if (sim && !useCamera) sim.drawBackground(now);
  const vw = src === video ? video.videoWidth : src.width;
  if (vw && vw !== app.view.vw) layoutVideo();

  let events = [];
  const fresh = src === video ? video.readyState >= 2 && video.currentTime !== lastVideoTime : true;
  // On a 60 fps camera, slow devices only track every other frame so the
  // picture keeps rendering smoothly (prediction fills the gaps).
  const due = !lastDetAt || now - lastDetAt >= (detMs > 12 ? 28 : 0);
  if (fresh) {
    lastVideoTime = video.currentTime;
    gfx.updateVideo(src);
  }
  if (fresh && due) {
    let det = { hands: [] };
    if (app.ready) {
      const n = needs();
      if (!n.face) app.face = null;
      if (!n.segment && app.hasMask) { gfx.clearMask(); app.hasMask = false; }
      // Modes may ask for a model only some of the time; load it on first ask.
      if (n.face && !tracker.face) tracker.ensure('face').catch(() => {});
      if (n.segment && !tracker.segmenter) tracker.ensure('segment').catch(() => {});
      const t0 = performance.now();
      det = tracker.detect(src, n, { hands: !sim });
      detMs += (performance.now() - t0 - detMs) * 0.1;
      if (lastDetAt) detFps += (1000 / Math.max(1, now - lastDetAt) - detFps) * 0.1;
      lastDetAt = now;
      ingestFace(det.face, now);
      if (det.mask) { gfx.setMask(det.mask.bytes, det.mask.w, det.mask.h); app.hasMask = true; }
    }
    if (sim) det.hands = sim.hands(now, app.view);
    if (app.ready || sim) {
      const r = gestures.update(det.hands, now, app.view);
      hands = r.hands;
      events = r.events;
    }
  } else if (sim) {
    // Scripted hands don't wait for camera frames (a slow fake camera
    // would otherwise make them stutter).
    const r = gestures.update(sim.hands(now, app.view), now, app.view);
    hands = r.hands;
    events = r.events;
  }
  gestures.predict(now);
  adaptResolution(now);

  const frame = {
    t: app.t, dt, realDt, now, hands, events, face: app.face, hasMask: app.hasMask,
    W: app.W, H: app.H, view: app.view, ready: app.ready, option: app.mode.option,
  };
  app.frame = frame;

  ui.update(frame);
  checkSnapshot(frame);
  const mode = app.mode;
  safe(() => mode.update?.(frame, app), 'update');

  // WebGL layer: camera + shader effects.
  gfx.time = app.t;
  gfx.bindTarget(null);
  if (mode.renderGL) safe(() => mode.renderGL(gfx, frame, app), 'renderGL');
  else gfx.drawVideo();

  // 2D layer: skeletons, mode overlay, UI cursors.
  ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  ctx.clearRect(0, 0, app.W, app.H);
  if (mode.skeleton !== false) {
    const style = typeof mode.skeleton === 'object' ? mode.skeleton : {};
    for (const h of hands) drawHand(ctx, h, style);
  }
  safe(() => mode.draw2D?.(ctx, frame, app), 'draw2D');
  ui.draw(ctx, frame);
  if (wantSnapshot) captureNow();

  if (now - statusAt > 500) {
    statusAt = now;
    if (!app.ready) ui.setStatus(`LOADING ${Math.round((app.progress || 0) * 100)}%`, 'loading');
    else if (app.loading) ui.setStatus(`LOADING ${app.loading === 'face' ? 'FACE' : 'BODY'} AI…`, 'loading');
    else ui.setStatus(`${hands.length ? hands.length + (hands.length > 1 ? ' HANDS' : ' HAND') : 'NO HANDS'} · ${Math.round(fps)} FPS`, hands.length ? 'ok' : 'idle');
  }
}

// ---------------------------------------------------------------------------
// Boot
function fatal(title, detail) {
  $('#splash').classList.add('error');
  $('#splash-msg').innerHTML = `<b>${title}</b><br>${detail}`;
}

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? 'No camera API in this browser.' : 'Camera needs HTTPS (or localhost).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    // 60 fps where the camera can (computers) halves tracking latency; phones
    // stay at 30 to keep cool and leave GPU time for the effects.
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: coarsePointer() ? 30 : 60 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  await video.play();
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
}

let starting = false;
async function start() {
  if (starting || app.started) return;
  starting = true;
  sfx.unlock();
  const btn = $('#start');
  btn.disabled = true;
  btn.textContent = 'STARTING…';
  try {
    if (useCamera) await startCamera();
    sim?.restart();
    app.started = true;
    resize();
    document.body.classList.add('running');
    ui.toast(app.mode.name, app.mode.tagline || '');
  } catch (e) {
    console.error(e);
    starting = false;
    btn.disabled = false;
    btn.textContent = 'TRY AGAIN';
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    fatal(denied ? 'Camera access was blocked.' : 'Could not start the camera.',
      denied ? 'Allow camera access for this site in your browser settings, then try again.' : (e.message || String(e)));
  }
}

function syncSoundChip() {
  const b = $('#sound-chip');
  b.classList.toggle('off', !sfx.enabled);
  b.querySelector('.lbl .long').textContent = sfx.enabled ? 'SOUND ON' : 'SOUND OFF';
  b.querySelector('.lbl .short').textContent = sfx.enabled ? 'ON' : 'OFF';
}

async function boot() {
  resize();
  const fromHash = location.hash.slice(1);
  let saved = null;
  try { saved = localStorage.getItem('bv.mode'); } catch (e) { /* ignore */ }
  setMode((sim && sim.modeId) || fromHash || saved || MODES[0].id);
  // ?opt=<id> picks the mode's starting option (handy for links and tests).
  const opt = params.get('opt');
  if (opt && app.mode.options?.some((o) => o.id === opt)) setOption(opt);
  syncSoundChip();
  requestAnimationFrame(loop);

  $('#start').addEventListener('click', start);
  const bar = $('#progress i');
  tracker.init((p, label) => {
    app.progress = p;
    bar.style.width = `${Math.round(p * 100)}%`;
    $('#progress-label').textContent = `${label} · ${Math.round(p * 100)}%`;
  }).then(() => {
    app.ready = true;
    $('#progress-label').textContent = `Ready · ${tracker.delegate} accelerated`;
    document.body.classList.add('ready');
    loadNeeds();
    preloadModels();
  }).catch((e) => {
    console.error(e);
    fatal('Could not load hand tracking.', e.message || String(e));
  });

  // Fonts used on canvas.
  document.fonts?.load?.('40px Bangers');
  document.fonts?.load?.('700 20px Orbitron');

  // Skip the start button when the camera was already allowed (or in sim).
  if (!useCamera) return start();
  try {
    const st = await navigator.permissions?.query({ name: 'camera' });
    if (st?.state === 'granted') start();
  } catch (e) { /* permissions API unsupported (e.g. Firefox): wait for the button */ }
}

// Number keys switch modes on a desktop (handy, but never required).
window.addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < MODES.length) setMode(MODES[i].id);
});
window.addEventListener('hashchange', () => setMode(location.hash.slice(1)));

// Small debug/test hook.
window.__bv = {
  app,
  setMode, setOption,
  state: () => ({
    mode: app.mode?.id, option: app.mode?.option, ready: app.ready, started: app.started,
    delegate: tracker.delegate, fps: Math.round(fps), detFps: Math.round(detFps), detMs: +detMs.toFixed(1), glScale,
    simT: sim ? +sim.time(performance.now()).toFixed(2) : undefined,
    face: !!app.face, mask: app.hasMask, errors: [...errored], trackerErrors: tracker.errors,
    hands: hands.map((h) => ({ id: h.id, pose: h.pose, pinching: h.pinching, side: h.side, handedness: h.handedness, ghost: h.ghost, x: Math.round(h.palm.x), y: Math.round(h.palm.y) })),
  }),
};

boot();
