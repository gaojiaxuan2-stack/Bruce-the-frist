#!/usr/bin/env node
// Headless browser check: opens the site, runs scripted steps, saves screenshots,
// and fails on any page error or console error.
//
//   npm install            (once, installs Playwright)
//   node tools/smoke.mjs --scene galaxy --shot out/galaxy.png
//   node tools/smoke.mjs --scene face --steps '[{"override":{"pointer":{"x":0.1,"y":0.2},"pinching":true}},{"wait":800},{"shot":"out/a.png"}]'
//   node tools/smoke.mjs --input hand --video tests/fixtures/hand.y4m --wait 6000
//
// Options:
//   --scene <id>        scene to open (default: first scene)
//   --input mouse|hand  mouse skips the start screen; hand starts the (fake) camera
//   --video <file.y4m>  feed this video to the fake camera (Chromium fake device otherwise)
//   --size 1280x800     viewport
//   --quality <q>       low | medium | high
//   --wait <ms>         settle time after load before steps (default 2500)
//   --steps <json|file> list of steps, see below
//   --shot <png>        screenshot at the end
//   --headed            show the browser
//   --chromium <path>   browser binary (default: Playwright's, or /opt/pw-browsers/chromium if present)
//
// Steps: {"wait":ms} {"override":{...}|null} {"eval":"expr"} {"key":"ArrowRight"} {"click":"css"}
//        {"mouse":{"move":[x,y]}|{"down":0|2}|{"up":0|2}|{"wheel":dy}} {"shot":"file.png"} {"goto":"sceneId"}
//        {"fps":ms}  -> measures frames per second over ms
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME } from './mime.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const out = { wait: 2500, input: 'mouse', size: '1280x800' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function serve() {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const IGNORED = [
  /GPU stall due to ReadPixels/i,
  /WebGL: CONTEXT_LOST/i,
  /Automatic fallback to software WebGL/i,
  /swiftshader/i,
  /favicon/i,
  /OpenGL error checking is disabled/i,
  /INFO: Created TensorFlow Lite/i,
  /GL_INVALID_OPERATION.*glDrawArrays/i,
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await import('playwright');
  const [w, h] = String(args.size).split('x').map(Number);
  const launchArgs = [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (args.video) launchArgs.push(`--use-file-for-fake-video-capture=${resolve(args.video)}`);
  const executablePath = typeof args.chromium === 'string'
    ? args.chromium
    : existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: !args.headed, args: launchArgs, executablePath });
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  await context.grantPermissions(['camera'], { origin: `http://localhost:${port}` });
  const page = await context.newPage();

  const errors = [];
  const warnings = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    if (msg.type() === 'error') errors.push(text);
    else if (msg.type() === 'warning') warnings.push(text);
    if (args.verbose || msg.type() === 'error') console.log(`[console.${msg.type()}] ${text}`);
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
    console.log(`[pageerror] ${err.stack || err.message}`);
  });
  page.on('requestfailed', (req) => {
    const msg = `request failed: ${req.url()} ${req.failure()?.errorText}`;
    if (!/favicon/.test(req.url())) errors.push(msg);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !/favicon/.test(res.url())) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  const qs = new URLSearchParams({ input: args.input });
  if (args.scene) qs.set('scene', args.scene);
  if (args.quality) qs.set('quality', args.quality);
  const url = `http://localhost:${port}/?${qs}`;
  console.log(`open ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: Number(args.timeout || 60000) });
  await page.waitForFunction(() => window.__app?.active, null, { timeout: Number(args.timeout || 60000) });
  await page.waitForTimeout(Number(args.wait));

  let steps = [];
  if (args.steps) {
    const raw = existsSync(args.steps) ? readFileSync(args.steps, 'utf8') : args.steps;
    steps = JSON.parse(raw);
  }
  const results = [];
  for (const step of steps) {
    if ('wait' in step) await page.waitForTimeout(step.wait);
    if ('override' in step) await page.evaluate((o) => window.__app.input.setOverride(o), step.override);
    if ('goto' in step) {
      await page.evaluate((id) => window.__app.goTo(id), step.goto);
      await page.waitForFunction((id) => window.__app.activeId === id, step.goto, { timeout: 60000 });
    }
    if ('key' in step) await page.keyboard.press(step.key);
    if ('click' in step) await page.click(step.click);
    if ('mouse' in step) {
      const m = step.mouse;
      if (m.move) await page.mouse.move(m.move[0], m.move[1], { steps: m.steps || 8 });
      if ('down' in m) await page.mouse.down({ button: m.down === 2 ? 'right' : 'left' });
      if ('up' in m) await page.mouse.up({ button: m.up === 2 ? 'right' : 'left' });
      if ('wheel' in m) await page.mouse.wheel(0, m.wheel);
    }
    if ('eval' in step) {
      const value = await page.evaluate((expr) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(expr);
        return v instanceof Promise ? v.then((x) => JSON.parse(JSON.stringify(x ?? null))) : JSON.parse(JSON.stringify(v ?? null));
      }, step.eval);
      console.log(`eval ${step.eval} => ${JSON.stringify(value)}`);
      results.push({ eval: step.eval, value });
    }
    if ('fps' in step) {
      const fps = await page.evaluate((ms) => new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else r((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }), step.fps);
      console.log(`fps ≈ ${fps.toFixed(1)}`);
      results.push({ fps });
    }
    if ('shot' in step) {
      mkdirSync(dirname(resolve(step.shot)), { recursive: true });
      await page.screenshot({ path: step.shot });
      console.log(`saved ${step.shot}`);
    }
  }
  if (args.shot) {
    mkdirSync(dirname(resolve(args.shot)), { recursive: true });
    await page.screenshot({ path: args.shot });
    console.log(`saved ${args.shot}`);
  }

  const summary = await page.evaluate(() => ({
    scene: window.__app.activeId,
    quality: window.__app.quality,
    handsRunning: window.__app.input.handsRunning,
    input: { source: window.__app.input.state.source, gesture: window.__app.input.state.gesture },
    render: { ...window.__app.renderer.info.render },
    memory: { ...window.__app.renderer.info.memory },
  }));
  console.log(JSON.stringify({ summary, errors, warnings: warnings.slice(0, 20), results }, null, 2));
  await browser.close();
  server.close();
  if (errors.length) {
    console.error(`FAILED: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
