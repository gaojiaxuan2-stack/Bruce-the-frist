// Timing for the generated music: a "look-ahead" scheduler. A timer wakes up every
// ~25 ms and books every 16th-note step that starts in the next ~0.45 s on the audio
// clock (AudioContext.currentTime; long enough to ride out a scene load). The audio clock is sample-accurate, the timer is not,
// so notes land exactly on the grid however late the timer fires.
// The maths is pure and unit-tested; LookaheadScheduler only adds the timer.

export const STEPS_PER_BAR = 16;

/** Seconds per 16th-note step. */
export const stepDuration = (bpm) => 60 / bpm / 4;

/** Swing: every odd 16th is pushed late by `swing` (0..0.5) of a step. */
export const swingOffset = (step, stepDur, swing = 0) => (step % 2 === 1 ? swing * stepDur : 0);

/**
 * A running position on the step grid (bar, step, time of the next step).
 * `advance(now, until)` returns every step whose start time is before `until`, in
 * order, each exactly one step after the previous. If the clock fell behind (the tab
 * froze, a long main-thread stall) by more than `maxLate`, it does not play the missed
 * steps in a burst: it restarts cleanly at the next bar, just after `now`.
 */
export class StepClock {
  constructor(stepDur, { stepsPerBar = STEPS_PER_BAR, maxLate = 0.1, restartDelay = 0.05 } = {}) {
    this.stepDur = stepDur;
    this.stepsPerBar = stepsPerBar;
    this.maxLate = maxLate;
    this.restartDelay = restartDelay;
    this.bar = 0;
    this.step = 0;
    this.nextTime = null;
    this.resyncs = 0;
  }

  get running() {
    return this.nextTime !== null;
  }

  /** Start (or restart after a pause) at the top of a bar at time t. */
  start(t) {
    if (this.step !== 0) {
      this.bar++;
      this.step = 0;
    }
    this.nextTime = t;
  }

  stop() {
    if (this.nextTime === null) return;
    // Resume at the top of the next bar so chords and drums line up again.
    if (this.step !== 0) {
      this.bar++;
      this.step = 0;
    }
    this.nextTime = null;
  }

  /**
   * @param {number} now current audio time
   * @param {number} until schedule steps starting before this time
   * @returns {{bar: number, step: number, time: number}[]}
   */
  advance(now, until) {
    const out = [];
    if (this.nextTime === null) return out;
    if (this.nextTime < now - this.maxLate) {
      this.resyncs++;
      this.start(now + this.restartDelay);
    }
    while (this.nextTime < until) {
      out.push({ bar: this.bar, step: this.step, time: this.nextTime });
      this.nextTime += this.stepDur;
      if (++this.step >= this.stepsPerBar) {
        this.step = 0;
        this.bar++;
      }
    }
    return out;
  }
}

/**
 * Calls `tick()` every `interval` ms (setInterval) and measures how long each call
 * takes, so the cost of the music can be checked in the browser.
 */
export class LookaheadScheduler {
  constructor(tick, { interval = 25 } = {}) {
    this.tick = tick;
    this.interval = interval;
    this.timer = null;
    this.stats = { calls: 0, totalMs: 0, maxMs: 0, avgMs: 0 };
  }

  get running() {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.run(), this.interval);
    // Node (tests): don't keep the process alive just for the music timer.
    if (typeof this.timer === 'object' && this.timer?.unref) this.timer.unref();
    this.run();
  }

  stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  run() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.tick();
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const s = this.stats;
    s.calls++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    s.avgMs = s.totalMs / s.calls;
  }
}
