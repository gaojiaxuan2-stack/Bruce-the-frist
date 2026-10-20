#!/usr/bin/env node
// Zero-dependency static server with the right MIME types for .mjs / .wasm / .task.
//   node tools/serve.mjs            -> http://localhost:8080
//   node tools/serve.mjs 3000
// The camera only works on https:// or http://localhost, so open the localhost URL.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME } from './mime.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = statSync(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(301, { location: `${path}/` }).end();
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`Particle 3D running at http://localhost:${port}/  (Ctrl+C to stop)`);
});
