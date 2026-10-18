// PORTAL — raise both hands: the window spanned by your thumb and index
// fingertips becomes a live filter lens over the camera (the viral blue
// dot-matrix clip, plus nine more looks). Pinch to flip filters, swipe with
// one hand, or point at a chip.

import { drawGlow, glowSprite, clamp, lerp, easeOutCubic, easeOutBack } from '../draw.js';
import { Particles } from '../particles.js';
import { FILTERS, filterColor, filterProgram, bgProgram, buildAtlases } from './portal-filters.js';

const BY_ID = Object.fromEntries(FILTERS.map((f) => [f.id, f]));
const HANDLE = '#2bff88';
const OPEN_S = 0.3;      // open animation
const CLOSE_S = 0.34;    // CRT-style collapse
const WIPE_S = 0.3;      // filter change wipe
const SCRAMBLE = '#%&@$*!?<>/=01ｱｶｻﾀﾅ';
const HINTS = {
  none: 'Raise <b>both hands</b> 🙌 to frame a window',
  one: 'Raise your other hand ✋ · <b>swipe</b> ↔ filters',
  two: '<b>Spread</b> thumb &amp; index ✋✋ to open it',
  open: '<b>Pinch 🤏</b> for the next filter',
};

const pt = () => ({ x: 0, y: 0 });
const quad4 = () => [pt(), pt(), pt(), pt()];
const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a)); return k * k * (3 - 2 * k); };
const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const lightCss = (c) => css([lerp(c[0], 1, 0.55), lerp(c[1], 1, 0.55), lerp(c[2], 1, 0.55)]);

// Runtime state (one portal at a time).
const S = {
  t: 0, cur: 'dots', prev: null, wipe: 1, wipeDir: 1, flash: 0, switchAt: -9, lastSwitch: -9, pending: null,
  quad: quad4(), dq: quad4(), present: false, open: 0, ids: [0, 0], span: 0, openedAt: 0, closedAt: -9,
  gq: quad4(), gReal: 0, ghostA: 0, ghostHand: 0, preview: 0, swipeFx: null,
  memo: new Map(), uiUntil: new Map(),
  uiScale: 1, hintKey: null, hintWant: null, hintSince: 0, humOn: false, sfxOpenAt: -9, sfxCloseAt: -9,
  safeTop: 120, safeBot: 9999, W: 1, H: 1, lab: { l: 0 }, pagerIn: false,
  particles: new Particles(320), atlas: null, warm: [], warmAt: 0,
};

// Uniform objects reused every frame (no per-frame allocation storms).
const U = {
  bg: { u_quad: new Float32Array(8), u_open: 0, u_tint: [1, 1, 1] },
  f: {
    u_quad: new Float32Array(8), u_center: [0, 0], u_span: 1, u_alpha: 1, u_reveal: 1, u_cell: 10, u_band: [0, 1e5],
    u_wipe: 9, u_wipeDir: 1, u_wipeInv: 0, u_flash: 0, u_tint: [1, 1, 1], u_fade: [0, 0], u_glyphs: null, u_ascii: null,
  },
};

// --- geometry ----------------------------------------------------------------

const finite = (q) => q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
const cross = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
function area(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; }
  return a / 2;  // > 0 when clockwise on screen
}

// Make a clockwise, convex quad. Crossed orders (hands crossed, tips swapped)
// are re-sorted by angle around the centroid; a reflex corner is mirrored out.
function orderQuad(q) {
  if (cross(q[3], q[0], q[1]) > 0 && cross(q[0], q[1], q[2]) > 0 && cross(q[1], q[2], q[3]) > 0 && cross(q[2], q[3], q[0]) > 0) return q;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  q.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let k = 0;
  for (let i = 1; i < 4; i++) if (q[i].x + q[i].y < q[k].x + q[k].y) k = i;
  for (let i = 0; i < k; i++) q.push(q.shift());  // top-left first: the label rides the top edge
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    if (cross(a, b, c) >= 0) continue;
    const dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy || 1;
    const s = ((b.x - a.x) * dx + (b.y - a.y) * dy) / l2;
    q[i] = { x: 2 * (a.x + dx * s) - b.x, y: 2 * (a.y + dy * s) - b.y };
  }
  return q;
}

// Index + thumb tips. While a pinch closes, blend toward where the tips were
// (in the hand's own frame) so pinching to switch doesn't crush the window.
function tips(h) {
  const lm = h.lm, d = h.dir, sz = Math.max(1, h.size), px = h.palm.x, py = h.palm.y;
  const nx = -d.y, ny = d.x;
  const w = smooth(0.2, 0.65, h.pinch || 0);
  let m = S.memo.get(h.id);
  if (w < 0.02) {
    if (!m) { m = { a: 0, b: 0, c: 0, e: 0 }; S.memo.set(h.id, m); }
    const ax = lm[8].x - px, ay = lm[8].y - py, bx = lm[4].x - px, by = lm[4].y - py;
    m.a = (ax * d.x + ay * d.y) / sz; m.b = (ax * nx + ay * ny) / sz;
    m.c = (bx * d.x + by * d.y) / sz; m.e = (bx * nx + by * ny) / sz;
  }
  const i = { x: lm[8].x, y: lm[8].y }, t = { x: lm[4].x, y: lm[4].y };
  if (m && w > 0) {
    i.x = lerp(i.x, px + (d.x * m.a + nx * m.b) * sz, w); i.y = lerp(i.y, py + (d.y * m.a + ny * m.b) * sz, w);
    t.x = lerp(t.x, px + (d.x * m.c + nx * m.e) * sz, w); t.y = lerp(t.y, py + (d.y * m.c + ny * m.e) * sz, w);
  }
  return [i, t];
}

// Up to two hands for the portal: live ones first, then ghosts. Hands that
// were just used on the HUD are left out for a moment.
function pickHands(hands, t) {
  const live = [], ghosts = [];
  for (const h of hands) {
    if (h.overUI) S.uiUntil.set(h.id, t + 0.45);
    if ((S.uiUntil.get(h.id) || 0) > t) continue;
    (h.ghost ? ghosts : live).push(h);
  }
  const out = live.concat(ghosts).slice(0, 2);
  out.sort((a, b) => a.palm.x - b.palm.x);
  return out;
}

// CRT power-off: squash to the horizontal midline, then shrink to a dot.
function collapse(dst, q, k) {
  const lx = (q[0].x + q[3].x) / 2, ly = (q[0].y + q[3].y) / 2;
  const rx = (q[1].x + q[2].x) / 2, ry = (q[1].y + q[2].y) / 2;
  if (k > 0.45) {
    const u = (k - 0.45) / 0.55, s = u * u;
    dst[0].x = lerp(lx, q[0].x, s); dst[0].y = lerp(ly, q[0].y, s);
    dst[3].x = lerp(lx, q[3].x, s); dst[3].y = lerp(ly, q[3].y, s);
    dst[1].x = lerp(rx, q[1].x, s); dst[1].y = lerp(ry, q[1].y, s);
    dst[2].x = lerp(rx, q[2].x, s); dst[2].y = lerp(ry, q[2].y, s);
  } else {
    const h = Math.pow(k / 0.45, 0.7), cx = (lx + rx) / 2, cy = (ly + ry) / 2;
    dst[0].x = dst[3].x = lerp(cx, lx, h); dst[0].y = dst[3].y = lerp(cy, ly, h);
    dst[1].x = dst[2].x = lerp(cx, rx, h); dst[1].y = dst[2].y = lerp(cy, ry, h);
  }
}

// One hand: a phantom window mirrored across the screen centre.
function phantom(h, W) {
  const [i, th] = tips(h);
  const up = i.y <= th.y ? i : th, lo = up === i ? th : i;
  if (!finite([up, lo]) || lo.y - up.y < 16) return false;
  const left = h.palm.x < W / 2;
  const minW = Math.max(h.size * 2.4, 110);
  let ux = W - up.x, lx = W - lo.x;
  if (left) { ux = Math.max(ux, up.x + minW); lx = Math.max(lx, lo.x + minW); }
  else { ux = Math.min(ux, up.x - minW); lx = Math.min(lx, lo.x - minW); }
  ux = clamp(ux, 26, W - 26); lx = clamp(lx, 26, W - 26);
  const g = S.gq;
  const set = (p, x, y) => { p.x = x; p.y = y; };
  if (!Number.isFinite(ux + lx)) return false;
  if (left) { set(g[0], up.x, up.y); set(g[1], ux, up.y); set(g[2], lx, lo.y); set(g[3], lo.x, lo.y); S.gReal = 0; }
  else { set(g[0], ux, up.y); set(g[1], up.x, up.y); set(g[2], lo.x, lo.y); set(g[3], lx, lo.y); S.gReal = 1; }
  if (area(g) < 400) return false;  // squeezed against a screen edge
  S.ghostHand = h.id;
  return true;
}

// Where the HUD bars are: busy graphics stay between these y values.
function hudBands(app, H) {
  const b = app.ui && app.ui.bands ? app.ui.bands() : null;
  S.safeTop = b ? b.top : 120;
  S.safeBot = b ? b.bottom : H - 150;
}

// --- filters -----------------------------------------------------------------

// Runs the in-window transition to filter `id` (called from setOption).
function switchTo(mode, app, id, dir, how) {
  if (!BY_ID[id] || id === S.cur) return;
  const t = S.t;
  const visible = S.open > 0.05 || S.ghostA > 0.05;
  S.prev = visible ? S.cur : null; S.cur = id;
  S.switchAt = t; S.lastSwitch = t;
  if (!visible) { S.wipe = 1; return; }  // nothing on screen: switch silently
  S.wipe = 0; S.wipeDir = dir;
  S.flash = how === 'pinch' ? 0.55 : 0.3;
  S.preview = 1;
  // The HUD already beeps for its own chips.
  if (how !== 'chip') app.sfx.play('select');
  if (how === 'swipe') app.sfx.play('whoosh');
  // Sparks along the edge the wipe starts from.
  const q = S.open > 0.05 ? S.dq : S.gq;
  const a = dir > 0 ? q[0] : q[3], b = dir > 0 ? q[1] : q[2];
  const col = css(filterColor(BY_ID[id], t));
  const sc = S.uiScale;
  for (let i = 0; i < 14; i++) {
    const k = Math.random();
    S.particles.emit({
      x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), kind: 'spark', life: 0.3 + Math.random() * 0.3,
      vx: (Math.random() - 0.5) * 120 * sc, vy: dir * (60 + Math.random() * 200) * sc,
      size: 3 * sc, drag: 0.2, color: i % 3 ? col : '#ffffff',
    });
  }
}

// A gesture picks the next/previous filter. It goes through app.setOption so
// the chips follow; setOption() below then runs the transition.
function step(mode, app, delta, how) {
  if (S.t - S.lastSwitch < 0.3) return;
  const i = FILTERS.findIndex((f) => f.id === S.cur);
  const n = FILTERS.length;
  const id = FILTERS[(i + delta + n) % n].id;
  S.pending = { dir: delta > 0 ? 1 : -1, how };
  if (app.setOption) app.setOption(id);
  if (S.cur !== id) {  // older core without app.setOption
    mode.option = id;
    switchTo(mode, app, id, S.pending.dir, how);
    app.ui?.setOption?.(id);
  }
  S.pending = null;
}

function burst(x, y, n, sc, colors, speed = 220) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (0.35 + Math.random() * 0.65) * speed * sc;
    S.particles.emit({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, kind: 'spark', life: 0.3 + Math.random() * 0.35,
      size: 2.6 * sc, drag: 0.15, color: colors[i % colors.length],
    });
  }
}

// --- 2D overlay pieces -------------------------------------------------------

function polyPath(ctx, q, p) {
  ctx.beginPath();
  if (p >= 1) {
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    return;
  }
  // Edges grow out of every corner and meet in the middle.
  const h = p * 0.5;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + (b.x - a.x) * h, a.y + (b.y - a.y) * h);
    ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + (a.x - b.x) * h, b.y + (a.y - b.y) * h);
  }
}

function perimeter(q) {
  let L = 0;
  for (let i = 0; i < 4; i++) L += Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y);
  return L;
}

function drawEdges(ctx, q, A, p, col, t) {
  const sc = S.uiScale;
  polyPath(ctx, q, p);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(col);
  ctx.globalAlpha = 0.14 * A; ctx.lineWidth = 11 * sc; ctx.stroke();
  ctx.globalAlpha = 0.4 * A; ctx.lineWidth = 4.5 * sc; ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = A; ctx.lineWidth = 1.6 * sc; ctx.strokeStyle = lightCss(col); ctx.stroke();
  if (p >= 1) {
    // A bright comet running around the frame.
    const L = perimeter(q);
    if (L > 40) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.setLineDash([L * 0.1, L * 0.9]);
      ctx.lineDashOffset = -((t * 0.32) % 1) * L;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.55 * A; ctx.lineWidth = 2.4 * sc; ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

function drawHandles(ctx, q, A, k, which = null) {
  const s = 13 * S.uiScale * k;
  if (s < 0.5) return;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) if (!which || which[i]) drawGlow(ctx, q[i].x, q[i].y, s * 1.7, HANDLE, 0.55 * A);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = A;
  ctx.fillStyle = HANDLE;
  for (let i = 0; i < 4; i++) if (!which || which[i]) ctx.fillRect(q[i].x - s / 2, q[i].y - s / 2, s, s);
  ctx.fillStyle = 'rgba(220,255,235,0.9)';
  const c = s * 0.28;
  for (let i = 0; i < 4; i++) if (!which || which[i]) ctx.fillRect(q[i].x - s / 2 + 1.5, q[i].y - s / 2 + 1.5, c, c);
}

// Techy tag with chamfered corners.
function tagPath(ctx, w, h) {
  const c = h * 0.35, x = -w / 2, y = -h / 2;
  ctx.beginPath();
  ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c);
  ctx.closePath();
}

function scramble(text, k) {
  if (k >= 1) return text;
  const upto = Math.floor(text.length * Math.max(0, k));
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += i < upto || text[i] === ' ' ? text[i] : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
  }
  return out;
}

// Filter name riding the top edge. It moves inside the window (and below the
// top HUD bar) when the edge is too high, and records where it went in S.lab
// so the REC readout can stay clear of it.
function drawLabel(ctx, q, A, t, col) {
  const f = BY_ID[S.cur];
  const a = q[0], b = q[1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  S.lab.l = 0;
  if (!(len > 30)) return;
  const ang = clamp(Math.atan2(b.y - a.y, b.x - a.x), -0.6, 0.6);
  const nx = Math.sin(ang), ny = -Math.cos(ang);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const sc = Math.min(S.uiScale, len / 150);
  const off = 17 * sc;
  let x = mx + nx * off, y = my + ny * off;
  if (y - 14 * sc < S.safeTop) {
    x = mx - nx * off; y = Math.max(my - ny * off, S.safeTop + 14 * sc);
  }
  const since = t - S.switchAt;
  const flash = clamp(1 - since / 0.6);
  const full = `${f.sym} ${f.label}`;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const pop = 1 + 0.22 * flash * flash;
  ctx.scale(sc * pop, sc * pop);
  ctx.font = '700 11px Orbitron, Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(full).width + 20, h = 19;
  // Where the tag starts along the top edge (CSS px from the TL corner).
  S.lab.l = len / 2 - (w / 2) * sc * pop;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = A * (0.3 + 0.6 * flash);
  ctx.drawImage(glowSprite(css(col)), -w * 0.8, -h * 1.7, w * 1.6, h * 3.4);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = A;
  tagPath(ctx, w, h);
  ctx.fillStyle = css(col);
  ctx.fill();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${(0.75 * flash).toFixed(3)})`; ctx.fill(); }
  ctx.fillStyle = '#03050a';
  ctx.fillText(`${f.sym} ${scramble(f.label, since / 0.32)}`, 0, 0.5);
  const i = FILTERS.indexOf(f) + 1;
  ctx.globalAlpha = A * 0.5;
  ctx.fillStyle = '#04060c';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(w / 2 + 2, -7, 34, 14, 7); else ctx.rect(w / 2 + 2, -7, 34, 14);
  ctx.fill();
  ctx.globalAlpha = A;
  ctx.font = '700 10px Rajdhani, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${String(i).padStart(2, '0')}/${FILTERS.length}`, w / 2 + 7, 0.5);
  ctx.restore();
}

// Filter pager under the bottom edge: one bar per filter.
function drawPager(ctx, q, A, col) {
  const a = q[3], b = q[2];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  S.pagerIn = false;
  if (!(len > 120)) return;
  const ang = clamp(Math.atan2(b.y - a.y, b.x - a.x), -0.6, 0.6);
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const off = 15 * S.uiScale;
  let x = mx + nx * off, y = my + ny * off;
  if (y + 6 > S.safeBot) { x = mx - nx * off; y = my - ny * off; S.pagerIn = true; }
  if (y + 6 > S.safeBot || y < S.safeTop) return;
  const cur = FILTERS.findIndex((f) => f.id === S.cur);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.globalAlpha = A;
  const gap = 9, n = FILTERS.length;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  for (let i = 0; i < n; i++) if (i !== cur) ctx.fillRect((i - (n - 1) / 2) * gap - 1.5, -1.5, 3, 3);
  ctx.fillStyle = css(col);
  ctx.fillRect((cur - (n - 1) / 2) * gap - 5, -1.5, 10, 3);
  ctx.restore();
}

// Tiny blinking "REC" + timecode in an inside corner: top-left, or
// bottom-left when the label spans that corner; corner coordinates outside.
function drawReadouts(ctx, q, A, t) {
  if (S.span < 150 || A < 0.02) return;
  const sc = S.uiScale;
  const need = 80 * sc;  // REC readout length along the edge
  let o = q[0], e = q[1], side = q[3];
  if (S.lab.l < need + 10) {
    // The label covers the top-left corner: use the bottom-left one.
    const lb = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
    if (S.pagerIn && lb / 2 - 48 < need) o = null;
    else { o = q[3]; e = q[2]; side = q[0]; }
  }
  if (o) {
    const ul = Math.hypot(e.x - o.x, e.y - o.y) || 1, vl = Math.hypot(side.x - o.x, side.y - o.y) || 1;
    const ux = (e.x - o.x) / ul, uy = (e.y - o.y) / ul, vx = (side.x - o.x) / vl, vy = (side.y - o.y) / vl;
    const x = o.x + ux * 14 * sc + vx * 16 * sc, y = o.y + uy * 14 * sc + vy * 16 * sc;
    if (ul > need + 40 && y > S.safeTop && y < S.safeBot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.scale(sc, sc);
      // Dark pill so it reads over any filter.
      ctx.globalAlpha = A * 0.55;
      ctx.fillStyle = '#04060c';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-5, -8, 70, 16, 8); else ctx.rect(-5, -8, 70, 16);
      ctx.fill();
      const on = (t * 1.6) % 1 < 0.6;
      ctx.globalAlpha = A * (on ? 1 : 0.3);
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, 4, 0, 9, '#ff3b3b', 0.6);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath(); ctx.arc(4, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = A * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px Rajdhani, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const s = Math.max(0, Math.floor(t - S.openedAt));
      ctx.fillText(`REC  ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, 11, 0.5);
      ctx.restore();
    }
  }

  // Corner coordinates, pushed diagonally out of each corner.
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  ctx.save();
  ctx.font = '600 9px Rajdhani, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = A * 0.55;
  for (let i = 0; i < 4; i++) {
    const p = q[i], dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / l) * 16 * sc, y = p.y + (dy / l) * 16 * sc;
    if (y < S.safeTop || y > S.safeBot) continue;
    ctx.textAlign = dx < 0 ? 'right' : 'left';
    ctx.fillText(`${Math.round(p.x)}·${Math.round(p.y)}`, x, y);
  }
  ctx.restore();
}

function drawPortal(ctx, t) {
  const q = S.dq;
  const col = filterColor(BY_ID[S.cur], t);
  const opening = S.present;
  const k = S.open;
  ctx.save();
  if (opening) {
    const p = easeOutCubic(clamp(k * 1.1));
    drawEdges(ctx, q, 1, p, col, t);
    drawHandles(ctx, q, 1, easeOutBack(clamp(k * 1.3)));
    const r = smooth(0.6, 1, k);
    if (r > 0) {
      drawLabel(ctx, q, r, t, col);
      drawPager(ctx, q, r * 0.9, col);
      drawReadouts(ctx, q, r, t);
    }
  } else {
    // Collapsing: a hot white line that shrinks to a dot.
    const white = [lerp(col[0], 1, 0.7), lerp(col[1], 1, 0.7), lerp(col[2], 1, 0.7)];
    drawEdges(ctx, q, clamp(k * 2.5), 1, k < 0.45 ? white : col, t);
    drawHandles(ctx, q, clamp(k * 2), clamp((k - 0.4) * 2.5));
    if (k < 0.45) {
      const cx = (q[0].x + q[1].x) / 2, cy = (q[0].y + q[1].y) / 2;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, cx, cy, 30 * S.uiScale, '#ffffff', clamp(k * 3) * 0.8);
    }
  }
  ctx.restore();
}

function drawPhantom(ctx, t) {
  const q = S.gq, A = S.ghostA, sc = S.uiScale;
  const col = filterColor(BY_ID[S.cur], t);
  ctx.save();
  polyPath(ctx, q, 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = css(col);
  ctx.globalAlpha = 0.15 * A; ctx.lineWidth = 8 * sc; ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([7 * sc, 7 * sc]);
  ctx.lineDashOffset = -t * 26;
  ctx.globalAlpha = 0.75 * A; ctx.lineWidth = 1.5 * sc; ctx.strokeStyle = lightCss(col);
  ctx.stroke();
  ctx.setLineDash([]);
  // Real corners solid, missing corners hollow and pulsing.
  const real = S.gReal === 0 ? [true, false, false, true] : [false, true, true, false];
  drawHandles(ctx, q, A, 1, real);
  const s = 13 * sc * (1 + 0.18 * Math.sin(t * 6));
  ctx.globalAlpha = A * (0.55 + 0.3 * Math.sin(t * 6));
  ctx.strokeStyle = HANDLE;
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i++) if (!real[i]) ctx.strokeRect(q[i].x - s / 2, q[i].y - s / 2, s, s);
  // A ghost hand waving where the other hand should go.
  const a = S.gReal === 0 ? q[1] : q[0], b = S.gReal === 0 ? q[2] : q[3];
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  ctx.globalAlpha = A * (0.6 + 0.25 * Math.sin(t * 4));
  ctx.font = `${Math.round(28 * sc)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(mx, my + Math.sin(t * 4) * 4);
  ctx.rotate(Math.sin(t * 5) * 0.25);
  ctx.fillText('✋', 0, 0);
  ctx.restore();
  ctx.restore();
  drawLabel(ctx, q, A, t, col);
}

// Converging ring at a portal hand's pinch point: feedback before the click.
function drawPinchCharge(ctx, frame) {
  const sc = S.uiScale;
  for (const h of frame.hands) {
    if (h.ghost || h.overUI) continue;
    const mine = S.present ? (h.id === S.ids[0] || h.id === S.ids[1]) : (S.ghostA > 0.5 && h.id === S.ghostHand);
    if (!mine) continue;
    const k = h.pinching ? 1 : clamp(((h.pinch || 0) - 0.12) / 0.6);
    if (k <= 0.01) continue;
    const p = h.pinchPoint, r = lerp(30, 10, k) * sc;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(ctx, p.x, p.y, r * 1.6, HANDLE, 0.35 * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = k;
    ctx.strokeStyle = HANDLE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSwipeFx(ctx, t) {
  const fx = S.swipeFx;
  if (!fx) return;
  const age = t - fx.t;
  if (age > 0.55) { S.swipeFx = null; return; }
  const col = css(filterColor(BY_ID[S.cur], t));
  const sc = S.uiScale, d = fx.dir;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const k = clamp((age - i * 0.06) / 0.45);
    if (k <= 0) continue;
    const x = fx.x + d * (40 + easeOutCubic(k) * 150 + i * 26) * sc, y = fx.y;
    const a = (1 - k) * (1 - i * 0.2);
    ctx.beginPath();
    ctx.moveTo(x - d * 10 * sc, y - 18 * sc); ctx.lineTo(x + d * 8 * sc, y); ctx.lineTo(x - d * 10 * sc, y + 18 * sc);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col; ctx.globalAlpha = a * 0.35; ctx.lineWidth = 12 * sc; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = a; ctx.lineWidth = 3 * sc; ctx.stroke();
  }
  ctx.restore();
}

// --- sim scenarios -----------------------------------------------------------

const portrait = () => typeof innerWidth !== 'undefined' && innerHeight > innerWidth;

// One sim hand in the "C" pose that frames a window edge: index tip above,
// thumb tip below. side: 'left' | 'right'. gap widens/narrows the window.
const frameX = () => (portrait() ? -0.1 : 0.16);
const frameSize = () => (portrait() ? 0.3 : 0.27);
function frameHand(t, side, gap = 0, pinch = false, breathe = 1) {
  const p = portrait(), k = side === 'left' ? 1 : -1;
  const br = Math.sin(t * 0.9) * (p ? 0.02 : 0.025) * breathe, sw = Math.sin(t * 0.7) * 0.015 * k * breathe;
  const x = frameX() + br - gap;
  return {
    id: side === 'left' ? 'L' : 'R', hand: side, pose: pinch ? 'pinch' : 'open',
    x: side === 'left' ? x : 1 - x, y: (p ? 0.65 : 0.76) + sw, size: frameSize(),
    rot: k * ((p ? 0.45 : 0.48) + Math.sin(t * (side === 'left' ? 0.5 : 0.6)) * 0.05 * breathe),
  };
}

// Two hands holding a window, slowly breathing. pinch: right hand pinches.
function frameHands(t, pinch = false, right = true) {
  const L = frameHand(t, 'left');
  return right ? [L, frameHand(t, 'right', 0, pinch)] : [L];
}

function oneHand(t, dx = 0) {
  const R = frameHand(t, 'right');
  R.x += dx;
  return [R];
}

// --- the mode ------------------------------------------------------------------

export default {
  id: 'portal',
  name: 'PORTAL',
  short: 'PORTAL',
  tagline: 'Frame the world with two hands',
  accent: '#38f9ff',
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" stroke="none" opacity=".7"/></svg>',
  hint: HINTS.none,
  guide: [['🙌', 'Frame a window'], ['🤏', 'Pinch: next filter'], ['👋↔', 'One hand: swipe filters']],
  options: FILTERS.map((f) => ({ id: f.id, label: f.label, short: f.short })),

  simScenarios: {
    frame: (t) => frameHands(t),
    // Right hand pinches every 2.2 s: next filter each time.
    cycle: (t) => { const ph = t % 2.2; return frameHands(t, ph > 1.5 && ph < 1.95); },
    one: (t) => oneHand(t, Math.sin(t * 0.8) * 0.03),
    // One hand: hold, flick left (next filter), hold, flick right (previous).
    swipe: (t) => {
      const P = 3.4, ph = t % P, B = portrait() ? -0.62 : -0.45;
      const dx = ph < 1.4 ? 0 : ph < 1.65 ? lerp(0, B, (ph - 1.4) / 0.25) : ph < 3.05 ? B : ph < 3.3 ? lerp(B, 0, (ph - 3.05) / 0.25) : 0;
      return oneHand(t, dx);
    },
    // The right hand leaves and comes back: close + open animations.
    blink: (t) => frameHands(t, false, t % 4 < 2.6),
    // Hands squeeze together until the window collapses, then pull apart.
    squeeze: (t) => {
      // The tips sit ~1.26 hand sizes inside the wrist: squeeze until they meet.
      const W = typeof innerWidth !== 'undefined' ? innerWidth : 1280, H = typeof innerHeight !== 'undefined' ? innerHeight : 720;
      const meet = 0.5 - frameX() - (1.26 * frameSize() * Math.min(W, H)) / W;
      const g = -Math.min(1, 1.25 * Math.max(0, Math.sin(t * 0.8))) * meet;
      return [frameHand(t, 'left', g, false, 0), frameHand(t, 'right', g, false, 0)];
    },
  },

  init(app) {
    try { S.atlas = buildAtlases(app.gfx); } catch (e) { console.warn('[portal] atlas failed', e); }
    const want = app.params?.get('filter');
    if (want && BY_ID[want]) this.option = want;
  },

  enter(app) {
    if (!BY_ID[this.option]) this.option = FILTERS[0].id;
    Object.assign(S, {
      cur: this.option, prev: null, wipe: 1, flash: 0, present: false, open: 0, ghostA: 0, pending: null,
      preview: 0, swipeFx: null, hintKey: null, hintWant: null, hintSince: 0, humOn: false,
      switchAt: -9, lastSwitch: -9, closedAt: -9, sfxOpenAt: -9, sfxCloseAt: -9,
    });
    S.memo.clear(); S.uiUntil.clear(); S.particles.clear();
    S.warm = FILTERS.map((f) => f.id).filter((id) => id !== S.cur);
  },

  exit(app) {
    app.sfx.stopLoop('portal-hum');
    S.humOn = false;
    S.particles.clear();
  },

  setOption(id, app) {
    let dir = 1;
    if (S.pending) dir = S.pending.dir;
    else {
      // Chips (and the phone ◀ ▶ arrows): wipe the short way round the list.
      const n = FILTERS.length;
      const d = (FILTERS.findIndex((f) => f.id === id) - FILTERS.findIndex((f) => f.id === S.cur) + n) % n;
      dir = d <= n / 2 ? 1 : -1;
    }
    switchTo(this, app, id, dir, S.pending ? S.pending.how : 'chip');
  },

  update(frame, app) {
    const { t, dt, W, H } = frame;
    S.t = t; S.W = W; S.H = H;
    hudBands(app, H);
    // Phones get a finer dot grid so a small window still holds a picture.
    U.f.u_cell = Math.min(W, H) < 560 ? 8 : 10;
    if (this.option !== S.cur && BY_ID[this.option]) switchTo(this, app, this.option, 1, 'chip');

    const hs = pickHands(frame.hands, t);
    if (hs.length) {
      const size = hs.reduce((s, h) => s + h.size, 0) / hs.length;
      if (Number.isFinite(size)) S.uiScale = clamp(size / 120, 0.8, 1.3);
    }

    // Two hands: the portal.
    let present = false;
    // Ghost hands keep an open portal alive across tracking blinks, but it
    // takes two live hands to open one.
    if (hs.length === 2 && (S.present || (!hs[0].ghost && !hs[1].ghost))) {
      const [L, R] = hs;
      const [li, lt] = tips(L), [ri, rt] = tips(R);
      const lu = li.y <= lt.y ? li : lt, ll = lu === li ? lt : li;
      const ru = ri.y <= rt.y ? ri : rt, rl = ru === ri ? rt : ri;
      const q = orderQuad([lu, ru, rl, ll]);
      const a = area(q);
      const m = Math.min(W, H), minA = (m * 0.075) ** 2;
      // Thickness ~ the window's narrow side: a long thin slit is not a window.
      // Open above 8% of the short screen side, stay open above 4%.
      const thick = a / Math.max(1, Math.hypot(q[2].x - q[0].x, q[2].y - q[0].y), Math.hypot(q[3].x - q[1].x, q[3].y - q[1].y));
      const keep = S.present ? 0.5 : 1;
      if (finite(q) && a > minA * keep && thick > m * 0.08 * keep) {
        present = true;
        for (let i = 0; i < 4; i++) { S.quad[i].x = q[i].x; S.quad[i].y = q[i].y; }
        S.span = Math.sqrt(a);
        S.ids[0] = L.id; S.ids[1] = R.id;
      }
    }

    if (present && !S.present) {
      if (S.open < 0.3) {
        S.openedAt = t;
        if (t - S.sfxOpenAt > 1.2) { app.sfx.play('portal'); S.sfxOpenAt = t; } else app.sfx.play('pop');
        const sc = S.uiScale;
        for (const p of S.quad) burst(p.x, p.y, 7, sc, [HANDLE, '#ffffff', css(filterColor(BY_ID[S.cur], t))], 260);
      }
    } else if (!present && S.present) {
      S.closedAt = t;
      if (t - S.sfxCloseAt > 0.3) {
        S.sfxCloseAt = t;
        app.sfx.tone({ type: 'sine', f0: 900, f1: 90, dur: 0.22, vol: 0.09 });
        app.sfx.noise({ dur: 0.12, vol: 0.08, type: 'highpass', f0: 3000 });
      }
    }
    const wasOpen = S.open;
    S.present = present;
    S.open = clamp(S.open + (present ? dt / OPEN_S : -dt / CLOSE_S));
    if (present) for (let i = 0; i < 4; i++) { S.dq[i].x = S.quad[i].x; S.dq[i].y = S.quad[i].y; }
    else if (S.open > 0) collapse(S.dq, S.quad, S.open);
    if (!present && wasOpen > 0 && S.open === 0) {
      const q = S.quad;
      burst((q[0].x + q[1].x + q[2].x + q[3].x) / 4, (q[0].y + q[1].y + q[2].y + q[3].y) / 4, 14, S.uiScale, ['#ffffff', css(filterColor(BY_ID[S.cur], t))], 180);
    }

    // One hand: phantom window + filter preview.
    const solo = !present && S.open < 0.5 && hs.length === 1 ? hs[0] : null;
    const gOn = !!solo && phantom(solo, W);
    S.ghostA = clamp(S.ghostA + (gOn ? dt * 3 : -dt * 5));
    S.preview = Math.max(0, S.preview - dt * 1.4);

    // Gestures.
    let live = 0;
    for (const h of frame.hands) if (!h.ghost) live++;
    const mine = (h) => (S.present ? S.open > 0.6 && (h.id === S.ids[0] || h.id === S.ids[1]) : gOn && h.id === S.ghostHand);
    for (const e of frame.events) {
      if (e.type === 'pinchstart') {
        if (e.consumed || e.hand.overUI) continue;  // the HUD used it as a click
        if (mine(e.hand)) step(this, app, 1, 'pinch');
      } else if (e.type === 'swipe' && (e.dir === 'left' || e.dir === 'right')) {
        // One settled hand only: not a hand flying into view, nor the hand
        // left behind right after the window closed.
        const h = e.hand;
        if (S.present || live !== 1 || h.overUI || h.ghost || (h.age ?? 1) < 0.4 || t - S.closedAt < 0.5) continue;
        const d = e.dir === 'left' ? -1 : 1;
        S.swipeFx = { t, dir: d, x: h.palm.x, y: h.palm.y };
        step(this, app, e.dir === 'left' ? 1 : -1, 'swipe');
      } else if (e.type === 'handleave') {
        S.memo.delete(e.hand.id);
        S.uiUntil.delete(e.hand.id);
      }
    }

    if (S.wipe < 1) S.wipe = Math.min(1, S.wipe + dt / WIPE_S);
    S.flash = Math.max(0, S.flash - dt * 3.5);
    S.particles.update(dt);

    // Hint follows the state once it has settled (no flapping on tracking blips).
    const key = present ? 'open' : hs.length === 2 ? 'two' : hs.length === 1 ? 'one' : 'none';
    if (key !== S.hintWant) { S.hintWant = key; S.hintSince = t; }
    if (key !== S.hintKey && (S.hintKey === null || t - S.hintSince > 0.3)) { S.hintKey = key; app.ui.setHint(HINTS[key]); }

    // A soft electric hum while the window is open.
    if (S.open > 0.01) {
      app.sfx.loop('portal-hum', S.open * 0.6, { type: 'triangle', base: 60, range: 40, vol: 0.045, filter: 380 });
      S.humOn = true;
    } else if (S.humOn) { app.sfx.stopLoop('portal-hum'); S.humOn = false; }
  },

  renderGL(gfx, frame) {
    // Compile the other filters a few at a time so switching never hitches.
    if (S.warm.length && frame.t - S.warmAt > 0.25) { S.warmAt = frame.t; filterProgram(gfx, S.warm.shift()); }

    const showPortal = S.open > 0.001;
    const showGhost = S.ghostA > 0.01;
    if (!showPortal && !showGhost) { gfx.drawVideo(); return; }
    const t = frame.t, d = gfx.dpr;
    const col = filterColor(BY_ID[S.cur], t);
    const bq = showPortal ? S.dq : S.gq;
    const bg = U.bg;
    for (let i = 0; i < 4; i++) { bg.u_quad[i * 2] = bq[i].x * d; bg.u_quad[i * 2 + 1] = bq[i].y * d; }
    bg.u_open = showPortal ? 0.9 * smooth(0, 1, S.open) : 0.18 * S.ghostA;
    bg.u_tint = col;
    gfx.fullscreen(bgProgram(gfx), bg);

    if (showGhost) {
      U.f.u_fade[0] = 1 - S.preview * 0.7; U.f.u_fade[1] = S.gReal;
      drawFilter(gfx, S.gq, S.ghostA * (0.8 + 0.2 * S.preview), 1, 0, col);
      U.f.u_fade[0] = 0;
    }
    if (showPortal) {
      const closing = !S.present;
      drawFilter(gfx, S.dq, 1, closing ? 1 : easeOutCubic(S.open), closing ? clamp((1 - S.open) * 1.4) : S.flash, col);
    }
  },

  draw2D(ctx, frame) {
    const t = frame.t;
    if (S.ghostA > 0.01) drawPhantom(ctx, t);
    if (S.open > 0.001) drawPortal(ctx, t);
    drawPinchCharge(ctx, frame);
    drawSwipeFx(ctx, t);
    S.particles.draw(ctx);
  },
};

// Draw the window with the current filter; during a switch the old filter
// stays below the wipe front.
function drawFilter(gfx, q, alpha, reveal, flash, col) {
  if (alpha <= 0.002) return;
  const d = gfx.dpr, u = U.f;
  let cx = 0, cy = 0;
  for (let i = 0; i < 4; i++) {
    u.u_quad[i * 2] = q[i].x * d; u.u_quad[i * 2 + 1] = q[i].y * d;
    cx += q[i].x / 4; cy += q[i].y / 4;
  }
  u.u_center[0] = cx * d; u.u_center[1] = cy * d;
  u.u_span = Math.max(1, Math.sqrt(Math.abs(area(q)))) * d;
  u.u_alpha = alpha; u.u_reveal = reveal; u.u_flash = flash; u.u_tint = col;
  u.u_band[0] = S.safeTop * d; u.u_band[1] = S.safeBot * d;
  u.u_wipeDir = S.wipeDir;
  if (S.atlas) { u.u_glyphs = S.atlas.glyphs; u.u_ascii = S.atlas.ascii; }
  const wiping = S.wipe < 1 && S.prev && BY_ID[S.prev];
  const front = -0.08 + easeOutCubic(S.wipe) * 1.25;
  if (wiping) {
    u.u_wipe = front; u.u_wipeInv = 1;
    gfx.quad(filterProgram(gfx, S.prev), q, u, { blend: 'alpha' });
  }
  u.u_wipe = wiping ? front : 9; u.u_wipeInv = 0;
  gfx.quad(filterProgram(gfx, S.cur), q, u, { blend: 'alpha' });
}
