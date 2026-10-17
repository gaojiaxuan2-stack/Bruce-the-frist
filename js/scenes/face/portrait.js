// Loads the selfie assets made by tools/prepare_face.py and turns them into
// one particle per sampled pixel of the person (background removed).
//
//   color.jpg  photo (sRGB)
//   data.png   R = depth (255 = nearest), G = person mask, B = part label * 50
//              (0 bg, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other)
//   meta.json  normalised face box + eye / nose / mouth points
//
// Everything here runs once in init(): the pixels are read with a single
// getImageData per image and the per-particle attributes are built in plain
// typed arrays.

const ASSET_DIR = new URL('../../../assets/face/', import.meta.url);

/** World height of the whole photo (its width follows the aspect ratio). */
export const WORLD_HEIGHT = 10;

// Relative sampling density per body part: the face and hair get the most
// particles so features stay crisp, the large plain T-shirt gets fewer.
const LABEL_DENSITY = [0, 1, 0.85, 1, 0.5, 0.8];
// Brightness per body part (the bright white shirt is toned down a little so
// the face stays the subject).
const LABEL_WEIGHT = [1, 1, 1, 1, 0.55, 1];

/** Fraction of particles drawn in Mono mode (see the 3x3 tagging below). */
export const MONO_FRACTION = 1 / 9;

export const LABEL = { bg: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4 };

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url.pathname.split('/').pop()} (HTTP ${res.status})`);
  return res;
}

/** Decode an image file to RGBA bytes. `raw` keeps data bytes untouched (no colour management). */
async function loadPixels(url, raw) {
  const blob = await (await fetchOk(url)).blob();
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, raw ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : {});
  } catch {
    bitmap = await createImageBitmap(blob);
  }
  const { width, height } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/** Separable box blur (running sums), returns a new array. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Small deterministic PRNG so the portrait looks the same on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of a 2D block index (0 .. 2^31). */
function blockHash(x, y) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % 9973;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Load the assets and sample about `targetCount` particles.
 * Returned positions are relative to the pivot (centre of the face):
 * x, y in world units (y up), z = depth 0..1 (scaled in the shader).
 */
export async function loadPortrait(targetCount) {
  const [meta, color, data] = await Promise.all([
    fetchOk(new URL('meta.json', ASSET_DIR)).then((r) => r.json()),
    loadPixels(new URL('color.jpg', ASSET_DIR), false),
    loadPixels(new URL('data.png', ASSET_DIR), true),
  ]);
  const W = data.width;
  const H = data.height;
  if (color.width !== W || color.height !== H) throw new Error('Face assets have different sizes');
  const N = W * H;
  const px = data.data;
  const cpx = color.data;

  const mask = new Uint8Array(N); // 0/1 person
  const depthRaw = new Float32Array(N);
  const label = new Uint8Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = i * 4;
    depthRaw[i] = px[j] / 255;
    mask[i] = px[j + 1] > 127 ? 1 : 0;
    label[i] = mask[i] ? Math.min(5, Math.round(px[j + 2] / 50)) : 0;
    lum[i] = (0.2126 * cpx[j] + 0.7152 * cpx[j + 1] + 0.0722 * cpx[j + 2]) / 255;
  }

  // Distance-to-silhouette proxy: blurred binary mask (0.5 on the edge, 1 deep inside).
  const maskF = Float32Array.from(mask);
  const soft = boxBlur(boxBlur(maskF, W, H, 4), W, H, 4);
  // Lightly smoothed depth (hides 8-bit steps) and its slope, used to keep the
  // brightness even when the head turns (steep areas bunch up on screen).
  const depth = boxBlur(boxBlur(depthRaw, W, H, 2), W, H, 2);
  // Local-contrast luminance (unsharp mask) so eyes, brows and mouth read well in Mono / Neon.
  const lumBlur = boxBlur(boxBlur(lum, W, H, 9), W, H, 9);

  const aspect = W / H;
  const worldW = WORLD_HEIGHT * aspect;
  const pivotU = meta.face.x + meta.face.w / 2;
  const pivotV = 1 - (meta.face.y + meta.face.h / 2);

  // Border fade: the photo cuts the shoulders at the bottom and the sides.
  const borderFade = (u, v) => smoothstep(0.0, 0.16, v) * smoothstep(0.0, 0.07, Math.min(u, 1 - u));

  // Stride so that the expected number of accepted samples ~= targetCount.
  let weighted = 0;
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i]) weighted += LABEL_DENSITY[label[i]] * borderFade((x + 0.5) / W, v);
    }
  }
  const stride = Math.max(0.5, Math.sqrt(weighted / targetCount));
  const cols = Math.ceil(W / stride);
  const rows = Math.ceil(H / stride);
  const cap = Math.ceil(targetCount * 1.15) + 1024;

  const position = new Float32Array(cap * 3);
  const colorAttr = new Uint8Array(cap * 3);
  const info = new Float32Array(cap * 4);
  const extra = new Float32Array(cap * 4);
  const slope = new Float32Array(cap * 2);
  const pxWorld = WORLD_HEIGHT / H; // world size of one photo pixel
  const rand = mulberry32(0x5eed);
  let n = 0;

  for (let gy = 0; gy < rows && n < cap; gy++) {
    for (let gx = 0; gx < cols && n < cap; gx++) {
      // Jittered (stratified) sample inside this grid cell: no visible grid.
      const fx = (gx + rand()) * stride;
      const fy = (gy + rand()) * stride;
      const keepRoll = rand();
      const r1 = rand();
      const r2 = rand();
      const ix = Math.min(W - 1, fx | 0);
      const iy = Math.min(H - 1, fy | 0);
      const i = iy * W + ix;
      if (!mask[i]) continue;
      const u = fx / W;
      const v = 1 - fy / H;
      const fade = borderFade(u, v);
      const dens = LABEL_DENSITY[label[i]] * fade;
      if (keepRoll >= dens) continue;

      const lab = label[i];
      const edge = smoothstep(0.5, 0.94, soft[i]);
      const l = lum[i];
      const enhanced = Math.min(1, Math.max(0, l + (l - lumBlur[i]) * 1.4));

      position[n * 3] = (u - pivotU) * worldW;
      position[n * 3 + 1] = (v - pivotV) * WORLD_HEIGHT;
      position[n * 3 + 2] = depth[i];
      // d(depth)/d(world), y up; multiplied by the depth scale in the shader.
      const xl = Math.max(0, ix - 2);
      const xr = Math.min(W - 1, ix + 2);
      const yt = Math.max(0, iy - 2);
      const yb = Math.min(H - 1, iy + 2);
      slope[n * 2] = (depth[iy * W + xr] - depth[iy * W + xl]) / ((xr - xl) * pxWorld);
      slope[n * 2 + 1] = (depth[yt * W + ix] - depth[yb * W + ix]) / ((yb - yt) * pxWorld);
      colorAttr[n * 3] = cpx[i * 4];
      colorAttr[n * 3 + 1] = cpx[i * 4 + 1];
      colorAttr[n * 3 + 2] = cpx[i * 4 + 2];
      info[n * 4] = enhanced;
      info[n * 4 + 1] = edge;
      info[n * 4 + 2] = r1;
      // Sparser regions get bigger dots so the coverage stays even.
      info[n * 4 + 3] = 1 / Math.sqrt(Math.max(0.25, LABEL_DENSITY[lab]));
      extra[n * 4] = lab;
      // One particle per 3x3 block of cells (a jittered coarse grid) is tagged
      // for the Mono halftone look by giving it rand2 < 1/9; rand2 stays uniform.
      const bh = blockHash(Math.floor(gx / 3), Math.floor(gy / 3));
      const tagged = gx % 3 === bh % 3 && gy % 3 === Math.floor(bh / 3) % 3;
      extra[n * 4 + 1] = tagged ? r2 * MONO_FRACTION : MONO_FRACTION + r2 * (1 - MONO_FRACTION);
      extra[n * 4 + 2] = LABEL_WEIGHT[lab] * Math.sqrt(fade);
      extra[n * 4 + 3] = l;
      n++;
    }
  }

  // Framing info: top of the hair, head width (rows between hair top and chin).
  let top = H;
  let left = W;
  let right = 0;
  const chinRow = Math.min(H - 1, Math.round((meta.face.y + meta.face.h) * H));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (y < top) top = y;
      if (y <= chinRow) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  return {
    meta,
    width: W,
    height: H,
    count: n,
    position: position.subarray(0, n * 3),
    color: colorAttr.subarray(0, n * 3),
    info: info.subarray(0, n * 4),
    extra: extra.subarray(0, n * 4),
    slope: slope.subarray(0, n * 2),
    /** Particle spacing in world units. */
    spacing: (stride / H) * WORLD_HEIGHT,
    worldSize: { w: worldW, h: WORLD_HEIGHT },
    pivotUV: { u: pivotU, v: pivotV },
    /** Content box in uv (v up). */
    bounds: { top: 1 - top / H, headLeft: left / W, headRight: (right + 1) / W },
    // Kept for ray-casting the pointer onto the 3D surface.
    depth,
    mask,
  };
}
