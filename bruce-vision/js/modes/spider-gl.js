// spider-gl.js — the Spider-Verse look: a comic-print grade of the camera
// (misregistered plates, Ben-Day dots, ink lines, paper grain) and, with
// person segmentation, a procedural comic NYC skyline behind the user.

// Shared by both passes: palette switch, ink colour, Ben-Day dots.
const COMMON = `
uniform float u_pal;     // 0 = dusk (Peter), 1 = neon night (Miles)

const vec3 INK = vec3(0.05, 0.02, 0.09);

// Ben-Day dot screen on a 45 degree grid. cover = inked area 0..1.
float dots(vec2 px, float cell, float cover) {
  vec2 p = mat2(0.7071, 0.7071, -0.7071, 0.7071) * px / cell;
  float d = length(fract(p) - 0.5);
  float r = sqrt(clamp(cover, 0.0, 1.0)) * 0.64;
  float aa = 0.8 / cell;
  return (1.0 - smoothstep(r - aa, r + aa, d)) * step(0.02, cover);
}
`;

// The procedural skyline (city(px)), rendered into a cached target.
const CITY_LIB = COMMON + `
uniform vec2 u_head;     // head offset from screen centre (-1..1), for parallax

float segD(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// The chest-emblem spider, q roughly -1..1 (y down).
float spiderSDF(vec2 q) {
  q.x = abs(q.x);
  float d = (length((q - vec2(0.0, 0.1)) / vec2(0.12, 0.24)) - 1.0) * 0.12;
  d = min(d, length(q - vec2(0.0, -0.2)) - 0.08);
  d = min(d, segD(q, vec2(0.05, -0.13), vec2(0.34, -0.42)) - 0.022);
  d = min(d, segD(q, vec2(0.34, -0.42), vec2(0.42, -0.8)) - 0.018);
  d = min(d, segD(q, vec2(0.07, -0.05), vec2(0.44, -0.16)) - 0.022);
  d = min(d, segD(q, vec2(0.44, -0.16), vec2(0.64, -0.44)) - 0.018);
  d = min(d, segD(q, vec2(0.07, 0.06), vec2(0.44, 0.17)) - 0.022);
  d = min(d, segD(q, vec2(0.44, 0.17), vec2(0.64, 0.46)) - 0.018);
  d = min(d, segD(q, vec2(0.05, 0.15), vec2(0.34, 0.44)) - 0.022);
  d = min(d, segD(q, vec2(0.34, 0.44), vec2(0.42, 0.82)) - 0.018);
  return d;
}

// One row of buildings painted over col. k: seed, cw: cell width (device px),
// h0..h1: height range as a fraction of the screen height.
vec3 buildings(vec3 col, vec2 px, float k, float cw, float h0, float h1,
               vec3 wall, vec3 lit, float winOn, float shift, float tower) {
  float H = u_res.y;
  float x = px.x + shift;
  float i = floor(x / cw);
  float fx = fract(x / cw);
  float r1 = hash12(vec2(i, k * 7.13 + 1.0));
  float r2 = hash12(vec2(i + 17.3, k * 3.71 + 5.0));
  float r3 = hash12(vec2(i * 1.37 + 3.1, k + 9.1));
  float top = H * (1.0 - mix(h0, h1, r1));
  float x0 = 0.03 + r2 * 0.12;
  float x1 = 0.97 - r3 * 0.12;
  float tierOn = step(0.5, r2);
  float tTop = top - H * 0.04 * tierOn;
  float spOn = step(0.78, r3);
  float sTop = tTop - H * (0.04 + 0.05 * r1) * spOn;
  float y = px.y;
  float lw = 1.6 * u_dpr;

  float inBody = step(x0, fx) * step(fx, x1) * step(top, y);
  float inTier = tierOn * step(0.27, fx) * step(fx, 0.73) * step(tTop, y);
  float inSpire = spOn * step(abs(fx - 0.5) * cw, 0.018 * cw + lw) * step(sTop, y);
  // rooftop water tower (near row only)
  float wt = tower * step(0.55, r1) * (1.0 - tierOn);
  float tx = abs(fx - 0.7) * cw;
  float tw = 0.075 * cw;
  float tankTop = top - H * 0.06, tankBot = top - H * 0.02;
  float inTank = wt * step(tx, tw) * step(tankTop, y) * step(y, tankBot);
  float roof = wt * step(tx, tw * (y - (tankTop - H * 0.025)) / (H * 0.025)) * step(tankTop - H * 0.025, y) * step(y, tankTop);
  float legs = wt * step(abs(tx - tw * 0.75), lw * 0.7) * step(tankBot, y) * step(y, top);
  float sil = max(inTank, max(roof, legs));

  float m = max(max(inBody, inTier), max(inSpire, sil));
  if (m < 0.5) return col;
  if (sil > 0.5 && inBody < 0.5) return mix(wall * 0.45, INK, 0.6);

  // inside distance to the outline (union of body / crown / spire)
  float eB = inBody > 0.5 ? min(min(fx - x0, x1 - fx) * cw, y - top) : -1.0;
  float eT = inTier > 0.5 ? min(min(fx - 0.27, 0.73 - fx) * cw, y - tTop) : -1.0;
  float e = max(eB, eT);
  if (inSpire > 0.5 && e < 0.0) e = 0.0;

  float depth = smoothstep(top, H, y);
  vec3 c = wall * (1.05 - 0.35 * depth);
  // lit edge facing the sun
  c = mix(c, c * 1.45 + vec3(0.06, 0.02, 0.0), smoothstep(0.62, 0.9, fx) * 0.55);
  // halftone shading, heavier toward the street
  c = mix(c, c * 0.5, dots(px, 6.0 * u_dpr, depth * 0.75 + 0.06));

  // windows
  vec2 wsz = vec2(cw * 0.15, H * 0.032);
  vec2 wq = vec2((fx - x0) * cw, y - top);
  vec2 wi = floor(wq / wsz);
  vec2 wf = fract(wq / wsz);
  float win = step(0.3, wf.x) * step(wf.x, 0.72) * step(0.34, wf.y) * step(wf.y, 0.72);
  win *= step(0.5, wi.y) * step(wq.x + wsz.x * 0.35, (x1 - x0) * cw) * step(wsz.x * 0.4, wq.x) * inBody;
  float on = step(1.0 - winOn, hash12(wi + vec2(i * 13.1, k * 31.7)));
  on *= step(0.07, hash12(wi * 1.7 + vec2(i, floor(u_time * 0.3 + r1 * 9.0))));
  c = mix(c, mix(wall * 0.45, lit, on), win);

  // ink outline
  return mix(c, INK, 1.0 - smoothstep(lw * 0.45, lw * 1.25, e));
}

vec3 city(vec2 px) {
  vec2 R = u_res;
  float S = min(R.x, R.y);
  float y = px.y / R.y;
  float lw = 1.6 * u_dpr;

  vec3 skyTop = mix(vec3(0.24, 0.06, 0.40), vec3(0.03, 0.02, 0.10), u_pal);
  vec3 skyMid = mix(vec3(0.95, 0.24, 0.52), vec3(0.28, 0.05, 0.42), u_pal);
  vec3 skyLow = mix(vec3(1.00, 0.63, 0.27), vec3(0.92, 0.12, 0.40), u_pal);
  vec3 col = mix(skyTop, skyMid, smoothstep(0.0, 0.42, y));
  col = mix(col, skyLow, smoothstep(0.32, 0.68, y));
  // sky halftone, denser toward the top
  float sd = dots(px, 9.0 * u_dpr, (1.0 - smoothstep(0.0, 0.62, y)) * 0.65 + 0.06);
  col = mix(col, col * vec3(0.7, 0.55, 0.85), sd * 0.55);
  // stars at night
  if (u_pal > 0.01) {
    vec2 cell = px / (16.0 * u_dpr);
    vec2 ci = floor(cell);
    float h = hash12(ci + 3.1);
    vec2 sp = vec2(hash12(ci + 7.7), hash12(ci + 1.3)) * 0.7 + 0.15;
    float sd = length(fract(cell) - sp) * 16.0;
    float tw = 0.6 + 0.4 * sin(u_time * (1.5 + h * 3.0) + h * 40.0);
    float st = step(0.93, h) * (1.0 - smoothstep(0.4, 1.3, sd)) * tw * (1.0 - smoothstep(0.1, 0.55, y));
    col = mix(col, vec3(1.0, 0.95, 1.0), st * u_pal);
  }

  // big halftone sun / moon with a faint spider on it
  vec2 sc = vec2(R.x * 0.77, R.y * 0.27) - u_head * vec2(0.012, 0.006) * S;
  float sr = S * 0.17;
  float d = length(px - sc);
  vec3 sunCol = mix(vec3(1.0, 0.88, 0.38), vec3(0.93, 0.92, 1.0), u_pal);
  col += sunCol * 0.32 * exp(-max(d - sr, 0.0) / (S * 0.07));
  if (d < sr + lw * 2.0) {
    vec2 q = (px - sc) / sr;
    float shade = smoothstep(-0.3, 1.0, dot(q, vec2(-0.6, 0.8)));
    vec3 disc = mix(sunCol, sunCol * mix(vec3(1.0, 0.55, 0.35), vec3(0.6, 0.55, 0.9), u_pal), dots(px, 7.0 * u_dpr, shade * 0.85));
    float sp = spiderSDF(q * 1.25);
    disc = mix(disc, disc * mix(vec3(0.82, 0.35, 0.2), vec3(0.95, 0.15, 0.25), u_pal), (1.0 - smoothstep(-0.01, 0.01, sp)) * 0.5);
    col = mix(col, disc, 1.0 - smoothstep(sr - 1.0, sr + 1.0, d));
    col = mix(col, INK, (1.0 - smoothstep(lw * 0.5, lw * 1.3, abs(d - sr))) * 0.85);
  }

  // three rows of buildings, far -> near, with a little head parallax
  float hx = u_head.x * S;
  col = buildings(col, px, 1.0, S * 0.085, 0.30, 0.60,
    mix(vec3(0.62, 0.25, 0.52), vec3(0.20, 0.08, 0.34), u_pal),
    mix(vec3(1.0, 0.86, 0.55), vec3(0.55, 0.9, 1.0), u_pal), 0.35, S * 0.37 - hx * 0.02, 0.0);
  col = buildings(col, px, 2.0, S * 0.13, 0.17, 0.44,
    mix(vec3(0.36, 0.09, 0.32), vec3(0.10, 0.04, 0.20), u_pal),
    mix(vec3(1.0, 0.78, 0.36), vec3(1.0, 0.22, 0.45), u_pal), 0.45, S * 0.11 - hx * 0.05, 0.0);
  col = buildings(col, px, 3.0, S * 0.21, 0.05, 0.25,
    mix(vec3(0.15, 0.04, 0.13), vec3(0.04, 0.02, 0.08), u_pal),
    mix(vec3(1.0, 0.72, 0.30), vec3(0.25, 0.95, 1.0), u_pal), 0.5, -hx * 0.1, 1.0);
  return col;
}
`;
const CITY_FRAG = CITY_LIB + `
void main() { outColor = vec4(city(v_px), 1.0); }
`;

const COMIC_FRAG = COMMON + `
uniform float u_grade;   // 0..1 comic grade
uniform float u_bg;      // 0..1 skyline replaces the background
uniform float u_glitch;  // 0..1 Miles-style misregistration glitches
uniform sampler2D u_city;

vec3 grade(vec3 c, vec2 px) {
  float l = luma(c);
  c = clamp(mix(vec3(l), c, 1.45), 0.0, 1.0);
  c = clamp((c - 0.5) * 1.18 + 0.53, 0.0, 1.0);
  c = mix(c, floor(c * 5.0 + 0.5) / 5.0, 0.3);
  l = luma(c);
  float cell = 6.0 * u_dpr;
  // shadows: ink dots that grow with darkness
  float sh = smoothstep(0.6, 0.1, l);
  c = mix(c, c * 0.35 + INK * 0.4, dots(px, cell, sh) * 0.65);
  // mid-tones: saturated print dots on lighter paper
  float mw = smoothstep(0.32, 0.5, l) * (1.0 - smoothstep(0.68, 0.88, l));
  vec3 sat = clamp(mix(vec3(l), c, 1.7), 0.0, 1.0);
  c = mix(c, mix(c * 1.05 + 0.05, sat * 0.88, dots(px + cell * 0.5, cell, 0.3)), mw * 0.4);
  // split tone: warm paper (dusk) or magenta / teal (Miles)
  c *= mix(vec3(1.04, 1.0, 0.93), mix(vec3(0.86, 0.95, 1.1), vec3(1.1, 0.9, 1.04), l), u_pal * 0.8);
  return c;
}

void main() {
  vec2 px = v_px;
  float g = 0.0;
  if (u_glitch > 0.001) {
    float tick = floor(u_time * 14.0);
    float burst = step(0.7, hash12(vec2(floor(u_time * 2.5), 3.7)));
    float band = floor(px.y / (22.0 * u_dpr));
    g = step(0.8, hash12(vec2(band, tick))) * burst * u_glitch;
    px.x += (hash12(vec2(tick, band + 7.0)) - 0.5) * 48.0 * u_dpr * g;
  }
  // Four taps give both the misregistered plates (red one way, cyan the
  // other) and a cheap gradient for the ink lines. They close in on the
  // pixel as the grade fades out, so the hand-off to the plain camera is seamless.
  float d = 1.2 * u_dpr * u_grade;
  vec3 R = cam(px + vec2(d, 0.0)), L = cam(px - vec2(d, 0.0));
  vec3 U = cam(px - vec2(0.0, d)), D = cam(px + vec2(0.0, d));
  vec3 plain = (R + L + U + D) * 0.25;
  vec3 c = mix(plain, vec3(R.r, L.g, L.b) * 0.5 + (U + D) * 0.25, u_grade);
  if (u_glitch > 0.001) {
    vec2 o = vec2((3.0 + 8.0 * g) * u_dpr, 1.2 * u_dpr);
    vec3 a = cam(px + o), b = cam(px - o);
    c = mix(c, vec3(a.r, b.g, b.b), u_glitch * 0.7);
  }
  float e = length(vec2(luma(R) - luma(L), luma(D) - luma(U)));
  vec3 gc = grade(c, px);
  gc = mix(gc, INK, smoothstep(0.09, 0.22, e / max(u_grade, 0.05)) * 0.85);
  vec3 outc = mix(c, gc, u_grade);

  if (u_bg > 0.001) {
    float m = person(px);
    float pm = smoothstep(0.3, 0.7, m);
    // (sampled outside any per-pixel branch: safe derivatives on mobile GPUs)
    vec3 bg = texture(u_city, vec2(v_px.x / u_res.x, 1.0 - v_px.y / u_res.y)).rgb;
    outc = mix(outc, mix(bg, outc, pm), u_bg);
    float rim = 1.0 - smoothstep(0.0, 0.13, abs(m - 0.5));
    outc = mix(outc, INK, rim * 0.7 * u_bg * u_grade);
  }
  // paper grain
  outc += (noise(v_px / (1.4 * u_dpr)) - 0.5) * 0.06 * u_grade;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;

const cache = { rt: null, w: 0, h: 0, hx: 9, hy: 9, pal: -1, t: -9 };

// The skyline in a screen-sized target (sample it at (x / W, 1 - y / H)).
// It only changes with parallax, palette and slow window flicker, so it is
// redrawn now and then, not every frame. look: { pal, head: {x, y} }
export function cityTexture(gfx, look) {
  if (!cache.rt) cache.rt = gfx.renderTarget(1);
  const rt = cache.rt, t = gfx.time;
  // (0.015 head ≈ 1 device px of parallax on the nearest row)
  const stale = rt.w !== cache.w || rt.h !== cache.h || Math.abs(look.pal - cache.pal) > 0.002
    || Math.abs(look.head.x - cache.hx) > 0.015 || Math.abs(look.head.y - cache.hy) > 0.015 || t - cache.t > 0.25;
  if (stale) {
    Object.assign(cache, { w: rt.w, h: rt.h, hx: look.head.x, hy: look.head.y, pal: look.pal, t });
    gfx.bindTarget(rt);
    gfx.fullscreen(gfx.program('spider-city', CITY_FRAG), { u_pal: look.pal, u_head: [look.head.x, look.head.y] });
    gfx.bindTarget(null);
  }
  return rt;
}

// look: { grade, bg, pal, glitch, head: {x, y} }
export function renderComic(gfx, look) {
  const comic = gfx.program('spider-comic', COMIC_FRAG);
  if (look.bg > 0.001) cityTexture(gfx, look);
  gfx.fullscreen(comic, {
    u_grade: look.grade,
    u_bg: look.bg,
    u_pal: look.pal,
    u_glitch: look.glitch,
    u_city: cache.rt || gfx.videoTex,
  });
}

// --- PORTAL backdrops: one per Spider-Man window version --------------------

// Classic covers: a comic building facade (concrete bays, tall warm-lit
// windows, golden light from the upper right, lilac shade lower left,
// halftone shadows, ink lines), seen from a little below, with the big web
// strands (pre-rendered canvas) strung across it.
const WALL_FRAG = COMMON + `
uniform sampler2D u_strands;  // web strands, straight alpha, row 0 = top
uniform vec2 u_head;

vec3 facade(vec2 px) {
  vec2 R = u_res;
  float S = min(R.x, R.y);
  float lw = 1.4 * u_dpr;
  float k = 1.0 + 0.2 * (1.0 - px.y / R.y);
  vec2 p = vec2((px.x - R.x * 0.5) * k + R.x * 0.5 + S * 0.07, px.y + S * 0.05) - u_head * S * 0.012;
  vec2 bay = vec2(0.25, 0.21) * S;
  vec2 ci = floor(p / bay);
  vec2 f = fract(p / bay);
  vec2 fp = f * bay;
  vec2 lp = (px - vec2(R.x, -R.y * 0.15)) / max(R.x, R.y);
  float L = smoothstep(1.35, 0.2, length(lp * vec2(1.0, 1.2)));
  vec3 wall = mix(vec3(0.33, 0.31, 0.4), vec3(0.86, 0.69, 0.45), L);
  wall *= (0.9 + 0.1 * noise(p / (45.0 * u_dpr))) * (0.94 + 0.09 * noise(p / (2.5 * u_dpr)));
  // pilaster on the left of each bay (lit right face), a ledge under the windows
  float pil = 1.0 - step(0.13, f.x);
  vec3 c = mix(wall, wall * mix(0.68, 1.22, smoothstep(0.02, 0.12, f.x)), pil);
  c = mix(c, wall * 1.2, step(0.86, f.y) * step(f.y, 0.92) * (1.0 - pil));
  c = mix(c, wall * 0.6, step(0.92, f.y) * step(f.y, 0.97) * (1.0 - pil));
  // window: warm lit rooms or dark glass, reflection streaks, mullions
  vec2 w0 = vec2(0.22, 0.14), w1 = vec2(0.9, 0.8);
  vec2 wf = (f - w0) / (w1 - w0);
  vec2 wp = wf * (w1 - w0) * bay;
  float r = hash12(ci + 3.7);
  vec3 glass = mix(vec3(1.0, 0.85, 0.5), vec3(0.97, 0.43, 0.17), wf.y);
  glass *= mix(vec3(1.0), vec3(1.0, 0.7, 0.62), step(0.72, hash12(ci + 9.1)));
  vec3 dark = mix(vec3(0.16, 0.14, 0.24), vec3(0.34, 0.31, 0.46), L * 0.6 + (1.0 - wf.y) * 0.3);
  vec3 gc = mix(dark, glass, step(0.36, r));
  float st = fract((wf.x * 0.6 - wf.y * 0.9) * 2.2 + r * 3.0);
  gc = mix(gc, gc * 1.16 + 0.07, step(0.84, st) * 0.8);
  float mul = 1.0 - step(lw * 1.1, abs(wp.x - (w1.x - w0.x) * bay.x * 0.5));
  mul = max(mul, 1.0 - step(lw * 1.1, abs(wp.y - (w1.y - w0.y) * bay.y * 0.36)));
  gc = mix(gc, vec3(0.22, 0.13, 0.1), mul);
  gc *= mix(0.68, 1.0, smoothstep(0.0, 0.14, wf.y));
  vec2 bc = (w0 + w1) * 0.5 * bay, hs = (w1 - w0) * 0.5 * bay;
  vec2 qd = abs(fp - bc) - hs;
  float sd = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0);
  c = mix(c, gc, step(sd, 0.0));
  c = mix(c, vec3(0.3, 0.19, 0.15) * (0.7 + 0.5 * L), step(-3.0 * lw, sd) * step(sd, 0.0));
  c = mix(c, INK, 1.0 - smoothstep(lw * 0.4, lw * 1.1, abs(sd)));
  c = mix(c, INK, (1.0 - smoothstep(lw * 0.4, lw * 1.1, abs(fp.x - 0.13 * bay.x))) * 0.8);
  c = mix(c, INK, (1.0 - smoothstep(lw * 0.4, lw * 1.1, abs(fp.x))) * 0.55);
  c = mix(c, INK, (1.0 - smoothstep(lw * 0.3, lw, abs(fp.y - 0.86 * bay.y))) * 0.55 * (1.0 - pil));
  c = mix(c, c * 0.55, dots(px, 6.0 * u_dpr, (1.0 - L) * 0.7 + 0.04) * 0.8);
  return c + vec3(1.0, 0.55, 0.2) * L * L * L * 0.12;
}

void main() {
  vec3 c = facade(v_px);
  vec4 s = texture(u_strands, (v_px - u_head * min(u_res.x, u_res.y) * 0.028) / u_res);
  outColor = vec4(mix(c, s.rgb, s.a), 1.0);
}
`;

// Miles: the night skyline pushed to Spider-Verse blue-violet, the red plate
// printed off-register, some rows slipped and a few glitched blocks.
const VERSE_FRAG = CITY_LIB + `
void main() {
  vec2 px = v_px;
  float row = floor(px.y / (14.0 * u_dpr));
  px.x += step(0.93, hash12(vec2(row, 2.0))) * (hash12(vec2(row, 5.0)) - 0.5) * 50.0 * u_dpr;
  // glitched blocks: a slice of the city from elsewhere, tinted cyan or magenta
  float h = hash12(floor(px / (vec2(64.0, 16.0) * u_dpr)) + 11.0);
  float blk = step(0.972, h);
  px.x += blk * (fract(h * 91.0) - 0.5) * 120.0 * u_dpr;
  vec3 b = city(px);
  vec3 c = vec3(city(px + vec2(3.0, 1.5) * u_dpr).r, b.g, b.b);
  c = c * vec3(0.8, 0.86, 1.35) + vec3(0.02, 0.0, 0.07);
  c = mix(c, c * mix(vec3(0.4, 1.3, 1.5), vec3(1.5, 0.5, 1.3), step(0.986, h)) + 0.04, blk);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// Black suit / Noir: the night skyline drained to a cold grey, fog rising
// from the street.
const NIGHT_FRAG = CITY_LIB + `
void main() {
  vec3 c = city(v_px);
  c = mix(vec3(luma(c)), c, 0.15) * vec3(0.86, 0.93, 1.08);
  c = mix(c, vec3(0.42, 0.46, 0.55), smoothstep(0.55, 1.0, v_px.y / u_res.y) * 0.35);
  outColor = vec4(c, 1.0);
}
`;

// Seeded random, so the webs hang the same way every time.
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// Rope-like strands: a soft shadow on the wall, a dark edge, a silver body
// and a white highlight. Each group is drawn as one, so its strands merge
// where they cross like real silk; later groups lie on top.
function ropes(g, list) {
  const pass = (style, k, add, dx, dy) => {
    g.strokeStyle = style;
    for (const [p, w] of list) {
      g.lineWidth = w * k + add;
      if (dx || dy) { g.save(); g.translate(w * dx, w * dy); g.stroke(p); g.restore(); } else g.stroke(p);
    }
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  pass('rgba(26,12,34,0.26)', 1.4, 0, 1.1, 1.6);
  pass('rgba(30,34,58,0.9)', 1, 2, 0, 0);
  pass('#c9cedb', 1, 0, 0, 0);
  pass('rgba(255,255,255,0.95)', 0.38, 0, -0.17, -0.22);
}

// Big tangled webs like the covers: a radial web in the upper left, a
// smaller one lower right, long sagging strands (twisted from a few fibres
// with clumps) across the whole screen.
function drawStrands(g, w, h) {
  const S = Math.min(w, h), R = rng(11);
  const radial = (hx, hy, n, rings, sc) => {
    const out = [], ang = [];
    for (let i = 0; i < n; i++) ang.push((i + (R() - 0.5) * 0.35) * Math.PI * 2 / n);
    for (const a of ang) {
      const p = new Path2D(), L = Math.max(w, h) * 1.5 * sc, j = (R() - 0.5) * 0.08;
      p.moveTo(hx, hy);
      p.quadraticCurveTo(hx + Math.cos(a + j) * L * 0.5, hy + Math.sin(a + j) * L * 0.5, hx + Math.cos(a) * L, hy + Math.sin(a) * L);
      out.push([p, S * 0.008 * sc]);
    }
    for (let k = 1; k <= rings; k++) {
      const rk = S * sc * (0.05 + 0.07 * k + 0.007 * k * k);
      const p = new Path2D();
      for (let i = 0; i < n; i++) {
        if (R() < 0.13) continue;  // torn
        const a = ang[i], b = ang[(i + 1) % n] + (i + 1 === n ? Math.PI * 2 : 0);
        const ra = rk * (1 + (R() - 0.5) * 0.12), rb = rk * (1 + (R() - 0.5) * 0.12);
        const ax = hx + Math.cos(a) * ra, ay = hy + Math.sin(a) * ra, bx = hx + Math.cos(b) * rb, by = hy + Math.sin(b) * rb;
        const mx = (ax + bx) / 2, my = (ay + by) / 2 + rk * 0.04;  // a little gravity
        p.moveTo(ax, ay);
        p.quadraticCurveTo(hx + (mx - hx) * 0.8, hy + (my - hy) * 0.8, bx, by);
      }
      out.push([p, S * sc * Math.max(0.0028, 0.0052 - k * 0.0002)]);
    }
    return out;
  };
  const strand = (x0, y0, x1, y1, sag, wd) => {
    const out = [];
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + sag * S;
    const at = (t) => {
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
    };
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nf = 2 + Math.floor(R() * 2);
    for (let f = 0; f < nf; f++) {
      const p = new Path2D(), ph = R() * 6.28, fr = 3 + R() * 4, amp = wd * (0.6 + R() * 0.9);
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, [x, y] = at(t), [x2, y2] = at(Math.min(1, t + 0.01));
        const dl = Math.hypot(x2 - x, y2 - y) || 1, nx = -(y2 - y) / dl, ny = (x2 - x) / dl;
        const o = Math.sin(t * fr * Math.PI + ph + f * 2.1) * amp;
        if (i) p.lineTo(x + nx * o, y + ny * o); else p.moveTo(x + nx * o, y + ny * o);
      }
      out.push([p, wd * (f ? 0.55 : 1)]);
    }
    for (let i = 0; i < Math.floor(len / (S * 0.45)); i++) {  // clumps
      const [x, y] = at(0.15 + R() * 0.7), p = new Path2D();
      p.ellipse(x, y, wd * 0.6, wd * 0.35, R() * 3, 0, Math.PI * 2);
      out.push([p, wd * 1.3]);
    }
    return out;
  };
  g.clearRect(0, 0, w, h);
  ropes(g, [...radial(w * 0.27, h * 0.3, 12, 10, 1), ...radial(w * 0.85, h * 0.72, 10, 6, 0.62)]);
  const long = [
    [-0.05, 0.55, 1.05, 0.3, 0.16], [0.1, -0.05, 0.95, 1.05, 0.1], [-0.05, 0.86, 0.62, -0.05, 0.12],
    [0.45, 1.05, 1.05, 0.04, 0.08], [-0.05, 0.18, 1.05, 0.8, 0.2], [0.3, -0.05, 1.05, 0.52, 0.14],
  ];
  let list = [];
  for (const [a, b, c, d, s] of long) list = list.concat(strand(a * w, b * h, c * w, d * h, s, S * (0.006 + R() * 0.004)));
  // fine loose fibres bridging the tangle
  for (let i = 0; i < 26; i++) {
    const p = new Path2D(), x = R() * w, y = R() * h, a = R() * 6.28, L = S * (0.08 + R() * 0.25);
    p.moveTo(x, y);
    p.quadraticCurveTo(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5 + L * 0.12, x + Math.cos(a) * L, y + Math.sin(a) * L);
    list.push([p, Math.max(1, S * 0.0018)]);
  }
  ropes(g, list);
}

let strands = null;  // { tex, w, h }: redrawn only when the size changes a lot
function strandTexture(gfx, w, h) {
  if (strands && Math.abs(w / strands.w - 1) < 0.15 && Math.abs(h / strands.h - 1) < 0.15) return strands.tex;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  drawStrands(c.getContext('2d'), w, h);
  strands = { tex: gfx.textureFrom(c, strands ? strands.tex : null), w, h };
  return strands.tex;
}

const BACKDROPS = { wall: WALL_FRAG, verse: VERSE_FRAG, night: NIGHT_FRAG };
const pool = [];  // two shared targets (at most 2x density): a wipe shows two versions
const broken = new Set();
const FALLBACK_LOOK = { pal: 1, head: { x: 0, y: 0 } };

// A portal backdrop in a screen-sized target (sample it at (x / W, 1 - y / H)),
// redrawn only on resize, head parallax, and (night skylines) window flicker.
// A backdrop whose shader fails on this GPU falls back to the skyline.
// kind: 'wall' | 'verse' | 'night'; look: { head: {x, y} }
export function backdropTexture(gfx, kind, look) {
  if (broken.has(kind)) { FALLBACK_LOOK.pal = kind === 'wall' ? 0 : 1; FALLBACK_LOOK.head = look.head; return cityTexture(gfx, FALLBACK_LOOK); }
  let e = null;
  for (const p of pool) if (p.kind === kind) e = p;
  if (!e) {
    if (pool.length < 2) { e = { rt: gfx.renderTarget(Math.min(1, 2 / gfx.dpr)) }; pool.push(e); }
    else e = pool[0].used <= pool[1].used ? pool[0] : pool[1];
    Object.assign(e, { kind, w: 0, h: 0, hx: 9, hy: 9, t: -9 });
  }
  const rt = e.rt, t = gfx.time;
  e.used = t;
  const stale = rt.w !== e.w || rt.h !== e.h || Math.abs(look.head.x - e.hx) > 0.015 || Math.abs(look.head.y - e.hy) > 0.015
    || (kind !== 'wall' && t - e.t > 0.5);
  if (stale) {
    Object.assign(e, { w: rt.w, h: rt.h, hx: look.head.x, hy: look.head.y, t });
    const u = { u_pal: kind === 'wall' ? 0 : 1, u_head: [look.head.x, look.head.y] };
    if (kind === 'wall') u.u_strands = strandTexture(gfx, rt.w, rt.h);
    let prog = null;
    try { prog = backdropProgram(gfx, kind); } catch (err) { broken.add(kind); console.warn('[spider] backdrop shader failed:', kind, err.message); }
    if (!prog) return backdropTexture(gfx, kind, look);
    gfx.bindTarget(rt);
    gfx.fullscreen(prog, u);
    gfx.bindTarget(null);
  }
  return rt;
}

// Compile a backdrop's shader ahead of time (switching then never hitches).
export function backdropProgram(gfx, kind) { return gfx.program('spider-bd-' + kind, BACKDROPS[kind]); }
