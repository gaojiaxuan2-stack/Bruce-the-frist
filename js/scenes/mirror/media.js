// Image / video files for the Live Mirror, scaled to what the particle grid can show.
//
// The shader samples one mip level where a texel is about one particle (~3-4 levels
// below a phone photo's full size), so full resolution is never read: a 24-48 MP photo
// would only cost 100-260 MB of GPU memory, and a 4K clip a full-size upload plus a
// mipmap rebuild on every frame. Images are decoded at <= 2048 px on the long side,
// videos are drawn into a <= 1024 px canvas once per new video frame.
import * as THREE from 'three';

export const MAX_IMAGE_SIDE = 2048;
export const MAX_VIDEO_SIDE = 1024;

/** (w, h) scaled down (never up) so the long side is at most `max`. */
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

function canvasOf(width, height, opaque = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: !opaque });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** sRGB colour texture with mipmaps (the shader reads a blur from the mip chain). */
function mipTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Decode with createImageBitmap (off the main thread, EXIF orientation applied), resized there. */
async function decodeBitmap(file) {
  if (typeof createImageBitmap !== 'function') throw new Error('no createImageBitmap');
  const full = await createImageBitmap(file);
  const { width, height } = fitSize(full.width, full.height, MAX_IMAGE_SIDE);
  let small = full;
  if (width !== full.width || height !== full.height) {
    try {
      small = await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    } catch {
      small = full; // no resize options here: the canvas below scales it
    }
  }
  const { canvas, ctx } = canvasOf(width, height);
  ctx.drawImage(small, 0, 0, width, height);
  if (small !== full) small.close();
  full.close();
  return canvas;
}

/** Fallback: an <img> (also EXIF-aware) drawn into a smaller canvas. */
async function decodeImg(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, MAX_IMAGE_SIDE);
  const { canvas, ctx } = canvasOf(width, height);
  ctx.drawImage(img, 0, 0, width, height);
  img.removeAttribute('src'); // let the full-size decode go
  return canvas;
}

/**
 * An image file as a texture of at most MAX_IMAGE_SIDE px on its long side.
 * @param {File} file
 * @param {string} url object URL of the same file (for the fallback decoder)
 * @returns {Promise<{texture: THREE.Texture, width: number, height: number}>}
 */
export async function loadImageTexture(file, url) {
  let canvas;
  try {
    canvas = await decodeBitmap(file);
  } catch {
    canvas = await decodeImg(url);
  }
  const texture = mipTexture(canvas);
  return { texture, width: canvas.width, height: canvas.height };
}

/**
 * A playing <video> copied into a small canvas texture, once per new video frame
 * (requestVideoFrameCallback where there is one, else when currentTime moves).
 * Call update() every frame while it is shown.
 */
export class VideoCanvasTexture {
  /** @param {HTMLVideoElement} video (metadata loaded) */
  constructor(video) {
    this.video = video;
    const { width, height } = fitSize(video.videoWidth, video.videoHeight, MAX_VIDEO_SIDE);
    this.width = width;
    this.height = height;
    const { canvas, ctx } = canvasOf(width, height, true);
    this.canvas = canvas;
    this.ctx = ctx;
    this.texture = mipTexture(canvas);
    this.lastTime = -1;
    this.fresh = true; // draw the first frame right away
    this.rvfc = 0;
    this.disposed = false;
    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (this.disposed) return;
        this.fresh = true;
        this.rvfc = video.requestVideoFrameCallback(onFrame);
      };
      this.rvfc = video.requestVideoFrameCallback(onFrame);
      this.useRvfc = true;
    }
  }

  /** Copy the current video frame if it is a new one. Cheap when nothing changed. */
  update() {
    const v = this.video;
    if (this.disposed || v.readyState < 2) return;
    if (!this.useRvfc && v.currentTime !== this.lastTime) this.fresh = true;
    if (!this.fresh) return;
    this.fresh = false;
    this.lastTime = v.currentTime;
    this.ctx.drawImage(v, 0, 0, this.width, this.height);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    if (this.useRvfc && this.rvfc) this.video.cancelVideoFrameCallback?.(this.rvfc);
    this.texture.dispose();
  }
}
