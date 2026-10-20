// The fixed part of the sound graph, built once per AudioContext (also works on an
// OfflineAudioContext for test renders):
//
//   mood buses ─► genBus ─┬─► highpass ─► musicBus ─► duck ─┐
//   song file ─► fileBus ─┤                     │
//                         └─► analyserIn ─► analyser (music only, never the effects)
//   microphone ───────────────► analyserIn          (never connected to the speakers)
//   effects ─► sfxBus ──────────────────────────┤
//   reverb sends: genWet ─► musicWet ─┐         │
//                 sfxWet ─────────────┴─► convolver ─► reverbReturn ─┤
//                  master (volume) ─► dcBlock ─► glue compressor ─► soft clipper ─► out
//
// Gate gains (genBus/genWet, musicBus/musicWet, sfxBus/sfxWet) switch the parts on and
// off with short ramps; nothing is rebuilt while the page runs.
//
// Loudness: at the default volume (0.7) the music plays at about -17 dBFS RMS (about
// -14.5 LUFS, the level of a streaming service), so laptop and phone speakers hear it
// clearly. The glue compressor (ratio 2, slow) evens out loud passages without pumping;
// the soft clipper rounds off the few transient peaks (claps, plucks, kicks) that would
// otherwise clip, and caps the output at -0.7 dBFS whatever the volume.

import { clamp, makeImpulse, vinylNoise, whiteNoise } from './dsp.js';

export const FFT_SIZE = 2048;

/** Master gain at volume 1, and the slider's curve (gain = OUTPUT_GAIN · volume^VOLUME_CURVE). */
export const OUTPUT_GAIN = 1.67;
export const VOLUME_CURVE = 1.5;

/** Volume slider (0..1) → master gain. 0.7 → 0.98 (the default); 1 → +4.6 dB louder. */
export function volumeGain(volume) {
  return OUTPUT_GAIN * Math.pow(clamp(Number(volume) || 0), VOLUME_CURVE);
}

/** The soft clipper's input is scaled by 1 / CLIP_RANGE, so it handles peaks up to +12 dBFS. */
export const CLIP_RANGE = 4;

/**
 * Soft-clip transfer curve for a WaveShaperNode: exactly linear up to `knee` (-5.2 dBFS),
 * then a smooth tanh shoulder that never goes above `ceiling` (-0.7 dBFS). Odd symmetric,
 * with an odd number of points, so silence stays exactly 0 (no DC).
 */
export function softClipCurve({ knee = 0.55, ceiling = 0.92, range = CLIP_RANGE, points = 4097 } = {}) {
  const c = new Float32Array(points);
  const room = ceiling - knee;
  for (let i = 0; i < points; i++) {
    const u = ((i / (points - 1)) * 2 - 1) * range;
    const a = Math.abs(u);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = u < 0 ? -y : y;
  }
  c[(points - 1) / 2] = 0;
  return c;
}

function bufferFrom(ctx, channels) {
  const buf = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((data, i) => {
    if (buf.copyToChannel) buf.copyToChannel(data, i);
    else buf.getChannelData(i).set(data);
  });
  return buf;
}

export class AudioGraph {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{destination?: AudioNode, reverbSeconds?: number}} [opts]
   */
  constructor(ctx, { destination = ctx.destination, reverbSeconds = 2.6 } = {}) {
    this.ctx = ctx;
    const gain = (v, to) => {
      const g = ctx.createGain();
      g.gain.value = v;
      if (to) g.connect(to);
      return g;
    };

    // Output: master volume → glue compressor → soft clipper → speakers.
    // The compressor only leans on loud passages (ratio 2, soft knee, slow attack and
    // release, so it never "pumps" on the kicks); short peaks pass it and are rounded off
    // by the clipper, which also guarantees the output never clips.
    this.compressor = ctx.createDynamicsCompressor();
    const c = this.compressor;
    c.threshold.value = -12;
    c.knee.value = 10;
    c.ratio.value = 2;
    c.attack.value = 0.02;
    c.release.value = 0.3;
    this.clipIn = null;
    this.clipper = null;
    if (typeof ctx.createWaveShaper === 'function') {
      this.clipIn = gain(1 / CLIP_RANGE);
      this.clipper = ctx.createWaveShaper();
      this.clipper.curve = softClipCurve();
      this.clipper.oversample = '2x';
      c.connect(this.clipIn).connect(this.clipper).connect(destination);
    } else {
      c.connect(destination);
    }
    // DC / infrasound blocker (FM e-piano and pitch-swept kicks leave a little DC).
    this.dcBlock = ctx.createBiquadFilter();
    this.dcBlock.type = 'highpass';
    this.dcBlock.frequency.value = 22;
    this.dcBlock.Q.value = 0.7;
    this.dcBlock.connect(c);
    this.master = gain(0, this.dcBlock);

    // Reverb (one shared convolver, fed by sends; no feedback paths).
    this.reverb = ctx.createConvolver();
    this.reverb.normalize = false;
    this.reverb.buffer = bufferFrom(ctx, makeImpulse(ctx.sampleRate, reverbSeconds, { decay: reverbSeconds * 0.92 }));
    this.reverbReturn = gain(0.55, this.master);
    this.reverb.connect(this.reverbReturn);

    // Music.
    this.duck = gain(1, this.master);
    this.musicBus = gain(1, this.duck);
    this.musicWet = gain(1, this.reverb);
    // Generated music: nothing below ~38 Hz (no speaker plays it; it only drives the limiter).
    this.genHp = ctx.createBiquadFilter();
    this.genHp.type = 'highpass';
    this.genHp.frequency.value = 38;
    this.genHp.Q.value = Math.SQRT1_2;
    this.genHp.connect(this.musicBus);
    this.genBus = gain(0, this.genHp);
    this.genWet = gain(0, this.musicWet);
    this.fileBus = gain(0.6, this.musicBus);

    // Effects.
    this.sfxBus = gain(1, this.master);
    this.sfxWet = gain(1, this.reverb);

    // Analysis of the music only (generated, song file or microphone).
    this.analyserIn = gain(1);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.3;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -10;
    this.analyserIn.connect(this.analyser);
    this.genBus.connect(this.analyserIn);
    this.fileBus.connect(this.analyserIn);

    // Shared sample data for the instruments.
    this.kit = {
      ctx,
      noise: bufferFrom(ctx, [whiteNoise(Math.round(ctx.sampleRate * 2), 5)]),
      vinyl: bufferFrom(ctx, [vinylNoise(ctx.sampleRate, 4, 9)]),
    };
  }

  /** Smoothly move a gain (or several) to `value` with time constant `tau` seconds. */
  setGain(params, value, tau = 0.05) {
    const t = this.ctx.currentTime;
    for (const p of Array.isArray(params) ? params : [params]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(value, t, tau);
    }
  }

  /** Briefly lower the music under a big effect (boom). */
  duckMusic(amount = 0.5, hold = 0.12, recover = 0.6) {
    const t = this.ctx.currentTime;
    const p = this.duck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(1 - amount, t, 0.02);
    p.setTargetAtTime(1, t + hold, recover / 3);
  }

  dispose() {
    for (const n of [this.master, this.dcBlock, this.compressor, this.clipIn, this.clipper, this.reverb, this.reverbReturn, this.duck, this.musicBus, this.musicWet, this.genHp, this.genBus, this.genWet, this.fileBus, this.sfxBus, this.sfxWet, this.analyserIn, this.analyser]) {
      try {
        n?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}
