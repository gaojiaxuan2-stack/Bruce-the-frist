# Bruce-the-frist
Frist one

## Mao Zedong statue (`mao/`)

A life-size (1.80 m) 3D statue of Mao Zedong in a Zhongshan suit, right hand raised, standing on a granite plinth inscribed 毛泽东.

- **`mao/index.html`**: an interactive viewer. Open it in a browser (double-clicking the file works; it loads three.js from jsDelivr). Drag to orbit, scroll or pinch to zoom, switch between painted, marble, bronze and gold finishes, and jump to a close-up of the face.
- **`mao/mao-zedong.glb`**: the same model as a glTF binary (about 270k triangles, painted vertex colours, named materials) for Blender, Unity, Unreal or any glTF viewer.

### How it is made

There are no hand-made meshes. Every part of the figure is a signed distance field built from about 125 primitives (ellipsoids, round cones and boxes blended with smooth min/max). The parts are:

- the head, with eyes, lids, nose, lips, large ears, swept-back hair and the mole on the chin
- both hands
- the suit, with its turn-down collar, five front buttons and four flapped pockets
- the trousers and shoes

The viewer polygonises the fields in the browser with sparse surface nets in four parallel Web Workers. It takes about 2–3 s on a laptop. It then bakes SDF normals, ambient occlusion and paint into the vertices.

### Re-exporting the GLB

```sh
cd mao
npm install
npx playwright install chromium   # once, if Playwright has no browser yet
npm run export          # detail 1.5 (~270k triangles)
node export-glb.mjs 1   # full viewer detail (~600k triangles)
```
