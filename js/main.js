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

  const handButton = $('#start-hand');
  const startHands = async () => {
    handButton.disabled = true;
    handButton.textContent = 'Starting camera…';
    errorEl.hidden = true;
    // The browser's permission pop-up is easy to miss: point at it if nothing happens for a while.
    const promptHint = setTimeout(() => {
      errorEl.textContent = 'Please allow the camera in your browser’s pop-up (near the address bar).';
      errorEl.hidden = false;
    }, 6000);
    try {
      await app.startHands();
      hideStart();
    } catch (err) {
      errorEl.textContent = cameraErrorMessage(err);
      errorEl.hidden = false;
      handButton.disabled = false;
      handButton.innerHTML = '&#9995; Try hand control again';
    } finally {
      clearTimeout(promptHint);
    }
  };

  handButton.addEventListener('click', startHands);
  $('#start-mouse').addEventListener('click', hideStart);

  // ?input=mouse skips the start screen (useful for embedding and tests); ?input=hand starts the camera.
  const input = params.get('input');
  if (input === 'mouse') {
    hideStart();
  } else if (input === 'hand') {
    startHands();
  } else {
    // Returning visitors who already allowed the camera go straight in.
    try {
      const status = await navigator.permissions?.query({ name: 'camera' });
      if (status?.state === 'granted') startHands();
    } catch {
      /* Permissions API without "camera" (Firefox) - wait for a click. */
    }
  }
}

main().catch((err) => {
  console.error(err);
  showFatal(`Something went wrong while starting: ${err.message || err}`);
});
