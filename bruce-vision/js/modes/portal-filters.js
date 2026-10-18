// portal-filters.js — the eleven window filters of PORTAL mode.
//
// Every filter is a GLSL body defining `vec3 filt(vec2 px)` (px = device
// pixels, so the window is a lens over the camera at the same spot). It is
// wrapped by COMMON (window uniforms + helpers) and MAIN (inner vignette,
// edge glow, open reveal, wipe transition, flash), then gfx.js adds PRELUDE.

export const FILTERS = [
  { id: 'dots', label: 'DOT MATRIX', short: 'DOTS', sym: '◉', color: [0.32, 0.5, 1.0] },
  { id: 'spider', label: 'SPIDER-MAN', short: 'SPIDEY', sym: '✷', color: [1.0, 0.12, 0.18] },
  { id: 'verse', label: 'SPIDER-VERSE', short: 'VERSE', sym: '✶', color: [1.0, 0.17, 0.25] },
  { id: 'thermal', label: 'THERMAL', short: 'HEAT', sym: '✹', color: [1.0, 0.5, 0.1] },
  { id: 'matrix', label: 'MATRIX', short: 'CODE', sym: '⌗', color: [0.15, 1.0, 0.45] },
  { id: 'ascii', label: 'ASCII', short: 'ASCII', sym: '▤', color: [1.0, 0.68, 0.05] },
  { id: 'neon', label: 'NEON EDGES', short: 'NEON', sym: '✦', color: null },  // hue cycles
  { id: 'xray', label: 'X-RAY', short: 'X-RAY', sym: '◎', color: [0.48, 0.85, 1.0] },
  { id: 'pixel', label: '8-BIT', short: '8-BIT', sym: '▦', color: [0.62, 0.78, 0.1] },
  { id: 'glitch', label: 'GLITCH', short: 'GLITCH', sym: '▚', color: [1.0, 0.16, 0.45] },
  { id: 'kaleido', label: 'KALEIDO', short: 'KALEI', sym: '❋', color: [0.72, 0.45, 1.0] },
];

// Frame colour of a filter at time t, as [r,g,b] 0..1. Neon cycles its hue
// in 24 steps so CSS strings (and cached glow sprites) stay bounded.
const HUES = Array.from({ length: 24 }, (_, i) => {
  const k = (n) => { const x = (n + (i / 24) * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(x, 4 - x))) * 0.8; };
  return [k(5), k(3), k(1)];
});
export function filterColor(f, t) {
  return f.color || HUES[Math.floor(((t * 0.07) % 1) * 24) % 24];
}

// --- GLSL ------------------------------------------------------------------

const COMMON = `
uniform vec2 u_quad[4];   // window corners, device px, clockwise on screen
uniform vec2 u_center;    // window centre, device px
uniform float u_span;     // window size, device px
uniform float u_alpha;    // overall opacity
uniform float u_reveal;   // open animation 0..1
uniform float u_wipe;     // filter-change wipe front 0..1 (>= 1: idle)
uniform float u_wipeDir;  // +1 top -> bottom, -1 bottom -> top
uniform float u_wipeInv;  // 1 = draw only the part not yet wiped (old filter)
uniform float u_flash;    // white flash 0..1
uniform vec3 u_tint;      // frame colour
uniform float u_open;     // background: how open the portal is
uniform vec2 u_fade;      // phantom preview: (amount, 1 = real hand on the right)
uniform float u_cell;     // halftone cell size, CSS px (smaller on phones)
uniform vec2 u_band;      // HUD-free y range (device px): the window dims outside it

// Local-contrast tone curve for the cell filters: compares a cell with its
// surroundings (4 wide taps) so a face in shadow still reads.
float tone(vec2 c, float l, float R) {
  float m = 0.25 * (luma(cam(c + vec2(-R, -R))) + luma(cam(c + vec2(R, -R)))
                  + luma(cam(c + vec2(-R, R))) + luma(cam(c + vec2(R, R))));
  return clamp(0.5 + (l - m) * 1.6 + (m - 0.45) * 0.9, 0.0, 1.0);
}

// Signed distance to the edge a->b (positive = outside a clockwise quad).
float edgeSD(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  return dot(p - a, vec2(d.y, -d.x)) / max(length(d), 1e-3);
}
float quadSD(vec2 p) {
  return max(max(edgeSD(p, u_quad[0], u_quad[1]), edgeSD(p, u_quad[1], u_quad[2])),
             max(edgeSD(p, u_quad[2], u_quad[3]), edgeSD(p, u_quad[3], u_quad[0])));
}
`;

const MAIN = `
void main() {
  vec2 px = v_px;
  float w = u_wipeDir > 0.0 ? v_local.y : 1.0 - v_local.y;
  float shown = 1.0 - smoothstep(u_wipe - 0.012, u_wipe + 0.012, w);  // u_wipe = 9 when idle
  float band = exp(-abs(w - u_wipe) * 22.0);
  if (u_wipeInv > 0.5) { shown = 1.0 - shown; band = 0.0; }
  // Glitchy row tearing right at the wipe front.
  float row = floor(v_px.y / (5.0 * u_dpr));
  px.x += (hash12(vec2(row, floor(u_time * 40.0))) - 0.5) * 70.0 * u_dpr * band * band;

  vec3 c = filt(px);

  float inner = max(-quadSD(v_px), 0.0);
  c *= mix(0.6, 1.0, smoothstep(0.0, 0.09 * u_span + 6.0 * u_dpr, inner));
  c += u_tint * exp(-inner / (4.0 * u_dpr)) * 0.55;

  // Open: a square grows from the centre with a bright rim.
  vec2 q = abs(v_local - 0.5) * 2.0;
  float r = max(q.x, q.y);
  float rr = u_reveal * 1.25;
  float rev = 1.0 - smoothstep(rr - 0.12, rr, r);
  c += u_tint * exp(-abs(r - rr + 0.06) * 26.0) * (1.0 - u_reveal) * 2.0;

  c += (u_tint * 0.9 + 0.35) * band;
  c = mix(c, vec3(1.0), u_flash);
  float a = u_alpha * rev * max(shown, band * 0.85);
  // Keep the HUD bars readable when the window reaches under them.
  float sp = 18.0 * u_dpr;
  a *= mix(0.3, 1.0, smoothstep(u_band.x - sp, u_band.x, v_px.y) * (1.0 - smoothstep(u_band.y, u_band.y + sp, v_px.y)));
  // Phantom preview: a hologram, solid at the real hand and fading toward
  // the missing one, with a few flickering data blocks at the fading front.
  float g = u_fade.y > 0.5 ? 1.0 - v_local.x : v_local.x;
  float blk = hash12(floor(v_px / (12.0 * u_dpr)) + floor(u_time * 6.0) * 0.731);
  float front = exp(-(g - 0.6) * (g - 0.6) * 12.0);
  float holo = 1.0 - smoothstep(0.05, 0.8, g);
  holo = max(holo, step(0.9, blk) * front * 0.75);
  holo *= 0.86 + 0.14 * sin(v_px.y / u_dpr * 1.4 - u_time * 9.0);
  a *= mix(1.0, holo, u_fade.x);
  outColor = vec4(c, a);
}
`;

// Outside the window: the camera, a little darker and desaturated while the
// portal is open, with the frame colour bleeding out around the edges.
const BG = `
void main() {
  vec3 c = cam(v_px);
  float d = max(quadSD(v_px), 0.0);
  float near = exp(-d / (40.0 * u_dpr));
  c = mix(c, vec3(luma(c)), 0.3 * u_open);
  c *= 1.0 - u_open * (0.26 - 0.14 * near);
  c += u_tint * near * near * 0.3 * u_open;
  outColor = vec4(c, 1.0);
}
`;

const BODIES = {
  // 1. The reference clip: an electric-blue panel; the scene as a halftone
  // of pale dots whose area follows brightness, deep navy in the shadows,
  // a fine navy outline and a soft LED glow.
  dots: `
vec3 filt(vec2 px) {
  float cs = u_cell * u_dpr;
  vec2 cell = floor(px / cs);
  vec2 cc = (cell + 0.5) * cs;
  float o = 0.25 * cs;
  float l = 0.25 * (luma(cam(cc + vec2(-o, -o))) + luma(cam(cc + vec2(o, -o)))
                  + luma(cam(cc + vec2(-o, o))) + luma(cam(cc + vec2(o, o))));
  float v = smoothstep(0.1, 0.92, tone(cc, l, 3.0 * cs));
  float d = length(px - cc);
  float rad = (0.05 + 0.39 * sqrt(v)) * cs;
  float aa = 0.8 * u_dpr;
  float dm = 1.0 - smoothstep(rad - aa, rad + aa, d);
  vec3 navy = vec3(0.015, 0.04, 0.3);
  vec3 blue = mix(vec3(0.12, 0.235, 1.0), vec3(0.17, 0.36, 1.0), v_local.x * 0.6 + v_local.y * 0.4);
  vec3 bg = mix(navy, blue, 0.28 + 0.72 * smoothstep(0.05, 0.55, v));
  float e = sobel(px, 1.5 * u_dpr);
  bg = mix(bg, vec3(0.01, 0.02, 0.15), smoothstep(0.25, 0.7, e) * 0.7);
  vec3 dc = mix(vec3(0.4, 0.64, 1.0), vec3(0.93, 0.99, 1.0), smoothstep(0.3, 0.85, v));
  dc += 0.18 * (1.0 - smoothstep(0.0, rad, d)) * v;  // hot LED core
  vec3 c = mix(bg, dc, dm);
  c += vec3(0.3, 0.55, 1.0) * exp(-max(d - rad, 0.0) / (0.14 * cs)) * v * 0.45 * (1.0 - dm);
  return c;
}`,

  // 2. You become Spider-Man: with person segmentation the body turns into
  // the suit (red shaded by the camera, blue side panels, black web lines
  // from the chest, ink outline) in front of the Spider-Verse skyline;
  // portal.js draws the mask + chest emblem on top. Until the mask arrives
  // it is a comic print of the camera.
  spider: `
uniform sampler2D u_city;  // Spider-Verse skyline, screen-sized (spider-gl.js)
uniform float u_seg;       // 0..1 person mask is live (eased)
uniform vec4 u_body;       // body centre line x, shoulder y, face width, face height (device px)
uniform float u_bodyOn;    // 0..1 a face is known (blue side panels)
uniform vec4 u_web;        // chest web centre x, y, ring spacing (device px), rotation

const vec3 RED = vec3(0.816, 0.078, 0.118);
const vec3 BLUE = vec3(0.102, 0.235, 0.784);
const vec3 INK = vec3(0.045, 0.01, 0.03);

float pmask(vec2 uv) { return u_hasMask > 0.5 ? texture(u_mask, clamp(uv, 0.0, 1.0)).r : 0.0; }

// Ben-Day dots on a 45 degree grid, cover 0..1.
float bd(vec2 px, float cell, float cover) {
  vec2 p = mat2(0.7071, 0.7071, -0.7071, 0.7071) * px / cell;
  float r = sqrt(clamp(cover, 0.0, 1.0)) * 0.64;
  return (1.0 - smoothstep(r - 0.1, r + 0.1, length(fract(p) - 0.5))) * step(0.02, cover);
}

// Suit web: 16 spokes from the chest + rings that sag toward the centre
// between spokes. Returns line coverage 0..1.
float web(vec2 px) {
  vec2 p = px - u_web.xy;
  float r = length(p), sp = u_web.z;
  float seg = 6.2831853 / 16.0;
  float f = (atan(p.y, p.x + 1e-4) - u_web.w) / seg;
  float t = fract(f);
  float lw = 0.65 * u_dpr, aa = 0.8 * u_dpr;
  // every other spoke starts further out so the centre doesn't clog
  float odd = mod(floor(f + 0.5), 2.0);
  float dS = r * sin(min(t, 1.0 - t) * seg);
  float spoke = (1.0 - smoothstep(lw, lw + aa, dS)) * smoothstep(sp * (0.45 + 0.7 * odd), sp * (0.8 + 0.9 * odd), r);
  float sag = 1.0 - 0.14 * sin(3.14159 * t);
  float k = r / (sag * sp);
  float dR = abs(fract(k + 0.5) - 0.5) * sp * sag;
  float ring = (1.0 - smoothstep(lw, lw + aa, dR)) * smoothstep(0.55, 0.8, k);
  return max(spoke, ring);
}

vec3 filt(vec2 px) {
  // 15 texture reads: 5 camera (shading, misregistered plates, ink-line
  // gradient), 9 person mask (outline, body shape), 1 skyline.
  float d = 1.6 * u_dpr;
  vec3 C = cam(px);
  vec3 R = cam(px + vec2(d, 0.0)), L = cam(px - vec2(d, 0.0));
  vec3 U = cam(px - vec2(0.0, d)), D = cam(px + vec2(0.0, d));
  float l = luma(C);
  float lb = 0.5 * l + 0.125 * (luma(R) + luma(L) + luma(U) + luma(D));
  float e = length(vec2(luma(R) - luma(L), luma(D) - luma(U)));

  // Comic print of the camera (no mask yet, or blended in as it arrives).
  vec3 pc = vec3(R.r, C.g, L.b);
  pc = clamp(mix(vec3(l), pc, 1.55) * 1.08, 0.0, 1.0);
  pc = mix(pc, floor(pc * 4.0 + 0.5) / 4.0, 0.45);
  float sh = 1.0 - smoothstep(0.12, 0.55, l);
  pc = mix(pc, pc * 0.3 + INK, bd(px, 6.0 * u_dpr, sh * 0.85) * 0.75);
  pc *= vec3(1.07, 0.95, 0.92);
  pc = mix(pc, INK, smoothstep(0.1, 0.24, e) * 0.85);
  if (u_seg < 0.002) return pc;

  // Person mask + its gradient (for a constant-width ink outline).
  vec2 uv = pxToUV(px);
  float md = 2.0 * u_dpr;
  vec2 du = vec2(md / u_vrect.z, 0.0), dv = vec2(0.0, md / u_vrect.w);
  float m = pmask(uv);
  vec2 g = vec2(pmask(uv + du) - pmask(uv - du), pmask(uv + dv) - pmask(uv - dv)) / (2.0 * md);
  float edge = abs(m - 0.5) / max(length(g), 1e-4);  // device px to the outline
  float pm = smoothstep(0.38, 0.62, m);

  // The suit: deep red shaded by the camera (folds keep their 3D), blue
  // side panels away from the body centre line, a little sheen.
  float s = smoothstep(0.03, 0.88, lb);
  s = mix(s, floor(s * 4.0 + 0.5) / 4.0, 0.3);
  float side = abs(px.x - u_body.x) / max(u_body.z, 1.0);
  float blue = smoothstep(1.1, 1.35, side) * smoothstep(u_body.y, u_body.y + 0.35 * u_body.w, px.y) * u_bodyOn;
  vec3 base = mix(RED, BLUE, blue);
  vec3 su = base * (0.28 + 0.95 * s);
  su += mix(vec3(1.0, 0.55, 0.5), vec3(0.6, 0.75, 1.0), blue) * smoothstep(0.75, 1.0, l) * 0.14;
  su = mix(su, su * 0.45, bd(px, 5.0 * u_dpr, (1.0 - s) * 0.7) * 0.7);
  su = mix(su, INK, smoothstep(0.12, 0.3, e) * 0.55);

  // Body shape from 4 wide mask taps: limbs and torso round off toward the
  // silhouette, dark on the far side, a warm rim from the skyline's sun.
  float rr = 0.22 * u_body.z;
  float aE = pmask(pxToUV(px + vec2(rr, 0.0))), aW = pmask(pxToUV(px - vec2(rr, 0.0)));
  float aN = pmask(pxToUV(px - vec2(0.0, rr))), aS = pmask(pxToUV(px + vec2(0.0, rr)));
  vec2 ov = vec2(aW - aE, aN - aS);  // points out of the body
  float rim = 1.0 - smoothstep(0.55, 0.98, 0.25 * (aE + aW + aN + aS));
  float lit = dot(ov, normalize(vec2(0.77, 0.27) * u_res - px)) / max(length(ov), 0.08);
  su *= 1.0 - rim * 0.5 * (1.0 - max(lit, 0.0));
  su += vec3(1.0, 0.58, 0.32) * rim * smoothstep(0.15, 0.8, lit) * 0.6;

  // Web lines (black, red parts only) with a raised-thread highlight.
  float w0 = web(px), w1 = web(px + vec2(0.9, 1.2) * u_dpr);
  su += vec3(1.0, 0.6, 0.55) * max(w1 - w0, 0.0) * 0.3 * (1.0 - blue);
  su = mix(su, INK, w0 * (1.0 - blue) * 0.92);
  // Black seam where the red meets the blue.
  float bs = abs(blue - 0.5) / max(fwidth(blue), 1e-4);
  su = mix(su, INK, (1.0 - smoothstep(0.7 * u_dpr, 1.5 * u_dpr, bs)) * 0.9);

  vec3 city = texture(u_city, vec2(px.x / u_res.x, 1.0 - px.y / u_res.y)).rgb;
  vec3 c = mix(city, su, pm);
  c = mix(c, INK, (1.0 - smoothstep(1.3 * u_dpr, 2.3 * u_dpr, edge)) * step(0.02, length(g) * md) * 0.95);
  return mix(pc, c, u_seg);
}`,

  // 3. Spider-Verse comic: posterized, CMY halftone in shadows, ink lines,
  // red/cyan misregistration and the odd glitch frame.
  verse: `
float ht(vec2 px, float ang, float cs, float amt) {
  float s = sin(ang), c = cos(ang);
  vec2 p = vec2(c * px.x - s * px.y, s * px.x + c * px.y) / cs;
  float r = sqrt(clamp(amt, 0.0, 1.0)) * 0.62;
  return 1.0 - smoothstep(r - 0.08, r + 0.08, length(fract(p) - 0.5));
}
vec3 filt(vec2 px) {
  float slot = floor(u_time * 7.0);
  float gl = step(0.9, hash12(vec2(slot, 4.7)));
  float bandY = floor(px.y / (22.0 * u_dpr));
  px.x += gl * step(0.55, hash12(vec2(bandY, slot))) * (hash12(vec2(slot, bandY)) - 0.5) * 60.0 * u_dpr;
  float mis = (3.0 + gl * 8.0) * u_dpr;
  vec3 base = cam(px);
  vec3 col = vec3(cam(px + vec2(mis, mis * 0.5)).r, base.g, cam(px - vec2(mis, mis * 0.5)).b);
  float l = luma(base);
  col = clamp(mix(vec3(l), col, 1.8) * 1.15, 0.0, 1.0);
  col = floor(col * 3.0 + 0.45) / 3.0;
  // Shadows: magenta + cyan Ben-Day dots on a deep purple ink.
  float sh = 1.0 - smoothstep(0.1, 0.48, l);
  float cs = 7.0 * u_dpr;
  float mD = ht(px, 1.31, cs, sh * 0.5);
  float cD = ht(px + 0.5 * cs, 0.26, cs, sh * 0.32);
  col = mix(col, vec3(0.2, 0.03, 0.32), sh * 0.85);
  col = mix(col, vec3(1.0, 0.12, 0.55), mD * sh);
  col = mix(col, vec3(0.0, 0.72, 1.0), cD * (1.0 - mD) * sh * 0.85);
  // Midtone hatching.
  float mid = smoothstep(0.28, 0.42, l) * (1.0 - smoothstep(0.5, 0.64, l));
  col *= 1.0 - step(0.66, fract((px.x + px.y) / (5.0 * u_dpr))) * mid * 0.4;
  // Thick ink outlines.
  float e = sobel(px, 2.2 * u_dpr);
  col *= 1.0 - smoothstep(0.28, 0.55, e);
  return col;
}`,

  // 4. Heat camera palette from blurred luminance (+ a little skin warmth).
  thermal: `
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0) * 6.0;
  vec3 c = mix(vec3(0.0, 0.0, 0.03), vec3(0.13, 0.02, 0.45), clamp(t, 0.0, 1.0));
  c = mix(c, vec3(0.52, 0.04, 0.62), clamp(t - 1.0, 0.0, 1.0));
  c = mix(c, vec3(0.93, 0.1, 0.22), clamp(t - 2.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.5, 0.02), clamp(t - 3.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.9, 0.12), clamp(t - 4.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 1.0, 0.94), clamp(t - 5.0, 0.0, 1.0));
  return c;
}
vec3 filt(vec2 px) {
  float s1 = 3.0 * u_dpr, s2 = 7.0 * u_dpr;
  vec3 b = cam(px) * 0.2;
  b += (cam(px + vec2(s1, 0.0)) + cam(px - vec2(s1, 0.0)) + cam(px + vec2(0.0, s1)) + cam(px - vec2(0.0, s1))) * 0.12;
  b += (cam(px + vec2(s2, s2)) + cam(px - vec2(s2, s2)) + cam(px + vec2(s2, -s2)) + cam(px + vec2(-s2, s2))) * 0.08;
  float warm = clamp((b.r - b.b) * 2.2, 0.0, 0.45) * smoothstep(0.12, 0.35, b.r);
  float h = luma(b) * 0.8 + warm * 0.7;
  h += (noise(px / (40.0 * u_dpr) + vec2(0.0, u_time * 0.5)) - 0.5) * 0.08;
  h += (hash12(px + fract(u_time) * 311.0) - 0.5) * 0.035;
  vec3 col = heat(smoothstep(0.04, 0.95, h));
  return col * (0.93 + 0.07 * sin(px.y * 2.1 / u_dpr));
}`,

  // 5. Green code rain: luminance x falling streaks, bright leading glyphs.
  matrix: `
uniform sampler2D u_glyphs;  // 8x8 glyph atlas, 32 px per glyph
vec3 filt(vec2 px) {
  vec2 cs = vec2(12.0, 16.0) * (u_cell / 10.0) * u_dpr;
  vec2 cell = floor(px / cs);
  vec2 f = fract(px / cs);
  vec2 cc = (cell + 0.5) * cs;
  float l = smoothstep(0.15, 0.85, tone(cc, luma(cam(cc)), 2.5 * cs.y));
  float ch = hash12(vec2(cell.x, 11.0));
  float speed = 5.0 + ch * 13.0;
  float rows = u_res.y / cs.y + 24.0;
  float trail = 0.0, head = 0.0;
  for (int k = 0; k < 3; k++) {
    float off = hash12(vec2(cell.x, float(k) * 7.0 + 1.0)) * rows;
    float d = mod(u_time * speed * (1.0 + float(k) * 0.3) + off, rows) - cell.y;
    if (d >= 0.0) {
      trail = max(trail, exp(-d / (7.0 + ch * 12.0)));
      head = max(head, 1.0 - smoothstep(0.0, 1.2, d));
    }
  }
  float rate = 1.5 + hash12(cell) * 7.0;
  float g = floor(hash12(cell + floor(u_time * rate + hash12(cell.yx) * 9.0) * 0.137) * 64.0);
  vec2 guv = (vec2(mod(g, 8.0), floor(g / 8.0)) + f) / 8.0;
  float lod = max(0.0, log2(32.0 / cs.y * 1.25));
  float gl = textureLod(u_glyphs, guv, lod).r;
  gl += textureLod(u_glyphs, guv, lod + 2.0).r * 0.45;  // blurry mip = cheap glyph glow
  float b = gl * (0.4 + trail * 0.85) * (0.03 + 1.25 * pow(l, 1.4));
  vec3 col = vec3(0.1, 1.0, 0.42) * b + vec3(0.8, 1.0, 0.88) * gl * head * (0.25 + 0.75 * l);
  return col + vec3(0.01, 0.2, 0.07) * l * l;
}`,

  // 6. Terminal ASCII art (amber phosphor).
  ascii: `
uniform sampler2D u_ascii;  // ramp " .:-=+*#%@", 10 glyphs in a row
vec3 filt(vec2 px) {
  vec2 cs = vec2(8.0, 12.0) * (0.5 + 0.5 * u_cell / 10.0) * u_dpr;
  vec2 cell = floor(px / cs);
  vec2 f = fract(px / cs);
  vec2 cc = (cell + 0.5) * cs;
  float l = 0.5 * (luma(cam(cc - vec2(0.0, cs.y * 0.25))) + luma(cam(cc + vec2(0.0, cs.y * 0.25))));
  l = smoothstep(0.1, 0.9, tone(cc, l, 2.0 * cs.y));
  float idx = min(floor(l * 10.0), 9.0);
  float g = textureLod(u_ascii, vec2((idx + f.x) / 10.0, f.y), max(0.0, log2(48.0 / cs.y))).r;
  vec3 col = vec3(1.0, 0.66, 0.08) * g * (0.45 + 0.8 * l) + vec3(1.0, 0.93, 0.72) * g * smoothstep(0.75, 1.0, l) * 0.5;
  col += vec3(0.07, 0.03, 0.0);
  return col * (0.84 + 0.16 * step(0.5, fract(px.y / (2.0 * u_dpr))));
}`,

  // 7. Glowing sobel edges with a travelling hue on black.
  neon: `
vec3 filt(vec2 px) {
  float e1 = sobel(px, 1.5 * u_dpr);
  float e2 = sobel(px, 4.5 * u_dpr);
  float hue = fract(u_time * 0.07 + (px.x * 0.6 + px.y) / max(u_res.x, u_res.y) * 0.9);
  vec3 nc = hsv2rgb(vec3(hue, 0.8, 1.0));
  vec3 col = nc * (smoothstep(0.14, 0.5, e1) * 1.3 + smoothstep(0.05, 1.0, e2) * 0.6);
  col += vec3(1.0) * smoothstep(0.5, 1.1, e1) * 0.7;
  vec2 gp = fract(px / (26.0 * u_dpr));
  col += nc * min(step(gp.x, 0.045) + step(gp.y, 0.045), 1.0) * 0.07;
  return col;
}`,

  // 8. Inverted cool-blue, hard contrast, scanlines, noise and a scan bar.
  xray: `
vec3 filt(vec2 px) {
  float l = luma(cam(px));
  float e = sobel(px, 1.5 * u_dpr);
  float v = pow(1.0 - smoothstep(0.08, 0.9, l), 1.5);
  vec3 col = mix(vec3(0.0, 0.03, 0.08), vec3(0.62, 0.9, 1.0), v);
  col += vec3(0.5, 0.85, 1.0) * smoothstep(0.15, 0.6, e) * 0.45;
  col *= 0.86 + 0.14 * sin(px.y * 3.14159 / (2.0 * u_dpr));
  col += vec3(0.4, 0.8, 1.0) * exp(-abs(v_local.y - fract(u_time * 0.3)) * 35.0) * 0.25;
  return col + (hash12(px + fract(u_time * 7.0) * 517.0) - 0.5) * 0.09;
}`,

  // 9. Game Boy: chunky pixels, 4 greens, Bayer ordered dither, LCD grid.
  pixel: `
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 filt(vec2 px) {
  float bs = 6.0 * u_dpr;
  vec2 b = floor(px / bs);
  vec2 bc = (b + 0.5) * bs;
  float o = bs * 0.3;
  float l = luma(cam(bc)) * 0.5 + 0.125 * (luma(cam(bc + vec2(o, 0.0))) + luma(cam(bc - vec2(o, 0.0)))
                                         + luma(cam(bc + vec2(0.0, o))) + luma(cam(bc - vec2(0.0, o))));
  l = smoothstep(0.08, 0.92, tone(bc, l, 4.0 * bs));
  float lv = clamp(floor(l * 3.0 + 0.5 + (bayer4(b) - 0.5) * 0.9), 0.0, 3.0);
  vec3 col = lv < 0.5 ? vec3(0.059, 0.22, 0.059) : lv < 1.5 ? vec3(0.19, 0.384, 0.19)
           : lv < 2.5 ? vec3(0.545, 0.675, 0.059) : vec3(0.79, 0.86, 0.5);
  vec2 g = fract(px / bs);
  return col * (0.8 + 0.2 * step(0.13, min(g.x, g.y)));
}`,

  // 10. Datamosh: RGB split, slice displacement, block corruption, bursts.
  glitch: `
vec3 filt(vec2 px) {
  float t = u_time;
  float burst = smoothstep(0.55, 0.8, noise(vec2(t * 2.3, 9.1)));
  float tick = floor(t * 14.0);
  float slice = floor(px.y / (mix(6.0, 34.0, hash12(vec2(tick, 2.0))) * u_dpr));
  float on = step(0.8 - burst * 0.45, hash12(vec2(slice, tick)));
  px.x += on * (hash12(vec2(tick, slice)) - 0.5) * (16.0 + 110.0 * burst) * u_dpr;
  float sp = (3.0 + 12.0 * burst) * u_dpr;
  vec3 col = vec3(cam(px + vec2(sp, 0.0)).r, cam(px).g, cam(px - vec2(sp, 0.0)).b);
  float bn = hash12(floor(px / (vec2(52.0, 18.0) * u_dpr)) + vec2(tick * 1.7, tick));
  if (bn > 0.975 - burst * 0.1) col = vec3(1.0) - col.gbr;
  else if (bn > 0.955 - burst * 0.1) col = floor(col * 2.0 + 0.5) * 0.5 * vec3(0.3, 1.0, 1.0);
  col += step(0.988, hash12(vec2(floor(px.y / (2.0 * u_dpr)), floor(t * 50.0)))) * 0.5;
  col = (col - 0.5) * 1.2 + 0.5;
  return clamp(col * (0.9 + 0.1 * sin(px.y / u_dpr * 1.7)), 0.0, 1.0);
}`,

  // 11. Eight mirrored wedges around the window centre, slowly turning.
  kaleido: `
vec3 filt(vec2 px) {
  vec2 p = px - u_center;
  float r = length(p);
  float seg = 6.2831853 / 8.0;
  float a0 = mod(atan(p.y, p.x + 1e-3) + u_time * 0.25, seg);  // no atan(0, 0)
  float a = abs(a0 - 0.5 * seg) - u_time * 0.12;
  float zr = r * (0.85 + 0.12 * sin(u_time * 0.6)) + 6.0 * u_dpr;
  vec3 col = cam(u_center + vec2(cos(a), sin(a)) * zr);
  col = clamp(mix(vec3(luma(col)), col, 1.5), 0.0, 1.0);
  col *= 0.8 + 0.35 * hsv2rgb(vec3(fract(r / (u_span + 1.0) * 0.7 - u_time * 0.05), 0.55, 1.0));
  float seam = min(a0, seg - a0) * r;
  col += exp(-seam / (1.5 * u_dpr)) * 0.18;
  return col;
}`,
};

const FALLBACK = 'vec3 filt(vec2 px) { return cam(px) * vec3(0.6, 0.85, 1.2); }';

// Compiled program for a filter id (cached by gfx). A shader that fails to
// compile on some GPU falls back to a tinted camera instead of breaking.
const broken = new Set();
export function filterProgram(gfx, id) {
  if (!broken.has(id)) {
    try { return gfx.program('portal-' + id, COMMON + (BODIES[id] || FALLBACK) + MAIN); } catch (e) {
      broken.add(id);
      console.warn('[portal] filter shader failed, using fallback:', id, e.message);
    }
  }
  return gfx.program('portal-fallback', COMMON + FALLBACK + MAIN);
}

export function bgProgram(gfx) { return gfx.program('portal-bg', COMMON + BG); }

// --- glyph atlases (built once) -------------------------------------------

function mipTexture(gfx, canvas) {
  const gl = gfx.gl;
  const tex = gfx.textureFrom(canvas);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  return tex;
}

const KATAKANA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
const MATRIX_CHARS = KATAKANA + '0123456789Z=*+<>:¦|';  // 64 glyphs
const ASCII_RAMP = ' .:-=+*#%@';

export function buildAtlases(gfx) {
  // Matrix: 8x8 grid of 32 px glyphs, katakana mirrored like the film.
  const G = 32;
  const m = document.createElement('canvas');
  m.width = m.height = G * 8;
  let g = m.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, m.width, m.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(G * 0.78)}px "IPAGothic", "Hiragino Kaku Gothic ProN", "Yu Gothic", "MS Gothic", "Noto Sans CJK JP", "Noto Sans JP", monospace`;
  [...MATRIX_CHARS].slice(0, 64).forEach((ch, i) => {
    g.save();
    g.translate((i % 8) * G + G / 2, Math.floor(i / 8) * G + G / 2 + 1);
    if (i < KATAKANA.length) g.scale(-1, 1);
    g.fillText(ch, 0, 0);
    g.restore();
  });

  // ASCII: 10 glyphs of 32x48 px in a row.
  const a = document.createElement('canvas');
  a.width = 32 * 10; a.height = 48;
  g = a.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, a.width, a.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 40px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace';
  [...ASCII_RAMP].forEach((ch, i) => g.fillText(ch, i * 32 + 16, 26));

  return { glyphs: mipTexture(gfx, m), ascii: mipTexture(gfx, a) };
}
