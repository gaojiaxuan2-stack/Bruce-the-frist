// Sound for the site: generated music for each scene, gesture sound effects, and
// live analysis so the particles can move with whatever is playing.
//
// Browsers only allow sound after a user gesture, so the App calls unlock() from
// the first click / tap / key press.
//
// Everything is synthesised with the Web Audio API (no audio files, no libraries):
//   graph.js        buses, reverb, limiter, analyser
//   patterns.js     the music as data, one mood per scene (pure, deterministic)
//   instruments.js  the synthesised instruments
//   music.js        mood players, crossfades, beat times
//   scheduler.js    the look-ahead step clock
//   sfx.js          sound effects and the charging hum
//   analysis.js     band levels, normaliser, beat detector (pure)
//
// Power: when nothing can be heard for a few seconds (muted, Music and Effects off, or a
// background tab with no song playing), the AudioContext is suspended, so a muted page
// costs no audio CPU. It wakes up as soon as something could sound again.

import { BANDS, BEAT_BAND, BeatDetector, bandDb, bandPresence, beatPulse, binRange, makeBandNormalizers, makePowerTable, spectralFlux } from './analysis.js';
import { clamp } from './dsp.js';
import { AudioGraph } from './graph.js';
import { MusicEngine } from './music.js';
import { MOODS, moodFor } from './patterns.js';
import { LookaheadScheduler } from './scheduler.js';
import { ChargeHum, SfxPlayer } from './sfx.js';

const STORAGE_KEY = 'particle3d.sound';
/**
 * How far ahead the music is booked on the audio clock (s), and how often (ms). A long
 * horizon rides out main-thread stalls (scene loads, shader compiles) without gaps;
 * mute / music off / hidden use gain gates, so they still act at once.
 */
export const LOOKAHEAD = 0.45;
const TICK_MS = 25;
/** First start of the music: a slower, gentle fade-in. */
const FIRST_FADE = 2.5;
/** A song file is mastered much louder than the generated music: bring it down. */
const FILE_LEVEL = 0.55;
const BEAT_LENGTH = 0.25;
/** A scene that stops calling charge() lets the hum fade after this long (s). */
const CHARGE_TIMEOUT = 0.3;
/** Nothing audible for this long (s; gates and reverb tails have died away) → suspend the context. */
export const PARK_AFTER = 3;
/** After a scene change, re-learn the level range once the new mood dominates (s). */
const RESEED_AFTER = 0.8;
/** setScene() applies the new mood on the 2nd update() after it (after the scene's first, slow frame)… */
const MOOD_FRAMES = 2;
/** …or after this long at the latest (s). */
const MOOD_MAX_WAIT = 0.5;

const NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const pageHidden = () => typeof document !== 'undefined' && !!document.hidden;

/** iPhone / iPad without navigator.audioSession (iOS < 17): the ring / silent switch mutes Web Audio. */
const IOS_LEGACY = (() => {
  try {
    if (typeof navigator === 'undefined' || navigator.audioSession) return false;
    return /iP(hone|ad|od)/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
})();

/** A short silent WAV (8 kHz, 16-bit mono) as an object URL. */
function silentWavUrl(seconds = 0.5, rate = 8000) {
  const n = Math.round(seconds * rate);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
}

export class AudioEngine {
  constructor(app) {
    this.app = app;
    /** User settings, remembered in localStorage. */
    this.settings = { muted: false, volume: 0.7, music: true, effects: true, react: true };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
      /* storage blocked: keep defaults */
    }
    /**
     * Smoothed analysis, all 0..1. beat jumps to 1 on a beat and decays to 0 in ~0.25 s;
     * beatCount goes up by one per beat.
     */
    this.levels = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, beatCount: 0 };
    /** Test hook: force fields of `levels` every frame (null = off). */
    this.override = null;
    this.ctx = null;
    this.sceneId = null;
    this._source = 'generated';

    this.graph = null;
    this.music = null;
    this.effects = null;
    this.hum = null;
    this.scheduler = new LookaheadScheduler(() => this._tick(), { interval: TICK_MS });
    this.norm = makeBandNormalizers();
    this.detector = new BeatDetector();
    /** Last beat: { clock: 'audio' | 'page', t } */
    this._lastBeat = null;
    /** Recent beat times (audio clock for the built-in music, page clock otherwise). */
    this.beatLog = [];
    /** Song-file beats waiting for the speakers to catch up (page clock). */
    this._fileBeats = [];
    this._targets = {};
    this._file = null;
    this._mic = null;
    this._chargeAt = -Infinity;
    /** Scene whose mood starts after the scene's first frame: { id, frames, at } */
    this._pendingMood = null;
    this._reseedAt = 0;
    /** The context is suspended on purpose (nothing can be heard). */
    this._parked = false;
    this._parkSince = null;
    this._parkTimer = null;
    this._silentEl = null;
    this._onVisibility = () => {
      if (pageHidden()) this._sleep();
      this._iosUnmute();
      this._syncPark();
    };
  }

  /** Create / resume the AudioContext. Call from a user-gesture handler; safe to repeat. */
  unlock() {
    if (!this.ctx) {
      const Ctx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx({ latencyHint: 'interactive' });
      } catch {
        try {
          this.ctx = new Ctx();
        } catch {
          return;
        }
      }
      this._init();
    }
    const st = this.ctx.state;
    // 'interrupted' is iOS Safari after a call / Siri / another app took the audio.
    // A context we suspended ourselves (nothing to hear) stays asleep.
    if (st !== 'running' && st !== 'closed' && !(this._parked && this._parkWanted())) {
      this._parked = false;
      this._parkSince = null;
      this.ctx.resume().catch(() => {});
      // Older iOS only unlocks after a sound starts inside the gesture: play one silent sample.
      this._blip();
    }
    this._iosUnmute();
  }

  _init() {
    const ctx = this.ctx;
    this._audioSession(this.settings.muted ? 'ambient' : 'playback');
    // Phones: a shorter reverb tail is cheaper to convolve.
    this.graph = new AudioGraph(ctx, { reverbSeconds: this.app?.isMobile ? 1.8 : 2.6 });
    this.music = new MusicEngine(this.graph);
    this.effects = new SfxPlayer(this.graph);
    this.hum = new ChargeHum(this.graph);
    const a = this.graph.analyser;
    this._bytes = new Uint8Array(a.frequencyBinCount);
    this._prev = new Uint8Array(a.frequencyBinCount);
    this._power = makePowerTable(a.minDecibels, a.maxDecibels);
    this._ranges = {};
    for (const [name, [lo, hi]] of Object.entries(BANDS)) this._ranges[name] = binRange(ctx.sampleRate, a.fftSize, lo, hi);
    this._beatRange = binRange(ctx.sampleRate, a.fftSize, BEAT_BAND[0], BEAT_BAND[1]);
    this._db = { level: 0, bass: 0, mid: 0, treble: 0 };
    this._pendingMood = null;
    this.music.setMood(this.sceneId, FIRST_FADE);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
    this._applyGains();
  }

  /**
   * true once sound is unlocked and can play. (Also while the engine has put the context
   * to sleep because nothing can be heard: it wakes up by itself.)
   */
  get running() {
    const st = this.ctx?.state;
    return st === 'running' || (this._parked && st === 'suspended');
  }

  /** 'generated' | 'file' | 'mic' */
  get source() {
    return this._source;
  }

  /** Debug / test numbers: scheduler cost, current mood, notes played. */
  get stats() {
    const s = this.scheduler.stats;
    const players = this.music?.players ?? [];
    return {
      mood: this.music?.moodId ?? null,
      bpm: this.music?.bpm ?? 0,
      players: players.length,
      buses: this.music ? Object.values(this.music.buses).filter((b) => b.attached).length : 0,
      notes: players.reduce((n, p) => n + p.notes, 0),
      resyncs: players.reduce((n, p) => n + p.clock.resyncs, 0),
      ticks: s.calls,
      tickAvgMs: s.avgMs,
      tickMaxMs: s.maxMs,
      sfxPlayed: this.effects?.played ?? 0,
      sfxDropped: this.effects?.dropped ?? 0,
      charging: !!this.hum?.voice,
      state: this.ctx?.state ?? 'none',
      parked: this._parked,
    };
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  setMuted(muted) {
    this.settings.muted = !!muted;
    this.save();
    if (this.graph) {
      this._applyGains();
      this._syncPark();
    }
  }

  toggleMuted() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  setVolume(v) {
    this.settings.volume = v;
    this.save();
    if (this.graph) this._applyGains();
  }

  /**
   * Switch the generated music to this scene's mood (crossfade). The App calls this just
   * before the new scene's first frame, which can block the page for a while (shaders
   * compile), so the new mood starts on the second update() after it: its first bar is
   * booked after that stall instead of being cut by it.
   */
  setScene(id) {
    this.sceneId = id;
    if (!this.music) return;
    this._pendingMood = { id, frames: 0, at: this._now() };
  }

  /** The current mood (key for effects, tempo). */
  get mood() {
    const id = this._pendingMood ? this._pendingMood.id : this.music?.moodId ?? this.sceneId;
    return MOODS[moodFor(id)];
  }

  /**
   * One-shot sound effect.
   * @param {'click'|'whoosh'|'chime'|'boom'|'pop'|'morph'|'sparkle'} name
   * @param {{intensity?: number, pan?: number}} [opts] intensity 0..1, pan -1 (left) .. 1 (right)
   */
  sfx(name, opts = {}) {
    if (!this.effects || !this._live()) return;
    const s = this.settings;
    if (!s.effects || s.muted || pageHidden()) return;
    const mood = this.mood;
    this.effects.play(name, opts || {}, { root: mood.root, scale: mood.scale });
  }

  /** Continuous "charging" hum while a fist gathers particles: call every frame with 0..1, 0 to stop. */
  charge(level) {
    this._chargeAt = this._now();
    if (!this.hum || !this._live()) return;
    const s = this.settings;
    const lv = s.effects && !s.muted ? clamp(Number(level) || 0) : 0;
    this.hum.set(lv, this.mood.root);
  }

  /** Play the user's own song (an audio File); particles follow it. */
  async playFile(file) {
    this.unlock();
    if (!this.ctx) throw new Error('Sound is not supported in this browser');
    if (!file) throw new Error('No file');
    const ctx = this.ctx;
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.src = url;
    let node = null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    try {
      node = ctx.createMediaElementSource(el);
      node.connect(gain).connect(this.graph.fileBus);
      await new Promise((resolve, reject) => {
        el.addEventListener('error', () => reject(el.error || new Error('This file cannot be played')), { once: true });
        el.play().then(resolve, reject);
      });
    } catch (err) {
      el.pause();
      try {
        node?.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
      el.removeAttribute('src');
      el.load();
      URL.revokeObjectURL(url);
      throw err;
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.04);
    this._stopFile();
    if (this._mic) this._audioSession(this.settings.muted ? 'ambient' : 'playback');
    this._stopMic();
    this._file = { el, url, node, gain, want: true, pauseTimer: null };
    this._source = 'file';
    this._newSource();
    if (!this.settings.music) {
      // Choosing a song means "play music".
      this.settings.music = true;
      this.save();
      this._refreshGui();
    }
    this._applyGains();
    this._syncPark();
  }

  /** Listen to the microphone (music playing in the room); nothing is played back. */
  async useMic() {
    this.unlock();
    if (!this.ctx) throw new Error('Sound is not supported in this browser');
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md?.getUserMedia) throw new Error('This browser cannot use the microphone');
    this._audioSession('play-and-record');
    let stream;
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (err) {
      if (this._source !== 'mic') this._audioSession(this.settings.muted ? 'ambient' : 'playback');
      throw err;
    }
    const node = this.ctx.createMediaStreamSource(stream);
    // Analysis only: the microphone never reaches the speakers.
    node.connect(this.graph.analyserIn);
    this._stopFile();
    this._stopMic();
    this._mic = { stream, node };
    this._source = 'mic';
    this._newSource();
    this._applyGains();
    this._syncPark();
  }

  /** Back to the built-in music. */
  useGenerated() {
    this._stopFile();
    if (this._mic) this._audioSession(this.settings.muted ? 'ambient' : 'playback');
    this._stopMic();
    this._source = 'generated';
    this._newSource();
    if (this.graph) {
      this._applyGains();
      this._syncPark();
    }
  }

  /** Per frame: update `levels`. */
  update(dt) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    const now = this._now();
    if (this.graph) {
      this._syncPark();
      this._applyPendingMood(now);
      if (this._reseedAt && now >= this._reseedAt) {
        this._reseedAt = 0;
        this._reseed();
      }
      this._applyGains();
      this._syncGenerated();
      this._syncFile();
      if (this.hum.level > 0 && now - this._chargeAt > CHARGE_TIMEOUT) this.hum.set(0);
      this.hum.update(now);
      if (!this.scheduler.running) this.music.collect(this.ctx.currentTime);
      if (this._analysing()) this._analyse(dt, now);
      else this._silence(dt, now);
    } else {
      this._silence(dt, now);
    }
    if (this.override) Object.assign(this.levels, this.override);
    return this.levels;
  }

  dispose() {
    this.scheduler.stop();
    clearTimeout(this._parkTimer);
    this._parkTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    this._stopFile(true);
    this._stopMic();
    this.hum?.stop();
    this.music?.dispose();
    this.graph?.dispose();
    if (this._silentEl) {
      try {
        this._silentEl.pause();
        URL.revokeObjectURL(this._silentEl.src);
      } catch {
        /* ignore */
      }
      this._silentEl = null;
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.graph = null;
    this.music = null;
    this.effects = null;
    this.hum = null;
    this._targets = {};
    this._parked = false;
    this._pendingMood = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
  }

  // ------------------------------------------------------------------ internals

  /** Page clock in seconds (tests replace it). */
  _now() {
    return NOW();
  }

  /** The audio clock is actually running (not suspended by the browser or by us). */
  _live() {
    return this.ctx?.state === 'running';
  }

  /** Built-in music should be playing right now. */
  _generatedWanted() {
    const s = this.settings;
    return this._live() && s.music && !s.muted && this._source === 'generated' && !pageHidden();
  }

  /**
   * Nothing can be heard and nothing needs analysing: muted (the microphone keeps
   * listening), or neither music nor effects can sound (both off, or a background tab
   * without a song playing).
   */
  _parkWanted() {
    const s = this.settings;
    if (this._source === 'mic') return false;
    if (s.muted) return true;
    const hidden = pageHidden();
    const music = s.music && (this._source === 'file' ? !!this._file : !hidden);
    const effects = s.effects && !hidden;
    return !music && !effects;
  }

  /**
   * Suspend the context after PARK_AFTER seconds with nothing to hear (by then the gates
   * have closed and the reverb has died away, so stopping the clock can't click); resume
   * it as soon as something could sound. update() stops in a background tab, so a timer
   * finishes the countdown.
   */
  _syncPark() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (!this._parkWanted()) {
      this._parkSince = null;
      if (this._parkTimer !== null) {
        clearTimeout(this._parkTimer);
        this._parkTimer = null;
      }
      if (this._parked) {
        this._parked = false;
        ctx.resume().catch(() => {});
      }
      return;
    }
    if (this._parked || ctx.state !== 'running') return;
    const now = this._now();
    if (this._parkSince === null) {
      this._parkSince = now;
      clearTimeout(this._parkTimer);
      this._parkTimer = setTimeout(() => {
        this._parkTimer = null;
        this._syncPark();
      }, PARK_AFTER * 1000 + 50);
    }
    if (now - this._parkSince >= PARK_AFTER) {
      this._parked = true;
      this.hum?.stop();
      const p = ctx.suspend?.();
      if (p?.catch) p.catch(() => (this._parked = false));
    }
  }

  /** One silent sample, started inside a user gesture (unlocks older iOS). */
  _blip() {
    try {
      const ctx = this.ctx;
      const s = ctx.createBufferSource();
      s.buffer = this._blank || (this._blank = ctx.createBuffer(1, 1, ctx.sampleRate));
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* not needed */
    }
  }

  /**
   * iOS < 17 plays Web Audio in the "ambient" category, which the ring / silent switch
   * mutes while the 🔊 button says sound is on. A silent looping <audio> element, started
   * from a tap, moves the page to the "playback" category like a music app. It is paused
   * while muted or hidden (so other apps' audio and the lock screen are left alone).
   */
  _iosUnmute() {
    if (!IOS_LEGACY || typeof document === 'undefined') return;
    const want = !this.settings.muted && !pageHidden() && !!this.ctx;
    let el = this._silentEl;
    if (want && !el) {
      try {
        el = this._silentEl = document.createElement('audio');
        el.setAttribute('playsinline', '');
        el.setAttribute('x-webkit-airplay', 'deny');
        el.disableRemotePlayback = true;
        el.loop = true;
        el.preload = 'auto';
        el.src = silentWavUrl();
      } catch {
        this._silentEl = null;
        return;
      }
    }
    if (!el) return;
    if (want && el.paused) el.play().catch(() => {});
    else if (!want && !el.paused) el.pause();
  }

  /** Move a gate only when its target changes (cheap: no node churn, no automation spam). */
  _ramp(key, params, value, tau) {
    if (this._targets[key] === value) return false;
    this._targets[key] = value;
    this.graph.setGain(params, value, tau);
    return true;
  }

  _applyGains() {
    const s = this.settings;
    const g = this.graph;
    const vol = clamp(Number(s.volume) || 0);
    if (this._targets.muted !== s.muted) {
      // Muted: don't take the audio from other apps (iOS); playing: be a music app.
      this._targets.muted = s.muted;
      if (this._source !== 'mic') this._audioSession(s.muted ? 'ambient' : 'playback');
      this._iosUnmute();
    }
    this._ramp('master', g.master.gain, s.muted ? 0 : vol * vol, 0.06);
    this._ramp('music', [g.musicBus.gain, g.musicWet.gain], s.music ? 1 : 0, 0.1);
    this._ramp('sfx', [g.sfxBus.gain, g.sfxWet.gain], s.effects ? 1 : 0, 0.05);
    const gen = this._generatedWanted();
    this._ramp('gen', [g.genBus.gain, g.genWet.gain], gen ? 1 : 0, gen ? 0.12 : 0.2);
    this._ramp('file', g.fileBus.gain, this._source === 'file' ? FILE_LEVEL : 0, 0.1);
  }

  _applyPendingMood(now) {
    const pm = this._pendingMood;
    if (!pm || (++pm.frames < MOOD_FRAMES && now - pm.at < MOOD_MAX_WAIT)) return;
    this._pendingMood = null;
    const before = this.music.moodId;
    this.music.setMood(pm.id);
    if (this.music.moodId !== before) this._reseedAt = now + RESEED_AFTER;
  }

  _syncGenerated() {
    if (this._generatedWanted()) {
      if (!this.scheduler.running) {
        this.music.setPlaying(true);
        this.scheduler.start();
      }
    } else if (this.scheduler.running) {
      this.scheduler.stop();
      this.music.setPlaying(false);
    }
  }

  /** Look-ahead timer: book the music for the next LOOKAHEAD seconds. */
  _tick() {
    if (!this.ctx || !this.music) return;
    if (pageHidden()) {
      this._sleep();
      return;
    }
    const now = this.ctx.currentTime;
    this.music.schedule(now + LOOKAHEAD, now);
  }

  /** The page went to the background: stop booking notes, fade the hum. */
  _sleep() {
    if (this.scheduler.running) {
      this.scheduler.stop();
      this.music?.setPlaying(false);
    }
    if (this.hum?.voice) this.hum.set(0);
    if (this.graph) this._applyGains();
  }

  /** Song file: pause it while "Music" is off, play it again when it comes back. */
  _syncFile() {
    const f = this._file;
    if (!f) return;
    const want = !!this.settings.music;
    if (want === f.want) return;
    f.want = want;
    clearTimeout(f.pauseTimer);
    if (want) f.el.play().catch(() => {});
    else f.pauseTimer = setTimeout(() => f.el.pause(), 300); // after the fade-out
  }

  _stopFile(now = false) {
    const f = this._file;
    if (!f) return;
    this._file = null;
    clearTimeout(f.pauseTimer);
    const ctx = this.ctx;
    if (ctx && !now) f.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    const finish = () => {
      f.el.pause();
      try {
        f.node.disconnect();
        f.gain.disconnect();
      } catch {
        /* ignore */
      }
      f.el.removeAttribute('src');
      f.el.load();
      URL.revokeObjectURL(f.url);
    };
    if (now || !ctx) finish();
    else setTimeout(finish, 150);
  }

  _stopMic() {
    const m = this._mic;
    if (!m) return;
    this._mic = null;
    for (const track of m.stream.getTracks()) track.stop();
    try {
      m.node.disconnect();
    } catch {
      /* ignore */
    }
  }

  /** The music source changed: forget its beats, re-learn the level range quickly. */
  _newSource() {
    this.detector.reset();
    this._fileBeats.length = 0;
    this._reseed();
  }

  _reseed() {
    for (const n of Object.values(this.norm)) n.reseed();
  }

  /**
   * iOS 17+ audio session: 'playback' plays through the silent switch like a music app,
   * 'ambient' (muted) leaves other apps' audio alone, 'play-and-record' for the microphone.
   */
  _audioSession(type) {
    try {
      if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = type;
    } catch {
      /* not supported */
    }
  }

  _refreshGui() {
    try {
      for (const c of this.app?.gui?.controllersRecursive?.() ?? []) c.updateDisplay();
    } catch {
      /* the GUI is optional */
    }
  }

  /** Is anything playing that the particles should follow? */
  _analysing() {
    if (!this._live()) return false;
    const s = this.settings;
    if (this._source === 'mic') return !!this._mic;
    if (this._source === 'file') return !!this._file && s.music && !s.muted && !this._file.el.paused;
    return this._generatedWanted();
  }

  /**
   * Audio-clock time of the sound leaving the speakers right now (the scheduled beat
   * times are on the same clock, so beats line up with what is heard).
   */
  _playTime() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const est = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (est <= t + 0.02 && est > t - 0.5) return est;
      }
    }
    return t - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
  }

  /**
   * How long after the analyser sees a sound it comes out of the speakers (s), minus a
   * frame for the screen. Large on Bluetooth (0.15–0.25 s).
   */
  _outputDelay() {
    const ctx = this.ctx;
    return Math.max(0, (ctx.outputLatency || 0) + (ctx.baseLatency || 0) - 0.02);
  }

  _beat(clock, t) {
    this._lastBeat = { clock, t };
    this.levels.beatCount++;
    this.beatLog.push(t);
    if (this.beatLog.length > 64) this.beatLog.shift();
  }

  _beatValue(now) {
    const b = this._lastBeat;
    if (!b) return 0;
    if (b.clock === 'audio') return this.ctx ? beatPulse(this._playTime() - b.t, BEAT_LENGTH) : 0;
    return beatPulse(now - b.t, BEAT_LENGTH);
  }

  /**
   * Beats of the built-in music: known exactly from the schedule. Every beat heard
   * since the last frame counts (slow frames too); the pulse uses its exact age.
   */
  _scheduledBeats(fire) {
    const q = this.music.beats;
    if (!q.length) return;
    const play = this._playTime();
    let i = 0;
    while (i < q.length && q[i] <= play) {
      const t = q[i++];
      if (fire && play - t < 2) this._beat('audio', t);
    }
    if (i) q.splice(0, i);
  }

  _analyse(dt, now) {
    const a = this.graph.analyser;
    const bytes = this._bytes;
    a.getByteFrequencyData(bytes);
    const lv = this.levels;
    const db = this._db;
    for (const name of ['level', 'bass', 'mid', 'treble']) {
      const [from, to] = this._ranges[name];
      db[name] = bandDb(bytes, from, to, this._power);
    }
    for (const name of ['level', 'bass', 'mid', 'treble']) {
      lv[name] = this.norm[name].update(db[name], dt, bandPresence(name, db, this._ranges));
    }
    if (this._source === 'generated') {
      this._scheduledBeats(true);
    } else {
      const [from, to] = this._beatRange;
      if (this.detector.push(spectralFlux(bytes, this._prev, from, to), now)) {
        // A song is heard `outputDelay` after the analyser sees it: pulse when it is heard.
        // (The microphone hears the room, which is already in time.)
        if (this._source === 'file') this._fileBeats.push(now + this._outputDelay());
        else this._beat('page', now);
      }
      this._scheduledBeats(false);
    }
    const fb = this._fileBeats;
    while (fb.length && fb[0] <= now) this._beat('page', fb.shift());
    this._prev.set(bytes);
    lv.beat = this._beatValue(now);
  }

  _silence(dt, now) {
    const lv = this.levels;
    for (const name of ['level', 'bass', 'mid', 'treble']) lv[name] = this.norm[name].silence(dt);
    if (this.music && this.ctx) this._scheduledBeats(false);
    this._fileBeats.length = 0;
    lv.beat = this._beatValue(now);
  }
}
