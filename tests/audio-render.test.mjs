// Renders the real sound graph in headless Chromium with OfflineAudioContext and checks
// the result by numbers (nobody can listen in CI): every mood plays clearly at the
// default volume (about -17 dBFS RMS) and about as loud as the others on laptop
// speakers, is heard within a second of the first start, never clips, has no DC; the
// echoes end in true silence; effects end; the built-in beats keep tempo; and the
// song / microphone beat detector pulses at the right tempo on real low-end hits.
//
// Needs a browser, so it only runs when asked:
//   AUDIO_RENDER=1 node --test tests/audio-render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENABLED = !!process.env.AUDIO_RENDER;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function withPage(fn) {
  const { MIME } = await import('../tools/mime.mjs');
  const { chromium } = await import('playwright');
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__blank') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>audio</title>');
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/__blank`);
    return await fn(page, errors);
  } finally {
    await browser.close();
    server.close();
  }
}

/** Runs in the page: offline renders + metrics. */
async function renderAll() {
  const { AudioGraph, volumeGain } = await import('/js/audio/graph.js');
  const { MusicEngine } = await import('/js/audio/music.js');
  const { SfxPlayer, ChargeHum } = await import('/js/audio/sfx.js');
  const { MOODS } = await import('/js/audio/patterns.js');
  const { FIRST_FADE, FIRST_FROM } = await import('/js/audio/AudioEngine.js');
  const A = await import('/js/audio/analysis.js');
  const SR = 44100;
  const db = (x) => 20 * Math.log10(x + 1e-12);

  /** 4th-order Butterworth high-pass at `f0` (two RBJ biquads): a laptop / phone speaker. */
  function speaker(x, f0) {
    let y = x;
    for (const q of [0.5412, 1.3066]) {
      const w = (2 * Math.PI * f0) / SR;
      const cs = Math.cos(w);
      const al = Math.sin(w) / (2 * q);
      const a0 = 1 + al;
      const [b0, b1, b2, a1, a2] = [(1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, (-2 * cs) / a0, (1 - al) / a0];
      const o = new Float32Array(y.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < y.length; i++) {
        const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = y[i];
        y2 = y1;
        y1 = v;
        o[i] = v;
      }
      y = o;
    }
    return y;
  }
  function rmsDb(L, R, from, to) {
    let e = 0;
    let n = 0;
    for (let i = Math.floor(from * SR); i < Math.min(L.length, Math.floor(to * SR)); i++) {
      e += (L[i] * L[i] + R[i] * R[i]) / 2;
      n++;
    }
    return db(Math.sqrt(e / Math.max(1, n)));
  }

  function metrics(buf, from = 0, to = buf.duration) {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let peak = 0;
    let e = 0;
    let sum = 0;
    let n = 0;
    let finite = true;
    for (let i = Math.floor(from * SR); i < Math.min(L.length, Math.floor(to * SR)); i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) finite = false;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      e += (L[i] * L[i] + R[i] * R[i]) / 2;
      sum += (L[i] + R[i]) / 2;
      n++;
    }
    return { peakDb: db(peak), rmsDb: db(Math.sqrt(e / n)), dc: sum / n, finite };
  }

  function graphFor(ctx, volume) {
    const g = new AudioGraph(ctx);
    g.master.gain.value = volumeGain(volume);
    g.genBus.gain.value = 1;
    g.genWet.gain.value = 1;
    return g;
  }

  async function mood(id, { secs = 5, startBar = 0, volume = 0.7, analyse = false, first = false, speakers = false } = {}) {
    const ctx = new OfflineAudioContext(2, SR * secs, SR);
    const g = graphFor(ctx, volume);
    const music = new MusicEngine(g, { seed: 4242 });
    if (first) music.setMood(id, FIRST_FADE, FIRST_FROM);
    else music.setMood(id, 0.01);
    music.current.clock.bar = startBar;
    music.setPlaying(true, 0);
    music.schedule(secs, 0);
    const kicks = [];
    const sd = 60 / MOODS[id].bpm / 4;
    const detected = [];
    if (analyse) {
      // The kicks, from the score.
      const { generateBar } = await import('/js/audio/patterns.js');
      for (let b = startBar; b < startBar + Math.ceil(secs / (16 * sd)) + 1; b++) {
        for (const e of generateBar(id, b, music.current.seed).events) {
          const swing = e.step % 2 ? MOODS[id].swing * sd : 0;
          if (['kick', 'bass', 'hbass', 'bbass'].includes(e.inst)) kicks.push(0.06 + ((b - startBar) * 16 + e.step) * sd + swing);
        }
      }
      const a = g.analyser;
      const bytes = new Uint8Array(a.frequencyBinCount);
      const prev = new Uint8Array(a.frequencyBinCount);
      const br = A.binRange(SR, a.fftSize, ...A.BEAT_BAND);
      const det = new A.BeatDetector();
      for (let t = 1 / 60; t < secs - 0.05; t += 1 / 60) {
        ctx.suspend(Math.round((t * SR) / 128) * (128 / SR)).then(() => {
          a.getByteFrequencyData(bytes);
          if (det.push(A.spectralFlux(bytes, prev, ...br), ctx.currentTime)) detected.push(ctx.currentTime);
          prev.set(bytes);
          ctx.resume();
        });
      }
    }
    const beats = music.beats.slice();
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const extra = {};
    if (first) extra.firstSecondDb = rmsDb(L, R, 0.06, 1);
    if (speakers) extra.laptopDb = rmsDb(speaker(L, 150), speaker(R, 150), 1, secs);
    return { id, startBar, volume, ...metrics(buf, 0.5), ...extra, beats, kicks, detected, bpm: MOODS[id].bpm };
  }

  /**
   * Book `play` seconds of a mood, then nothing: the mood's bus (echoes included) must
   * end in exact silence (no feedback loop keeps it busy), and so must the output.
   */
  async function silence(id, play = 2, secs = 20) {
    const ctx = new OfflineAudioContext(3, SR * secs, SR);
    const merger = ctx.createChannelMerger(3);
    merger.connect(ctx.destination);
    const out = ctx.createGain();
    out.connect(merger, 0, 0);
    const g = new AudioGraph(ctx, { destination: out });
    g.master.gain.value = volumeGain(0.7);
    g.genBus.gain.value = 1;
    g.genWet.gain.value = 1;
    const music = new MusicEngine(g, { seed: 4242 });
    music.setMood(id, 0.01);
    music.setPlaying(true, 0);
    music.schedule(play, 0);
    const bus = music.current.bus;
    const tap = ctx.createGain();
    tap.channelCount = 1;
    tap.channelCountMode = 'explicit';
    bus.out.connect(tap).connect(merger, 0, 1);
    bus.wet.connect(tap);
    music.setPlaying(false, play);
    const buf = await ctx.startRendering();
    const lastSound = (data) => {
      for (let i = data.length - 1; i >= 0; i--) if (data[i] !== 0) return i / SR;
      return 0;
    };
    return { id, busyUntil: bus.busyUntil, busSilentAfter: lastSound(buf.getChannelData(1)), outTailDb: metrics(buf, secs - 3).peakDb, secs };
  }

  async function sfx(name, intensity) {
    const ctx = new OfflineAudioContext(2, SR * 4, SR);
    const g = graphFor(ctx, 0.7);
    new SfxPlayer(g).play(name, { intensity, pan: 0.4 }, { root: 62, scale: [0, 2, 4, 7, 9] });
    const buf = await ctx.startRendering();
    return { name, intensity, ...metrics(buf), tail: metrics(buf, 3.2).peakDb };
  }

  async function charge() {
    const ctx = new OfflineAudioContext(2, SR * 5, SR);
    const g = graphFor(ctx, 0.7);
    const hum = new ChargeHum(g);
    for (let t = 0; t < 3; t += 0.05) {
      const lv = t < 2.4 ? Math.min(1, t / 2) : 0;
      ctx.suspend(Math.round((t * SR) / 128) * (128 / SR)).then(() => {
        hum.set(lv, 57);
        ctx.resume();
      });
    }
    ctx.suspend(Math.round((4 * SR) / 128) * (128 / SR)).then(() => {
      hum.stop();
      ctx.resume();
    });
    const buf = await ctx.startRendering();
    return { name: 'charge', ...metrics(buf), tail: metrics(buf, 4.6).peakDb }; // after the reverb tail
  }

  const out = { moods: [], balance: [], first: [], silence: [], sfx: [] };
  for (const id of Object.keys(MOODS)) {
    out.moods.push(await mood(id));
    out.moods.push(await mood(id, { startBar: 16 }));
    out.moods.push(await mood(id, { startBar: 8, volume: 1 }));
    out.balance.push(await mood(id, { startBar: 16, secs: 16, speakers: true }));
    out.first.push(await mood(id, { secs: 1.5, first: true }));
  }
  for (const id of ['galaxy', 'mirror']) out.silence.push(await silence(id));
  for (const name of ['click', 'whoosh', 'chime', 'boom', 'pop', 'morph', 'sparkle']) {
    out.sfx.push(await sfx(name, 0.6));
    out.sfx.push(await sfx(name, 1));
  }
  out.sfx.push(await charge());
  out.house = await mood('mirror', { secs: 10, startBar: 8, analyse: true });
  out.lofi = await mood('face', { secs: 10, startBar: 8, analyse: true });
  return out;
}

test('offline renders: moods, effects and beat detection', { skip: !ENABLED && 'set AUDIO_RENDER=1 (needs Chromium)', timeout: 300000 }, async () => {
  const res = await withPage(async (page, errors) => {
    const r = await page.evaluate(renderAll);
    assert.deepEqual(errors, []);
    return r;
  });

  const show = (list, keys) => list.map((m) => `${m.id || m.name}${m.startBar !== undefined ? ' bar ' + m.startBar : ''}${m.volume ? ' vol ' + m.volume : ''}: ` + keys.map((k) => `${k} ${typeof m[k] === 'number' ? m[k].toFixed(1) : m[k]}`).join(', ')).join('\n');
  console.log(show(res.moods, ['rmsDb', 'peakDb']));
  console.log(show(res.balance, ['rmsDb', 'laptopDb', 'peakDb']));
  console.log(show(res.first, ['firstSecondDb']));
  console.log(show(res.silence, ['busyUntil', 'busSilentAfter', 'outTailDb']));
  console.log(show(res.sfx, ['peakDb', 'rmsDb', 'tail']));

  for (const m of res.moods) {
    const tag = `${m.id} bar ${m.startBar} vol ${m.volume}`;
    assert.ok(m.finite, `${tag}: NaN / Infinity`);
    assert.ok(m.peakDb < -0.5, `${tag}: clipping, peak ${m.peakDb.toFixed(1)} dB`);
    // Clearly audible on small speakers at the default volume, not blasting.
    if (m.volume < 1) assert.ok(m.rmsDb > -21 && m.rmsDb < -14, `${tag}: rms ${m.rmsDb.toFixed(1)} dB`);
    assert.ok(Math.abs(m.dc) < 2e-3, `${tag}: DC ${m.dc}`);
    // Scheduled beats are exactly one quarter note apart.
    const iv = m.beats.slice(1).map((t, i) => t - m.beats[i]);
    for (const x of iv) assert.ok(Math.abs(x - 60 / m.bpm) < 1e-6, `${tag}: beat interval ${x}`);
  }
  // Every mood at about the same loudness: -17 dBFS RMS (±1.5) at the default volume, and
  // within 3 dB of each other through a laptop speaker (150 Hz high-pass), so changing
  // scene never makes the music drop away.
  for (const m of res.balance) assert.ok(Math.abs(m.rmsDb + 16.8) < 1.5, `${m.id}: ${m.rmsDb.toFixed(1)} dB RMS at volume 0.7`);
  const laptop = res.balance.map((m) => m.laptopDb);
  assert.ok(Math.max(...laptop) - Math.min(...laptop) < 3, `laptop-speaker loudness spread: ${laptop.map((x) => x.toFixed(1)).join(' / ')}`);
  // The first start is heard within a second (slow swells come in fast on the first bar).
  for (const m of res.first) assert.ok(m.firstSecondDb > -24, `${m.id}: first second only ${m.firstSecondDb.toFixed(1)} dB`);
  // No feedback anywhere: after the last note and its echoes the mood bus is exactly 0.
  for (const s of res.silence) {
    assert.ok(s.busSilentAfter < s.busyUntil + 1, `${s.id}: bus still sounding at ${s.busSilentAfter.toFixed(2)} s (notes end ${s.busyUntil.toFixed(2)} s)`);
    assert.ok(s.outTailDb < -120, `${s.id}: output not silent at the end (${s.outTailDb.toFixed(1)} dB)`);
  }

  for (const s of res.sfx) {
    const tag = `${s.name} @${s.intensity ?? ''}`;
    assert.ok(s.finite, `${tag}: NaN`);
    // Heard over the music (about -17 dBFS RMS, peaks -1..-4 dB) but never above its peaks.
    assert.ok(s.peakDb < -2 && s.peakDb > -36, `${tag}: peak ${s.peakDb.toFixed(1)} dB`);
    assert.ok(Math.abs(s.dc) < 1e-3, `${tag}: DC ${s.dc}`);
    assert.ok(s.tail < -70, `${tag}: still sounding at the end (${s.tail.toFixed(1)} dB)`);
  }
  const boom = res.sfx.filter((s) => s.name === 'boom');
  assert.ok(boom[1].rmsDb > boom[0].rmsDb + 1, 'intensity makes the boom bigger');

  // Song / mic detector on real rendered music: pulses at the song's tempo that land on
  // real low-end hits (a kick or a bass note; in some phrases the off-beat bass is the
  // strongest low onset, and following it is fine for the visuals).
  for (const m of [res.house, res.lofi]) {
    const hits = m.kicks.filter((t) => t > 1.6 && t < 9.8);
    const det = m.detected.filter((t) => t > 1.6 && t < 9.8);
    const good = det.filter((d) => hits.some((k) => Math.abs(d - k) < 0.07)).length;
    const perBeat = det.length / ((9.8 - 1.6) * (m.bpm / 60));
    assert.ok(good / det.length >= 0.8, `${m.id}: only ${good}/${det.length} detections on a low hit`);
    assert.ok(perBeat > 0.45 && perBeat < 1.15, `${m.id}: ${det.length} detections = ${perBeat.toFixed(2)} per beat`);
  }
  const iv = res.house.detected.slice(1).map((t, i) => t - res.house.detected[i]).sort((x, y) => x - y);
  const medianIv = iv[iv.length >> 1];
  assert.ok(Math.abs(medianIv - 60 / 118) < 0.03, `house tempo from detections: ${(60 / medianIv).toFixed(1)} bpm`);
});
