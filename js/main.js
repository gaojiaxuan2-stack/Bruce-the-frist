import { App, cameraErrorMessage } from './core/App.js';
import { SCENES, VISIBLE_SCENES } from './core/registry.js';

const $ = (sel) => document.querySelector(sel);
const start = $('#start');
const errorEl = $('#start-error');

function showFatal(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  $('#start-hand').disabled = true;
  $('#start-mouse').disabled = true;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function hideStart() {
  start.classList.add('hidden');
  setTimeout(() => (start.hidden = true), 450);
}

/** Show a message under the start buttons: kind 'error' (red) or 'note' (quiet). */
function startMessage(text, kind = 'error') {
  errorEl.textContent = text;
  errorEl.className = kind === 'error' ? 'error' : 'fine';
  errorEl.hidden = !text;
}

async function main() {
  if (!webglAvailable()) {
    showFatal('Your browser has WebGL 2 turned off or unsupported. Try the latest Chrome, Edge, Safari or Firefox.');
    return;
  }

  const app = new App($('#stage'));
  window.__app = app; // handy for debugging and automated tests

  const params = app.params;
  const firstScene = SCENES.some((s) => s.id === params.get('scene')) ? params.get('scene') : VISIBLE_SCENES[0].id;
  app.goTo(firstScene);

  // Leaving the start screen: replay the scene's intro (e.g. the face assembling) so it isn't missed.
  const enter = () => {
    hideStart();
    app.active?.playIntro?.(2.5);
  };

  const handButton = $('#start-hand');
  const startHands = async () => {
    handButton.disabled = true;
    handButton.textContent = 'Starting camera…';
    startMessage('');
    // While waiting, say what is going on: the permission pop-up is easy to miss, and the first
    // visit downloads the hand-tracking model.
    const startedAt = performance.now();
    const progress = setInterval(() => {
      const cameraOn = !!app.input.hand?.video?.srcObject?.active;
      if (cameraOn) {
        handButton.textContent = 'Loading hand tracking…';
        startMessage('Camera is on. Loading hand tracking (about 17 MB, only the first time)…', 'note');
      } else if (performance.now() - startedAt > 6000) {
        startMessage('Please allow the camera in your browser’s pop-up (near the address bar).', 'note');
      }
    }, 500);
    try {
      await app.startHands();
      enter();
    } catch (err) {
      startMessage(cameraErrorMessage(err));
      handButton.disabled = false;
      handButton.innerHTML = '&#9995; Try hand control again';
    } finally {
      clearInterval(progress);
    }
  };

  handButton.addEventListener('click', startHands);
  $('#start-mouse').addEventListener('click', enter);

  // ?input=mouse skips the start screen (useful for embedding and tests); ?input=hand starts the camera.
  const input = params.get('input');
  if (input === 'mouse') {
    hideStart();
  } else if (input === 'hand') {
    startHands();
  }
  // Everyone else starts from the start screen: its button click is also what lets the
  // browser play sound (pages can't start audio on their own).
}

main().catch((err) => {
  console.error(err);
  showFatal(`Something went wrong while starting: ${err.message || err}`);
});
