// neon-gl.js — GPU side of NEON DRAW.
//
// Every stroke is a triangle strip drawn into an offscreen target with MAX
// blending, so a tube never brightens where it folds over itself. The target
// is then added over a darkened, cool-tinted camera that up to 8 coloured
// lights (pens + clusters of strokes) shine onto.

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
    float n1 = noise(vec2(s * 0.045 - t * 2.6, u_seed * 7.0 + t * 0.9));
    float n2 = noise(vec2(s * 0.11 + t * 1.9, a * 0.09 - t * 5.0 + u_seed * 3.0));
    float flick = 0.55 + 0.6 * n1;
    float reach = u_R * (0.28 + 0.72 * n2 * (0.45 + n1));
    float flame = exp(-d / max(reach * 0.34, 1.0)) * flick;
    float body = exp(-d * d / (w * w * 8.0));
    float k = clamp(d / (w * 7.0), 0.0, 1.0);
    vec3 hot = vec3(1.0, 0.93, 0.62), mid = vec3(1.0, 0.5, 0.06), rim = vec3(0.85, 0.1, 0.02);
    vec3 base = mix(mix(hot, mid, smoothstep(0.0, 0.4, k)), rim, smoothstep(0.4, 1.0, k));
    col = base * (body * 1.15 + flame) + hot * core * (0.75 + 0.25 * n1);
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
  float hot = u_live * exp(-max(u_len - s, 0.0) / 70.0);
  col += vec3(1.0, 0.96, 0.92) * hot * (core * 0.6 + tube * 0.7 + halo * 0.35);
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
// bloom (the ink target is mipmapped every frame; high LODs = wide blur).
const COMPOSITE = `
uniform sampler2D u_ink;
uniform vec4  u_L[8];      // light: x, y, radius (device px), intensity
uniform vec3  u_LC[8];     // light colour
uniform float u_dark;      // 0..1 mood fade-in
uniform float u_inkOn;
uniform float u_flash;
uniform vec2  u_flashAt;   // device px

void main() {
  vec3 c = cam(v_px);
  float l = luma(c);
  vec3 g = mix(c, mix(vec3(l), c, 0.4) * vec3(0.3, 0.35, 0.5), u_dark);
  vec2 q = v_px / u_res - 0.5;
  g *= 1.0 - u_dark * dot(q, q) * 1.4;
  vec3 light = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 L = u_L[i];
    vec2 d = (v_px - L.xy) / max(L.z, 1.0);
    float r2 = dot(d, d);
    light += u_LC[i] * (L.w * (exp(-r2 * 2.6) + 0.1 / (1.0 + r2 * 5.0)));
  }
  // Lit surfaces take the light's colour; a little haze hangs in the air.
  vec3 col = g + g * light * 3.0 + light * 0.03;
  if (u_inkOn > 0.0) {
    vec2 iuv = vec2(v_px.x / u_res.x, 1.0 - v_px.y / u_res.y);
    vec2 o = vec2(18.0 * u_dpr) / u_res;
    vec3 ink = textureLod(u_ink, iuv, 0.0).rgb;
    vec3 bloom = textureLod(u_ink, iuv, 2.5).rgb * 0.5
      + (textureLod(u_ink, iuv + vec2(o.x, 0.0), 4.2).rgb + textureLod(u_ink, iuv - vec2(o.x, 0.0), 4.2).rgb
       + textureLod(u_ink, iuv + vec2(0.0, o.y), 4.2).rgb + textureLod(u_ink, iuv - vec2(0.0, o.y), 4.2).rgb) * 0.3;
    col += (ink + bloom) * u_inkOn;
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
    u_dark: 0, u_inkOn: 0, u_flash: 0, u_flashAt: [0, 0],
  },
};

export class NeonGL {
  constructor() {
    this.rt = null;
    this.strip = null;
    this.comp = null;
    this.ok = true;
  }

  // Lazily compile (first renderGL) so a compile error stays inside the mode.
  ensure(gfx) {
    if (this.comp) return;
    this.comp = gfx.program('neon-composite', COMPOSITE);
    this.strip = gfx.program('neon-strip', STRIP);
    // Full resolution on desktop; 3/4 on high-DPR phones (still > 1 px per CSS px).
    this.rt = gfx.renderTarget(gfx.dpr >= 1.4 ? 0.75 : 1);
    // gfx has no public triangle-strip call; its internal _use/_draw share the
    // VAO + vertex layout of quad()/polygon(), so strips go through them.
    this.ok = typeof gfx._use === 'function' && typeof gfx._draw === 'function';
  }

  // strokes: [{ stroke, amp, live }]; lights: { L, LC } typed arrays (device px).
  render(gfx, items, light, mood) {
    this.ensure(gfx);
    const gl = gfx.gl;
    let drew = false;
    if (items.length && this.ok) {
      gfx.bindTarget(this.rt);
      gfx.clear(0, 0, 0, 0);
      const u = U.strip;
      for (const it of items) {
        const s = it.stroke;
        s.build();
        if (s.geoN < 4) continue;
        u.u_R = s.R; u.u_w = s.w; u.u_len = s.len; u.u_style = s.si; u.u_col = s.col;
        u.u_seed = s.seed; u.u_amp = it.amp; u.u_kill = s.kill; u.u_shatter = s.shatter;
        u.u_live = it.live; u.u_hue = s.hue;
        gfx._use(this.strip, u, 'add');
        if (!drew) { gl.blendEquation(gl.MAX); drew = true; }
        gfx._draw(gl.TRIANGLE_STRIP, s.geo, s.geoN);
      }
      if (drew) gl.blendEquation(gl.FUNC_ADD);
      gfx.bindTarget(null);
      if (drew) {
        // Mip chain of the ink = cheap wide blur for the bloom.
        gl.bindTexture(gl.TEXTURE_2D, this.rt.tex);
        if (!this.mips) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); this.mips = true; }
        gl.generateMipmap(gl.TEXTURE_2D);
      }
    }
    const c = U.comp;
    c.u_ink = this.rt;
    c.u_inkOn = drew ? 1 : 0;
    c.u_L.set(light.L); c.u_LC.set(light.LC);
    c.u_dark = mood.dark; c.u_flash = mood.flash;
    c.u_flashAt[0] = mood.fx * gfx.dpr; c.u_flashAt[1] = mood.fy * gfx.dpr;
    gfx.fullscreen(this.comp, c);
  }
}
