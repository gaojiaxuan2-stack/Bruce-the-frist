// Sound for the site: generated music for each scene, gesture sound effects, and
// live analysis so the particles can move with whatever is playing.
//
// Browsers only allow sound after a user gesture, so the App calls unlock() from
// the first click / tap / key press.
//
// PLACEHOLDER: the API below is the contract the App and the scenes use; the real
// synthesis, music and analysis replace the bodies.

const STORAGE_KEY = 'particle3d.sound';

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
  }

  /** Create / resume the AudioContext. Call from a user-gesture handler; safe to repeat. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** true once sound can actually play. */
  get running() {
    return this.ctx?.state === 'running';
  }

  /** 'generated' | 'file' | 'mic' */
  get source() {
    return this._source;
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
  }

  toggleMuted() {
    this.setMuted(!this.settings.muted);
    return this.settings.muted;
  }

  setVolume(v) {
    this.settings.volume = v;
    this.save();
  }

  /** Switch the generated music to this scene's mood (crossfade). */
  setScene(id) {
    this.sceneId = id;
  }

  /**
   * One-shot sound effect.
   * @param {'click'|'whoosh'|'chime'|'boom'|'pop'|'morph'|'sparkle'} name
   * @param {{intensity?: number, pan?: number}} [opts] intensity 0..1, pan -1 (left) .. 1 (right)
   */
  // eslint-disable-next-line no-unused-vars
  sfx(name, opts = {}) {}

  /** Continuous "charging" hum while a fist gathers particles: call every frame with 0..1, 0 to stop. */
  // eslint-disable-next-line no-unused-vars
  charge(level) {}

  /** Play the user's own song (an audio File); particles follow it. */
  // eslint-disable-next-line no-unused-vars
  async playFile(file) {
    this._source = 'file';
  }

  /** Listen to the microphone (music playing in the room); nothing is played back. */
  async useMic() {
    this._source = 'mic';
  }

  /** Back to the built-in music. */
  useGenerated() {
    this._source = 'generated';
  }

  /** Per frame: update `levels`. */
  // eslint-disable-next-line no-unused-vars
  update(dt) {
    if (this.override) Object.assign(this.levels, this.override);
    return this.levels;
  }

  dispose() {
    this.ctx?.close();
  }
}
