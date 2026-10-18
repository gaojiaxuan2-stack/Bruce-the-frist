// DOM overlay: scene tabs, gesture hints, status chip, toasts.
// Anything a hand should be able to "click" carries the data-hand-clickable attribute.

const $ = (sel) => document.querySelector(sel);

export class Hud {
  constructor(app, scenes) {
    this.app = app;
    this.tabs = new Map();
    const nav = $('#tabs');
    for (const s of scenes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.dataset.handClickable = '';
      b.dataset.scene = s.id;
      b.innerHTML = `<span class="tab-icon" aria-hidden="true">${s.icon}</span><span class="tab-label">${s.title}</span>`;
      b.title = s.title;
      b.addEventListener('click', () => app.goTo(s.id));
      nav.appendChild(b);
      this.tabs.set(s.id, b);
    }
    this.cameraButton = $('#btn-camera');
    this.cameraButton.addEventListener('click', () => app.toggleHands());
    this.statusEl = $('#status');
    this.toastsEl = $('#toasts');
    this.statusKey = '';
  }

  setActive(id, meta) {
    for (const [sid, b] of this.tabs) {
      b.classList.toggle('active', sid === id);
      b.setAttribute('aria-current', sid === id ? 'page' : 'false');
    }
    this.tabs.get(id)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    $('#scene-title').textContent = meta.title;
    $('#scene-subtitle').textContent = meta.subtitle || '';
    const list = $('#hint-list');
    if (!meta.hints) {
      // Still loading: keep the previous hints, dimmed, so the card doesn't jump.
      list.classList.add('loading');
      return;
    }
    list.classList.remove('loading');
    list.replaceChildren(...meta.hints.map((h) => hintItem(h.icon, h.gesture, h.text)));
    // Without hand control, say how the mouse / touch stands in for the gestures.
    if (!this.app.input.handsRunning) {
      const touch = matchMedia('(pointer: coarse)').matches;
      const base = touch
        ? 'drag = point · two fingers = turn + zoom · hold = fist'
        : 'drag = pinch · right-drag = fist · wheel = zoom';
      const extra = touch ? meta.touchHint : meta.mouseHint;
      const li = hintItem(touch ? '👆' : '🖱️', touch ? 'Touch' : 'Mouse', extra ? `${base} · ${extra}` : base);
      li.className = 'hint-mouse';
      list.appendChild(li);
    }
  }

  setCameraState(on, loading = false) {
    const b = this.cameraButton;
    b.classList.toggle('on', on);
    b.disabled = loading;
    b.textContent = loading ? 'Starting camera…' : on ? '✋ Hand control: on' : 'Hand control: off';
  }

  /** Persistent status line. kind: '' | 'ok' | 'warn'. Pass '' to hide. */
  setStatus(text, kind = '') {
    const key = `${kind}|${text}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.statusEl.textContent = text;
    this.statusEl.className = `chip ${kind}`;
  }

  toast(text, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toastsEl.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, ms);
  }
}

function hintItem(icon, gesture, text) {
  const li = document.createElement('li');
  li.innerHTML = '<span class="hint-icon" aria-hidden="true"></span><span class="hint-gesture"></span><span class="hint-text"></span>';
  li.children[0].textContent = icon || '';
  li.children[1].textContent = gesture || '';
  li.children[2].textContent = text || '';
  return li;
}
