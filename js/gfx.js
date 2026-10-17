// gfx.js — a tiny WebGL2 compositor.
//
// Every public method takes CSS-pixel coordinates (the same space the 2D
// overlay and the hand landmarks use). Fragment shaders get `v_px` in DEVICE
// pixels with a top-left origin, plus helpers to sample the mirrored camera.

const VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_local;
uniform vec2 u_res;
uniform float u_dpr;
out vec2 v_px;
out vec2 v_local;
void main() {
  vec2 px = a_pos * u_dpr;
  v_px = px;
  v_local = a_local;
  vec2 clip = px / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// Prepended to every fragment shader. Mode shaders only write helpers + main().
export const PRELUDE = `#version 300 es
precision highp float;
uniform sampler2D u_video;   // camera frame (unmirrored, row 0 = top)
uniform sampler2D u_mask;    // person mask, same UV space as u_video (1 = person)
uniform vec2  u_res;         // canvas size in device px
uniform vec4  u_vrect;       // mirrored video rect on canvas: x, y, w, h (device px)
uniform vec2  u_vsize;       // video size in texels
uniform float u_dpr;         // device px per CSS px
uniform float u_time;        // seconds
uniform float u_hasMask;     // 1.0 when u_mask holds a real segmentation
in vec2 v_px;                // fragment position, device px, top-left origin
in vec2 v_local;             // per-shape local coords (0..1 across a quad/circle)
out vec4 outColor;

vec2 pxToUV(vec2 px) { vec2 uv = (px - u_vrect.xy) / u_vrect.zw; uv.x = 1.0 - uv.x; return uv; }
vec2 uvToPx(vec2 uv) { uv.x = 1.0 - uv.x; return u_vrect.xy + uv * u_vrect.zw; }
vec3 camUV(vec2 uv) { return texture(u_video, clamp(uv, 0.0, 1.0)).rgb; }
vec3 cam(vec2 px) { return camUV(pxToUV(px)); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float maskUV(vec2 uv) { return u_hasMask > 0.5 ? texture(u_mask, clamp(uv, 0.0, 1.0)).r : 1.0; }
float person(vec2 px) { return maskUV(pxToUV(px)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; } return s; }
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(0, 2, 1) / 3.0) * 6.0 - 3.0); return c.z * mix(vec3(1), clamp(p - 1.0, 0.0, 1.0), c.y); }
// Luminance edge magnitude around a device-px position; stepPx is in device px.
float sobel(vec2 px, float stepPx) {
  vec2 uv = pxToUV(px);
  vec2 d = vec2(stepPx / u_vrect.z, stepPx / u_vrect.w);
  float tl = luma(camUV(uv + vec2(-d.x, -d.y))), t = luma(camUV(uv + vec2(0.0, -d.y))), tr = luma(camUV(uv + vec2(d.x, -d.y)));
  float l  = luma(camUV(uv + vec2(-d.x, 0.0))),                                         r  = luma(camUV(uv + vec2(d.x, 0.0)));
  float bl = luma(camUV(uv + vec2(-d.x, d.y))),  b = luma(camUV(uv + vec2(0.0, d.y))),  br = luma(camUV(uv + vec2(d.x, d.y)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return length(vec2(gx, gy));
}
`;

const PASSTHROUGH = `void main() { outColor = vec4(cam(v_px), 1.0); }`;

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.programs = new Map();
    this.targets = new Set();
    this.W = 1; this.H = 1; this.dpr = 1;
    this.time = 0;
    this.vrect = [0, 0, 1, 1];  // CSS px
    this.vsize = [1, 1];
    this.hasMask = 0;

    this.buf = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.scratch = new Float32Array(4 * 4096);

    this.videoTex = this.createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.maskTex = this.createTexture();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    this.maskSize = [1, 1];

    this.passthrough = this.program('__passthrough', PASSTHROUGH);
  }

  // --- sizing -------------------------------------------------------------
  resize(W, H, dpr) {
    this.W = W; this.H = H; this.dpr = dpr;
    const cw = Math.max(1, Math.round(W * dpr)), ch = Math.max(1, Math.round(H * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw; this.canvas.height = ch;
    }
    for (const t of this.targets) this._sizeTarget(t);
  }

  // Where the mirrored camera image lands on screen, in CSS px.
  setVideoRect(x, y, w, h, vw, vh) { this.vrect = [x, y, w, h]; this.vsize = [vw, vh]; }

  // --- textures -----------------------------------------------------------
  createTexture({ filter = 'linear', wrap = 'clamp' } = {}) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const f = filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const w = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    return tex;
  }

  // Upload a canvas / image / video into a texture (created on first call).
  textureFrom(source, tex = null, opts) {
    const gl = this.gl;
    tex = tex || this.createTexture(opts);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return tex;
  }

  updateVideo(source) {
    try { this.textureFrom(source, this.videoTex); } catch (e) { /* frame not ready yet */ }
  }

  // Person mask: Uint8Array, one byte per texel, row 0 = top.
  setMask(bytes, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.maskSize[0] !== w || this.maskSize[1] !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
      this.maskSize = [w, h];
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, bytes);
    }
    this.hasMask = 1;
  }
  clearMask() { this.hasMask = 0; }

  // --- render targets (offscreen, auto-resized with the canvas) ----------
  // scale: fraction of the device-pixel canvas size.
  renderTarget(scale = 1) {
    const gl = this.gl;
    const t = { scale, tex: this.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
    this.targets.add(t);
    this._sizeTarget(t);
    return t;
  }
  _sizeTarget(t) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.width * t.scale));
    const h = Math.max(1, Math.round(this.canvas.height * t.scale));
    if (t.w === w && t.h === h) return;
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    t.cleared = false;
  }
  // Draw into a target (or the screen with null). Shaders still receive
  // canvas-space v_px, so a target is a scaled copy of the screen.
  bindTarget(t) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : this.canvas.width, t ? t.h : this.canvas.height);
    this.currentTarget = t;
  }
  clear(r = 0, g = 0, b = 0, a = 1) {
    const gl = this.gl;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // --- programs -----------------------------------------------------------
  // Compile (once) a fragment shader body; PRELUDE is prepended.
  program(key, fragBody) {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const vs = this._shader(gl.VERTEX_SHADER, VERT, key);
    const fs = this._shader(gl.FRAGMENT_SHADER, PRELUDE + fragBody, key);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.bindAttribLocation(p, 1, 'a_local');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed (${key}): ${gl.getProgramInfoLog(p)}`);
    }
    const uniforms = {};
    let unit = 2;  // 0 = video, 1 = mask
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      const u = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
      if (info.type === gl.SAMPLER_2D) {
        u.unit = name === 'u_video' ? 0 : name === 'u_mask' ? 1 : unit++;
      }
      uniforms[name] = u;
    }
    const prog = { key, p, uniforms };
    this.programs.set(key, prog);
    return prog;
  }

  _shader(type, src, key) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n');
      console.error(`Shader compile failed (${key}):\n${log}\n${lines}`);
      throw new Error(`Shader compile failed (${key}): ${log}`);
    }
    return s;
  }

  _use(prog, uniforms, blend) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    const d = this.dpr;
    const base = {
      u_res: [this.canvas.width, this.canvas.height],
      u_dpr: d,
      u_time: this.time,
      u_vrect: [this.vrect[0] * d, this.vrect[1] * d, this.vrect[2] * d, this.vrect[3] * d],
      u_vsize: this.vsize,
      u_hasMask: this.hasMask,
      u_video: this.videoTex,
      u_mask: this.maskTex,
    };
    for (const name in prog.uniforms) {
      const v = name in uniforms ? uniforms[name] : base[name];
      if (v !== undefined) this._set(prog.uniforms[name], v);
    }
    if (blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
    else if (blend === 'alpha') { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    else if (blend === 'screen') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); }
    else gl.disable(gl.BLEND);
  }

  _set(u, v) {
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
      case gl.SAMPLER_2D: {
        const tex = v && v.tex ? v.tex : v;  // accept a render target too
        gl.activeTexture(gl.TEXTURE0 + u.unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u.loc, u.unit);
        break;
      }
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      default: break;
    }
  }

  _draw(mode, data, count) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 4), gl.STREAM_DRAW);
    gl.drawArrays(mode, 0, count);
  }

  // --- drawing ------------------------------------------------------------
  // Full-screen pass. v_local spans 0..1 across the screen.
  fullscreen(prog, uniforms = {}, blend = null) {
    const W = this.W, H = this.H, s = this.scratch;
    s.set([0, 0, 0, 0, W, 0, 1, 0, 0, H, 0, 1, W, H, 1, 1]);
    this._use(prog, uniforms, blend);
    this._draw(this.gl.TRIANGLE_STRIP, s, 4);
  }

  // The plain mirrored camera.
  drawVideo() { this.fullscreen(this.passthrough); }

  // Arbitrary 4-corner quad [tl, tr, br, bl] ({x,y} CSS px). It is drawn as a
  // grid so v_local is bilinear (no seam along the diagonal).
  quad(prog, corners, uniforms = {}, { blend = null, grid = 10 } = {}) {
    const [a, b, c, d] = corners, s = this.scratch;
    let k = 0;
    const pt = (u, v) => {
      const x = (a.x * (1 - u) + b.x * u) * (1 - v) + (d.x * (1 - u) + c.x * u) * v;
      const y = (a.y * (1 - u) + b.y * u) * (1 - v) + (d.y * (1 - u) + c.y * u) * v;
      s[k++] = x; s[k++] = y; s[k++] = u; s[k++] = v;
    };
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const u0 = i / grid, u1 = (i + 1) / grid, v0 = j / grid, v1 = (j + 1) / grid;
        pt(u0, v0); pt(u1, v0); pt(u1, v1);
        pt(u0, v0); pt(u1, v1); pt(u0, v1);
      }
    }
    this._use(prog, uniforms, blend);
    this._draw(this.gl.TRIANGLES, s, k / 4);
  }

  // Filled circle (or ellipse with ry). v_local: 0..1 box, center at 0.5.
  circle(prog, cx, cy, r, uniforms = {}, { blend = null, segments = 72, ry = r } = {}) {
    const s = this.scratch;
    let k = 0;
    s[k++] = cx; s[k++] = cy; s[k++] = 0.5; s[k++] = 0.5;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      s[k++] = cx + c * r; s[k++] = cy + sn * ry; s[k++] = 0.5 + c * 0.5; s[k++] = 0.5 + sn * 0.5;
    }
    this._use(prog, uniforms, blend);
    this._draw(this.gl.TRIANGLE_FAN, s, k / 4);
  }

  // Convex polygon as a triangle fan. Optional per-vertex locals [{x,y}].
  polygon(prog, points, uniforms = {}, { blend = null, locals = null } = {}) {
    if (points.length < 3) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const s = this.scratch;
    let k = 0;
    points.forEach((p, i) => {
      s[k++] = p.x; s[k++] = p.y;
      if (locals) { s[k++] = locals[i].x; s[k++] = locals[i].y; }
      else { s[k++] = (p.x - minX) / Math.max(1e-6, maxX - minX); s[k++] = (p.y - minY) / Math.max(1e-6, maxY - minY); }
    });
    this._use(prog, uniforms, blend);
    this._draw(this.gl.TRIANGLE_FAN, s, k / 4);
  }
}
