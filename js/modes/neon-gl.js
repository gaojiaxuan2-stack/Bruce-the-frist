// neon-gl.js — GPU side of NEON DRAW.
//
// Every stroke is a triangle strip drawn with MAX blending, so a tube never
// brightens where it folds over itself. Each stroke keeps its own vertex
// buffer, uploaded only when its shape changes. Settled strokes live in an offscreen
// CACHE target that is re-rendered only when the set of strokes changes, on
// resize, or (when there is a lot of ink) on a slow animation tick; the pen's
// live stroke, igniting and dissolving strokes are drawn on top of a copy of
// it every frame. The ink is then added (with mip-chain bloom) over a
// darkened, cool-tinted camera that up to 8 coloured lights shine onto.

// Profiles are computed per pixel from v_local = (arc length s, side ±1).
const STRIP = `
uniform float u_R;       // strip half width = glow reach (CSS px)
uniform float u_w;       // core half width (CSS px)
uniform float u_len;     // stroke length (CSS px)
uniform float u_style;   // 0 neon, 1 rainbow, 2 fire, 3 stars
uniform vec3  u_col;
uniform float u_seed;
uniform float u_amp;     // brightness: pulse, ignition flicker, fades
uniform float u_kill;    // 0..1 dissolve
uniform float u_shatter; // 1 = clear-all break-up (bigger shards)
uniform float u_live;    // 1 while the pen is down: hot fresh ink at the tip
uniform float u_hue;     // rainbow phase

void main() {
  float s = v_local.x;
  float a = v_local.y * u_R;
  // Screen-space slope of a, taken before any discard (derivatives need the
  // whole 2x2 pixel quad on some mobile GPUs).
  vec2 gr = vec2(dFdx(a), dFdy(a));
  float ds = max(-s, 0.0) + max(s - u_len, 0.0);
  float d = length(vec2(ds, a));
  if (d >= u_R) discard;
  float t = u_time;
  float w = u_w;
  float fade = 1.0 - smoothstep(u_R * 0.55, u_R, d);
  float core = 1.0 - smoothstep(w * 0.4, w * 1.3, d);
  float tube = exp(-d * d / (w * w * 5.0));
  float halo = exp(-d / (u_R * 0.19)) * 0.6 + exp(-d / (u_R * 0.42)) * 0.22;
  vec3 col;
  if (u_style < 0.5) {
    float flow = 0.93 + 0.07 * sin(s * 0.06 - t * 4.0 + u_seed * 6.28);
    col = u_col * (tube * 1.1 + halo) * flow + vec3(core);
  } else if (u_style < 1.5) {
    float hue = fract(u_hue + s / 480.0 - t * 0.28);
    vec3 rc = hsv2rgb(vec3(hue, 0.82, 1.0));
    col = rc * (tube * 1.1 + halo) + vec3(core);
  } else if (u_style < 2.5) {
    // Fire: a white-hot wick with flame tongues that rise up the SCREEN
    // whatever the stroke's direction, torn by upward-scrolling noise.
    // (window-space derivatives: y grows UP the screen in the framebuffer)
    vec2 nrm = gr / max(length(gr), 1e-4);    // screen direction of growing a
    float up = a * nrm.y;                      // px above the wick
    float lat = length(vec2(a * nrm.x, ds));   // px beside it
    vec2 fp = v_px / u_dpr;
    float n1 = noise(vec2(fp.x * 0.055 + u_seed * 13.0, fp.y * 0.05 + t * 2.6));
    float n2 = noise(vec2(fp.x * 0.14 - u_seed * 5.0, fp.y * 0.12 + t * 5.2));
    float n = n1 * 0.62 + n2 * 0.38;
    float hgt = max(up, 0.0) / u_R;
    float tongue = clamp((n * 1.35 - hgt * 1.15) * 2.4, 0.0, 1.0);
    float hug = exp(-max(-up, 0.0) / (w * 1.6)) * exp(-lat / (w * 2.2 + u_R * 0.16 * (1.0 - hgt)));
    float flame = tongue * hug * (1.0 - 0.55 * hgt);
    float body = exp(-d * d / (w * w * 6.0));
    // Heat → colour: white-hot at the wick, yellow, orange, red tips.
    float heat = max(body, flame * (0.4 + 0.42 * n2));
    vec3 c = mix(vec3(0.5, 0.03, 0.0), vec3(1.0, 0.27, 0.02), smoothstep(0.0, 0.28, heat));
    c = mix(c, vec3(1.0, 0.6, 0.1), smoothstep(0.28, 0.6, heat));
    c = mix(c, vec3(1.0, 0.93, 0.72), smoothstep(0.62, 0.97, heat));
    col = c * heat * 1.2 + vec3(1.0, 0.3, 0.04) * halo * 0.4 + vec3(1.0, 0.95, 0.8) * core * (0.8 + 0.2 * n1);
  } else {
    // Star dust: a faint nebula path with twinkling points scattered across it.
    float neb = 0.6 + 0.6 * noise(vec2(s * 0.025 - t * 0.4, a * 0.05 + u_seed * 9.0));
    col = u_col * (exp(-d / (u_R * 0.3)) * 0.22 * neb + tube * 0.18);
    vec2 sa = vec2(s, a);
    for (int k = -1; k <= 1; k++) {
      float cell = floor(s / 7.0) + float(k);
      float h1 = hash12(vec2(cell, u_seed * 131.0));
      float h2 = hash12(vec2(cell + 7.31, u_seed * 37.0 + 1.0));
      float h3 = hash12(vec2(cell * 1.73, u_seed * 11.0 + 5.1));
      vec2 p = vec2((cell + h1) * 7.0, (h2 - 0.5) * u_R * 0.95 * h3);
      float r = mix(0.55, 1.6, (1.0 - h3) * h1) * max(w, 1.0);
      float tw = max(0.0, 0.4 + 0.6 * sin(t * (1.5 + 4.5 * h3) + h2 * 6.283));
      vec2 q = sa - p;
      vec3 sc = mix(vec3(1.0), mix(u_col, vec3(1.0, 0.85, 0.5), h2), 0.25 + 0.35 * h1);
      col += sc * exp(-dot(q, q) / (r * r)) * tw * 1.3;
    }
    for (int k = -1; k <= 1; k++) {
      float cell = floor(s / 36.0) + float(k);
      float h1 = hash12(vec2(cell, u_seed * 53.0 + 2.0));
      float h2 = hash12(vec2(cell + 3.17, u_seed * 29.0));
      vec2 p = vec2((cell + h1) * 36.0, (h2 - 0.5) * u_R * 0.5);
      vec2 q = sa - p;
      float tw = 0.5 + 0.5 * sin(t * (1.8 + 2.6 * h2) + h1 * 6.283);
      tw = tw * tw * tw;
      float r = (1.3 + 1.3 * h2) * max(w, 1.0);
      float sp = exp(-dot(q, q) / (r * r)) * 1.6
        + (exp(-abs(q.x) * 0.42) * exp(-q.y * q.y * 0.5) + exp(-abs(q.y) * 0.42) * exp(-q.x * q.x * 0.5)) * 0.6;
      col += vec3(1.0, 0.97, 0.9) * sp * tw;
    }
  }
  // Fresh ink right behind the pen glows white-hot, then cools to colour.
  float hot = u_live * exp(-max(u_len - s, 0.0) / 60.0);
  col += vec3(1.0, 0.96, 0.92) * hot * (core * 0.5 + tube * 0.55 + halo * 0.15);
  col *= fade * u_amp;
  if (u_kill > 0.0) {
    // Burn away along noisy fronts; shards are larger when everything shatters.
    float f = mix(0.05, 0.02, u_shatter);
    float n = noise(vec2(s * f + u_seed * 31.0, a * f * 1.6)) * 0.72 + noise(vec2(s * 0.21, a * 0.2 + u_seed * 7.0)) * 0.28;
    float th = u_kill * 1.15 - 0.08;
    float keep = smoothstep(th, th + 0.05, n);
    float rim = (smoothstep(th - 0.02, th + 0.04, n) - smoothstep(th + 0.05, th + 0.16, n)) * (1.0 - u_kill);
    col = col * keep + vec3(1.0, 0.86, 0.62) * rim * fade * (tube + halo) * 2.2;
  }
  outColor = vec4(col, 1.0);
}`;

// Darkened, desaturated, cool camera + coloured light spill + the ink with
// bloom (the ink target is mipmapped whenever it changes; high LODs = wide
// blur). Ink is dimmed over the HUD bars so the buttons stay readable.
const COMPOSITE = `
uniform sampler2D u_ink;
uniform vec4  u_L[8];      // light: x, y, radius (device px), intensity
uniform vec3  u_LC[8];     // light colour
uniform float u_dark;      // 0..1 mood fade-in
uniform float u_inkOn;
uniform float u_flash;
uniform vec2  u_flashAt;   // device px
uniform vec2  u_band;      // drawing band top / bottom (device px)

void main() {
  vec3 c = cam(v_px);
  float l = luma(c);
  vec3 g = mix(c, mix(vec3(l), c, 0.42) * vec3(0.36, 0.42, 0.6), u_dark);
  vec2 q = v_px / u_res - 0.5;
  g *= 1.0 - u_dark * dot(q, q) * 1.3;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 L = u_L[i];
    vec2 d = (v_px - L.xy) / max(L.z, 1.0);
    float r2 = dot(d, d);
    light += u_LC[i] * (L.w * (exp(-r2 * 2.6) + 0.1 / (1.0 + r2 * 5.0)));
  }
  // Lit surfaces take the light's colour (saturating, so a crowd of lights
  // never bleaches a face); a little haze hangs in the air.
  light /= 1.0 + 0.7 * max(light.r, max(light.g, light.b));
  vec3 col = g + g * light * 3.0 + light * 0.03;
  if (u_inkOn > 0.0) {
    vec2 iuv = vec2(v_px.x / u_res.x, 1.0 - v_px.y / u_res.y);
    vec2 o = vec2(18.0 * u_dpr) / u_res;
    vec3 ink = textureLod(u_ink, iuv, 0.0).rgb;
    vec3 bloom = textureLod(u_ink, iuv, 2.5).rgb * 0.5
      + (textureLod(u_ink, iuv + vec2(o.x, 0.0), 4.2).rgb + textureLod(u_ink, iuv - vec2(o.x, 0.0), 4.2).rgb
       + textureLod(u_ink, iuv + vec2(0.0, o.y), 4.2).rgb + textureLod(u_ink, iuv - vec2(0.0, o.y), 4.2).rgb) * 0.3;
    float e = 24.0 * u_dpr;
    float inBand = smoothstep(u_band.x - e, u_band.x + e, v_px.y) * (1.0 - smoothstep(u_band.y - e, u_band.y + e, v_px.y));
    col += (ink + bloom) * u_inkOn * mix(0.4, 1.0, inBand);
  }
  if (u_flash > 0.0) {
    float fd = length(v_px - u_flashAt) / max(u_res.x, u_res.y);
    col += vec3(0.75, 0.85, 1.0) * u_flash * (0.22 + 0.5 * exp(-fd * 5.0));
  }
  outColor = vec4(col, 1.0);
}`;

const U = {
  strip: {
    u_R: 1, u_w: 1, u_len: 0, u_style: 0, u_col: [1, 1, 1], u_seed: 0,
    u_amp: 1, u_kill: 0, u_shatter: 0, u_live: 0, u_hue: 0,
  },
  comp: {
    u_ink: null, u_L: new Float32Array(32), u_LC: new Float32Array(24),
    u_dark: 0, u_inkOn: 0, u_flash: 0, u_flashAt: [0, 0], u_band: [0, 0],
  },
};

// Below this much tube area (CSS px²) the cache is simply redrawn every
// frame; above it, its animation (pulse, flow, flicker) runs at 30 / 20 /
// 12 Hz as the ink grows.
const CACHE_FREE = 260000;
const refreshEvery = (cost) => (cost < CACHE_FREE ? 0 : cost < CACHE_FREE * 3 ? 1 / 30 : cost < CACHE_FREE * 8 ? 1 / 20 : 1 / 12);

export class NeonGL {
  constructor() {
    this.cache = null;     // settled strokes
    this.ink = null;       // cache + live strokes, mipmapped, read by the composite
    this.strip = null;
    this.comp = null;
    this.ok = true;
    this.key = null;       // what the cache holds
    this.cacheT = -1;
    this.inkFresh = false; // ink == cache copy + nothing live (can be reused)
    this.hasInk = false;
    this.vao = null;       // own vertex array: strokes draw from their own buffers
    this.bufs = new Map(); // stroke -> { buf, ver, mark }
    this.mark = 0;
    this.mipW = 0; this.mipH = 0;
  }

  // Lazily compile (first renderGL) so a compile error stays inside the mode.
  ensure(gfx) {
    if (this.comp) return;
    this.comp = gfx.program('neon-composite', COMPOSITE);
    this.strip = gfx.program('neon-strip', STRIP);
    // Full resolution on desktop; 3/4 on high-DPR phones (still > 1 px per CSS px).
    const sc = gfx.dpr >= 1.4 ? 0.75 : 1;
    this.cache = gfx.renderTarget(sc);
    this.ink = gfx.renderTarget(sc);
    const gl = gfx.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ink.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // gfx has no public triangle-strip call: programs + uniforms + blend go
    // through its internal _use(); the geometry comes from our own VAO with
    // the same layout (a_pos = 0, a_local = 1; x, y, s, side per vertex).
    this.ok = typeof gfx._use === 'function';
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.bindVertexArray(gfx.vao || null);
  }

  // The ink texture is sampled with mipmaps; keep its chain complete after
  // every (re)allocation so it is never sampled incomplete.
  fixMips(gfx) {
    if (this.ink.w === this.mipW && this.ink.h === this.mipH) return;
    this.mipW = this.ink.w; this.mipH = this.ink.h;
    gfx.bindTarget(this.ink);
    gfx.clear(0, 0, 0, 0);
    this.mip(gfx.gl);
    gfx.bindTarget(null);
    this.inkFresh = false;
    this.key = null;
  }

  // Forget the buffers of strokes that are gone (called with this frame's lists).
  sweep(gl, a, b) {
    const m = ++this.mark;
    for (const it of a) { const e = this.bufs.get(it.stroke); if (e) e.mark = m; }
    for (const it of b) { const e = this.bufs.get(it.stroke); if (e) e.mark = m; }
    if (this.bufs.size <= a.length + b.length) return;
    for (const [s, e] of this.bufs) if (e.mark !== m) { gl.deleteBuffer(e.buf); this.bufs.delete(s); }
  }

  // Draw strokes ([{ stroke, amp, live }]) into the bound target.
  drawStrips(gfx, items) {
    const gl = gfx.gl, u = U.strip;
    let drew = false;
    for (const it of items) {
      const s = it.stroke;
      s.build();
      if (s.geoN < 4) continue;
      u.u_R = s.R; u.u_w = s.w; u.u_len = s.len; u.u_style = s.si; u.u_col = s.col;
      u.u_seed = s.seed; u.u_amp = it.amp; u.u_kill = s.kill; u.u_shatter = s.shatter;
      u.u_live = it.live; u.u_hue = s.hue;
      gfx._use(this.strip, u, 'add');
      if (!drew) { gl.blendEquation(gl.MAX); gl.bindVertexArray(this.vao); drew = true; }
      let e = this.bufs.get(s);
      if (!e) { e = { buf: gl.createBuffer(), ver: -1, mark: this.mark }; this.bufs.set(s, e); }
      gl.bindBuffer(gl.ARRAY_BUFFER, e.buf);
      if (e.ver !== s.geoVer) {
        gl.bufferData(gl.ARRAY_BUFFER, s.geo.subarray(0, s.geoN * 4), s.endT < 0 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        e.ver = s.geoVer;
      }
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, s.geoN);
    }
    if (drew) { gl.blendEquation(gl.FUNC_ADD); gl.bindVertexArray(gfx.vao || null); }
    return drew;
  }

  // settled: cacheable strokes (+ key: a signature of that set and its
  // size, cost: tube area); live: strokes that change every frame.
  render(gfx, settled, key, cost, live, light, mood) {
    this.ensure(gfx);
    const gl = gfx.gl, t = gfx.time;
    this.fixMips(gfx);
    this.sweep(gl, settled, live);
    if (this.ok && (settled.length || live.length)) {
      const sizeKey = `${key}|${this.ink.w}x${this.ink.h}`;
      const every = refreshEvery(cost);
      if (every === 0) {
        // Light scene: draw everything straight into the ink every frame.
        gfx.bindTarget(this.ink);
        gfx.clear(0, 0, 0, 0);
        this.drawStrips(gfx, settled);
        this.drawStrips(gfx, live);
        this.key = null;
        this.inkFresh = false;
        this.mip(gl);
      } else {
        let cacheNew = false;
        if (sizeKey !== this.key || t - this.cacheT >= every || t < this.cacheT) {
          gfx.bindTarget(this.cache);
          gfx.clear(0, 0, 0, 0);
          this.drawStrips(gfx, settled);
          this.key = sizeKey; this.cacheT = t;
          cacheNew = true;
        }
        if (cacheNew || live.length || !this.inkFresh) {
          // ink = copy of the cache + the live strokes on top.
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.cache.fbo);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.ink.fbo);
          gl.blitFramebuffer(0, 0, this.cache.w, this.cache.h, 0, 0, this.ink.w, this.ink.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gfx.bindTarget(this.ink);
          this.drawStrips(gfx, live);
          this.inkFresh = !live.length;
          this.mip(gl);
        }
      }
      gfx.bindTarget(null);
      this.hasInk = true;
    } else {
      this.hasInk = false;
      this.key = null;
      this.inkFresh = false;
    }
    const c = U.comp, d = gfx.dpr;
    c.u_ink = this.ink;
    c.u_inkOn = this.hasInk ? 1 : 0;
    c.u_L.set(light.L); c.u_LC.set(light.LC);
    c.u_dark = mood.dark; c.u_flash = mood.flash;
    c.u_flashAt[0] = mood.fx * d; c.u_flashAt[1] = mood.fy * d;
    c.u_band[0] = mood.top * d; c.u_band[1] = mood.bottom * d;
    gfx.fullscreen(this.comp, c);
  }

  // Mip chain of the ink = cheap wide blur for the bloom.
  mip(gl) {
    gl.bindTexture(gl.TEXTURE_2D, this.ink.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}
