// spider-mask.js — a procedural Spider-Man mask drawn over the 478 FaceMesh
// landmarks: shaded red (or Miles-black) hood, curved web lines radiating
// from the nose bridge, and big white lenses that squint with the user.
// style.kind 'symbiote' (glossy black, big angular lenses), 'noir' (black
// hood, goggles on a strap) and 'miles' (the Miles hood with a fine dark-red
// web instead of the glowing one) are the PORTAL window's versions.

import { HAND_CONNECTIONS } from '../gestures.js';
import { drawGlow, glowSprite, clamp } from '../draw.js';

const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYES = [
  { outer: 33, inner: 133, top: 159, bot: 145 },
  { outer: 263, inner: 362, top: 386, bot: 374 },
];
const RINGS = 6;
const LENS_SCALE = 1.7;
// Lens outline in eye units (x = outward from the nose, y = down):
// pointed near the nose, wide and lifted at the outer upper corner.
const LENS = [
  [-0.47, 0.07],
  [-0.30, -0.17, 0.05, -0.37, 0.40, -0.41],
  [0.63, -0.43, 0.67, -0.10, 0.53, 0.10],
  [0.37, 0.32, 0.01, 0.37, -0.22, 0.27],
  [-0.34, 0.21, -0.43, 0.14, -0.47, 0.07],
];
const LENS_PIVOT = 0.04;
// Black suit: bigger, sharper lenses sweeping up to a point.
const LENS_SYM = [
  [-0.52, 0.12],
  [-0.38, -0.2, 0.0, -0.5, 0.56, -0.58],
  [0.8, -0.62, 0.78, -0.14, 0.62, 0.12],
  [0.44, 0.4, -0.02, 0.42, -0.28, 0.31],
  [-0.4, 0.26, -0.48, 0.19, -0.52, 0.12],
];

// Peter (red) and Miles (black) palettes; lerped by `miles` 0..1.
const PAL = {
  hood: [[255, 76, 76], [212, 22, 34], [140, 8, 22], [62, 0, 10]],
  hoodM: [[70, 70, 82], [30, 30, 38], [12, 12, 16], [0, 0, 0]],
  line: [34, 0, 6], lineM: [255, 32, 52],
  hoodS: [[96, 106, 132], [26, 28, 38], [8, 8, 12], [0, 0, 0]],   // black suit, glossy
  hoodN: [[88, 88, 88], [38, 38, 38], [15, 15, 15], [2, 2, 2]],   // noir
};
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const mixc = (a, b, t, alpha = 1) => `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${alpha})`;

let halftone = null;
// Rim-heavy halftone vignette (dots grow toward the edge), rendered once.
function halftoneSprite() {
  if (halftone) return halftone;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  const step = 9, n = Math.ceil(S / step);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      // 45 degree grid
      const px = S / 2 + (i - j) * step * 0.7071, py = S / 2 + (i + j) * step * 0.7071;
      if (px < 0 || py < 0 || px > S || py > S) continue;
      const k = clamp((Math.hypot(px - S / 2, py - S / 2) / (S / 2) - 0.45) / 0.55, 0, 1);
      if (k <= 0.02) continue;
      g.beginPath();
      g.arc(px, py, k * step * 0.42, 0, Math.PI * 2);
      g.fill();
    }
  }
  halftone = c;
  return c;
}

export class SpiderMask {
  constructor() {
    this.vis = 0;          // face presence fade 0..1
    this.face = null;      // last face (kept while fading out)
    this.open = [1, 1];    // smoothed lens openness per screen side
    this.ref = [0.3, 0.3]; // adaptive "eye fully open" ratio per side
    this.B = OVAL.map(() => ({ x: 0, y: 0 }));
  }

  reset() { this.vis = 0; this.face = null; this.open = [1, 1]; }

  update(face, dt) {
    if (face && face.lm && face.lm.length >= 468) {
      this.face = face;
      this.vis = Math.min(1, this.vis + dt * 3);
      this._eyes(face.lm, dt);
    } else {
      this.vis = Math.max(0, this.vis - dt * 4);
      if (this.vis === 0) this.face = null;
    }
  }

  // Lens openness from the lid gap over the eye width, per screen side.
  _eyes(lm, dt) {
    const wA = Math.hypot(lm[33].x - lm[133].x, lm[33].y - lm[133].y);
    const wB = Math.hypot(lm[263].x - lm[362].x, lm[263].y - lm[362].y);
    const ew = (wA + wB) / 2;
    if (!(ew > 2)) return;
    for (const e of EYES) {
      const cx = (lm[e.outer].x + lm[e.inner].x) / 2;
      const other = e === EYES[0] ? EYES[1] : EYES[0];
      const side = cx < (lm[other.outer].x + lm[other.inner].x) / 2 ? 0 : 1;
      const r = Math.hypot(lm[e.top].x - lm[e.bot].x, lm[e.top].y - lm[e.bot].y) / ew;
      // learn this user's normal open eye (fast up, slow down)
      this.ref[side] += (r - this.ref[side]) * (r > this.ref[side] ? 0.05 : 0.004);
      this.ref[side] = clamp(this.ref[side], 0.16, 0.45);
      const target = clamp((r / this.ref[side] - 0.3) / 0.5, 0, 1);
      this.open[side] += (target - this.open[side]) * Math.min(1, dt * 16);
    }
  }

  // style: { amt 0..1, miles 0..1, comic 0..1, kind: '' | 'miles' | 'symbiote'
  //          | 'noir', ink: lens outline weight (1 = default) }
  draw(ctx, frame, style) {
    const f = this.face;
    const amt = this.vis * style.amt;
    if (!f || amt < 0.01) return;
    const lm = f.lm;
    const top = lm[10], chin = lm[152], C = lm[168];
    let ux = top.x - chin.x, uy = top.y - chin.y;
    const fh = Math.hypot(ux, uy);
    if (!(fh > 20) || !isFinite(C.x + C.y)) return;
    ux /= fh; uy /= fh;
    const mx = (top.x + chin.x) / 2, my = (top.y + chin.y) / 2;
    const half = fh / 2;
    const L = lm[234], Rr = lm[454];
    const fw = Math.hypot(Rr.x - L.x, Rr.y - L.y) || fh * 0.8;
    // yaw -1..1 from where the nose tip sits between the cheeks
    const rx = (Rr.x - L.x) / fw, ry = (Rr.y - L.y) / fw;
    const yaw = clamp((((lm[1].x - L.x) * rx + (lm[1].y - L.y) * ry) / fw - 0.5) * 2, -1, 1);

    // Face oval, the top pushed out to cover the forehead / hairline.
    const B = this.B;
    for (let i = 0; i < OVAL.length; i++) {
      const p = lm[OVAL[i]];
      const vx = p.x - mx, vy = p.y - my;
      // raise the forehead along the face's up axis (a dome, not a box)
      let w = clamp((vx * ux + vy * uy) / half, 0, 1);
      w = w * w * (3 - 2 * w);
      const lift = half * 0.36 * w * w, k = 1.05 - 0.03 * w;
      B[i].x = mx + vx * k + ux * lift; B[i].y = my + vy * k + uy * lift;
    }
    const n = B.length;
    const ovalPath = () => {
      ctx.beginPath();
      ctx.moveTo((B[n - 1].x + B[0].x) / 2, (B[n - 1].y + B[0].y) / 2);
      for (let i = 0; i < n; i++) {
        const a = B[i], b = B[(i + 1) % n];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ctx.closePath();
    };
    const miles = style.miles, comic = style.comic;
    const kind = style.kind || '', alt = kind === 'symbiote' ? PAL.hoodS : kind === 'noir' ? PAL.hoodN : null;
    const lw = Math.max(0.8, fw * 0.0068);

    ctx.save();
    ctx.globalAlpha = amt;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // contact shadow on the neck
    ctx.save();
    ctx.translate(chin.x - ux * fh * 0.06, chin.y - uy * fh * 0.06);
    ctx.rotate(Math.atan2(ry, rx));
    ctx.scale(fw * 0.42, fh * 0.12);
    ctx.globalAlpha = amt * 0.45;
    ctx.drawImage(glowSprite('rgba(0,0,0,0.9)'), -1, -1, 2, 2);
    ctx.restore();

    // hood: shaded fill, light from the front-top, following the head turn
    const gx = C.x + ux * fh * 0.12 + rx * yaw * fw * 0.12, gy = C.y + uy * fh * 0.12 + ry * yaw * fw * 0.12;
    const grad = ctx.createRadialGradient(gx, gy, fw * 0.04, gx, gy, Math.max(fw, fh) * 0.72);
    const stops = [0, 0.42, 0.82, 1];
    for (let i = 0; i < 4; i++) grad.addColorStop(stops[i], alt ? rgb(alt[i]) : mixc(PAL.hood[i], PAL.hoodM[i], miles));
    ovalPath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // comic halftone shading around the rim
    if (comic > 0.01) {
      ctx.save();
      ctx.translate(mx + ux * fh * 0.06, my + uy * fh * 0.06);
      ctx.rotate(Math.atan2(ry, rx));
      ctx.globalAlpha = amt * comic * (0.42 - miles * 0.3);
      const hw = fw * 0.62, hh = fh * 0.72;
      ctx.drawImage(halftoneSprite(), -hw, -hh, hw * 2, hh * 2);
      ctx.restore();
    }
    // soft specular sheen on the forehead
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(C.x + ux * fh * 0.3 + rx * yaw * fw * 0.08, C.y + uy * fh * 0.3 + ry * yaw * fw * 0.08);
    ctx.rotate(Math.atan2(ry, rx));
    ctx.scale(fw * 0.32, fh * 0.13);
    ctx.globalAlpha = amt * (alt ? (kind === 'noir' ? 0.14 : 0.3) : 0.22 - miles * 0.1);
    ctx.drawImage(glowSprite(alt ? '#d4e0ff' : '#ffd0d0'), -1, -1, 2, 2);
    if (kind === 'symbiote') {
      // wet-look gloss: a sharp streak on the forehead and one on the cheek
      ctx.globalAlpha = amt * 0.45;
      ctx.drawImage(glowSprite('#ffffff'), -0.5, -0.45, 1, 0.9);
      ctx.translate(0.55 - yaw * 0.3, 3.4);
      ctx.drawImage(glowSprite('#cfdcff'), -0.35, -1.2, 0.7, 2.4);
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    if (kind === 'noir') this._strap(ctx, lm, B, amt, C, ux, uy, fh, lw);

    // web lines: radials from the nose bridge + rings bowed toward it
    const webPath = () => {
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) { ctx.moveTo(C.x, C.y); ctx.lineTo(B[i].x, B[i].y); }
      const grow = clamp(this.vis * 1.4, 0, 1) * (RINGS + 1);   // rings grow out as the mask appears
      for (let k = 1; k <= RINGS; k++) {
        if (k > grow) break;
        const fr = Math.sin(1.3 * k / (RINGS + 0.5)) / Math.sin(1.3);
        for (let i = 0; i < n; i += 2) {
          const a = B[i], b = B[(i + 2) % n];
          const ax = C.x + (a.x - C.x) * fr, ay = C.y + (a.y - C.y) * fr;
          const bx = C.x + (b.x - C.x) * fr, by = C.y + (b.y - C.y) * fr;
          const qx = (ax + bx) / 2, qy = (ay + by) / 2;
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo(qx + (C.x - qx) * 0.17, qy + (C.y - qy) * 0.17, bx, by);
        }
      }
    };
    if (alt) { /* no web on the black suit / noir hood */ } else if (miles > 0.01) {
      webPath();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = amt * miles * (kind === 'miles' ? 0.1 : 0.35);
      ctx.strokeStyle = '#ff1030';
      ctx.lineWidth = lw * 3.5;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // raised-thread highlight (paths bake the transform, so rebuild it offset)
    if (!alt && miles < 0.99) {
      ctx.save();
      ctx.translate(-lw * 0.5, -lw * 0.6);
      webPath();
      ctx.restore();
      ctx.globalAlpha = amt * (1 - miles) * 0.3;
      ctx.strokeStyle = '#ffb0b0';
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
    }
    if (!alt) {
      webPath();
      ctx.globalAlpha = amt * 0.92;
      ctx.strokeStyle = kind === 'miles' ? '#a80d24' : mixc(PAL.line, PAL.lineM, miles);
      ctx.lineWidth = kind === 'miles' ? lw * 0.6 : lw;
      ctx.stroke();
    }
    // Miles: the lenses glow red into the black hood (kept inside the mask)
    if (miles > 0.01) this._lenses(ctx, lm, amt * miles * (kind === 'miles' ? 0.5 : 1), 1, true);
    ctx.restore();   // unclip

    // ink outline (comic looks) / dark seam (plain)
    ovalPath();
    ctx.globalAlpha = amt * (0.35 + comic * 0.55);
    ctx.strokeStyle = '#0d0205';
    ctx.lineWidth = lw * (1.4 + comic * 1.4);
    ctx.stroke();

    this._lenses(ctx, lm, amt, miles, false, kind, style.ink || 1);

    // Let hands in front of the face show through the mask.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    for (const h of frame.hands) {
      const p = h.lm, s = h.size;
      if (!(s > 5)) continue;
      if (Math.hypot(h.palm.x - mx, h.palm.y - my) > fh * 1.3 + s * 2) continue;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = s * 0.24;
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(p[a].x, p[a].y); ctx.lineTo(p[b].x, p[b].y); }
      ctx.stroke();
      ctx.beginPath();
      for (const i of [0, 1, 5, 9, 13, 17]) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Noir: a leather strap across the eyes and a stitched seam up the
  // middle of the hood (inside the hood clip).
  _strap(ctx, lm, B, amt, C, ux, uy, fh, lw) {
    const a = { x: (lm[33].x + lm[133].x) / 2, y: (lm[33].y + lm[133].y) / 2 };
    const b = { x: (lm[263].x + lm[362].x) / 2, y: (lm[263].y + lm[362].y) / 2 };
    const ex = b.x - a.x, ey = b.y - a.y, el = Math.hypot(ex, ey);
    if (!(el > 4)) return;
    const k = 3 / el;
    const line = (o) => {
      ctx.beginPath();
      ctx.moveTo(a.x - ex * k + ux * o, a.y - ey * k + uy * o);
      ctx.lineTo(b.x + ex * k + ux * o, b.y + ey * k + uy * o);
    };
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.globalAlpha = amt;
    line(0);
    ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = el * 0.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(160,160,160,0.4)'; ctx.lineWidth = lw * 1.1;
    ctx.setLineDash([el * 0.03, el * 0.07]);
    line(el * 0.19); ctx.stroke();
    line(-el * 0.19); ctx.stroke();
    ctx.restore();
    // centre seam with stitches, from the crown to the chin
    const top = B[0], chin = lm[152];
    ctx.save();
    ctx.globalAlpha = amt * 0.75;
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = lw * 1.3;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(C.x + ux * fh * 0.2, C.y + uy * fh * 0.2, chin.x, chin.y);
    ctx.stroke();
    ctx.lineWidth = lw * 4;
    ctx.setLineDash([lw * 1.1, lw * 3.2]);
    ctx.globalAlpha = amt * 0.5;
    ctx.stroke();
    ctx.restore();
  }

  // glowOnly: just the soft red Miles glow behind each lens.
  _lenses(ctx, lm, amt, miles, glowOnly = false, kind = '', ink = 1) {
    const ca = { x: (lm[33].x + lm[133].x) / 2, y: (lm[33].y + lm[133].y) / 2 };
    const cb = { x: (lm[263].x + lm[362].x) / 2, y: (lm[263].y + lm[362].y) / 2 };
    const left = ca.x < cb.x ? ca : cb, right = ca.x < cb.x ? cb : ca;
    let ex = right.x - left.x, ey = right.y - left.y;
    const el = Math.hypot(ex, ey);
    if (!(el > 4)) return;
    ex /= el; ey /= el;
    const downX = -ey, downY = ex;   // face "down", perpendicular to the eye line
    const wA = Math.hypot(lm[33].x - lm[133].x, lm[33].y - lm[133].y);
    const wB = Math.hypot(lm[263].x - lm[362].x, lm[263].y - lm[362].y);
    const avg = (wA + wB) / 2;

    for (const e of EYES) {
      const o = lm[e.outer], i = lm[e.inner];
      let ox = o.x - i.x, oy = o.y - i.y;
      const w = Math.hypot(ox, oy);
      if (!(w > 1)) continue;
      ox /= w; oy /= w;
      const cx = (o.x + i.x) / 2, cy = (o.y + i.y) / 2;
      const side = cx < (left.x + right.x) / 2 ? 0 : 1;
      const open = this.open[side];
      const sq = 0.14 + 0.86 * open * open * (3 - 2 * open);
      // eye frame: x outward (foreshortened eye width), y down (average width)
      const sx = Math.max(w, avg * 0.55) * LENS_SCALE, sy = avg * LENS_SCALE;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.transform(ox * sx, oy * sx, downX * sy, downY * sy, 0, 0);
      ctx.translate(0.04, -0.09);
      const unit = Math.sqrt(sx * sy);

      if (glowOnly) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = amt;
        drawGlow(ctx, 0.08, -0.03, 1.05, '#ff1a30', 0.75);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }
      if (kind === 'noir') { this._goggle(ctx, amt, unit); ctx.restore(); continue; }
      if (kind === 'symbiote') {
        // big white lenses, a thin dark rim, a glossy streak
        this._lensPath(ctx, sq, LENS_SYM);
        ctx.globalAlpha = amt;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(2, unit * 0.08) / unit;
        ctx.stroke();
        const gs = ctx.createLinearGradient(-0.3, -0.5, 0.4, 0.4);
        gs.addColorStop(0, '#ffffff');
        gs.addColorStop(0.6, '#eef2fa');
        gs.addColorStop(1, '#b5c0d6');
        ctx.fillStyle = gs;
        ctx.fill();
        ctx.restore();
        continue;
      }
      this._lensPath(ctx, sq);
      ctx.globalAlpha = amt;
      ctx.strokeStyle = '#050505';
      ctx.lineWidth = (Math.max(3, unit * 0.13) * ink) / unit;
      ctx.stroke();
      const g = ctx.createRadialGradient(0.12, 0.08, 0.05, 0.05, 0, 0.62);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, miles > 0.5 ? '#fff4f6' : '#f3f6fb');
      g.addColorStop(1, miles > 0.5 ? '#e8c9d0' : '#c3cedd');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }
  }

  _lensPath(ctx, sq, shape = LENS) {
    const y = (v) => LENS_PIVOT + (v - LENS_PIVOT) * sq;
    ctx.beginPath();
    ctx.moveTo(shape[0][0], y(shape[0][1]));
    for (let k = 1; k < shape.length; k++) {
      const c = shape[k];
      ctx.bezierCurveTo(c[0], y(c[1]), c[2], y(c[3]), c[4], y(c[5]));
    }
    ctx.closePath();
  }

  // Noir goggle in eye units: smoked glass in a metal rim, with a glint.
  _goggle(ctx, amt, unit) {
    ctx.globalAlpha = amt;
    ctx.beginPath();
    ctx.arc(0.04, 0.0, 0.44, 0, Math.PI * 2);
    const gl = ctx.createRadialGradient(-0.1, -0.14, 0.02, 0.04, 0, 0.46);
    gl.addColorStop(0, '#3c4248');
    gl.addColorStop(1, '#050607');
    ctx.fillStyle = gl;
    ctx.fill();
    const rim = ctx.createLinearGradient(-0.4, -0.4, 0.4, 0.4);
    rim.addColorStop(0, '#e6e6e6');
    rim.addColorStop(0.5, '#6a6a6a');
    rim.addColorStop(1, '#2a2a2a');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 0.13;
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(1.5, unit * 0.03) / unit;
    ctx.beginPath(); ctx.arc(0.04, 0.0, 0.51, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0.04, 0.0, 0.31, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(0.18, 0.16, 0.035, 0, Math.PI * 2); ctx.fill();
  }
}
