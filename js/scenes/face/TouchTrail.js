// Small offscreen "touch" canvas in portrait UV space (like brunoimbrizi's
// interactive-particles TouchTexture). Every frame the trail points age and are
// redrawn as soft radial blobs; the canvas is uploaded as a texture and the
// particle vertex shader pushes particles away from bright areas. As a point
// fades the particles spring back home.
//
// Nothing is allocated per frame: the points live in a fixed ring buffer, the
// blob is one pre-rendered gradient sprite, and the canvas is only redrawn and
// uploaded while something is (or was just) on it.
import * as THREE from 'three';

const MAX_POINTS = 160;
const SPRITE_SIZE = 64;
/** Below this pointer speed (portrait heights / s) nothing is stamped: a resting finger, tracking jitter, the head swaying under a still pointer. */
const MIN_SPEED = 0.04;
/** The resting-finger mark fades this long (s) after the last real stroke. */
const HOVER_HOLD = 0.8;

const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);
const easeOutQuad = (t) => t * (2 - t);

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_SIZE;
  const ctx = c.getContext('2d');
  const r = SPRITE_SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return c;
}

export class TouchTrail {
  constructor(width = 192, height = 256) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);
    this.sprite = makeSprite();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;

    /** Blob radius as a fraction of the portrait height. */
    this.radius = 0.08;
    this.maxAge = 1.15;
    // Ring buffer of trail stamps, oldest at `head`.
    this.pu = new Float32Array(MAX_POINTS);
    this.pv = new Float32Array(MAX_POINTS);
    this.age = new Float32Array(MAX_POINTS);
    this.force = new Float32Array(MAX_POINTS);
    this.head = 0;
    this.count = 0;
    this.hasLast = false;
    this.lastU = 0; // last stamp (new stamps every `spacing` of travel)
    this.lastV = 0;
    this.prevU = 0; // pointer last frame (for its speed)
    this.prevV = 0;
    this.speed = 0;
    this.onHead = false;
    this.sinceStroke = Infinity;
    /** Small soft mark under the fingertip right after a stroke (eased presence 0..1). */
    this.hover = 0;
    this.hoverTarget = 0;
    this.hoverU = 0;
    this.hoverV = 0;
    this.dirty = true;
  }

  /** Number of live trail stamps. */
  get length() {
    return this.count;
  }

  /**
   * Pointer is at (u, v) (v up). `onHead` = it really touches the person (a
   * small mark follows the fingertip right after a stroke); off the head it
   * only extends the trail.
   */
  move(u, v, dt, onHead = true) {
    this.onHead = onHead;
    if (onHead) {
      this.hoverU = u;
      this.hoverV = v;
    }
    const aspect = this.width / this.height; // isotropic distances
    if (!this.hasLast) {
      this.hasLast = true;
      this.lastU = this.prevU = u;
      this.lastV = this.prevV = v;
      this.speed = 0;
      return;
    }
    // Pointer speed in portrait heights per second, smoothed against jitter.
    const step = Math.hypot((u - this.prevU) * aspect, v - this.prevV);
    this.prevU = u;
    this.prevV = v;
    this.speed += (step / Math.max(dt, 1 / 240) - this.speed) * (1 - Math.exp(-15 * dt));

    // Stamps are laid along the path every `spacing` of travel (not every
    // frame), so a resting or slowly drifting finger does not pile them up
    // into a crater, and the trail looks the same at any frame rate.
    const lu = this.lastU;
    const lv = this.lastV;
    const dist = Math.hypot((u - lu) * aspect, v - lv);
    const spacing = this.radius * 0.2;
    if (dist < spacing) return;
    this.lastU = u;
    this.lastV = v;
    if (this.speed < MIN_SPEED) return;
    const force = Math.min(1, 0.25 + this.speed * 0.9);
    if (force > 0.3) this.sinceStroke = 0;
    // The stamp nearest the previous one was passed first, so it is the oldest.
    const steps = Math.min(10, Math.ceil(dist / spacing));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      this.push(lu + (u - lu) * t, lv + (v - lv) * t, (1 - t) * dt, force);
    }
  }

  push(u, v, age, force) {
    if (this.count === MAX_POINTS) {
      this.head = (this.head + 1) % MAX_POINTS; // drop the oldest
      this.count--;
    }
    const i = (this.head + this.count) % MAX_POINTS;
    this.pu[i] = u;
    this.pv[i] = v;
    this.age[i] = age;
    this.force[i] = force;
    this.count++;
  }

  /** Pointer left the portrait / stopped pointing. */
  lift() {
    this.hasLast = false;
    this.onHead = false;
  }

  clear() {
    this.head = this.count = 0;
    this.hasLast = false;
    this.onHead = false;
    this.sinceStroke = Infinity;
    this.hover = this.hoverTarget = 0;
    this.dirty = true;
  }

  /** Age the points and redraw. Returns true when the texture changed. */
  update(dt) {
    this.sinceStroke += dt;
    this.hoverTarget = this.onHead && this.sinceStroke < HOVER_HOLD ? 1 : 0;
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-(this.hoverTarget > this.hover ? 6 : 3) * dt));
    if (this.hover < 0.002 && this.hoverTarget === 0) this.hover = 0;
    for (let k = 0; k < this.count; k++) this.age[(this.head + k) % MAX_POINTS] += dt;
    // Stamps are stored oldest first, so expired ones are all at the head.
    while (this.count && this.age[this.head] > this.maxAge) {
      this.head = (this.head + 1) % MAX_POINTS;
      this.count--;
    }

    const busy = this.count > 0 || this.hover > 0;
    if (!busy && !this.dirty) return false;
    this.dirty = busy; // one more (empty) redraw after the last stamp fades

    const { ctx, width: w, height: h } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const r = this.radius * h;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head + k) % MAX_POINTS;
      const a = Math.max(0, this.age[i]) / this.maxAge;
      const intensity = (a < 0.25 ? easeOutSine(a / 0.25) : easeOutQuad(1 - (a - 0.25) / 0.75)) * this.force[i];
      this.blob(this.pu[i] * w, (1 - this.pv[i]) * h, r * (0.8 + 0.4 * a), intensity * 0.55);
    }
    if (this.hover > 0) this.blob(this.hoverU * w, (1 - this.hoverV) * h, r * 0.5, this.hover * 0.2);
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
    return true;
  }

  blob(x, y, r, intensity) {
    if (intensity <= 0.002) return;
    this.ctx.globalAlpha = Math.min(1, intensity);
    this.ctx.drawImage(this.sprite, x - r, y - r, r * 2, r * 2);
  }

  dispose() {
    this.texture.dispose();
  }
}
