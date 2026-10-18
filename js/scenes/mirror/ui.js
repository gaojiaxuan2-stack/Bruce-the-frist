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
.mirror-cta button {
  pointer-events: auto;
  border: 0;
  border-radius: 999px;
  padding: 15px 28px;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.01em;
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
  border-radius: 999px;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  text-align: center;
  max-width: min(440px, calc(100vw - 32px));
}
@keyframes mirror-cta-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(124, 246, 200, 0.55), 0 0 26px rgba(124, 246, 200, 0.35), 0 10px 30px rgba(0, 0, 0, 0.5); }
  50% { box-shadow: 0 0 0 1px rgba(124, 246, 200, 0.8), 0 0 46px rgba(124, 246, 200, 0.6), 0 10px 30px rgba(0, 0, 0, 0.5); }
}
@media (max-width: 720px) {
  .mirror-cta { bottom: max(104px, calc(env(safe-area-inset-bottom) + 96px)); }
  .mirror-cta button { font-size: 16px; padding: 13px 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .mirror-cta button { animation: none; }
}
`;

const LABEL = '✋ Turn on camera';
const NOTE = 'This is your photo. Turn on the camera to see yourself live in particles.';

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
      requestAnimationFrame(() => this.cta.classList.remove('out'));
    } else {
      this.cta.classList.add('out');
      this.hideTimer = setTimeout(() => (this.cta.hidden = true), 340);
    }
  }

  /** Text under the button; null restores the default. */
  setNote(text) {
    this.note.textContent = text || NOTE;
  }

  setBusy(busy) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.button.disabled = busy;
    this.button.textContent = busy ? 'Starting camera…' : LABEL;
  }

  pickFile() {
    this.fileInput.click();
  }

  dispose() {
    clearTimeout(this.hideTimer);
    this.cta.remove();
    this.fileInput.remove();
    document.getElementById(STYLE_ID)?.remove();
  }
}
