// AudioEngine behaviour on a small mock of the Web Audio API (no sound card needed):
// lifecycle, routing (the microphone never reaches the speakers), settings gates,
// scheduled beats, rate limits, the charge watchdog, click-free envelopes, cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';

// ------------------------------------------------------------------ mock Web Audio

class MockParam {
  constructor(owner, name, value) {
    this.owner = owner;
    this.name = name;
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.check(v, t);
    this.events.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.check(v, t);
    this.events.push(['linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this.check(v, t);
    if (!(v > 0)) throw new RangeError(`exponential ramp to ${v} on ${this.owner.kind}.${this.name}`);
    this.events.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v, t, tau) {
    this.check(v, t);
    if (!(tau > 0)) throw new RangeError('timeConstant must be > 0');
    this.events.push(['target', v, t, tau]);
    return this;
  }
  cancelScheduledValues(t) {
    this.events = this.events.filter((e) => e[2] < t);
    return this;
  }
  check(v, t) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`non-finite automation ${v} @ ${t} on ${this.owner.kind}.${this.name}`);
  }
  /** Final target of the automation (what the value settles at). */
  get target() {
    return this.events.length ? this.events[this.events.length - 1][1] : this.value;
  }
}

class MockNode {
  constructor(ctx, kind, params = {}) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = new Set();
    for (const [k, v] of Object.entries(params)) this[k] = new MockParam(this, k, v);
    ctx.nodes.push(this);
  }
  connect(dest) {
    if (!dest) throw new TypeError('connect(undefined)');
    this.outputs.add(dest);
    return dest;
  }
  disconnect(dest) {
    if (dest) this.outputs.delete(dest);
    else this.outputs.clear();
  }
}

class MockSource extends MockNode {
  start(t = 0) {
    if (this.started !== undefined) throw new Error('start twice');
    this.started = t;
  }
  stop(t = 0) {
    if (this.started === undefined) throw new Error('stop before start');
    this.stopped = t;
  }
}

class MockAudioContext {
  static instances = [];
  /** iOS: a context created on pointerdown can't start until the touchend. */
  static blockResumeOnCreate = false;
  constructor() {
    this.blockResume = MockAudioContext.blockResumeOnCreate;
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.nodes = [];
    this.resumes = 0;
    this.destination = new MockNode(this, 'destination');
    MockAudioContext.instances.push(this);
  }
  resume() {
    this.resumes++;
    if (this.blockResume) return Promise.reject(new Error('NotAllowedError'));
    this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.suspends = (this.suspends || 0) + 1;
    this.setState('suspended');
    return Promise.resolve();
  }
  /** Like the browser: change the state, then tell the listener. */
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  getOutputTimestamp() {
    return { contextTime: Math.max(0, this.currentTime - 0.02), performanceTime: performance.now() };
  }
  createGain() {
    return new MockNode(this, 'gain', { gain: 1 });
  }
  createBiquadFilter() {
    return new MockNode(this, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
  }
  createOscillator() {
    return new MockSource(this, 'osc', { frequency: 440, detune: 0 });
  }
  createBufferSource() {
    return new MockSource(this, 'buffer', { playbackRate: 1, detune: 0 });
  }
  createStereoPanner() {
    return new MockNode(this, 'panner', { pan: 0 });
  }
  createDelay() {
    return new MockNode(this, 'delay', { delayTime: 0 });
  }
  createConvolver() {
    return new MockNode(this, 'convolver');
  }
  createWaveShaper() {
    const n = new MockNode(this, 'waveshaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }
  createDynamicsCompressor() {
    return new MockNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createAnalyser() {
    const a = new MockNode(this, 'analyser');
    a.fftSize = 2048;
    a.minDecibels = -100;
    a.maxDecibels = -30;
    a.smoothingTimeConstant = 0.8;
    Object.defineProperty(a, 'frequencyBinCount', { get: () => a.fftSize / 2 });
    a.fakeBytes = null;
    a.getByteFrequencyData = (arr) => arr.set(a.fakeBytes ? a.fakeBytes.subarray(0, arr.length) : new Uint8Array(arr.length));
    return a;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i], copyToChannel: (d, i) => data[i].set(d) };
  }
  createMediaElementSource(el) {
    const n = new MockNode(this, 'mediaElement');
    n.element = el;
    return n;
  }
  createMediaStreamSource(stream) {
    const n = new MockNode(this, 'mic');
    n.stream = stream;
    return n;
  }
}

class MockAudio {
  static failNext = false;
  constructor() {
    this.paused = true;
    this.listeners = {};
  }
  play() {
    if (MockAudio.failNext) {
      MockAudio.failNext = false;
      return Promise.reject(new Error('NotSupportedError'));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  load() {}
}

function makeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { getTracks: () => tracks, tracks };
}

globalThis.window = { AudioContext: MockAudioContext };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.Audio = MockAudio;
const revoked = [];
const realRevoke = URL.revokeObjectURL;
URL.revokeObjectURL = (u) => {
  revoked.push(u);
  realRevoke.call(URL, u);
};
let lastStream = null;
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  configurable: true,
  value: {
    getUserMedia: async (constraints) => {
      lastStream = makeStream();
      lastStream.constraints = constraints;
      return lastStream;
    },
  },
});

const { AudioEngine, LOOKAHEAD, PARK_AFTER, FIRST_FROM } = await import('../js/audio/AudioEngine.js');
const { volumeGain } = await import('../js/audio/graph.js');
const { ENTRY_ATTACK } = await import('../js/audio/instruments.js');

// ------------------------------------------------------------------ helpers

/** Every node reachable from `from` through connections (params count as their node). */
function reachable(from) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const outs = n.outputs ? [...n.outputs] : [];
    for (const o of outs) stack.push(o instanceof MockParam ? o.owner : o);
  }
  return seen;
}

function makeEngine({ run = true, scene = 'galaxy' } = {}) {
  const app = { gui: null };
  const engine = new AudioEngine(app);
  engine.settings = { muted: false, volume: 0.7, music: true, effects: true, react: true };
  engine.setScene(scene);
  engine.unlock();
  if (run) engine.ctx.state = 'running';
  return engine;
}

/** Advance the mock clock, run the scheduler and one frame. */
function step(engine, seconds, dt = 1 / 60) {
  const ctx = engine.ctx;
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end - 1e-9) {
    ctx.currentTime += dt;
    if (engine.scheduler.running) engine._tick();
    engine.update(dt);
  }
}

// ------------------------------------------------------------------ tests

test('unlock creates one context, resumes it, and is cheap to repeat', () => {
  const before = MockAudioContext.instances.length;
  const e = new AudioEngine({});
  e.unlock();
  e.unlock();
  e.unlock();
  assert.equal(MockAudioContext.instances.length, before + 1);
  assert.ok(e.ctx.resumes >= 1);
  assert.equal(e.running, true);
  // iOS: an interrupted context is resumed by the next gesture.
  e.ctx.state = 'interrupted';
  const r = e.ctx.resumes;
  e.unlock();
  assert.equal(e.ctx.resumes, r + 1);
  e.dispose();
  assert.equal(e.ctx, null);
});

test('before unlock everything is safe and levels stay at 0 (override applies last)', () => {
  const e = new AudioEngine({});
  e.sfx('boom');
  e.charge(1);
  e.setScene('mirror');
  e.useGenerated();
  for (let i = 0; i < 10; i++) e.update(1 / 60);
  assert.deepEqual(e.levels, { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, beatCount: 0 });
  e.override = { bass: 0.9, beat: 1 };
  assert.equal(e.update(1 / 60).bass, 0.9);
  assert.equal(e.levels.beat, 1);
  e.override = null;
  e.dispose();
});

test('routing: music and song reach the analyser, effects do not, the mic never reaches the speakers', async () => {
  const e = makeEngine();
  const g = e.graph;
  const dest = e.ctx.destination;
  assert.ok(reachable(g.genBus).has(g.analyser), 'generated music is analysed');
  assert.ok(reachable(g.genBus).has(dest), 'generated music is heard');
  assert.ok(!reachable(g.sfxBus).has(g.analyser), 'effects are not analysed');
  assert.ok(reachable(g.sfxBus).has(dest));
  await e.playFile(new Blob(['x']));
  const el = e.ctx.nodes.find((n) => n.kind === 'mediaElement');
  assert.ok(reachable(el).has(g.analyser) && reachable(el).has(dest), 'a song is analysed and heard');
  await e.useMic();
  assert.equal(e.source, 'mic');
  assert.deepEqual(lastStream.constraints, { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const mic = e.ctx.nodes.find((n) => n.kind === 'mic');
  assert.ok(reachable(mic).has(g.analyser), 'the mic is analysed');
  assert.ok(!reachable(mic).has(dest), 'the mic must never reach the speakers');
  e.dispose();
});

test('gates follow the settings every frame (volume curve, mute, music, effects)', () => {
  const e = makeEngine();
  const g = e.graph;
  e.update(1 / 60);
  assert.ok(Math.abs(g.master.gain.target - volumeGain(0.7)) < 1e-9, `master ${g.master.gain.target}`);
  assert.equal(g.musicBus.gain.target, 1);
  assert.equal(g.genBus.gain.target, 1);
  e.settings.muted = true; // the GUI checkbox writes the setting directly
  e.update(1 / 60);
  assert.equal(g.master.gain.target, 0);
  assert.equal(g.genBus.gain.target, 0, 'built-in music pauses while muted');
  e.settings.muted = false;
  e.settings.music = false;
  e.update(1 / 60);
  assert.equal(g.musicBus.gain.target, 0);
  assert.equal(g.musicWet.gain.target, 0);
  assert.equal(e.scheduler.running, false, 'no scheduling while music is off');
  e.settings.music = true;
  e.settings.effects = false;
  e.update(1 / 60);
  assert.equal(g.sfxBus.gain.target, 0);
  const n = e.ctx.nodes.length;
  e.sfx('chime');
  assert.equal(e.ctx.nodes.length, n, 'no nodes for effects that are off');
  e.setVolume(0.5);
  assert.ok(Math.abs(g.master.gain.target - volumeGain(0.5)) < 1e-9);
  // Unchanged settings don't add automation events.
  const events = g.master.gain.events.length;
  for (let i = 0; i < 20; i++) e.update(1 / 60);
  assert.equal(g.master.gain.events.length, events);
  e.dispose();
});

test('built-in music: notes are booked ahead, beats fire on the schedule at the mood tempo', () => {
  for (const [scene, bpm] of [['mirror', 118], ['blackhole', 60], ['test', 96]]) {
    const e = makeEngine({ scene });
    e.update(1 / 60);
    assert.equal(e.scheduler.running, true);
    step(e, 6);
    const st = e.stats;
    assert.equal(st.bpm, bpm);
    assert.ok(st.notes >= 6, `${scene}: ${st.notes} notes`);
    assert.ok(e.levels.beatCount >= Math.floor((5.5 * bpm) / 60) - 1, `${scene}: ${e.levels.beatCount} beats`);
    const log = e.beatLog.slice(-6);
    const intervals = log.slice(1).map((t, i) => t - log[i]);
    for (const iv of intervals) assert.ok(Math.abs(iv - 60 / bpm) < 0.02, `${scene}: beat interval ${iv}`);
    // Never booked further ahead than the look-ahead window (long enough to ride out a
    // scene load without gaps).
    const latest = Math.max(...e.ctx.nodes.filter((n) => n.started !== undefined).map((n) => n.started));
    assert.ok(latest <= e.ctx.currentTime + LOOKAHEAD + 0.01, `booked ${latest - e.ctx.currentTime}s ahead`);
    assert.equal(st.resyncs, 0, 'no restarts');
    e.scheduler.stop();
    e.dispose();
  }
});

test('beat value: 1 on the beat, 0 a quarter second later', () => {
  const e = makeEngine({ scene: 'mirror' });
  e.update(1 / 60);
  let maxBeat = 0;
  let sawZero = false;
  for (let i = 0; i < 240; i++) {
    step(e, 1 / 240, 1 / 240);
    maxBeat = Math.max(maxBeat, e.levels.beat);
    if (e.levels.beatCount > 0 && e.levels.beat === 0) sawZero = true;
  }
  assert.ok(maxBeat > 0.9, `max beat ${maxBeat}`);
  assert.ok(sawZero, 'beat falls back to 0 between beats');
  e.scheduler.stop();
  e.dispose();
});

test('levels follow the analyser and decay to 0 when nothing plays', () => {
  const e = makeEngine();
  const bytes = new Uint8Array(1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, 200 - i);
  e.graph.analyser.fakeBytes = bytes;
  step(e, 1);
  for (const k of ['level', 'bass', 'mid', 'treble']) assert.ok(e.levels[k] > 0.2, `${k} ${e.levels[k]}`);
  e.settings.muted = true;
  step(e, 2);
  for (const k of ['level', 'bass', 'mid', 'treble']) assert.equal(e.levels[k], 0, `${k} decays when muted`);
  assert.equal(e.levels.beat, 0);
  e.settings.muted = false;
  // The browser suspends the context and refuses to resume it (no gesture yet): levels
  // stay at 0 and the engine says it is not running (the HUD then shows "Tap for sound").
  e.ctx.blockResume = true;
  e.ctx.setState('suspended');
  step(e, 0.5);
  assert.equal(e.running, false);
  for (const k of ['level', 'bass', 'mid', 'treble']) assert.equal(e.levels[k], 0);
  e.dispose();
});

test('scene changes crossfade, and rapid switching keeps at most two moods alive', () => {
  const e = makeEngine({ scene: 'face' });
  e.update(1 / 60);
  for (const id of ['blackhole', 'galaxy', 'mirror', 'shapes', 'face', 'test']) {
    e.setScene(id);
    step(e, 0.05);
  }
  assert.equal(e.stats.mood, 'galaxy');
  assert.ok(e.music.players.length <= 2, `${e.music.players.length} players`);
  const cur = e.music.current.bus;
  assert.equal(cur.out.gain.target, cur.level, 'new mood fades in (to its loudness trim)');
  // Old moods are dropped once their fade is over; each mood has one bus, reused.
  step(e, 8, 1 / 30);
  assert.equal(e.music.players.length, 1);
  assert.ok(Object.keys(e.music.buses).length <= 5);
  assert.equal(e.stats.buses, 1, 'only the playing mood stays connected');
  // Same scene again: no restart.
  const p = e.music.current;
  e.setScene('test');
  assert.equal(e.music.current, p);
  e.scheduler.stop();
  e.dispose();
});

test('effects: all names play, each one is rate-limited, unknown names are ignored', () => {
  const e = makeEngine();
  for (const name of ['click', 'whoosh', 'chime', 'boom', 'pop', 'morph', 'sparkle']) {
    e.sfx(name, { intensity: 0.8, pan: -0.5 });
  }
  assert.equal(e.effects.played, 7);
  e.ctx.currentTime += 1;
  const played = e.effects.played;
  for (let i = 0; i < 10; i++) e.sfx('pop', { intensity: 1 });
  assert.equal(e.effects.played, played + 1, 'a burst of the same effect plays once');
  e.ctx.currentTime += 0.1;
  e.sfx('pop');
  assert.equal(e.effects.played, played + 2);
  e.sfx('nope');
  e.sfx('click', null);
  e.sfx('whoosh', { pan: 7, intensity: -3 });
  e.dispose();
});

test('charge: one persistent hum, fades out when level is 0 or the scene stops calling', async () => {
  const e = makeEngine();
  e.charge(0.6);
  e.charge(0.7);
  const v = e.hum.voice;
  assert.ok(v, 'hum started');
  e.charge(0.8);
  assert.equal(e.hum.voice, v, 'one voice, reused');
  assert.ok(v.out.gain.target > 0.05);
  e.charge(0);
  assert.equal(v.out.gain.target, 0, 'level 0 fades it out');
  e.charge(0.5);
  // The scene stops calling charge(): the hum fades by itself, then stops.
  await new Promise((r) => setTimeout(r, 350));
  e.update(1 / 60);
  assert.equal(e.hum.level, 0);
  assert.equal(v.out.gain.target, 0);
  e.hum.quietSince = performance.now() / 1000 - 2;
  e.update(1 / 60);
  assert.equal(e.hum.voice, null, 'stopped after being quiet');
  for (const o of v.oscs) assert.ok(o.stopped !== undefined);
  e.dispose();
});

test('envelopes are click-free: every voice gain starts at 0 and ends at 0', () => {
  const e = makeEngine({ scene: 'shapes' });
  e.update(1 / 60);
  for (const scene of ['shapes', 'face', 'blackhole', 'galaxy', 'mirror']) {
    e.setScene(scene);
    step(e, 3, 1 / 30);
  }
  for (const name of ['click', 'whoosh', 'chime', 'boom', 'pop', 'morph', 'sparkle']) {
    e.ctx.currentTime += 0.5;
    e.sfx(name, { intensity: 1 });
  }
  let checked = 0;
  for (const n of e.ctx.nodes) {
    if (n.kind !== 'gain') continue;
    const ev = n.gain.events;
    if (!ev.length || ev[0][0] !== 'set') continue; // gates use setTarget ramps
    if ([...n.outputs].some((o) => o instanceof MockParam)) continue; // FM depth, not audio
    checked++;
    assert.equal(ev[0][1], 0, 'envelope starts at 0');
    const last = ev[ev.length - 1];
    assert.ok(last[1] <= 1e-4, `envelope ends at ${last[1]}`);
    for (let i = 1; i < ev.length; i++) assert.ok(ev[i][2] >= ev[i - 1][2] - 1e-9, 'events in time order');
  }
  assert.ok(checked > 100, `${checked} envelopes checked`);
  // Every source that was started is also stopped (nothing runs forever).
  const sources = e.ctx.nodes.filter((n) => n.started !== undefined);
  const forever = sources.filter((n) => n.stopped === undefined);
  // Allowed to run until disposed: the tape-wobble LFO of the lo-fi mood and the hum.
  assert.ok(forever.length <= 2, `${forever.length} sources never stop`);
  e.scheduler.stop();
  e.dispose();
});

test('song file: plays, replaces the previous source, failures leave the state alone', async () => {
  const e = makeEngine();
  await e.useMic();
  const micStream = lastStream;
  await e.playFile(new Blob(['song']));
  assert.equal(e.source, 'file');
  assert.ok(micStream.tracks[0].stopped, 'mic tracks stopped');
  e.update(1 / 60);
  assert.equal(e.scheduler.running, false, 'generated music is stopped while a song plays');
  assert.ok(Math.abs(e.graph.fileBus.gain.target - 0.55) < 1e-9);
  const first = e._file;
  await e.playFile(new Blob(['song 2']));
  assert.notEqual(e._file, first);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(revoked.includes(first.url), 'old object URL revoked');
  assert.ok(first.el.paused);
  // A file that cannot play: rejects, keeps the current song.
  const current = e._file;
  MockAudio.failNext = true;
  await assert.rejects(e.playFile(new Blob(['bad'])));
  assert.equal(e._file, current);
  assert.equal(e.source, 'file');
  // Music off pauses the song; on plays it again.
  e.settings.music = false;
  e.update(1 / 60);
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(current.el.paused);
  e.settings.music = true;
  e.update(1 / 60);
  assert.equal(current.el.paused, false);
  e.useGenerated();
  assert.equal(e.source, 'generated');
  assert.equal(e._file, null);
  e.update(1 / 60);
  assert.equal(e.scheduler.running, true, 'built-in music resumes');
  e.scheduler.stop();
  e.dispose();
});

test('hidden page: scheduling pauses and the hum fades', () => {
  const e = makeEngine();
  e.update(1 / 60);
  e.charge(0.8);
  assert.equal(e.scheduler.running, true);
  document.hidden = true;
  e._tick(); // the timer notices first
  assert.equal(e.scheduler.running, false);
  assert.equal(e.hum.level, 0);
  e.update(1 / 60);
  assert.equal(e.graph.genBus.gain.target, 0);
  document.hidden = false;
  e.update(1 / 60);
  assert.equal(e.scheduler.running, true);
  e.scheduler.stop();
  e.dispose();
});

test('dispose closes the context and stops the timer', () => {
  const e = makeEngine();
  e.update(1 / 60);
  const ctx = e.ctx;
  e.dispose();
  assert.equal(ctx.state, 'closed');
  assert.equal(e.scheduler.running, false);
  e.update(1 / 60);
  e.sfx('click');
  e.charge(1);
  e.dispose();
});

// ------------------------------------------------------------------ sound must start and stay on

/** A page clock the test controls, plus frames that advance both clocks. */
function fakeTime(e, start = 100) {
  const clock = { t: start };
  e._now = () => clock.t;
  clock.run = (seconds, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      clock.t += dt;
      if (e.ctx.state === 'running') e.ctx.currentTime += dt;
      if (e.scheduler.running) e._tick();
      e.update(dt);
    }
  };
  return clock;
}

const blips = (ctx) => ctx.nodes.filter((n) => n.kind === 'buffer' && n.outputs.has(ctx.destination)).length;

test('iOS first tap: pointerdown cannot start sound, the touchend retries inside the gesture and the music starts at once', () => {
  const e = new AudioEngine({});
  e.settings = { muted: false, volume: 0.7, music: true, effects: true, react: true };
  e.setScene('face');
  MockAudioContext.blockResumeOnCreate = true;
  e.unlock(); // pointerdown: not a user activation on iOS
  MockAudioContext.blockResumeOnCreate = false;
  const ctx = e.ctx;
  assert.equal(e.running, false);
  assert.equal(ctx.resumes, 1);
  assert.equal(blips(ctx), 1, 'a silent sample with every try');
  e.update(1 / 60);
  assert.equal(e.scheduler.running, false);
  ctx.blockResume = false;
  e.unlock(); // touchend: counts
  assert.equal(ctx.resumes, 2);
  assert.equal(blips(ctx), 2);
  assert.equal(e.running, true);
  assert.equal(e.scheduler.running, true, 'the music starts on the state change, not a frame later');
  assert.ok(e.graph.genBus.gain.target === 1 && e.graph.master.gain.target > 0.9, 'gates open, default volume is loud');
  // Repeating unlock on later taps costs nothing.
  e.unlock();
  assert.equal(ctx.resumes, 2);
  e.scheduler.stop();
  e.dispose();
});

test('the engine resumes by itself after an iOS interruption or a browser suspend', () => {
  const e = makeEngine();
  const clock = fakeTime(e);
  clock.run(0.5);
  const ctx = e.ctx;
  ctx.blockResume = true; // a phone call: resume() can't succeed yet
  let r = ctx.resumes;
  ctx.setState('interrupted');
  assert.equal(ctx.resumes, r + 1, 'tries at once');
  assert.equal(e.running, false, 'the HUD offers "Tap for sound" meanwhile');
  clock.run(0.5);
  assert.equal(ctx.resumes, r + 1, 'no hammering');
  clock.run(1.5);
  assert.equal(ctx.resumes, r + 2, 'retries every couple of seconds');
  ctx.blockResume = false; // the call ended
  clock.run(1.6);
  assert.equal(ctx.state, 'running');
  assert.equal(e.scheduler.running, true);
  // A tab that comes back retries at once, and so does the next tap.
  ctx.blockResume = true;
  ctx.setState('suspended');
  r = ctx.resumes;
  e._onVisibility();
  assert.equal(ctx.resumes, r + 1);
  ctx.blockResume = false;
  e.unlock();
  assert.equal(ctx.state, 'running');
  e.scheduler.stop();
  e.dispose();
});

test('parking: the context sleeps only when nothing can be heard, and wakes at once', () => {
  const e = makeEngine();
  const clock = fakeTime(e);
  const ctx = e.ctx;
  clock.run(PARK_AFTER * 3);
  assert.equal(ctx.suspends ?? 0, 0, 'never while the music plays');
  e.settings.music = false;
  clock.run(PARK_AFTER * 2);
  assert.equal(ctx.suspends ?? 0, 0, 'never while effects can sound');
  e.settings.music = true;
  e.setMuted(true);
  clock.run(PARK_AFTER - 0.5);
  assert.equal(ctx.state, 'running', 'gates and tails first');
  clock.run(1);
  assert.equal(ctx.state, 'suspended');
  assert.equal(e.stats.parked, true);
  assert.equal(e.running, true, 'still "unlocked" for the HUD');
  // Any tap wakes it (iOS only resumes inside a gesture: the next action may be "unmute").
  e.unlock();
  assert.equal(ctx.state, 'running');
  assert.equal(e.stats.parked, false);
  clock.run(PARK_AFTER + 0.5);
  assert.equal(ctx.state, 'suspended', 'and it parks again');
  e.setMuted(false);
  assert.equal(ctx.state, 'running', 'unmute resumes at once');
  clock.run(0.3);
  assert.equal(e.scheduler.running, true);
  assert.equal(e.graph.genBus.gain.target, 1);
  // A background tab with the built-in music parks (the timer finishes the countdown,
  // as frames stop); coming back wakes it.
  document.hidden = true;
  e._onVisibility();
  clock.t += PARK_AFTER + 0.1;
  e._syncPark();
  assert.equal(ctx.state, 'suspended');
  document.hidden = false;
  e._onVisibility();
  assert.equal(ctx.state, 'running');
  e.scheduler.stop();
  e.dispose();
});

test('first start is heard at once: the fade starts at half level and slow swells come in fast', () => {
  const e = makeEngine({ scene: 'blackhole' });
  e.update(1 / 60);
  step(e, 1);
  const bus = e.music.current.bus;
  const first = bus.out.gain.events[0];
  assert.equal(first[0], 'target');
  assert.ok(Math.abs(first[1] - FIRST_FROM * bus.level) < 1e-9 && first[3] < 0.05, `first fade ${first}`);
  // Organ and drone swells (2-3.5 s attacks) in the first bar reach full level within ENTRY_ATTACK.
  let swells = 0;
  for (const n of e.ctx.nodes) {
    const ev = n.kind === 'gain' ? n.gain.events : [];
    if (ev.length < 2 || ev[0][0] !== 'set' || ev[1][0] !== 'linear') continue;
    swells++;
    assert.ok(ev[1][2] - ev[0][2] <= ENTRY_ATTACK + 1e-9, `attack ${ev[1][2] - ev[0][2]}`);
  }
  assert.ok(swells >= 2, `${swells} envelopes`);
  e.scheduler.stop();
  e.dispose();
});

test('a saved volume of (almost) 0 is reset to the default', () => {
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ volume: 0, music: true }), setItem() {} };
  try {
    assert.equal(new AudioEngine({}).settings.volume, 0.7);
    globalThis.localStorage.getItem = () => JSON.stringify({ volume: 0.4 });
    assert.equal(new AudioEngine({}).settings.volume, 0.4);
  } finally {
    globalThis.localStorage = saved;
  }
});

test('song-file beats pulse when the song is heard (after the output latency), microphone beats at once', async () => {
  const e = makeEngine();
  const ctx = e.ctx;
  ctx.outputLatency = 0.2;
  ctx.baseLatency = 0.01;
  await e.playFile(new Blob(['song']));
  const clock = fakeTime(e);
  const bytes = new Uint8Array(1024);
  e.graph.analyser.fakeBytes = bytes;
  const measure = (seconds) => {
    const delays = [];
    let lastBurst = null;
    let count = e.levels.beatCount;
    for (let k = 0; k < seconds * 60; k++) {
      const burst = k % 30 === 0;
      bytes.fill(90);
      if (burst) for (let i = 2; i < 10; i++) bytes[i] = 230;
      clock.run(1 / 60);
      if (burst) lastBurst = clock.t;
      if (e.levels.beatCount !== count) {
        count = e.levels.beatCount;
        if (lastBurst !== null && k > 60) delays.push(clock.t - lastBurst);
      }
    }
    return delays;
  };
  const file = measure(6);
  assert.ok(file.length >= 6, `${file.length} beats`);
  for (const d of file) assert.ok(Math.abs(d - 0.19) < 0.02, `file beat ${d.toFixed(3)} s after the analyser saw it`);
  await e.useMic();
  const mic = measure(6);
  assert.ok(mic.length >= 6);
  for (const d of mic) assert.ok(d < 0.02, `mic beat ${d.toFixed(3)} s late`);
  e.dispose();
});

test('no feedback loops anywhere, and one bus per mood, reused across visits', () => {
  const e = makeEngine({ scene: 'galaxy' });
  e.update(1 / 60);
  step(e, 1);
  const galaxyBus = e.music.buses.galaxy;
  for (const id of ['face', 'blackhole', 'mirror', 'shapes', 'galaxy']) {
    e.setScene(id);
    step(e, 2, 1 / 30);
  }
  assert.equal(Object.keys(e.music.buses).length, 5);
  assert.equal(e.music.buses.galaxy, galaxyBus, 'the galaxy bus is reused');
  assert.ok(galaxyBus.echoTail > 0 && galaxyBus.echoTail < 4);
  // Depth-first search for a cycle through connections (audio params count as their node).
  const state = new Map();
  const visit = (n) => {
    state.set(n, 1);
    for (const o of n.outputs) {
      const next = o instanceof MockParam ? o.owner : o;
      if (state.get(next) === 1) return true;
      if (!state.has(next) && visit(next)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const n of e.ctx.nodes) if (!state.has(n)) assert.equal(visit(n), false, `feedback loop through a ${n.kind}`);
  // Only the playing mood stays connected once the others' notes and fades are over.
  step(e, 25, 1 / 20);
  assert.equal(e.stats.buses, 1);
  e.scheduler.stop();
  e.dispose();
});

test('iOS before 17: a silent looping <audio> plays from the tap (the ring switch no longer mutes), paused while muted or hidden', () => {
  const made = [];
  const savedCreate = document.createElement;
  document.createElement = (tag) => {
    const el = new MockAudio();
    el.tag = tag;
    el.attrs = {};
    el.setAttribute = (k, v) => (el.attrs[k] = v);
    made.push(el);
    return el;
  };
  AudioEngine.iosLegacy = true;
  try {
    const e = makeEngine();
    assert.equal(made.length, 1);
    const el = made[0];
    assert.equal(el.tag, 'audio');
    assert.ok(el.loop && 'playsinline' in el.attrs && el.src.startsWith('blob:'));
    assert.equal(el.paused, false, 'started inside the unlocking gesture');
    e.setMuted(true);
    assert.equal(el.paused, true, 'muted: other apps keep their audio');
    e.setMuted(false);
    assert.equal(el.paused, false);
    document.hidden = true;
    e._onVisibility();
    assert.equal(el.paused, true);
    document.hidden = false;
    e._onVisibility();
    assert.equal(el.paused, false);
    e.unlock();
    assert.equal(made.length, 1, 'one element');
    e.scheduler.stop();
    e.dispose();
    assert.ok(revoked.includes(el.src));
  } finally {
    AudioEngine.iosLegacy = false;
    document.createElement = savedCreate;
  }
});
