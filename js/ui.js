// ui.js — the HUD. Every button ("chip") can be pressed without touching
// anything: point at it with one finger (☝️) and hold, or pinch (🤏) on it.
// Mouse / touch clicks work too.

import { drawGlow } from './draw.js';

const DWELL_S = 0.65;
const HIT_PAD = 12;

export class UI {
  constructor({ modes, onMode, onOption, onAction, sfx }) {
    this.modes = modes;
    this.onMode = onMode;
    this.onOption = onOption;
    this.onAction = onAction;
    this.sfx = sfx;
    this.$modes = document.getElementById('modes');
    this.$options = document.getElementById('options');
    this.$hint = document.getElementById('hint');
    this.$guide = document.getElementById('guide');
    this.$toast = document.getElementById('toast');
    this.$status = document.getElementById('status-text');
    this.$dot = document.getElementById('status-dot');
    this.$idle = document.getElementById('idle');
    this.$snaps = document.getElementById('snaps');
    this.chipState = new Map();  // element -> { p, locked }
    this.pointers = [];
    this.lastHandsAt = 0;
    this.accent = '#38f9ff';
    this._bands = null;
    this._bandsAt = -1;

    for (const m of modes) {
      const b = chip({ kind: 'mode', id: m.id, label: m.name, short: m.short || m.name, icon: m.icon });
      this.$modes.appendChild(b);
    }
    document.getElementById('hud').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (b) this.activate(b);
    });
  }

  chips() { return document.querySelectorAll('#hud .chip:not([hidden])'); }

  setMode(m) {
    this.modeSince = performance.now() / 1000;
    document.documentElement.style.setProperty('--accent', m.accent || '#38f9ff');
    this.accent = m.accent || '#38f9ff';
    for (const b of this.$modes.children) b.classList.toggle('active', b.dataset.id === m.id);
    this.$options.innerHTML = '';
    const opts = m.options || [];
    // Many options: on phones only the current one shows, between ◀ ▶ chips
    // (a scrolling row can't be scrolled without touching the screen).
    this.$options.classList.toggle('many', opts.length > 5);
    if (opts.length > 5) this.$options.appendChild(chip({ kind: 'action', id: 'opt-prev', label: '◀', short: '◀' }));
    for (const o of opts) {
      this.$options.appendChild(chip({ kind: 'option', id: o.id, label: o.label, short: o.short || o.label, icon: o.icon }));
    }
    if (opts.length > 5) this.$options.appendChild(chip({ kind: 'action', id: 'opt-next', label: '▶', short: '▶' }));
    this._bandsAt = -1;
    this.setOption(m.option);
    this.setHint(m.hint || '');
    this.$guide.innerHTML = (m.guide || []).map(([g, text]) => `<div class="g"><span class="gi">${g}</span><span>${text}</span></div>`).join('')
      + '<div class="g dim"><span class="gi">☝️</span><span>Point &amp; hold on a button to press it</span></div>'
      + '<div class="g dim"><span class="gi">👍👍</span><span>Two thumbs up = photo</span></div>';
  }

  setOption(id) {
    for (const b of this.$options.children) b.classList.toggle('active', b.dataset.id === id);
  }

  setHint(text) { this.$hint.innerHTML = text; this.$hint.classList.toggle('empty', !text); this._bandsAt = -1; }

  // Screen bands (CSS px) covered by the HUD: effects should keep busy
  // graphics out of y < top and y > bottom. Measured, cached for 0.5 s.
  bands() {
    const now = performance.now();
    if (this._bands && now - this._bandsAt < 500) return this._bands;
    const H = window.innerHeight;
    let top = 0, bottom = H;
    for (const el of [this.$modes, document.querySelector('#hud .status')]) {
      const r = el?.getBoundingClientRect();
      if (r && r.height) top = Math.max(top, r.bottom);
    }
    for (const el of [this.$hint, this.$options]) {
      const r = el?.getBoundingClientRect();
      if (r && r.height && !el.classList.contains('empty')) bottom = Math.min(bottom, r.top);
    }
    this._bands = { top: top + 8, bottom: bottom - 8 };
    this._bandsAt = now;
    return this._bands;
  }

  toast(title, sub = '') {
    const t = this.$toast;
    t.querySelector('.t1').textContent = title;
    t.querySelector('.t1').dataset.text = title;
    t.querySelector('.t2').textContent = sub;
    t.classList.remove('show');
    void t.offsetWidth;  // restart the CSS animation
    t.classList.add('show');
  }

  setStatus(text, state = 'ok') {
    this.$status.textContent = text;
    this.$dot.dataset.state = state;
  }

  addSnapshot(url) {
    const b = chip({ kind: 'action', id: 'save', label: 'SAVE', short: 'SAVE' });
    b.classList.add('snap');
    b.dataset.url = url;
    b.style.backgroundImage = `url(${url})`;
    this.$snaps.prepend(b);
    while (this.$snaps.children.length > 3) this.$snaps.lastChild.remove();
    setTimeout(() => b.remove(), 30000);
  }

  activate(b) {
    const { kind, id } = b.dataset;
    if (kind === 'mode') this.onMode(id);
    else if (kind === 'option') this.onOption(id);
    else this.onAction(id, b);
  }

  // Called every frame with the tracked hands. Handles hover/dwell/pinch.
  update(frame) {
    const now = frame.t;
    if (frame.hands.length) this.lastHandsAt = now;
    this.$idle.classList.toggle('show', now - this.lastHandsAt > 4 && frame.ready);

    // The gesture guide steps back once it has been read, and gets out of
    // the way when a hand moves over it.
    const g = this.$guide.getBoundingClientRect();
    const handOver = g.width > 0 && frame.hands.some((h) => h.lm.some((p) => p.x > g.left - 20 && p.x < g.right + 20 && p.y > g.top - 20 && p.y < g.bottom + 20));
    this.$guide.classList.toggle('faded', now - (this.modeSince ?? now) > 12);
    this.$guide.classList.toggle('covered', handOver);

    // Pointers: a hand that points (index only) or pinches.
    this.pointers = [];
    for (const h of frame.hands) {
      h.overUI = false;
      if (h.ghost) continue;
      if (h.pose === 'point') this.pointers.push({ hand: h, x: h.pointer.x, y: h.pointer.y, pinch: false });
      else if (h.pinching) this.pointers.push({ hand: h, x: h.pinchPoint.x, y: h.pinchPoint.y, pinch: true });
    }

    const chips = this.chips();
    const rects = [];
    for (const b of chips) {
      const r = b.getBoundingClientRect();
      if (r.width) rects.push([b, r]);
    }
    const hit = (x, y) => {
      for (const [b, r] of rects) {
        if (x >= r.left - HIT_PAD && x <= r.right + HIT_PAD && y >= r.top - HIT_PAD && y <= r.bottom + HIT_PAD) return b;
      }
      return null;
    };

    // Pinch = instant click on a chip.
    for (const e of frame.events) {
      if (e.type !== 'pinchstart') continue;
      const b = hit(e.x, e.y);
      if (b) { e.hand.overUI = true; e.consumed = true; this.flash(b); this.activate(b); }
    }

    const hovered = new Set();
    for (const p of this.pointers) {
      const b = hit(p.x, p.y);
      p.chip = b;
      if (b) { hovered.add(b); p.hand.overUI = true; }
    }
    for (const [b] of rects) {
      let s = this.chipState.get(b);
      if (!s) { s = { p: 0, locked: false }; this.chipState.set(b, s); }
      const isHover = hovered.has(b);
      const pointing = isHover && this.pointers.some((p) => p.chip === b && !p.pinch);
      if (!isHover) { s.p = Math.max(0, s.p - frame.dt * 4); s.locked = false; }
      else if (pointing && !s.locked && !b.classList.contains('active')) {
        if (s.p === 0) this.sfx.play('hover');
        s.p += frame.dt / DWELL_S;
        if (s.p >= 1) { s.p = 0; s.locked = true; this.flash(b); this.activate(b); }
      }
      b.classList.toggle('hover', isHover);
      b.style.setProperty('--p', s.p.toFixed(3));
      for (const p of this.pointers) if (p.chip === b) p.progress = s.p;
    }
  }

  flash(b) {
    b.classList.remove('pressed');
    void b.offsetWidth;
    b.classList.add('pressed');
    this.sfx.play('select');
  }

  // Draw finger cursors on the 2D overlay.
  draw(ctx, frame) {
    ctx.save();
    for (const p of this.pointers) {
      const r = p.pinch ? 10 : 16;
      ctx.globalCompositeOperation = 'lighter';
      drawGlow(ctx, p.x, p.y, r * 2.2, this.accent, 0.35);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (p.chip && p.progress > 0) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, -Math.PI / 2, -Math.PI / 2 + p.progress * Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function chip({ kind, id, label, short, icon }) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.dataset.kind = kind;
  b.dataset.id = id;
  b.innerHTML = `<span class="ring"></span>${icon ? `<span class="ico">${icon}</span>` : ''}<span class="lbl"><span class="long">${label}</span><span class="short">${short}</span></span>`;
  return b;
}
