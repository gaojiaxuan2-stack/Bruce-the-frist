// Sculpts the statue in headless Chromium and saves it as mao-zedong.glb.
//
//   cd mao && npm install && npm run export          # default detail 1.5 (~270k triangles)
//   node export-glb.mjs 1                             # full viewer detail (~600k triangles)
//
// Set THREE_DIR to a local three@0.160.0 package to work offline.
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const detail = Number(process.argv[2] || 1.5);
const outFile = path.join(here, 'mao-zedong.glb');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
if (process.env.THREE_DIR) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', (route) => {
    const file = path.join(process.env.THREE_DIR, route.request().url().split('three@0.160.0/')[1]);
    return fs.existsSync(file) ? route.fulfill({ path: file, contentType: 'application/javascript' }) : route.abort();
  });
}
await page.goto(`${pathToFileURL(path.join(here, 'index.html')).href}?detail=${detail}`);
await page.waitForFunction(() => window.__maoReady === true, null, { timeout: 180000 });

const base64 = await page.evaluate(async () => {
  const { THREE, figure, plinth } = window.__mao;
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const root = new THREE.Group();
  root.name = 'MaoZedongStatue';
  root.add(plinth.clone(true));
  // KHR_materials_sheen has no intensity, so fold three.js's `sheen` scalar into the colour.
  const baked = new Map();
  const bake = (mt) => {
    if (!baked.has(mt)) {
      const c = mt.clone();
      if (c.isMeshPhysicalMaterial && c.sheen > 0) { c.sheenColor.multiplyScalar(c.sheen); c.sheen = 1; }
      baked.set(mt, c);
    }
    return baked.get(mt);
  };
  const fig = new THREE.Group();
  fig.name = 'Figure';
  fig.position.copy(figure.position);
  for (const m of figure.children) {
    // Rebuild each part without the viewer's bookkeeping, with 8-bit RGBA vertex colours.
    const src = m.geometry, g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    const c = src.userData.paintedAttr.array, n = c.length / 3, rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[4 * i] = Math.round(Math.min(1, c[3 * i]) * 255);
      rgba[4 * i + 1] = Math.round(Math.min(1, c[3 * i + 1]) * 255);
      rgba[4 * i + 2] = Math.round(Math.min(1, c[3 * i + 2]) * 255);
      rgba[4 * i + 3] = 255;
    }
    g.setAttribute('color', new THREE.BufferAttribute(rgba, 4, true));
    g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    const mesh = new THREE.Mesh(g, m.material.map(bake));
    mesh.name = { head: 'Head', body: 'Suit', handR: 'RightHand', handL: 'LeftHand' }[m.name] || m.name;
    mesh.position.copy(m.position);
    mesh.quaternion.copy(m.quaternion);
    mesh.scale.copy(m.scale);
    fig.add(mesh);
  }
  root.add(fig);
  const glb = new Uint8Array(await new GLTFExporter().parseAsync(root, { binary: true }));
  let bin = '';
  for (let i = 0; i < glb.length; i += 0x8000) bin += String.fromCharCode.apply(null, glb.subarray(i, i + 0x8000));
  return btoa(bin);
});
await browser.close();

fs.writeFileSync(outFile, Buffer.from(base64, 'base64'));
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB, detail ${detail})`);
