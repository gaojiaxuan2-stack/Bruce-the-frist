// Plays the generated music: one MoodPlayer per scene mood, each with its own small
// mixing bus (instrument strips → tone filter → [tape wobble] → fade), crossfading when
// the scene changes. The look-ahead scheduler calls `schedule(until)`; the player books
// every step that starts before `until` on the audio clock and records the exact times
// of the beats, so the particles can hit on the beat.

import { INSTRUMENTS } from './instruments.js';
import { MOODS, generateBar, moodFor } from './patterns.js';
import { StepClock, stepDuration, swingOffset } from './scheduler.js';

const CROSSFADE = 1.2;

/** Mixing bus of one mood. All nodes persist for the life of the player only. */
export class MoodBus {
  constructor(graph, mood) {
    const ctx = graph.ctx;
    this.ctx = ctx;
    this.mood = mood;
    this.nodes = [];
    this.sources = [];
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
    this.out.connect(graph.genBus);
    this.wet = gain(0);
    this.wet.connect(graph.genWet);

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

    // Ping-pong delay send (feedback stays inside the delay loop, damped, < 0.5).
    this.delayIn = null;
    if (mood.bus.delay) {
      const { beats, feedback, tone } = mood.bus.delay;
      const time = (60 / mood.bpm) * beats;
      const inG = gain(1);
      const dL = make(() => ctx.createDelay(2));
      const dR = make(() => ctx.createDelay(2));
      dL.delayTime.value = time;
      dR.delayTime.value = time;
      const fb = gain(feedback);
      const damp = make(() => ctx.createBiquadFilter());
      damp.type = 'lowpass';
      damp.frequency.value = tone;
      const panL = this.panner(-0.7);
      const panR = this.panner(0.7);
      inG.connect(damp).connect(dL);
      dL.connect(panL);
      dL.connect(dR);
      dR.connect(panR);
      dR.connect(fb).connect(dL);
      const ret = gain(0.8);
      panL.connect(ret);
      panR.connect(ret);
      ret.connect(this.tone);
      const retWet = gain(0.5);
      ret.connect(retWet).connect(this.wet);
      this.delayIn = inG;
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

  /** Fade the whole mood (dry and wet) to `value` from time t, ~98% there after `seconds`. */
  fade(value, t, seconds) {
    for (const p of [this.out.gain, this.wet.gain]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(value, t, Math.max(0.01, seconds / 4));
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
  }
}

export class MoodPlayer {
  constructor(graph, moodId, seed = 0) {
    this.graph = graph;
    this.mood = MOODS[moodFor(moodId)];
    this.seed = seed;
    this.bus = new MoodBus(graph, this.mood);
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

  start(t) {
    this.clock.start(t);
  }

  stop() {
    this.clock.stop();
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
    for (const { bar, step, time } of this.clock.advance(now, Math.min(until, this.retireAt))) {
      if (bar !== this.barIndex) {
        this.barIndex = bar;
        this.barData = generateBar(this.mood.id, bar, this.seed);
      }
      const t = Math.max(time + swingOffset(step, sd, swing), now);
      for (const e of this.barData.events) {
        if (e.step !== step) continue;
        const play = INSTRUMENTS[e.inst];
        if (!play) continue;
        play(kit, this.bus.strip(e.inst), t, e, sd);
        this.notes++;
      }
      if (beats && this.barData.beats.includes(step)) beats.push(t);
    }
  }

  dispose() {
    this.clock.stop();
    this.bus.dispose();
  }
}

/** Owns the mood players: crossfades, pause / resume, beat times. */
export class MusicEngine {
  constructor(graph, { seed = (Math.random() * 2 ** 31) | 0, crossfade = CROSSFADE } = {}) {
    this.graph = graph;
    this.ctx = graph.ctx;
    this.seed = seed;
    this.crossfade = crossfade;
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

  /** Switch to a scene's mood with a crossfade (`fade` seconds; 0 = instant). */
  setMood(sceneId, fade = this.crossfade) {
    const id = moodFor(sceneId);
    if (this.current && this.current.mood.id === id && this.current.retireAt === Infinity) return;
    const t = this.ctx.currentTime;
    const old = this.current;
    if (old) {
      old.bus.fade(0, t, fade);
      old.retireAt = t + fade + 0.2;
      old.disposeAt = old.retireAt + 6; // let long releases (organ, drone, reverb) finish
    }
    const p = new MoodPlayer(this.graph, id, (this.seed + 7919 * this.visits++) | 0);
    p.bus.fade(1, t, fade);
    this.players.push(p);
    this.current = p;
    // Beats already booked for the old mood are still about to sound: keep them.
    if (this.playing) p.start(t + 0.06);
    // Rapid switching: never keep more than one mood fading out.
    while (this.players.length > 2) {
      const dead = this.players.shift();
      dead.bus.fade(0, t, 0.15);
      dead.retireAt = Math.min(dead.retireAt, t);
      dead.disposeAt = Math.min(dead.disposeAt, t + 0.5);
      this.zombies = (this.zombies || []).concat(dead);
    }
  }

  /** Start or pause booking new notes (playing notes finish on their own). */
  setPlaying(on, now = this.ctx.currentTime) {
    if (on === this.playing) return;
    this.playing = on;
    for (const p of this.players) {
      if (on) {
        if (p === this.current) p.start(now + 0.06);
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

  /** Free players (old moods) whose sound has fully ended. */
  collect(now = this.ctx.currentTime) {
    const all = this.zombies?.length ? this.players.concat(this.zombies) : this.players;
    for (const p of all) {
      if (now >= p.disposeAt) {
        p.dispose();
        this.players = this.players.filter((x) => x !== p);
        if (this.zombies) this.zombies = this.zombies.filter((x) => x !== p);
      }
    }
  }

  dispose() {
    for (const p of this.players.concat(this.zombies || [])) p.dispose();
    this.players = [];
    this.zombies = [];
    this.current = null;
  }
}
