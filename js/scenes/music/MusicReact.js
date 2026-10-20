// Music reaction shared by the scenes.
//
// The App feeds the music analysis into two shared shader uniforms every frame:
//   uAudio (vec4: x level, y bass, z mid, w treble, 0..1) and uBeat (1 on a beat -> 0 in ~0.25 s).
// They are already 0 when the sound is muted or "Particles follow music" is off, and every
// music term in the scene shaders is a product with them, so silence = the normal look, exactly.
//
// The band levels are normalised to the music's own recent peak, so with most music they sit
// near the top most of the time. Pushing particles by the raw bass would just leave a scene
// in a constantly "pumped" state; instead the bass reaction is gated by a beat envelope:
// about a third of it all the time (the scene feels the energy), the rest swelling on every
// beat and decaying over ~0.4 s (the scene pulses with the music).
//
// A scene adds a few uniforms of its own (MusicReact.uniforms):
//   uReact     the scene's "Music reaction" strength (GUI 0..2, default 1)
//   uBeatEnv   beat envelope: 1 on a beat, smooth decay (also catches beats a slow frame missed)
//   uBeatWave  the two most recent beats as travelling waves: (age1, amp1, age2, amp2).
//              age = seconds since that beat, amp = how strong it still is (fades with age).
//              Two slots, so a new beat never makes the previous ripple vanish mid-way.
// and reads the same numbers on the CPU (level / bass / mid / treble / beat, onset) for things
// that live there (rotation speed, a bouncing scale, the photon-ring flare, ...).
import * as THREE from 'three';

/** Declarations + helpers for a vertex shader (needs the uniforms of MusicReact + uAudio). */
export const MUSIC_GLSL = /* glsl */ `
uniform vec4 uAudio;     // shared: level, bass, mid, treble (0 when the sound is off)
uniform float uReact;    // this scene's "Music reaction" strength
uniform float uBeatEnv;  // beat envelope 0..1
uniform vec4 uBeatWave;  // last two beats: age (s), amplitude, age, amplitude

// The music, scaled by the scene's reaction strength: level, bass (pulsing with the beat),
// mid, treble. All 0 when the sound is off.
vec4 music() {
  return vec4(uAudio.x, uAudio.y * (0.3 + 0.7 * uBeatEnv), uAudio.z, uAudio.w) * uReact;
}

// Ring travelling outward from a beat: r = distance from the wave's origin, speed in the
// same units per second, width = half-width of the band. 0 when there is no beat. The ring
// grows in as it leaves its origin (no bright blob at the centre on the beat itself).
float beatRing(float r, float speed, float width) {
  float s = 0.0;
  if (uBeatWave.y > 0.0005) {
    float R = uBeatWave.x * speed;
    float d = (r - R) / width;
    s += uBeatWave.y * exp(-d * d) * smoothstep(0.0, 3.0 * width, R);
  }
  if (uBeatWave.w > 0.0005) {
    float R = uBeatWave.z * speed;
    float d = (r - R) / width;
    s += uBeatWave.w * exp(-d * d) * smoothstep(0.0, 3.0 * width, R);
  }
  return s;
}

// Sparse per-particle glints (0..1): about 4 particles in 10 glint, each peaking briefly at
// its own pace and phase, so treble makes the field shimmer instead of flashing as a whole.
float musicGlint(float seed, float t) {
  if (fract(seed * 43.758) < 0.6) return 0.0;
  float s = 0.5 + 0.5 * sin(t * (6.0 + 10.0 * fract(seed * 7.31)) + seed * 91.7);
  s *= s;
  return s * s * s;
}
`;

const MIN_GAP = 0.12; // s: two onsets closer than this are one beat
const ENV_DECAY = 4.5; // 1/s: the beat envelope is down to ~1/6 after 0.4 s
const BASS_FLOOR = 0.3; // share of the bass reaction that does not wait for a beat (as in music())

export class MusicReact {
  /**
   * @param {import('../../core/App.js').App} app
   * @param {{decay?: number}} [opts] decay: how fast a beat wave fades (1/s)
   */
  constructor(app, { decay = 1.6 } = {}) {
    this.app = app;
    this.decay = decay;
    /** GUI "Music reaction" (0..2). */
    this.strength = 1;
    this.uniforms = {
      uReact: { value: 1 },
      uBeatEnv: { value: 0 },
      uBeatWave: { value: new THREE.Vector4(99, 0, 99, 0) },
    };
    // CPU copies, all x strength (bass pulses with the beat, like music() in the shaders)
    this.level = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    /** Beat envelope x strength: 1 on a beat, smooth decay. */
    this.beat = 0;
    /** true on the frame a beat starts. */
    this.onset = false;
    /** Strength of the beat that just started (x strength). */
    this.onsetAmp = 0;
    this.env = 0;
    this.waves = [
      { age: 99, amp: 0 },
      { age: 99, amp: 0 },
    ];
    this.prevBeat = 0;
    this.prevCount = 0;
    this.sinceOnset = 99;
    this.lastSeen = -1;
  }

  update(dt) {
    const shared = this.app.sharedUniforms;
    const a = shared.uAudio.value;
    const b = shared.uBeat.value;
    const k = this.strength;
    this.uniforms.uReact.value = k;

    // Beat onset: the engine counted a new beat, or the pulse jumped up. Only while the
    // shared uniforms are live (the engine keeps counting beats when "Particles follow
    // music" is off, but then the uniforms are 0). A slow frame may land after the pulse
    // has already decayed: a counted beat still makes a wave.
    const count = this.app.audio?.levels?.beatCount ?? 0;
    // First frame after the scene was away: beats counted meanwhile are old news.
    const now = this.app.elapsed ?? 0;
    if (now - this.lastSeen > 0.25) this.prevCount = count;
    this.lastSeen = now;
    const live = a.x + a.y + a.z + a.w + b > 0;
    const counted = count !== this.prevCount;
    this.sinceOnset += dt;
    this.onset = false;
    let hit = 0;
    if (live && k > 0 && this.sinceOnset > MIN_GAP && (counted || (b > this.prevBeat + 0.25 && b > 0.3))) {
      hit = Math.min(1, Math.max(b, counted ? 0.7 : 0));
      this.onset = true;
      this.onsetAmp = hit * k;
      this.sinceOnset = 0;
      const w0 = this.waves[0];
      const w1 = this.waves[1];
      w1.age = w0.age;
      w1.amp = w0.amp;
      w0.age = 0;
      w0.amp = this.onsetAmp;
    }
    this.prevBeat = b;
    this.prevCount = count;

    // Beat envelope: jumps up with the beat, decays smoothly.
    this.env *= Math.exp(-ENV_DECAY * dt);
    if (live) this.env = Math.max(this.env, Math.min(1, b), hit);
    if (this.env < 1e-3) this.env = 0;
    this.uniforms.uBeatEnv.value = this.env;

    this.level = a.x * k;
    this.bass = a.y * (BASS_FLOOR + (1 - BASS_FLOOR) * this.env) * k;
    this.mid = a.z * k;
    this.treble = a.w * k;
    this.beat = live ? this.env * k : 0;

    // Waves age and fade; when the music stops they fade out quickly.
    const fade = Math.exp(-(!live || k === 0 ? 5 : 0) * dt);
    const out = this.uniforms.uBeatWave.value;
    for (let i = 0; i < 2; i++) {
      const w = this.waves[i];
      w.age += dt;
      w.amp *= fade;
      if (w.age > 4 || w.amp < 1e-3) w.amp = 0;
    }
    const w0 = this.waves[0];
    const w1 = this.waves[1];
    out.set(w0.age, w0.amp * Math.exp(-this.decay * w0.age), w1.age, w1.amp * Math.exp(-this.decay * w1.age));
    if (out.y < 5e-4) out.y = 0;
    if (out.w < 5e-4) out.w = 0;
    return this;
  }

  /** Forget running waves (scene left). */
  reset() {
    for (const w of this.waves) {
      w.age = 99;
      w.amp = 0;
    }
    this.uniforms.uBeatWave.value.set(99, 0, 99, 0);
    this.env = 0;
    this.uniforms.uBeatEnv.value = 0;
    this.sinceOnset = 99;
  }

  /** Adds the 'Music reaction' slider to a scene's GUI folder. */
  addGui(folder, target, key = 'music') {
    return folder
      .add(target, key, 0, 2, 0.05)
      .name('Music reaction')
      .onChange((v) => (this.strength = v));
  }
}

/**
 * Rate-limited quiet "sparkle" sound for a fast fingertip push. Call every frame.
 */
export class SparkleLimiter {
  constructor(app, { minGap = 0.28, minSpeed = 1.6 } = {}) {
    this.app = app;
    this.minGap = minGap;
    this.minSpeed = minSpeed;
    this.t = 99;
  }

  /** @param {boolean} pushing @param {{x: number, y: number}} velocity NDC/s @param {number} pan -1..1 */
  update(dt, pushing, velocity, pan = 0) {
    this.t += dt;
    if (!pushing || this.t < this.minGap) return;
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed < this.minSpeed) return;
    this.t = 0;
    this.app.audio?.sfx?.('sparkle', { intensity: Math.min(0.45, 0.15 + (speed - this.minSpeed) * 0.08), pan });
  }
}

/**
 * The fist "charging" hum: pass the gather level every frame (0 when the fist is released).
 * Calls the engine every frame while it is on, and once with 0 when it stops.
 */
export class ChargeHum {
  constructor(app) {
    this.app = app;
    this.last = 0;
  }

  set(level) {
    const v = level > 0.001 ? Math.min(1, level) : 0;
    if (v === 0 && this.last === 0) return;
    this.last = v;
    this.app.audio?.charge?.(v);
  }

  /** Scene left / disposed: make sure the hum stops. */
  stop() {
    this.last = 0;
    this.app.audio?.charge?.(0);
  }
}
