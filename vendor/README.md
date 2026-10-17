# Vendored libraries

Everything the site needs is served from this folder, so it works offline and
on networks where public CDNs (jsDelivr, Google Storage) are slow or blocked.

| Folder | Package | Version | License |
| --- | --- | --- | --- |
| `three/` | [three.js](https://threejs.org) (`build/` + a few `examples/jsm` addons) | 0.180.0 | MIT |
| `mediapipe/` | [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (bundle + wasm) | 0.10.21 | Apache-2.0 |
| `mediapipe/models/hand_landmarker.task` | [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (float16 v1) | - | Apache-2.0 |
| `mediapipe/models/selfie_segmenter.tflite` | [MediaPipe Selfie Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) (float16) | - | Apache-2.0 |
| `lil-gui/` | [lil-gui](https://lil-gui.georgealways.com) | 0.21.0 | MIT |

To update, `npm install` the package at the new version and copy the same files over.
