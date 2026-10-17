// draw.js — shared 2D overlay helpers (hand skeletons, glow sprites, text).

import { HAND_CONNECTIONS, FINGER_TIPS } from './gestures.js';

const spriteCache = new Map();

// A soft radial glow sprite, cached per color. Draw it with
// ctx.globalCompositeOperation = 'lighter' for cheap bloom (much faster than
// shadowBlur on phones).
export function glowSprite(color, size = 128) {
  const key = color + size;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  spriteCache.set(key, c);
  return c;
}

export function drawGlow(ctx, x, y, radius, color, alpha = 1) {
  const s = glowSprite(color);
  const prevA = ctx.globalAlpha;
  ctx.globalAlpha = prevA * alpha;
  ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prevA;
}

// Stylized hand skeleton, like the reference video: thin bright bones and
// small joints. opts: { color, width, alpha, joints, tips, glow }
export function drawHand(ctx, hand, opts = {}) {
  const { color = 'rgba(255,255,255,0.85)', width = 1.6, alpha = 1, joints = true, tips = false, glow = null } = opts;
  const lm = hand.lm;
  ctx.save();
  ctx.globalAlpha *= alpha * (hand.ghost ? 0.5 : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (glow) {
    ctx.strokeStyle = glow;
    ctx.lineWidth = width * 4;
    ctx.globalAlpha *= 0.25;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[b].x, lm[b].y); }
    ctx.stroke();
    ctx.globalAlpha /= 0.25;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(lm[a].x, lm[a].y); ctx.lineTo(lm[b].x, lm[b].y); }
  ctx.stroke();
  if (joints) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 21; i++) {
      const r = FINGER_TIPS.includes(i) ? width * 1.8 : width * 1.2;
      ctx.moveTo(lm[i].x + r, lm[i].y);
      ctx.arc(lm[i].x, lm[i].y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (tips) {
    for (const i of FINGER_TIPS) drawGlow(ctx, lm[i].x, lm[i].y, 14, color, 0.6);
  }
  ctx.restore();
}

// Comic-book style text with thick outline (used by Spider-Man "THWIP!").
export function comicText(ctx, text, x, y, { size = 48, fill = '#ffe600', stroke = '#000', rot = 0, alpha = 1, scale = 1, shadow = '#e62429', font = 'Bangers' } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;
  ctx.font = `${size}px ${font}, Impact, "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(text, size * 0.08, size * 0.08);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = size * 0.16;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
