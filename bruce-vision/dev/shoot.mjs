#!/usr/bin/env node
// Dev helper: open the app in headless Chromium and save screenshots.
//
//   node dev/shoot.mjs --url "index.html?sim=spider:thwip" --shots 1500,3000 --out /tmp/spider
//   node dev/shoot.mjs --url "index.html#portal" --cam hands.y4m      # fake camera video (.y4m / .mjpeg)
//
// Options: --size 1280x720  --mobile (390x844 @3x)  --ready (wait for the hand model)
//          --noperm (don't pre-grant the camera: shows the start screen)
//          --eval "__bv.setOption('miles')"  (run in the page once it has started)
// Shot times count from when the app starts (that is also sim time 0).
// Prints window.__bv.state() and every console error as JSON.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(Number(args.port || 0), '127.0.0.1', r));
const port = server.address().port;

const mobile = !!args.mobile;
const [w, h] = (args.size || (mobile ? '390x844' : '1280x720')).split('x').map(Number);
const flags = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
];
if (args.cam) flags.push(`--use-file-for-fake-video-capture=${path.resolve(args.cam)}`);

const browser = await pw.chromium.launch({ headless: true, args: flags });
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: mobile ? 3 : 1,
  isMobile: mobile, hasTouch: mobile,
  permissions: args.noperm ? [] : ['camera'],
});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const url = `http://127.0.0.1:${port}/${args.url || 'index.html'}`;
await page.goto(url);
if (args.click !== undefined || args.cam) {
  await page.waitForSelector('#start');
  // The app auto-starts when the camera is already allowed; only click if needed.
  await page.click('#start', { timeout: 1500 }).catch(() => {});
}
const out = args.out || '/tmp/bv';
fs.mkdirSync(path.dirname(out + 'x'), { recursive: true });

if (!args.noperm) await page.waitForFunction(() => window.__bv?.state().started, null, { timeout: 60000 }).catch(() => logs.push('[harness] app never started'));
if (args.ready) {
  await page.waitForFunction(() => window.__bv?.state().ready, null, { timeout: Number(args.timeout || 60000) }).catch(() => logs.push('[harness] timed out waiting for ready'));
}
if (args.eval) await page.evaluate(args.eval).catch((e) => logs.push(`[harness] eval failed: ${e.message}`));
const t0 = Date.now();
const shots = String(args.shots || '2500').split(',').map(Number);
const states = [];
for (const [i, at] of shots.entries()) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  const file = `${out}-${i}.png`;
  await page.screenshot({ path: file });
  const st = await page.evaluate(() => window.__bv?.state()).catch((e) => ({ error: String(e) }));
  states.push({ at, file, state: st });
}
console.log(JSON.stringify({ url, states, logs }, null, 2));
await browser.close();
server.close();
