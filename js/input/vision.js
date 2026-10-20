// Shared MediaPipe setup. Everything is served from /vendor so the site works
// offline and where Google / jsDelivr CDNs are blocked.
import { FilesetResolver } from '@mediapipe/tasks-vision';

const base = new URL('../../vendor/mediapipe/', import.meta.url);

export const MODEL_URLS = {
  hand: new URL('models/hand_landmarker.task', base).href,
  selfieSegmenter: new URL('models/selfie_segmenter.tflite', base).href,
};

let filesetPromise = null;

/** The MediaPipe WASM fileset, loaded once and shared by every task. */
export function getVisionFileset() {
  filesetPromise ??= FilesetResolver.forVisionTasks(new URL('wasm', base).href).catch((err) => {
    filesetPromise = null;
    throw err;
  });
  return filesetPromise;
}
