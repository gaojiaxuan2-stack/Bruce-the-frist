// Renders the real sound graph in headless Chromium with OfflineAudioContext and checks
// the result by numbers (nobody can listen in CI): every mood and every effect has a
// sane level, no clipping, no DC, effects end, the built-in beats keep tempo, and the
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
  const { AudioGraph } = await import('/js/audio/graph.js');
  const { MusicEngine } = await import('/js/audio/music.js');
  const { SfxPlayer, ChargeHum } = await import('/js/audio/sfx.js');
  const { MOODS } = await import('/js/audio/patterns.js');
  const A = await import('/js/audio/analysis.js');
  const SR = 44100;
  const db = (x) => 20 * Math.log10(x + 1e-12);

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
    g.master.gain.value = volume * volume;
    g.genBus.gain.value = 1;
    g.genWet.gain.value = 1;
    return g;
  }

  async function mood(id, { secs = 5, startBar = 0, volume = 0.7, analyse = false } = {}) {
    const ctx = new OfflineAudioContext(2, SR * secs, SR);
    const g = graphFor(ctx, volume);
    const music = new MusicEngine(g, { seed: 4242 });
    music.setMood(id, 0.01);
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
    return { id, startBar, volume, ...metrics(buf, 0.5), beats, kicks, detected, bpm: MOODS[id].bpm };
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

  const out = { moods: [], sfx: [] };
  for (const id of Object.keys(MOODS)) {
    out.moods.push(await mood(id));
    out.moods.push(await mood(id, { startBar: 16 }));
    out.moods.push(await mood(id, { startBar: 8, volume: 1 }));
  }
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

  for (const m of res.moods) {
    const tag = `${m.id} bar ${m.startBar} vol ${m.volume}`;
    assert.ok(m.finite, `${tag}: NaN / Infinity`);
    assert.ok(m.peakDb < -0.5, `${tag}: clipping, peak ${m.peakDb.toFixed(1)} dB`);
    if (m.volume < 1) assert.ok(m.rmsDb > -32 && m.rmsDb < -15, `${tag}: rms ${m.rmsDb.toFixed(1)} dB`);
    assert.ok(Math.abs(m.dc) < 2e-3, `${tag}: DC ${m.dc}`);
    // Scheduled beats are exactly one quarter note apart.
    const iv = m.beats.slice(1).map((t, i) => t - m.beats[i]);
    for (const x of iv) assert.ok(Math.abs(x - 60 / m.bpm) < 1e-6, `${tag}: beat interval ${x}`);
  }
  for (const s of res.sfx) {
    const tag = `${s.name} @${s.intensity ?? ''}`;
    assert.ok(s.finite, `${tag}: NaN`);
    assert.ok(s.peakDb < -6 && s.peakDb > -40, `${tag}: peak ${s.peakDb.toFixed(1)} dB`);
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
