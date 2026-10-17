// Small offscreen "touch" canvas in portrait UV space (like brunoimbrizi's
// interactive-particles TouchTexture). Every frame the trail points age and are
// redrawn as soft radial blobs; the canvas is uploaded as a texture and the
// particle vertex shader pushes particles away from bright areas. As a point
// fades the particles spring back home.
import * as THREE from 'three';

const MAX_POINTS = 160;

const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);
const easeOutQuad = (t) => t * (2 - t);

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
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;

    /** Blob radius as a fraction of the portrait height. */
    this.radius = 0.08;
    this.maxAge = 1.15;
    this.points = [];
    this.last = null;
    /** Soft dent under a finger that is held still (eased presence 0..1). */
    this.hover = 0;
    this.hoverTarget = 0;
    this.hoverPos = { u: 0, v: 0 };
    this.dirty = true;
  }

  /** Pointer is over the portrait at (u, v) (v up). */
  move(u, v, dt) {
    this.hoverTarget = 1;
    this.hoverPos.u = u;
    this.hoverPos.v = v;
    const last = this.last;
    this.last = { u, v };
    if (!last) return;
    const du = (u - last.u) * (this.width / this.height); // isotropic distance
    const dv = v - last.v;
    const dist = Math.hypot(du, dv);
    if (dist < 1e-4) return;
    const speed = dist / Math.max(dt, 1 / 240);
    const force = Math.min(1, 0.25 + speed * 0.9);
    // Fill fast moves with several stamps so the trail is continuous.
    const steps = Math.min(10, Math.max(1, Math.ceil(dist / (this.radius * 0.3))));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      this.points.push({ u: last.u + (u - last.u) * t, v: last.v + (v - last.v) * t, age: -(1 - t) * dt, force });
    }
    if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
  }

  /** Pointer left the portrait / stopped pointing. */
  lift() {
    this.last = null;
    this.hoverTarget = 0;
  }

  clear() {
    this.points.length = 0;
    this.last = null;
    this.hover = this.hoverTarget = 0;
    this.dirty = true;
  }

  /** Age the points and redraw. Returns true when the texture changed. */
  update(dt) {
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-(this.hoverTarget > this.hover ? 6 : 3) * dt));
    if (this.hover < 0.002 && this.hoverTarget === 0) this.hover = 0;
    for (const p of this.points) p.age += dt;
    while (this.points.length && this.points[0].age > this.maxAge) this.points.shift();
    // Remove any other expired points (ages are not strictly ordered after interpolation).
    if (this.points.some((p) => p.age > this.maxAge)) this.points = this.points.filter((p) => p.age <= this.maxAge);

    const busy = this.points.length > 0 || this.hover > 0;
    if (!busy && !this.dirty) return false;
    this.dirty = busy;

    const { ctx, width: w, height: h } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const r = this.radius * h;
    for (const p of this.points) {
      const a = Math.max(0, p.age) / this.maxAge;
      const intensity = (a < 0.25 ? easeOutSine(a / 0.25) : easeOutQuad(1 - (a - 0.25) / 0.75)) * p.force;
      this.blob(p.u * w, (1 - p.v) * h, r * (0.8 + 0.4 * a), intensity * 0.55);
    }
    if (this.hover > 0) this.blob(this.hoverPos.u * w, (1 - this.hoverPos.v) * h, r * 0.8, this.hover * 0.6);
    this.texture.needsUpdate = true;
    return true;
  }

  blob(x, y, r, intensity) {
    if (intensity <= 0.002) return;
    const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = Math.min(1, intensity);
    g.addColorStop(0, `rgba(255,255,255,${c})`);
    g.addColorStop(0.45, `rgba(255,255,255,${c * 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  dispose() {
    this.texture.dispose();
  }
}
