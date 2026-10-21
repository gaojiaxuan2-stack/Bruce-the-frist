// ironman-visor.js — the inside of the helmet. A dark faceplate with a
// rounded eye opening frames the view, and smoked glass darkens the
// periphery behind the HUD readouts so they stay legible over a bright room.
// The frame is pre-rendered once per layout into a half-resolution sprite
// (one blit per frame); the glowing rim of the glass is thin line art drawn
// into the HUD's glow layer.

import { clamp, hexRGB } from './ironman-fx.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Signed distance to a rectangle with soft corners (negative inside).
function sdBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

export class Visor {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = this.c.height = 1;
    this.key = '';
    this.V = null;
    this.rim = [];     // four corner polylines (Float32Array x,y pairs)
  }

  // Shape of the eye opening for this layout (CSS px).
  shape(L) {
    const { W, H } = L, m = Math.min(W, H);
    const V = { cx: W / 2, cy: H / 2, hw: W / 2 + 2, hh: H / 2 + 2 };
    if (L.portrait) { V.rt = W * 0.46; V.rb = W * 0.64; V.F = W * 0.05; V.S = W * 0.26; V.brow = 0; }
    else { V.hw = W / 2 - W * 0.012; V.rt = H * 0.4; V.rb = H * 0.58; V.F = m * 0.055; V.S = m * 0.25; V.brow = H * 0.035; }
    V.rt = Math.min(V.rt, V.hw, V.hh); V.rb = Math.min(V.rb, V.hw, V.hh);
    return V;
  }

  // Distance to the visor edge (negative inside the opening).
  sd(x, y) {
    const V = this.V;
    const px = Math.abs(x - V.cx);
    let py = y - V.cy;
    const r = py < 0 ? V.rt : V.rb;
    // the brow of the faceplate dips a little over the centre
    let brow = 0;
    if (py < 0 && V.brow) { const u = px / (V.hw * 0.42); brow = u < 1 ? V.brow * (1 - u * u) * (1 - u * u) : 0; }
    py = Math.abs(py);
    const qx = px - V.hw + r, qy = py - V.hh + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r + brow;
  }

  // Rebuild the sprite when the layout or the suit changes.
  update(L, P) {
    const key = `${L.W}x${L.H}|${L.key}|${P.id}`;
    if (key === this.key) return;
    this.key = key;
    this.V = this.shape(L);
    this.build(L, P);
    this.buildRim(L);
  }

  build(L, P) {
    const k = 0.5;
    const w = Math.max(2, Math.ceil(L.W * k)), h = Math.max(2, Math.ceil(L.H * k));
    const c = this.c;
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h), d = img.data;
    const V = this.V, F = V.F, S = V.S;
    const [hr, hg, hb] = hexRGB(P.main);
    const plates = (P.full ? L.plates : L.quietPlates) || [];
    const smoke = P.full ? 0.4 : 0.3;
    let i = 0;
    for (let y = 0; y < h; y++) {
      const py = (y + 0.5) / k;
      for (let x = 0; x < w; x++, i += 4) {
        const px = (x + 0.5) / k;
        const sd = this.sd(px, py);
        // the faceplate: near-black, with HUD light catching its inner lip
        const edge = smooth(-F * 0.9, F * 0.8, sd);
        const lip = Math.exp(-Math.pow((sd - F * 0.35) / (F * 0.5), 2)) * 0.2;
        // smoked glass toward the periphery, and behind the readouts
        const s = smooth(-S, -F * 0.2, sd);
        let a = 1 - (1 - edge * 0.96) * (1 - s * s * smoke);
        for (const p of plates) {
          const pd = sdBox(px, py, p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2, Math.min(p.w, p.h) * (p.round ? 0.5 : 0.3));
          const pa = (1 - smooth(-3, p.f || 12, pd)) * (p.a || 0.46);
          a = 1 - (1 - a) * (1 - pa);
        }
        d[i] = 1 + hr * lip; d[i + 1] = 4 + hg * lip; d[i + 2] = 9 + hb * lip;
        d[i + 3] = Math.round(clamp(a) * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }

  // The four corner arcs of the glass rim, inset a little from the edge.
  buildRim(L) {
    const V = this.V, ins = V.F * 0.15;
    const hw = V.hw - ins, hh = V.hh - ins, rt = Math.max(4, V.rt - ins), rb = Math.max(4, V.rb - ins);
    const corners = [
      // centre x, centre y, radius, start angle, signs for the straight runs
      [V.cx - hw + rt, V.cy - hh + rt, rt, Math.PI, -1, -1],
      [V.cx + hw - rt, V.cy - hh + rt, rt, Math.PI * 1.5, 1, -1],
      [V.cx + hw - rb, V.cy + hh - rb, rb, 0, 1, 1],
      [V.cx - hw + rb, V.cy + hh - rb, rb, Math.PI * 0.5, -1, 1],
    ];
    this.rim = corners.map(([cx, cy, r, a0], ci) => {
      const N = 28, pts = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const a = a0 + (i / (N - 1)) * Math.PI * 0.5;
        let x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (ci < 2 && V.brow) {
          const u = Math.abs(x - V.cx) / (V.hw * 0.42);
          if (u < 1) y += V.brow * (1 - u * u) * (1 - u * u);
        }
        pts[i * 2] = x; pts[i * 2 + 1] = y;
      }
      return pts;
    });
  }

  // Blit the faceplate (fades in with the mode).
  draw(ctx, L, alpha) {
    if (alpha <= 0.004) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.c, 0, 0, L.W, L.H);
    ctx.restore();
  }

  // Glowing rim of the glass: brightest mid-corner, fading toward the ends,
  // with a glint that travels around it. Drawn into the glow layer.
  drawRim(g, P, t, A, flare) {
    if (A <= 0.01) return;
    g.lineCap = 'round';
    g.strokeStyle = P.line;
    for (let c = 0; c < 4; c++) {
      const pts = this.rim[c];
      if (!pts) continue;
      const n = pts.length / 2;
      // fade toward the ends in a few alpha steps (one stroke each)
      for (let s = 0; s < 4; s++) {
        const i0 = Math.floor((n - 1) * (s / 8)), i1 = Math.ceil((n - 1) * (1 - s / 8));
        g.globalAlpha = (0.12 + flare * 0.25) * A;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(pts[i0 * 2], pts[i0 * 2 + 1]);
        for (let i = i0 + 1; i <= i1; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
        g.stroke();
      }
      // glint
      const f = (t * 0.23 + c * 0.25) % 1, gi = Math.floor(f * (n - 4));
      g.globalAlpha = Math.sin(f * Math.PI) * 0.75 * A;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(pts[gi * 2], pts[gi * 2 + 1]);
      for (let i = gi + 1; i < gi + 4; i++) g.lineTo(pts[i * 2], pts[i * 2 + 1]);
      g.stroke();
      // a few rivets along the arc
      g.fillStyle = P.main;
      g.globalAlpha = 0.5 * A;
      for (let i = 4; i < n - 2; i += 6) g.fillRect(pts[i * 2] - 1, pts[i * 2 + 1] - 1, 2, 2);
    }
    g.globalAlpha = 1;
  }
}

