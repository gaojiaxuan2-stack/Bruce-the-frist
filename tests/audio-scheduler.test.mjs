// Unit tests for the look-ahead scheduler maths (js/audio/scheduler.js), driven by a fake
// audio clock and a jittery fake timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LookaheadScheduler, STEPS_PER_BAR, StepClock, stepDuration, swingOffset } from '../js/audio/scheduler.js';
import { mulberry32 } from '../js/audio/dsp.js';

const LOOKAHEAD = 0.15;

/** Simulate the timer: wakes every ~25 ms (± jitter, plus rare long stalls). */
function simulate(clock, { seconds, interval = 0.025, jitter = 0.01, stalls = [], seed = 1 }) {
  const rng = mulberry32(seed);
  const booked = [];
  let now = 0;
  while (now < seconds) {
    for (const s of clock.advance(now, now + LOOKAHEAD)) booked.push({ ...s, bookedAt: now });
    const stall = stalls.find((s) => now < s.at && now + interval >= s.at);
    now += interval + (rng() * 2 - 1) * jitter + (stall ? stall.ms / 1000 : 0);
  }
  return booked;
}

test('step duration and swing', () => {
  assert.equal(stepDuration(60), 0.25);
  assert.equal(stepDuration(120), 0.125);
  assert.ok(Math.abs(stepDuration(78) - 60 / 78 / 4) < 1e-15);
  assert.equal(swingOffset(0, 0.2, 0.3), 0);
  assert.ok(Math.abs(swingOffset(1, 0.2, 0.3) - 0.06) < 1e-12);
  assert.equal(swingOffset(2, 0.2, 0.3), 0);
});

test('scheduler: every step booked once, in order, exactly on the grid, ahead of time', () => {
  for (const bpm of [60, 78, 96, 108, 118]) {
    const sd = stepDuration(bpm);
    const clock = new StepClock(sd);
    clock.start(0.05);
    const booked = simulate(clock, { seconds: 30, seed: bpm });
    assert.ok(booked.length > 0);
    for (let i = 0; i < booked.length; i++) {
      const b = booked[i];
      // Exactly on the grid (no drift): time = start + index * stepDur.
      assert.ok(Math.abs(b.time - (0.05 + i * sd)) < 1e-9, `${bpm} bpm step ${i} drifted`);
      // bar / step counters follow.
      assert.equal(b.bar * STEPS_PER_BAR + b.step, i);
      // Booked before it plays, and not absurdly early.
      assert.ok(b.time >= b.bookedAt - 1e-12, 'booked late');
      assert.ok(b.time - b.bookedAt <= LOOKAHEAD + 1e-9, 'booked too early');
    }
    // Nothing missing up to the end of the simulation.
    const last = booked[booked.length - 1].time;
    assert.ok(last > 30 - sd, `stopped early at ${last}`);
    assert.equal(clock.resyncs, 0);
  }
});

test('scheduler: a long stall restarts at a bar without a burst of late notes', () => {
  const sd = stepDuration(118);
  const clock = new StepClock(sd);
  clock.start(0);
  const booked = simulate(clock, { seconds: 10, stalls: [{ at: 4, ms: 900 }], seed: 3 });
  assert.equal(clock.resyncs, 1);
  const lateBooked = booked.filter((b) => b.time < b.bookedAt - 1e-9);
  assert.equal(lateBooked.length, 0, 'no step is booked in the past');
  // After the restart the grid resumes at the top of a bar.
  const gap = booked.findIndex((b, i) => i > 0 && b.time - booked[i - 1].time > sd * 1.5);
  assert.ok(gap > 0);
  assert.equal(booked[gap].step, 0, 'restarts at the top of a bar');
  assert.equal(booked[gap].bar, booked[gap - 1].bar + 1);
  // And at most one look-ahead window of notes is booked at once.
  const perWake = new Map();
  for (const b of booked) perWake.set(b.bookedAt, (perWake.get(b.bookedAt) || 0) + 1);
  assert.ok(Math.max(...perWake.values()) <= Math.ceil((LOOKAHEAD + 0.06) / sd) + 1);
});

test('scheduler: a short hiccup (< maxLate) keeps the grid', () => {
  const sd = stepDuration(96);
  const clock = new StepClock(sd);
  clock.start(0);
  const booked = simulate(clock, { seconds: 6, stalls: [{ at: 2, ms: 60 }], seed: 9 });
  assert.equal(clock.resyncs, 0);
  for (let i = 1; i < booked.length; i++) assert.ok(Math.abs(booked[i].time - booked[i - 1].time - sd) < 1e-9);
});

test('scheduler: stop / start resumes at the top of the next bar', () => {
  const clock = new StepClock(0.1);
  clock.start(0);
  const first = clock.advance(0, 0.55); // steps 0..5 of bar 0
  assert.equal(first.length, 6);
  clock.stop();
  assert.equal(clock.running, false);
  assert.deepEqual(clock.advance(1, 2), [], 'nothing while stopped');
  clock.start(3);
  const next = clock.advance(3, 3.05);
  assert.deepEqual(next[0], { bar: 1, step: 0, time: 3 });
});

test('LookaheadScheduler: runs the tick on a timer and measures it', async () => {
  let calls = 0;
  const s = new LookaheadScheduler(() => {
    calls++;
    let x = 0;
    for (let i = 0; i < 1e4; i++) x += i;
    return x;
  }, { interval: 5 });
  s.start();
  s.start(); // idempotent
  await new Promise((r) => setTimeout(r, 60));
  s.stop();
  const n = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, n, 'stopped');
  assert.ok(n >= 3, `ran ${n} times`);
  assert.equal(s.stats.calls, n);
  assert.ok(s.stats.avgMs >= 0 && s.stats.maxMs >= s.stats.avgMs);
});
