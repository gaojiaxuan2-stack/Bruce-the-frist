// Small DOM pieces owned by the Live Mirror scene: the "Turn on camera" call to
// action (hand-clickable) and the hidden file picker used by the GUI.

const STYLE_ID = 'mirror-scene-style';

const CSS = `
.mirror-cta {
  position: fixed;
  left: 50%;
  bottom: max(28px, calc(env(safe-area-inset-bottom) + 18px));
  transform: translate(-50%, 0);
  z-index: 12;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  transition: opacity 320ms ease, transform 320ms ease;
}
.mirror-cta[hidden] { display: none; }
.mirror-cta.out { opacity: 0; transform: translate(-50%, 12px); }
/* Beside the hints card, in the bottom-right corner: free while the CTA shows
   (no camera = no camera preview there). */
.mirror-cta.at-right {
  left: auto;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  transform: none;
  align-items: flex-end;
}
.mirror-cta.at-right small { text-align: right; }
/* Phones: a full-width column just above the hints card (bottom comes from the card's top). */
.mirror-cta.above {
  left: max(16px, env(safe-area-inset-left));
  right: max(16px, env(safe-area-inset-right));
  transform: none;
}
.mirror-cta.at-right.out, .mirror-cta.above.out { transform: translateY(12px); }
.mirror-cta button {
  pointer-events: auto;
  border: 0;
  border-radius: 999px;
  padding: 15px 28px;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.01em;
  white-space: nowrap;
  color: #04110c;
  background: var(--accent, #7cf6c8);
  box-shadow: 0 0 0 1px rgba(124, 246, 200, 0.55), 0 0 34px rgba(124, 246, 200, 0.45), 0 10px 30px rgba(0, 0, 0, 0.5);
  cursor: pointer;
  animation: mirror-cta-pulse 2.6s ease-in-out infinite;
  transition: transform 160ms ease, filter 160ms ease;
}
.mirror-cta button:hover,
.mirror-cta button.hand-hover { transform: scale(1.06); filter: brightness(1.08); }
.mirror-cta button:disabled { opacity: 0.75; cursor: progress; animation: none; }
.mirror-cta small {
  font-size: 13px;
  line-height: 1.35;
  color: rgba(242, 244, 248, 0.9);
  background: rgba(0, 0, 0, 0.58);
  padding: 5px 12px;
  border-radius: 14px;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  text-align: center;
  text-wrap: balance;
  max-width: min(440px, calc(100vw - 32px));
}
@keyframes mirror-cta-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(124, 246, 200, 0.55), 0 0 26px rgba(124, 246, 200, 0.35), 0 10px 30px rgba(0, 0, 0, 0.5); }
  50% { box-shadow: 0 0 0 1px rgba(124, 246, 200, 0.8), 0 0 46px rgba(124, 246, 200, 0.6), 0 10px 30px rgba(0, 0, 0, 0.5); }
}
@media (max-width: 720px) {
  .mirror-cta button { font-size: 16px; padding: 13px 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .mirror-cta button { animation: none; }
}
`;

const LABEL = '✋ Turn on camera';
const NOTE = 'This is your photo. Turn on the camera to see yourself live.';
const EDGE = 16; // px from the screen edges (as the HUD)
const GAP = 12; // px between the CTA and the hints card
const CENTRE_MIN_WIDTH = 1141; // narrower windows: never centred (the hints card reaches ~376 px)

export class MirrorUi {
  /**
   * @param {{onCamera: () => void, onFile: (file: File) => void}} handlers
   */
  constructor({ onCamera, onFile }) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.cta = document.createElement('div');
    this.cta.className = 'mirror-cta out';
    this.cta.hidden = true;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.dataset.handClickable = '';
    this.button.textContent = LABEL;
    this.note = document.createElement('small');
    this.note.textContent = NOTE;
    this.cta.append(this.button, this.note);
    this.button.addEventListener('click', () => onCamera());
    document.body.appendChild(this.cta);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*,video/*';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) onFile(file);
    });
    document.body.appendChild(this.fileInput);

    this.visible = false;
    this.busy = false;
    this.hideTimer = 0;

    // Keep clear of the hints card (bottom left), whatever its size: re-place on resize
    // and whenever the card changes size (scene / hand-control changes refill it).
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
    const hints = document.getElementById('hints');
    if (hints && typeof ResizeObserver === 'function') {
      this.hintsObserver = new ResizeObserver(() => this.place());
      this.hintsObserver.observe(hints);
    }
  }

  /**
   * Put the CTA where it never covers the hints card:
   * - wide screens: centred at the bottom, if that clears the card;
   * - otherwise the bottom-right corner, beside the card (the note may wrap);
   * - phones (no room beside the card): full width, just above the card.
   */
  place() {
    if (this.cta.hidden) return;
    const el = this.cta;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const card = document.getElementById('hints');
    const rect = card?.getBoundingClientRect();
    const r = rect && rect.width > 0 && rect.height > 0 ? rect : null; // null: no card on screen
    const cardRight = r ? r.right : 0;
    const mode = (name, noteMax = '') => {
      el.classList.toggle('at-right', name === 'right');
      el.classList.toggle('above', name === 'above');
      el.style.bottom = '';
      this.note.style.maxWidth = noteMax;
    };

    mode('centre');
    if (W >= CENTRE_MIN_WIDTH && (W - el.offsetWidth) / 2 >= cardRight + GAP) return;

    const room = W - EDGE - cardRight - GAP; // width free right of the card
    if (room >= Math.max(240, this.button.offsetWidth)) {
      mode('right', `${Math.floor(Math.min(440, room))}px`);
      if (el.offsetWidth <= room + 0.5) return;
    }

    mode('above');
    const top = r ? r.top : H - EDGE;
    el.style.bottom = `${Math.round(Math.max(EDGE, H - top + GAP))}px`;
  }

  /** Show / hide the camera call to action (animated). */
  setCtaVisible(on, immediate = false) {
    if (on === this.visible && !immediate) return;
    this.visible = on;
    clearTimeout(this.hideTimer);
    if (!on && immediate) {
      this.cta.classList.add('out');
      this.cta.hidden = true;
    } else if (on) {
      this.cta.hidden = false;
      this.place();
      requestAnimationFrame(() => this.cta.classList.remove('out'));
    } else {
      this.cta.classList.add('out');
      this.hideTimer = setTimeout(() => (this.cta.hidden = true), 340);
    }
  }

  /** Text under the button; null restores the default. */
  setNote(text) {
    this.note.textContent = text || NOTE;
    this.place();
  }

  setBusy(busy) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.button.disabled = busy;
    this.button.textContent = busy ? 'Starting camera…' : LABEL;
    this.place();
  }

  pickFile() {
    this.fileInput.click();
  }

  dispose() {
    clearTimeout(this.hideTimer);
    window.removeEventListener('resize', this.onResize);
    this.hintsObserver?.disconnect();
    this.cta.remove();
    this.fileInput.remove();
    // (a rebuilt scene may already have its own CTA using the same style sheet)
    if (!document.querySelector('.mirror-cta')) document.getElementById(STYLE_ID)?.remove();
  }
}
