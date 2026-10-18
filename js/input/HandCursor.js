// On-screen cursor for hand control, plus "clicking without a mouse":
//   - pinch over a button / tab / lil-gui widget = click (sliders can be dragged while pinching)
//   - hold the cursor still on a [data-hand-clickable] element for ~1.1 s = click (dwell)
//     (not for data-hand-clickable="pinch", e.g. the camera on/off button)
// While the cursor is over UI (or dragging a UI widget) it sets state.uiCaptured so
// scenes ignore the pinch.

const DWELL_S = 1.1;
const DWELL_SHOW_S = 0.15;
const CLICK_SLOP_PX = 40;
const RING_R = 31;
const RING_C = 2 * Math.PI * RING_R;

const GESTURE_TEXT = {
  open: '🖐️ Open',
  fist: '✊ Fist',
  point: '☝️ Point',
  pinch: '🤏 Pinch',
  victory: '✌️ Peace',
  thumbsUp: '👍 Thumbs up',
};

const STYLE = `
#hand-layer .hc { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none;
  will-change: transform; --hc: #7cf6c8; --hc-glow: rgba(124, 246, 200, 0.55); --hc-fill: rgba(124, 246, 200, 0.5); }
#hand-layer .hc[hidden] { display: none; }
#hand-layer .hc.is-fist { --hc: #ff7b7b; --hc-glow: rgba(255, 123, 123, 0.6); --hc-fill: rgba(255, 123, 123, 0.45); }
#hand-layer .hc-ring { position: absolute; left: -19px; top: -19px; width: 38px; height: 38px;
  border-radius: 50%; border: 2px solid var(--hc); box-sizing: border-box;
  box-shadow: 0 0 14px var(--hc-glow), inset 0 0 10px var(--hc-glow);
  background: radial-gradient(circle, rgba(255, 255, 255, 0.08), transparent 70%);
  transition: border-color 160ms, box-shadow 160ms, background-color 160ms; }
#hand-layer .hc.is-pinch .hc-ring { background-color: var(--hc-fill); }
/* Over a button / tab / widget: a thin, see-through ring so the label under it stays
   readable (the target's own .hand-hover highlight shows what is hovered). */
#hand-layer .hc.is-hover .hc-ring { border-width: 1.5px; background: transparent;
  box-shadow: 0 0 10px var(--hc-glow); }
#hand-layer .hc.is-hover.is-pinch .hc-ring { background: var(--hc-fill); border-width: 2px; }
#hand-layer .hc.is-hover .hc-dot { width: 4px; height: 4px; left: -2px; top: -2px; }
#hand-layer .hc-dot { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 8px var(--hc), 0 0 2px #000; transition: opacity 160ms; }
#hand-layer .hc.is-pinch .hc-dot { opacity: 0; }
#hand-layer .hc-dwell { position: absolute; left: -35px; top: -35px; width: 70px; height: 70px;
  transform: rotate(-90deg); opacity: 0; transition: opacity 120ms; overflow: visible; }
#hand-layer .hc-dwell.show { opacity: 1; }
#hand-layer .hc-dwell circle { fill: none; stroke-width: 3; }
#hand-layer .hc-dwell .hc-track { stroke: rgba(255, 255, 255, 0.12); }
#hand-layer .hc-dwell .hc-bar { stroke: var(--hc); stroke-linecap: round; filter: drop-shadow(0 0 4px var(--hc)); }
#hand-layer .hc-label { position: absolute; left: 30px; top: 14px; white-space: nowrap;
  font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: 5px 9px; border-radius: 999px; color: #f2f4f8; background: rgba(18, 20, 28, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.14); opacity: 0; transform: translateY(4px);
  transition: opacity 180ms, transform 180ms; }
#hand-layer .hc-label.show { opacity: 1; transform: none; }
/* Near the right / bottom edge the label goes to the other side of the cursor. */
#hand-layer .hc.flip-x .hc-label { left: auto; right: 30px; }
#hand-layer .hc.flip-y .hc-label { top: auto; bottom: 14px; }
#hand-layer .hc.secondary { --hc: #8aa8ff; --hc-glow: rgba(138, 168, 255, 0.45); }
#hand-layer .hc.secondary .hc-ring { left: -12px; top: -12px; width: 24px; height: 24px; opacity: 0.8; }
#hand-layer .hc.secondary .hc-dot { opacity: 0.8; }
#hand-layer .hc-ripple { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
#hand-layer .hc-ripple::after { content: ""; position: absolute; left: -22px; top: -22px; width: 44px; height: 44px;
  border-radius: 50%; border: 2px solid #7cf6c8; box-shadow: 0 0 16px rgba(124, 246, 200, 0.7);
  animation: hc-ripple 520ms ease-out forwards; }
@keyframes hc-ripple { from { transform: scale(0.5); opacity: 1; } to { transform: scale(2.1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { #hand-layer .hc-ripple::after { animation-duration: 1ms; } }
`;

const damp = (k, dt) => 1 - Math.exp(-k * dt);

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  parent?.appendChild(e);
  return e;
}

function svg(tag, attrs, parent) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

/** What the hand cursor is over. kind: button | gui-title | gui-controller | panel */
function hitTest(x, y) {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  const deep = document.elementFromPoint(x, y);
  if (!deep) return null;
  const button = deep.closest('[data-hand-clickable]');
  if (button) return { kind: 'button', el: button, deep, disabled: !!button.disabled };
  const gui = deep.closest('.lil-gui');
  if (!gui) return null;
  const title = deep.closest('.lil-title, .title');
  if (title && gui.contains(title)) return { kind: 'gui-title', el: title, deep };
  const ctrl = deep.closest('.lil-controller, .controller');
  if (ctrl && gui.contains(ctrl)) {
    const disabled = ctrl.classList.contains('lil-disabled') || ctrl.classList.contains('disabled');
    return { kind: 'gui-controller', el: ctrl, deep, disabled };
  }
  return { kind: 'panel', el: null, deep };
}

function guiType(ctrl) {
  for (const t of ['boolean', 'option', 'function', 'color', 'number', 'string']) {
    if (ctrl.classList.contains(`lil-${t}`) || ctrl.classList.contains(t)) return t;
  }
  return '';
}

function rotateHue(hex, degrees) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ff6030';
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  } else {
    // Grey: give it some colour so the click is visible.
    s = 0.7;
  }
  h = (h + degrees + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v) => Math.round(Math.min(1, Math.max(0, v + mm)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export class HandCursor {
  /** @param {import('../core/App.js').App} app */
  constructor(app) {
    this.app = app;
    this.layer = document.getElementById('hand-layer') || document.body;
    if (!document.getElementById('hand-cursor-style')) {
      const style = el('style');
      style.id = 'hand-cursor-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    this.root = el('div', 'hc', this.layer);
    this.root.hidden = true;
    const dwell = svg('svg', { class: 'hc-dwell', viewBox: '-35 -35 70 70' }, this.root);
    svg('circle', { class: 'hc-track', r: RING_R, cx: 0, cy: 0 }, dwell);
    this.dwellBar = svg('circle', {
      class: 'hc-bar', r: RING_R, cx: 0, cy: 0, 'stroke-dasharray': RING_C.toFixed(2), 'stroke-dashoffset': RING_C.toFixed(2),
    }, dwell);
    this.dwellSvg = dwell;
    this.ring = el('div', 'hc-ring', this.root);
    el('div', 'hc-dot', this.root);
    this.label = el('div', 'hc-label', this.root);

    this.second = el('div', 'hc secondary', this.layer);
    this.second.hidden = true;
    el('div', 'hc-ring', this.second);
    el('div', 'hc-dot', this.second);

    this.visible = false;
    this.secondVisible = false;
    this.x = 0;
    this.y = 0;
    this.ringScale = 1;
    this.wasPinching = false;
    /** UI press in progress (pinch started over a widget): {target, x, y} */
    this.press = null;
    /** Pinch started over the scene: ignore UI until it ends. */
    this.sceneDrag = false;
    this.hoverEl = null;
    this.dwell = { el: null, t: 0, done: null };
    this.dwellShown = false;
    this.lastGesture = 'none';
    this.labelTime = 0;
    this.classKey = '';
    this.flipX = false;
    this.flipY = false;
    this.debug = { clicks: 0, lastClick: null, hover: null };
  }

  /**
   * @param {import('./InputState.js').InputState} state (source === 'hand')
   * @param {number} dt
   */
  update(state, dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = Math.round(((state.pointer.x + 1) / 2) * w * 10) / 10;
    const y = Math.round(((1 - state.pointer.y) / 2) * h * 10) / 10;
    this.x = x;
    this.y = y;
    const pinching = !!state.pinching;
    const pinchStart = pinching && !this.wasPinching;
    const pinchEnd = !pinching && this.wasPinching;
    this.wasPinching = pinching;

    // ---- what is under the cursor
    let target = null;
    if (this.press) target = this.press.target;
    else if (!(pinching && this.sceneDrag)) target = hitTest(x, y);

    // ---- pinch = mouse button
    if (pinchStart) {
      if (target && !target.disabled) {
        this.press = { target, x, y, startX: x, startY: y };
        if (target.kind !== 'panel') this._mouse('down', target.deep, x, y);
        this.dwell.done = target.el; // no dwell click right after a pinch click
      } else if (!target) {
        this.sceneDrag = true;
      }
    } else if (pinching && this.press) {
      if (x !== this.press.x || y !== this.press.y) {
        this.press.x = x;
        this.press.y = y;
        if (this.press.target.kind !== 'panel') this._mouse('move', this.press.target.deep, x, y);
      }
    }
    if (pinchEnd) {
      const press = this.press;
      this.press = null;
      this.sceneDrag = false;
      if (press && press.target.kind !== 'panel') {
        this._mouse('up', press.target.deep, x, y);
        const now = hitTest(x, y);
        const same = now && now.el === press.target.el;
        const near = Math.hypot(x - press.startX, y - press.startY) < CLICK_SLOP_PX;
        if (same || near) this._activate(press.target, x, y);
      }
      target = hitTest(x, y);
    }

    // ---- hover highlight
    const hoverEl = target && target.kind !== 'panel' && !target.disabled ? target.el : null;
    if (hoverEl !== this.hoverEl) {
      this.hoverEl?.classList.remove('hand-hover');
      hoverEl?.classList.add('hand-hover');
      this.hoverEl = hoverEl;
      this.debug.hover = hoverEl ? describe(hoverEl) : null;
    }
    // InputManager clears the flag every frame; in hand mode the cursor sets it.
    state.uiCaptured = !!(this.press || target);

    // ---- dwell click on [data-hand-clickable] (not ="pinch")
    const d = this.dwell;
    if (d.done && (!target || target.el !== d.done)) d.done = null; // re-arm after leaving
    const dwellEl = !pinching && !this.press && target?.kind === 'button' && !target.disabled
      && target.el.dataset.handClickable !== 'pinch'
      && !target.el.classList.contains('active') && target.el.getAttribute('aria-current') !== 'page'
      && target.el !== d.done ? target.el : null;
    if (dwellEl !== d.el) {
      d.el = dwellEl;
      d.t = 0;
    }
    let progress = 0;
    if (dwellEl) {
      d.t += dt;
      progress = Math.min(1, Math.max(0, (d.t - DWELL_SHOW_S) / (DWELL_S - DWELL_SHOW_S)));
      if (d.t >= DWELL_S) {
        this._activate(target, x, y);
        d.done = dwellEl;
        d.el = null;
        d.t = 0;
        progress = 0;
      }
    }
    const showDwell = progress > 0;
    if (showDwell !== this.dwellShown) {
      this.dwellShown = showDwell;
      this.dwellSvg.classList.toggle('show', showDwell);
    }
    if (showDwell) this.dwellBar.setAttribute('stroke-dashoffset', (RING_C * (1 - progress)).toFixed(2));

    // ---- draw
    if (!this.visible) {
      this.visible = true;
      this.root.hidden = false;
    }
    this.root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const fist = !!state.fist && !pinching;
    const hovering = !!hoverEl;
    const base = fist ? 1.3 : hovering ? 0.9 : 1;
    const targetScale = base * (1 - 0.4 * Math.min(1, state.pinch || 0)) * (pinching ? 0.92 : 1);
    this.ringScale += (targetScale - this.ringScale) * damp(22, dt);
    this.ring.style.transform = `scale(${this.ringScale.toFixed(3)})`;
    // Label side, with a little hysteresis so it does not flip back and forth at the line.
    this.flipX = x > w - (this.flipX ? 190 : 170);
    this.flipY = y > h - (this.flipY ? 60 : 50);
    const key = `${pinching ? 'p' : ''}${fist ? 'f' : ''}${hovering ? 'h' : ''}${this.flipX ? 'x' : ''}${this.flipY ? 'y' : ''}`;
    if (key !== this.classKey) {
      this.classKey = key;
      this.root.classList.toggle('is-pinch', pinching);
      this.root.classList.toggle('is-fist', fist);
      this.root.classList.toggle('is-hover', hovering);
      this.root.classList.toggle('flip-x', this.flipX);
      this.root.classList.toggle('flip-y', this.flipY);
    }

    // Short gesture label next to the cursor whenever the gesture changes.
    if (state.gesture !== this.lastGesture) {
      this.lastGesture = state.gesture;
      const text = GESTURE_TEXT[state.gesture];
      if (text) {
        this.label.textContent = text;
        this.label.classList.add('show');
        this.labelTime = 0.9;
      }
    }
    if (this.labelTime > 0) {
      this.labelTime -= dt;
      if (this.labelTime <= 0) this.label.classList.remove('show');
    }

    // Second hand: a small companion cursor at its index fingertip.
    const other = state.twoHands ? state.hands?.[1] : null;
    const op = other?.pointer || (other?.landmarks?.[8] && { x: clampNdc(other.landmarks[8].x), y: clampNdc(other.landmarks[8].y) });
    if (op) {
      this.second.style.transform = `translate3d(${((op.x + 1) / 2) * w}px, ${((1 - op.y) / 2) * h}px, 0)`;
      if (!this.secondVisible) {
        this.secondVisible = true;
        this.second.hidden = false;
      }
    } else if (this.secondVisible) {
      this.secondVisible = false;
      this.second.hidden = true;
    }
  }

  /** Hide the cursor and drop hover / press state (hand lost or camera off). */
  hide() {
    if (!this.visible && !this.press && !this.hoverEl && !this.secondVisible && !this.wasPinching) return;
    if (this.press && this.press.target.kind !== 'panel') this._mouse('up', this.press.target.deep, this.x, this.y);
    this.press = null;
    this.sceneDrag = false;
    this.wasPinching = false;
    this.hoverEl?.classList.remove('hand-hover');
    this.hoverEl = null;
    this.debug.hover = null;
    this.dwell.el = null;
    this.dwell.t = 0;
    this.dwell.done = null;
    if (this.dwellShown) {
      this.dwellShown = false;
      this.dwellSvg.classList.remove('show');
    }
    this.label.classList.remove('show');
    this.labelTime = 0;
    this.lastGesture = 'none';
    this.visible = false;
    this.root.hidden = true;
    this.secondVisible = false;
    this.second.hidden = true;
  }

  /**
   * Synthetic pointer + mouse event at the cursor. Mouse events bubble up to window
   * (lil-gui drags listen to mousedown on the widget, then mousemove / mouseup on
   * window). Pointer events go to the widget only: window-level pointer listeners
   * belong to the real mouse (MouseInput), which must not mistake the hand for it.
   */
  _mouse(phase, target, x, y) {
    if (!target?.isConnected) target = document.elementFromPoint(x, y) || document.body;
    const buttons = phase === 'up' ? 0 : 1;
    const init = {
      cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons,
    };
    const pointerType = { down: 'pointerdown', move: 'pointermove', up: 'pointerup' }[phase];
    const mouseType = { down: 'mousedown', move: 'mousemove', up: 'mouseup' }[phase];
    try {
      target.dispatchEvent(new PointerEvent(pointerType, {
        ...init, bubbles: false, pointerId: 77, pointerType: 'mouse', isPrimary: true,
      }));
    } catch {
      /* very old browsers: no PointerEvent constructor */
    }
    target.dispatchEvent(new MouseEvent(mouseType, { ...init, bubbles: true }));
  }

  /** Perform the "click" for a UI target. */
  _activate(target, x, y) {
    if (!target || target.disabled || !target.el?.isConnected) return;
    const e = target.el;
    if (target.kind === 'button' || target.kind === 'gui-title') {
      e.click();
    } else if (target.kind === 'gui-controller') {
      const type = guiType(e);
      if (type === 'boolean') {
        e.querySelector('input[type="checkbox"]')?.click();
      } else if (type === 'option') {
        const select = e.querySelector('select');
        if (select && select.options.length) {
          select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (type === 'function') {
        e.querySelector('button')?.click();
      } else if (type === 'color') {
        const input = e.querySelector('input[type="color"]');
        if (input) {
          input.value = rotateHue(input.value, 45);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        // number (slider already moved on press) / string: nothing more to do
        return;
      }
    } else {
      return;
    }
    this.debug.clicks++;
    this.debug.lastClick = describe(e);
    this._ripple(x, y);
  }

  _ripple(x, y) {
    const r = el('div', 'hc-ripple', this.layer);
    r.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    setTimeout(() => r.remove(), 600);
  }
}

function clampNdc(v) {
  return Math.max(-1, Math.min(1, v));
}

function describe(e) {
  const text = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.dataset?.scene ? `[${e.dataset.scene}]` : ''} ${text}`.trim();
}
