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
  constructor() {
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
    this.state = 'running';
    return Promise.resolve();
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

const { AudioEngine } = await import('../js/audio/AudioEngine.js');

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
  assert.ok(Math.abs(g.master.gain.target - 0.49) < 1e-9, `master ${g.master.gain.target}`);
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
  assert.ok(Math.abs(g.master.gain.target - 0.25) < 1e-9);
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
    // Never booked further ahead than the look-ahead window.
    const latest = Math.max(...e.ctx.nodes.filter((n) => n.started !== undefined).map((n) => n.started));
    assert.ok(latest <= e.ctx.currentTime + 0.16, `booked ${latest - e.ctx.currentTime}s ahead`);
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
  e.ctx.state = 'suspended';
  step(e, 0.5);
  assert.equal(e.running, false);
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
  assert.equal(cur.out.gain.target, 1, 'new mood fades in');
  // Old moods are disposed once their tails are over.
  step(e, 8, 1 / 30);
  assert.equal(e.music.players.length, 1);
  assert.equal(e.music.zombies.length, 0);
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
