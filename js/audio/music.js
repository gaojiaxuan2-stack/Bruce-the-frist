// Plays the generated music: one MoodPlayer per scene mood, each with its own small
// mixing bus (instrument strips → tone filter → [tape wobble] → fade), crossfading when
// the scene changes. The look-ahead scheduler calls `schedule(until)`; the player books
// every step that starts before `until` on the audio clock and records the exact times
// of the beats, so the particles can hit on the beat.
//
// Each mood has exactly one bus, created the first time the mood plays and reused on
// every later visit (at most five, whatever the browser's garbage collector does). A bus
// is disconnected from the music bus once every note booked into it has ended, so the
// browser skips it completely while its mood is not playing. Nothing inside a bus
// feeds back on itself: when no notes are booked, the whole bus goes truly silent.

import { INSTRUMENTS } from './instruments.js';
import { MOODS, generateBar, moodFor } from './patterns.js';
import { StepClock, stepDuration, swingOffset } from './scheduler.js';

const CROSSFADE = 1.2;
/** Longest echo time any mood uses (0.75 beat at 96 bpm = 0.47 s). */
export const MAX_ECHO = 0.6;
/** Echo taps quieter than this are left out. */
const MIN_ECHO = 0.1;
const MAX_TAPS = 6;
/** A new mood (or a resumed one) starts this long after the call, on the audio clock. */
const START_DELAY = 0.06;

/**
 * Levels of the ping-pong echoes: pairs (left, right) that each lose `feedback`, like the
 * classic two-delay loop, but as a fixed chain (it ends; a loop never quite does).
 */
export function echoTaps(feedback) {
  const taps = [];
  for (let level = 1; level >= MIN_ECHO && taps.length < MAX_TAPS; level *= feedback) taps.push(level, level);
  return taps.slice(0, MAX_TAPS);
}

/** Mixing bus of one mood. Created once per mood and reused. */
export class MoodBus {
  constructor(graph, mood) {
    const ctx = graph.ctx;
    this.ctx = ctx;
    this.graph = graph;
    this.mood = mood;
    /** Overall level of the mood (evens out loudness between moods). */
    this.level = mood.bus.level ?? 1;
    this.nodes = [];
    this.sources = [];
    /** Audio time when the last note booked into this bus has fully ended. */
    this.busyUntil = 0;
    this.attached = false;
    const make = (fn) => {
      const n = fn();
      this.nodes.push(n);
      return n;
    };
    const gain = (v) => make(() => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    });

    this.out = gain(0);
    this.wet = gain(0);

    // Tone filter (lo-fi darkness for some moods), then optional tape "wow".
    this.tone = make(() => ctx.createBiquadFilter());
    this.tone.type = 'lowpass';
    this.tone.frequency.value = mood.bus.tone ?? 12000;
    this.tone.Q.value = 0.5;
    let last = this.tone;
    if (mood.bus.wow) {
      const d = make(() => ctx.createDelay(0.05));
      d.delayTime.value = 0.012;
      const lfo = make(() => ctx.createOscillator());
      lfo.frequency.value = 0.45;
      const depth = gain(mood.bus.wow);
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      this.sources.push(lfo);
      last.connect(d);
      last = d;
    }
    last.connect(this.out);

    // Ping-pong echo send: a chain of delays (mono, damped), each tap panned left or right.
    // No feedback loop, so the echoes stop a fixed time after the last note.
    this.delayIn = null;
    if (mood.bus.delay) {
      const { beats, feedback, tone } = mood.bus.delay;
      const time = Math.min(MAX_ECHO, (60 / mood.bpm) * beats);
      const inG = gain(1);
      inG.channelCount = 1;
      inG.channelCountMode = 'explicit';
      const damp = make(() => ctx.createBiquadFilter());
      damp.type = 'lowpass';
      damp.frequency.value = tone;
      inG.connect(damp);
      const panL = this.panner(-0.7);
      const panR = this.panner(0.7);
      let prev = damp;
      echoTaps(feedback).forEach((level, k) => {
        const d = make(() => ctx.createDelay(MAX_ECHO));
        d.delayTime.value = time;
        prev.connect(d);
        d.connect(gain(level)).connect(k % 2 ? panR : panL);
        prev = d;
      });
      this.echoTail = time * echoTaps(feedback).length;
      const ret = gain(0.8);
      panL.connect(ret);
      panR.connect(ret);
      ret.connect(this.tone);
      ret.connect(gain(0.5)).connect(this.wet);
      this.delayIn = inG;
    } else {
      this.echoTail = 0;
    }

    this.strips = {};
  }

  panner(pan) {
    const ctx = this.ctx;
    let p;
    if (ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
    } else {
      p = ctx.createGain();
    }
    this.nodes.push(p);
    return p;
  }

  /** Channel strip for an instrument (created on first use). */
  strip(inst) {
    let s = this.strips[inst];
    if (s) return s;
    const ctx = this.ctx;
    const m = this.mood;
    const g = ctx.createGain();
    g.gain.value = m.mix[inst] ?? 0.5;
    this.nodes.push(g);
    g.connect(this.tone);
    const rev = m.rev[inst] ?? 0;
    if (rev > 0) {
      const send = ctx.createGain();
      send.gain.value = rev;
      this.nodes.push(send);
      g.connect(send).connect(this.wet);
    }
    const dly = m.dly[inst] ?? 0;
    if (dly > 0 && this.delayIn) {
      const send = ctx.createGain();
      send.gain.value = dly;
      this.nodes.push(send);
      g.connect(send).connect(this.delayIn);
    }
    const inL = this.panner(-0.35);
    const inR = this.panner(0.35);
    inL.connect(g);
    inR.connect(g);
    s = { in: g, inL, inR };
    this.strips[inst] = s;
    return s;
  }

  /** A note booked into this bus ends at `end` (audio time; plus the echoes). */
  booked(end) {
    const e = end + this.echoTail;
    if (e > this.busyUntil) this.busyUntil = e;
  }

  /** Connect to the music bus (before notes are booked into it). */
  attach() {
    if (this.attached) return;
    this.out.connect(this.graph.genBus);
    this.wet.connect(this.graph.genWet);
    this.attached = true;
  }

  /** Disconnect from the music bus: only once every booked note has ended (see MusicEngine.collect). */
  detach() {
    if (!this.attached) return;
    this.out.disconnect();
    this.wet.disconnect();
    this.attached = false;
  }

  /** Fade the whole mood (dry and wet) to `value` from time t, ~98% there after `seconds`. */
  fade(value, t, seconds) {
    for (const p of [this.out.gain, this.wet.gain]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(value * this.level, t, Math.max(0.01, seconds / 4));
    }
  }

  dispose() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0;
    this.attached = false;
  }
}

export class MoodPlayer {
  /**
   * @param {import('./graph.js').AudioGraph} graph
   * @param {string} moodId
   * @param {number} seed
   * @param {MoodBus} [bus] the mood's (shared, reused) bus
   */
  constructor(graph, moodId, seed = 0, bus = null) {
    this.graph = graph;
    this.mood = MOODS[moodFor(moodId)];
    this.seed = seed;
    this.bus = bus || new MoodBus(graph, this.mood);
    this.stepDur = stepDuration(this.mood.bpm);
    this.clock = new StepClock(this.stepDur);
    this.barData = null;
    this.barIndex = -1;
    this.retireAt = Infinity;
    this.disposeAt = Infinity;
    this.notes = 0;
  }

  get playing() {
    return this.clock.running;
  }

  get retiring() {
    return this.retireAt !== Infinity;
  }

  start(t) {
    this.clock.start(t);
  }

  stop() {
    this.clock.stop();
  }

  /** Fade out over `fade` seconds and stop booking notes once the fade is done. */
  retire(t, fade) {
    this.bus.fade(0, t, fade);
    this.retireAt = t + fade + 0.2;
    this.disposeAt = this.retireAt + 1;
  }

  /** Rapid switching: fade out fast and stop booking now. */
  kill(t) {
    this.bus.fade(0, t, 0.15);
    this.retireAt = Math.min(this.retireAt, t);
    this.disposeAt = Math.min(this.disposeAt, t + 1);
    this.clock.stop();
  }

  /** Back to this mood while it was still fading out: fade in again and keep going. */
  revive(t, fade, startAt) {
    this.retireAt = Infinity;
    this.disposeAt = Infinity;
    this.bus.fade(1, t, fade);
    if (startAt !== null && !this.clock.running) this.clock.start(startAt);
  }

  /**
   * Book every step starting before `until`.
   * @param {number} now audio time
   * @param {number} until
   * @param {number[]|null} beats receives the audio times of the beats (current player only)
   */
  schedule(now, until, beats) {
    if (now >= this.retireAt) {
      this.clock.stop();
      return;
    }
    const kit = this.graph.kit;
    const sd = this.stepDur;
    const swing = this.mood.swing || 0;
    const bus = this.bus;
    const steps = this.clock.advance(now, Math.min(until, this.retireAt));
    if (steps.length) bus.attach();
    for (const { bar, step, time } of steps) {
      if (bar !== this.barIndex) {
        this.barIndex = bar;
        this.barData = generateBar(this.mood.id, bar, this.seed);
      }
      const t = Math.max(time + swingOffset(step, sd, swing), now);
      for (const e of this.barData.events) {
        if (e.step !== step) continue;
        const play = INSTRUMENTS[e.inst];
        if (!play) continue;
        const end = play(kit, bus.strip(e.inst), t, e, sd);
        bus.booked(Number.isFinite(end) ? end : t + 30);
        this.notes++;
      }
      if (beats && this.barData.beats.includes(step)) beats.push(t);
    }
  }

  dispose() {
    this.clock.stop();
  }
}

/** Owns the mood players and buses: crossfades, pause / resume, beat times. */
export class MusicEngine {
  constructor(graph, { seed = (Math.random() * 2 ** 31) | 0, crossfade = CROSSFADE } = {}) {
    this.graph = graph;
    this.ctx = graph.ctx;
    this.seed = seed;
    this.crossfade = crossfade;
    /** Mood id → its bus (created on first use, then reused). */
    this.buses = {};
    /** Live players, current last. Old ones stay until their notes have ended. */
    this.players = [];
    this.current = null;
    this.playing = false;
    this.visits = 0;
    /** Audio times of upcoming / recent beats of the current mood (consumed by the engine). */
    this.beats = [];
  }

  get moodId() {
    return this.current?.mood.id ?? null;
  }

  get bpm() {
    return this.current?.mood.bpm ?? 0;
  }

  busFor(mood) {
    let b = this.buses[mood.id];
    if (!b) b = this.buses[mood.id] = new MoodBus(this.graph, mood);
    return b;
  }

  /** Switch to a scene's mood with a crossfade (`fade` seconds; 0 = instant). */
  setMood(sceneId, fade = this.crossfade) {
    const id = moodFor(sceneId);
    const old = this.current;
    if (old && old.mood.id === id) return;
    const t = this.ctx.currentTime;
    const startAt = t + START_DELAY;
    if (old) old.retire(t, fade);
    // Coming back while that mood is still fading out: the same player carries on.
    let p = this.players.find((x) => x.mood.id === id);
    if (p) {
      p.revive(t, fade, this.playing ? startAt : null);
      this.players = this.players.filter((x) => x !== p);
    } else {
      p = new MoodPlayer(this.graph, id, (this.seed + 7919 * this.visits++) | 0, this.busFor(MOODS[id]));
      p.bus.fade(1, t, fade);
      if (this.playing) p.start(startAt);
    }
    this.players.push(p);
    this.current = p;
    // Beats of the old mood after the new one starts would double up: the new mood leads.
    if (old) this.beats = this.beats.filter((b) => b < startAt);
    // Rapid switching: never keep more than one mood fading out.
    const fading = this.players.filter((x) => x !== p && x.retireAt > t);
    while (fading.length > 1) fading.shift().kill(t);
  }

  /** Start or pause booking new notes (notes already booked finish on their own). */
  setPlaying(on, now = this.ctx.currentTime) {
    if (on === this.playing) return;
    this.playing = on;
    for (const p of this.players) {
      if (on) {
        if (p === this.current) p.start(now + START_DELAY);
      } else p.stop();
    }
  }

  /** Called by the look-ahead timer. */
  schedule(until, now = this.ctx.currentTime) {
    if (this.playing) {
      for (const p of this.players) p.schedule(now, until, p === this.current ? this.beats : null);
    }
    this.collect(now);
  }

  /**
   * Drop old players whose fade is over, and disconnect every bus whose notes have all
   * ended and that nothing is about to play into (paused, or its mood has gone): the
   * browser then skips it entirely. A player re-attaches its bus when it books notes.
   */
  collect(now = this.ctx.currentTime) {
    if (this.players.length > 1) {
      this.players = this.players.filter((p) => {
        if (p === this.current || now < p.disposeAt) return true;
        p.dispose();
        return false;
      });
    }
    for (const id in this.buses) {
      const b = this.buses[id];
      if (!b.attached || now <= b.busyUntil + 0.25) continue;
      const booking = this.playing && this.players.some((p) => p.bus === b && p.playing && now < p.retireAt);
      if (!booking) b.detach();
    }
  }

  dispose() {
    for (const p of this.players) p.dispose();
    for (const id in this.buses) this.buses[id].dispose();
    this.buses = {};
    this.players = [];
    this.current = null;
  }
}
