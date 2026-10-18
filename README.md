# Particle 3D

Interactive 3D particle effects in the browser that you control with your hand in
front of the webcam. No typing needed: point, pinch, make a fist, open your palm or
swipe.

| Scene | What it is | Inspired by |
| --- | --- | --- |
| 🙂 **Your Face** | Your selfie as ~180k particles with real 3D depth (nose forward, shoulders back) | brunoimbrizi/interactive-particles |
| 🕳️ **Black Hole** | A Gargantua-style black hole: Keplerian accretion disk, photon ring, gravitational lensing | "Cosmic Singularity & Gargantua" |
| 🌌 **Galaxy** | Spiral galaxy generator with the classic count / branches / spin / colour controls | Three.js Journey galaxy |
| 🪞 **Live Mirror** | Your live webcam turned into a 3D particle relief, background removed | Particleify |
| 💠 **Shapes** | Particles morphing between sphere, torus knot, heart, DNA, planet and text, chosen by how many fingers you hold up | |

## Hand controls

| Gesture | Does |
| --- | --- |
| ☝️ Point | moves the cursor, pushes particles |
| 🤏 Pinch + move | grab and rotate; pinch on a button or slider to click / drag it |
| ✊ Fist | pulls the particles in |
| ✋ Open palm (after a fist) | explodes them back out |
| ✌️ Peace | changes colours / style (depends on the scene) |
| 👋 Fast swipe left / right | next / previous scene |
| ☝️ Point at a tab ~1 s | opens that scene |
| Hand closer / farther, or two hands apart | zoom |

Each scene shows its own gestures in the bottom-left corner. Without a camera, the
mouse works too: move = point, left-drag = pinch, right-drag (or Shift-drag) = fist,
wheel = zoom, ← → or 1–5 = change scene, `H` = hand control on/off, `G` = controls panel.

## Run it

The camera only works on `https://` or `http://localhost`, and the browser needs to
load ES modules, so open it through a small web server (double-clicking
`index.html` will not work):

```bash
node tools/serve.mjs        # then open http://localhost:8080
```

Any static server works (e.g. `npx serve`) as long as it serves `.mjs` as JavaScript
and `.wasm` as `application/wasm`.

### Put it online with GitHub Pages

1. On GitHub open **Settings → Pages**.
2. Under **Build and deployment** choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and **Save**.
3. After a minute the site is live at `https://<your-user>.github.io/<repo-name>/`.

Everything (three.js, MediaPipe, the hand model) is in `vendor/`, so the site does not
depend on any CDN and also works where Google / jsDelivr are blocked.

## Use a different face

The face scene reads `assets/face/color.jpg` + `assets/face/data.png` (depth and mask).
To make them from another photo:

```bash
pip install mediapipe opencv-python-headless numpy scipy pillow
python tools/prepare_face.py path/to/selfie.jpg
```

## Project layout

```
index.html            page + import map
css/style.css         HUD styling
js/main.js            start screen
js/core/              App (renderer, bloom, scene switching, quality), BaseScene, shared GLSL
js/input/             InputState contract, mouse input, MediaPipe hand tracking, gestures, hand cursor
js/scenes/            one file per scene
assets/face/          the face scene's photo, depth and mask
vendor/               three.js, lil-gui, MediaPipe tasks-vision + models (see vendor/README.md)
tools/                local server, face preprocessing, headless smoke test, test-video builder
tests/                unit tests for the gesture logic (node --test tests/)
```

## Development checks

```bash
npm install                      # Playwright for the headless checks
npm test                         # gesture unit tests (node --test "tests/*.test.mjs")
node tools/smoke.mjs --scene galaxy --shot out/galaxy.png
bash tools/make_fixtures.sh      # fake-webcam videos of real hands
node tools/smoke.mjs --scene test --input hand --video out/fixtures/fist.y4m --wait 9000 \
  --steps '[{"eval":"__app.input.state.gesture"}]'
```

Performance: quality is `high` on desktop and `low` on phones, and drops automatically
if the frame rate stays under ~28 fps. Force it with `?quality=low|medium|high`.
