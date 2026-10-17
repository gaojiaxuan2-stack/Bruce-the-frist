# Writing a mode

A mode is a plain object exported as `default` from `js/modes/<id>.js` and
listed in `js/modes/index.js`. Everything is optional except `id` and `name`.

```js
export default {
  id: 'spider',                 // URL hash (#spider) and storage key
  name: 'SPIDER-MAN',           // chip label + toast title
  short: 'SPIDEY',              // chip label on phones
  tagline: 'Thwip!',            // toast subtitle when the mode opens
  icon: '<svg viewBox="0 0 24 24">…</svg>',   // 24×24, use currentColor
  accent: '#ff2a3d',            // CSS --accent while active
  hint: 'Make the <b>🤟 web-shooter</b> sign',  // bottom hint (HTML)
  guide: [['🤟', 'Shoot a web'], ['✊✊', 'Clear webs']],  // gesture legend
  options: [{ id: 'city', label: 'CITY', short: 'CITY', icon: '…' }],  // bottom chips
  needs: { face: true, segment: true },   // or (app) => ({...}); loaded lazily
  skeleton: { color: '#fff', width: 1.6, glow: null, joints: true } | false,
  simScenarios: { name: (t) => [handSpec, …] },   // see js/sim.js

  init(app) {},                 // once, first time the mode opens
  enter(app) {},                // every time it opens
  exit(app) {},                 // when another mode opens
  setOption(id, app) {},        // bottom chip chosen; `this.option` is already set
  update(frame, app) {},        // every animation frame, before drawing
  renderGL(gfx, frame, app) {}, // WebGL layer; omit to show the plain camera
  draw2D(ctx, frame, app) {},   // 2D overlay, CSS px, ctx already cleared
};
```

## Coordinates

Everything is in **CSS pixels of the screen**, already mirrored like a selfie
camera: `frame.W × frame.H`. Hand landmarks, face landmarks, `gfx.quad()`
corners and the 2D canvas all share this space.

## `frame`

| field | meaning |
| --- | --- |
| `t`, `dt` | seconds since page load, seconds since last frame |
| `hands` | tracked hands, sorted left→right on screen (see below) |
| `events` | one-shot events this frame (see below) |
| `face` | `{ lm[478], center, width, height, angle, blend }` or `null` — only when `needs.face` |
| `hasMask` | `true` once a person-segmentation mask is in `u_mask` — only when `needs.segment` |
| `W`, `H`, `view` | screen size; `view.{ox,oy,dw,dh}` = where the camera image is drawn |
| `option` | current option id of the mode |

`face.blend` holds MediaPipe blendshape scores (0..1), e.g. `eyeBlinkLeft`,
`eyeBlinkRight`, `eyeSquintLeft`, `jawOpen`, `mouthSmileLeft`.

### Hand

| field | meaning |
| --- | --- |
| `id` | stable id while the hand stays in view |
| `lm[21]` | smoothed landmarks `{x, y, z}` (see `LM` in `js/gestures.js`) |
| `world[21]` | MediaPipe world landmarks (metres, hand-centred) |
| `pose` | `open` `fist` `point` `peace` `spider` `thumbsUp` `other` |
| `poseTime` | seconds the current pose has been held |
| `ext`, `curl` | per finger: extended? and curl 0..1 (`thumb index middle ring pinky`) |
| `pinching`, `pinch`, `pinchPoint` | thumb–index pinch flag, strength 0..1, midpoint |
| `palm`, `size`, `angle`, `dir` | palm centre, wrist→middle-knuckle length (px), direction |
| `vel`, `speed` | palm velocity px/s |
| `pointer` | index fingertip |
| `side` | `left` / `right` half of the screen (as the user sees it) |
| `handedness` | the user's real hand, `Left` / `Right` |
| `ghost` | `true` for up to 140 ms after the tracker lost the hand |
| `overUI` | the hand is pointing/pinching at a HUD button — ignore it |
| `is(pose)` | `pose === x && !ghost` |

### Events

`{type:'pose', hand, pose, prev}`, `{type:'pinchstart'|'pinchend', hand, x, y}`
(skip it if `e.consumed` — the HUD used it as a click),
`{type:'swipe', hand, dir:'left'|'right'|'up'|'down'}`,
`{type:'handenter'|'handleave', hand}`.

## `app`

`app.gfx` (WebGL, below), `app.sfx` (sounds: `play('thwip')`,
`loop(id, level)`, `stopLoop(id)`), `app.ui` (`toast(title, sub)`,
`setHint(html)`), `app.W/H`, `app.toScreen(nx, ny)`.

## `gfx` (WebGL2)

```js
const prog = gfx.program('spider-bg', `void main(){ outColor = vec4(cam(v_px), 1.0); }`);
gfx.fullscreen(prog, { u_myUniform: 1.0 });
gfx.quad(prog, [tl, tr, br, bl], uniforms, { blend: 'alpha' });   // v_local 0..1
gfx.circle(prog, cx, cy, r, uniforms, { blend: 'add' });          // v_local 0..1, centre .5
gfx.polygon(prog, points, uniforms);
gfx.drawVideo();                                                  // plain camera
const tex = gfx.textureFrom(canvas);                              // canvas → sampler
const rt = gfx.renderTarget(0.5); gfx.bindTarget(rt); …; gfx.bindTarget(null);
```

Shader prelude (`js/gfx.js`) gives: `v_px` (device px, top-left origin),
`v_local`, `u_time`, `u_res`, `u_dpr`, `cam(px)`, `camUV(uv)`, `pxToUV(px)`,
`person(px)` (mask, 1 = person; 1 everywhere when no mask), `luma`, `sobel(px, step)`,
`noise`, `fbm`, `hash12`, `hsv2rgb`. Pass sizes in device px (`× u_dpr`).

## Performance rules (phones!)

* Avoid `ctx.shadowBlur` in loops — use `drawGlow()` / `glowSprite()` from
  `js/draw.js` with `globalCompositeOperation = 'lighter'`.
* Pre-render static art (rings, glyph atlases) to offscreen canvases once.
* Keep shader loops small; no more than ~25 texture reads per pixel.
