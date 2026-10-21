// portal-filters.js — the window filters of PORTAL mode.
//
// Every filter is a GLSL body defining `vec3 filt(vec2 px)` (px = device
// pixels, so the window is a lens over the camera at the same spot). It is
// wrapped by COMMON (window uniforms + helpers) and MAIN (inner vignette,
// edge glow, open reveal, wipe transition, flash), then gfx.js adds PRELUDE.
// The Spider-Man versions share one suit shader; SUITS holds what differs.

export const FILTERS = [
  { id: 'dots', label: 'DOT MATRIX', short: 'DOTS', sym: '◉', color: [0.32, 0.5, 1.0] },
  { id: 'spider', label: 'SPIDER-MAN', short: 'SPIDEY', sym: '✷', color: [1.0, 0.12, 0.18] },
  { id: 'miles', label: 'MILES MORALES', short: 'MILES', sym: '✸', color: [1.0, 0.1, 0.34] },
  { id: 'symbiote', label: 'BLACK SUIT', short: 'BLACK', sym: '✱', color: [0.6, 0.7, 1.0] },
  { id: 'noir', label: 'SPIDER-NOIR', short: 'NOIR', sym: '◐', color: [0.86, 0.86, 0.84] },
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

// The Spider-Man versions: suit shader uniforms (tones are shadow, mid,
// light, highlight), backdrop (spider-gl.js), emblem (atlas channel; centre
// in face heights below the chin, size in face widths), chest web ring
// spacing (face widths), mask style (spider-mask.js), cover masthead and
// THWIP colours (portal.js).
const tones = (a) => new Float32Array(a.flat());
export const SUITS = {
  spider: {
    bg: 'wall', chan: [1, 0, 0], embAt: 0.8, embSize: 0.62, webSp: 0.17,
    pA: tones([[0.34, 0.015, 0.045], [0.78, 0.06, 0.1], [1.0, 0.2, 0.15], [1.0, 0.72, 0.64]]),
    pB: tones([[0.025, 0.04, 0.11], [0.07, 0.11, 0.29], [0.15, 0.24, 0.56], [0.52, 0.66, 1.0]]),
    pE: tones([[0.03, 0.01, 0.02], [0.04, 0.01, 0.025], [0.06, 0.02, 0.04], [0.3, 0.24, 0.3]]),
    web: [0.04, 0.01, 0.02, 0.95], look: [0, 0, 0.5, 0], fx: [0.8, 0, 0, 1.3],
    mask: { miles: 0, comic: 1, ink: 1.7 },
    title: { top: 'THE AMAZING', main: 'SPIDER-MAN', fill: '#ffffff', topFill: '#ffe23a', shade: '#1b2a6b' },
    pop: ['#ffffff', '#e62429'],
  },
  miles: {
    bg: 'verse', chan: [0, 1, 0], embAt: 0.95, embSize: 1.45, webSp: 0.19,
    pA: tones([[0.012, 0.012, 0.02], [0.05, 0.055, 0.08], [0.13, 0.16, 0.25], [0.45, 0.6, 0.9]]),
    pB: tones([[0.42, 0.02, 0.05], [0.85, 0.06, 0.1], [1.0, 0.25, 0.25], [1.0, 0.75, 0.7]]),
    pE: tones([[0.62, 0.03, 0.06], [0.93, 0.07, 0.1], [1.0, 0.32, 0.27], [1.0, 0.8, 0.74]]),
    web: [0.5, 0.04, 0.08, 0.85], look: [1, 1, 0.7, 0], fx: [0, 0.8, 1, 1.3],
    mask: { miles: 1, comic: 1, ink: 1.4, kind: 'miles' },
    title: { top: 'SPIDER-MAN', main: 'MILES MORALES', fill: '#ff2a3d', topFill: '#ffffff', ghost: true },
    pop: ['#ff2a3d', '#00d8ff'],
  },
  symbiote: {
    bg: 'night', chan: [0, 0, 1], embAt: 1.0, embSize: 3.3, webSp: 0.3,
    pA: tones([[0.005, 0.005, 0.01], [0.035, 0.04, 0.06], [0.13, 0.15, 0.23], [0.6, 0.68, 0.88]]),
    pB: tones([[0.005, 0.005, 0.01], [0.035, 0.04, 0.06], [0.13, 0.15, 0.23], [0.6, 0.68, 0.88]]),
    pE: tones([[0.52, 0.57, 0.68], [0.86, 0.88, 0.94], [1.0, 1.0, 1.0], [1.0, 1.0, 1.0]]),
    web: [0, 0, 0, 0], look: [2, 2, 1, 0.3], fx: [0, 0, 0, 1.3],
    mask: { miles: 0, comic: 0.5, kind: 'symbiote' },
    title: { top: 'THE SENSATIONAL', main: 'SPIDER-MAN', fill: '#f4f6fb', topFill: '#9fb4ff', shade: '#2a3350' },
    pop: ['#ffffff', '#2b3a80'],
  },
  noir: {
    bg: 'night', chan: [0, 0, 0], embAt: 0.8, embSize: 1, webSp: 0.3,
    pA: tones([[0.03, 0.03, 0.03], [0.17, 0.17, 0.17], [0.42, 0.42, 0.42], [0.92, 0.92, 0.92]]),
    pB: tones([[0.03, 0.03, 0.03], [0.17, 0.17, 0.17], [0.42, 0.42, 0.42], [0.92, 0.92, 0.92]]),
    pE: tones([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
    web: [0, 0, 0, 0], look: [2, 3, 0.4, 0.8], fx: [0.9, 0, 0, 1.5],
    mask: { miles: 0, comic: 0, kind: 'noir' },
    title: { top: 'SPIDER-MAN', main: 'NOIR', fill: '#f2f0ea', topFill: '#cfcac0', shade: '#3a3a3a', serif: true },
    pop: ['#f2f0ea', '#3a3a3a'],
  },
};

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

// 2-5. The Spider-Man versions, one shader driven by SUITS. With person
// segmentation whoever is in the window wears the suit: cel shaded in three
// hard tones (the silhouette rounds the body off, the camera adds folds),
// glossy highlights, hatching / Ben-Day dots in the shadows, web lines from
// the chest and the face, panels, emblem, gloves and an ink outline, in
// front of the version's backdrop; portal.js draws the mask + masthead.
// Until the mask arrives it is a comic print of the camera.
const SUIT = `
uniform sampler2D u_city;  // this version's backdrop, screen-sized (spider-gl.js)
uniform sampler2D u_emb;   // emblem atlas: r classic, g Miles, b black suit
uniform sampler2D u_lumS;  // camera light blurred ~6 px and ~24 px (lightTargets)
uniform sampler2D u_lumL;
uniform float u_seg;       // 0..1 person mask is live (eased)
uniform vec4 u_body;       // body centre line x, shoulder y, face width, face height (device px)
uniform float u_bodyOn;    // 0..1 a face is known (panels, emblem, head web)
uniform vec4 u_web;        // chest web centre x, y, ring spacing (device px), rotation
uniform vec4 u_face;       // head web centre x, y (nose bridge), ring spacing, head tilt
uniform vec4 u_head;       // head ellipse centre x, y, radii x, y (device px)
uniform vec4 u_glove;      // two hands: middle knuckle x, y (device px) ...
uniform vec2 u_gloveR;     // ... and glove radius (0 = no hand)
uniform vec4 u_embXf;      // emblem centre x, y, atlas size (device px), rotation
uniform vec3 u_embSel;     // the version's atlas channel
uniform vec3 u_pA[4];      // suit tones: shadow, mid, light, highlight
uniform vec3 u_pB[4];      // panel tones (navy sides, Miles' red shoulders)
uniform vec3 u_pE[4];      // emblem tones
uniform vec4 u_webC;       // web line colour, amount (0 = no web)
uniform vec4 u_look;       // panels (0 sides, 1 shoulders, 2 none), look (0 wall, 1 verse, 2 night, 3 noir), gloss, rain
uniform vec4 u_fx;         // shadow hatching, shadow dots, gloves in the panel colour, ink outline (CSS px)

const vec3 INK = vec3(0.03, 0.01, 0.025);

float pmask(vec2 uv) { return u_hasMask > 0.5 ? texture(u_mask, clamp(uv, 0.0, 1.0)).r : 0.0; }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Ben-Day dots on a 45 degree grid, cover 0..1.
float bd(vec2 px, float cell, float cover) {
  vec2 p = mat2(0.7071, 0.7071, -0.7071, 0.7071) * px / cell;
  float r = sqrt(clamp(cover, 0.0, 1.0)) * 0.64;
  return (1.0 - smoothstep(r - 0.1, r + 0.1, length(fract(p) - 0.5))) * step(0.02, cover);
}

// Diagonal ink hatching (coverage); period and half width in device px.
float hatch(vec2 p, float period, float w) {
  float d = abs(fract((p.x + p.y) * 0.7071 / period) - 0.5) * period;
  return 1.0 - smoothstep(w, w + 0.8 * u_dpr, d);
}

// Suit web around c: n0 spokes at the centre, doubling outward at rings
// k0, 3 k0, 6 k0, 12 k0 so the cells stay square, and rings that sag toward
// the centre between spokes. Line coverage 0..1.
float web(vec2 px, vec2 c, float sp, float rot, float n0, float k0, float lw) {
  vec2 p = px - c;
  float r = length(p), k = r / sp;
  float n = n0 * exp2(step(k0, k) + step(3.0 * k0, k) + step(6.0 * k0, k) + step(12.0 * k0, k));
  float seg = 6.2831853 / n;
  float t = fract((atan(p.y, p.x + 1e-4) - rot) / seg);
  float aa = 0.8 * u_dpr;
  float dS = r * sin(min(t, 1.0 - t) * seg);
  float spoke = (1.0 - smoothstep(lw, lw + aa, dS)) * smoothstep(0.25 * sp, 0.6 * sp, r);
  float rr = r + 0.3 * sin(3.14159 * t) * min(r * seg, sp);
  float dR = abs(fract(rr / sp + 0.5) - 0.5) * sp;
  float ring = (1.0 - smoothstep(lw, lw + aa, dR)) * smoothstep(0.5, 0.8, k);
  return max(spoke, ring);
}

// Slanted rain streaks (coverage).
float rain(vec2 px) {
  vec2 p = px / u_dpr;
  p.x += p.y * 0.22;
  float col = floor(p.x / 6.0), h = hash12(vec2(col, 3.1));
  float y = p.y / (40.0 + 30.0 * h) - u_time * (6.0 + 4.0 * h) + h * 17.0;
  float s = fract(y);
  float x = abs(fract(p.x / 6.0) - 0.5) * 6.0;
  return step(0.86, hash12(vec2(col, floor(y)))) * smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.25, 0.5, s)) * (1.0 - smoothstep(0.25, 0.8, x));
}

// The suited person over the backdrop. C, l, e: camera colour, luma and
// luma gradient at px.
vec3 suit(vec2 px, vec3 C, float l, float e) {
  // Person mask + its gradient (for a constant-width ink outline). The mask
  // is bilinear-smooth, so its screen derivatives are a good gradient.
  float m = pmask(pxToUV(px));
  vec2 g = vec2(dFdx(m), dFdy(m));
  float edge = abs(m - 0.5) / max(length(g), 1e-4);  // device px to the outline
  float pm = smoothstep(0.38, 0.62, m);

  // Body form from 4 wide mask taps: the outward normal near the silhouette.
  float fw = max(u_body.z, 1.0), fh = max(u_body.w, 1.0);
  float rr = 0.2 * fw;
  float aE = pmask(pxToUV(px + vec2(rr, 0.0))), aW = pmask(pxToUV(px - vec2(rr, 0.0)));
  float aN = pmask(pxToUV(px - vec2(0.0, rr))), aS = pmask(pxToUV(px + vec2(0.0, rr)));
  vec2 ov = vec2(aW - aE, aN - aS);
  vec2 on = ov / max(length(ov), 1e-3) * smoothstep(0.1, 0.5, length(ov));
  float ax = abs(px.x - u_body.x);
  float head = step(0.5, u_bodyOn) * step(length(rot2(-u_face.w) * (px - u_head.xy) / u_head.zw), 1.0);
  // Gloves: skin-coloured pixels around a tracked hand.
  float glove = max((1.0 - smoothstep(0.75, 1.0, length(px - u_glove.xy) / max(u_gloveR.x, 1.0))) * step(1.0, u_gloveR.x),
                    (1.0 - smoothstep(0.75, 1.0, length(px - u_glove.zw) / max(u_gloveR.y, 1.0))) * step(1.0, u_gloveR.y));
  glove *= smoothstep(0.02, 0.07, C.r - C.g) * smoothstep(0.05, 0.12, C.r - C.b) * smoothstep(0.12, 0.25, l);

  // Panels with a black seam.
  float panel = 0.0, seam = 0.0;
  if (u_look.x < 0.5) {
    // Classic: navy torso sides past ~1.2 face widths from the centre line,
    // below the shoulders with a rounded armpit, and the underside of the arms.
    float ar = 0.45 * fw;
    vec2 pq = vec2(ax - 1.22 * fw, px.y - u_body.y - 0.3 * fh);
    float pd = min(min(pq.x, pq.y), ar - length(max(vec2(ar) - pq, 0.0)));
    float side = smoothstep(-0.8 * u_dpr, 0.8 * u_dpr, pd);
    float uf = on.y - 0.45, arm = step(0.8 * fw, ax);
    panel = max(side, smoothstep(-0.03, 0.03, uf) * arm);
    seam = max(1.0 - smoothstep(0.7 * u_dpr, 1.5 * u_dpr, abs(pd)),
               (1.0 - smoothstep(0.8, 1.6, abs(uf) / max(fwidth(uf), 1e-4))) * arm * (1.0 - side));
  } else if (u_look.x < 1.5) {
    // Miles: red caps where the silhouette faces up (shoulders, the top of
    // the arms), out from the neck, around shoulder height.
    float tf = -on.y - 0.35;
    float reach = smoothstep(0.5 * fw, 0.6 * fw, ax) * (1.0 - smoothstep(2.6 * fw, 2.9 * fw, ax));
    panel = smoothstep(-0.03, 0.03, tf) * reach * (1.0 - smoothstep(0.9 * fh, 1.3 * fh, abs(px.y - u_body.y)));
  }
  panel *= u_bodyOn * (1.0 - head);
  seam *= u_bodyOn * (1.0 - head) * (1.0 - glove);
  // Gloves: the hands keep the suit colour (classic) or wear the panel's (Miles).
  panel = mix(panel * (1.0 - glove), max(panel, glove), u_fx.z);

  // Cel shading, key light from the upper right: three hard tones from the
  // silhouette's form plus the local light, and glossy gleams (noise
  // stretched along the form) on the lit rim and the brightest spots.
  float key = dot(on, vec2(0.6, -0.8));
  vec2 buv = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y);
  float Ls = texture(u_lumS, buv).r, Ll = texture(u_lumL, buv).r;
  float shd = clamp(0.5 + 0.36 * key + clamp((Ls - Ll) * 2.4, -0.4, 0.4) + (Ll - 0.5) * 0.25, 0.0, 1.0);
  float aw = fwidth(shd) * 0.75 + 0.012;
  float tA = smoothstep(0.38 - aw, 0.38 + aw, shd);
  float tB = smoothstep(0.66 - aw, 0.66 + aw, shd);
  vec2 nd = ov / max(length(ov), 1e-3), gp = px - u_web.xy;
  float gR = noise(vec2(dot(gp, vec2(-nd.y, nd.x)) / (0.2 * fw), dot(gp, nd) / (0.05 * fw)))
           + 0.3 * smoothstep(0.6, 0.95, key) + 0.05 * u_look.z;
  float gS = noise(mat2(0.8, 0.6, -0.6, 0.8) * gp / (vec2(0.3, 0.07) * fw)) * 0.4 + shd * 0.9 + 0.05 * u_look.z;
  float gw = fwidth(gR) + 0.01, sw = fwidth(gS) + 0.01;
  float tS = max(smoothstep(0.95 - gw, 0.95 + gw, gR) * smoothstep(0.5, 0.65, key),
                 smoothstep(1.0 - sw, 1.0 + sw, gS)) * tA;
  vec3 cA = mix(mix(u_pA[0], u_pA[1], tA), u_pA[2], tB);
  vec3 cB = mix(mix(u_pB[0], u_pB[1], tA), u_pB[2], tB);
  vec3 su = mix(mix(cA, cB, panel), mix(u_pA[3], u_pB[3], panel), tS);
  // Shadows: hatching, cross-hatched in the deepest; or Ben-Day dots.
  float dk = 1.0 - tA;
  float hc = max(hatch(px, 4.0 * u_dpr, 0.4 * u_dpr) * dk, hatch(vec2(px.x, -px.y), 4.0 * u_dpr, 0.4 * u_dpr) * (1.0 - smoothstep(0.12, 0.24, shd)));
  su = mix(su, su * 0.3, hc * u_fx.x);
  su = mix(su, su * 0.4, bd(px, 5.0 * u_dpr, dk * 0.65 + (1.0 - tB) * 0.12) * u_fx.y);

  // Web lines: from the nose bridge on the head, from the chest elsewhere,
  // with a raised-thread highlight; not on the panels.
  if (u_webC.a > 0.0) {
    vec2 wc = mix(u_web.xy, u_face.xy, head);
    float ws = mix(u_web.z, u_face.z, head), wr = mix(u_web.w, u_face.w, head);
    float n0 = mix(8.0, 18.0, head), k0 = mix(1.0, 4.0, head), lw = 0.5 * u_dpr;
    float w0 = web(px, wc, ws, wr, n0, k0, lw);
    float w1 = web(px + vec2(0.9, 1.2) * u_dpr, wc, ws, wr, n0, k0, lw);
    float wm = (1.0 - panel) * u_webC.a;
    su += u_pA[3] * max(w1 - w0, 0.0) * 0.3 * wm;
    su = mix(su, u_webC.rgb, w0 * wm);
  }

  // Emblem from the atlas, shaded like the suit.
  vec2 eq = rot2(-u_embXf.w) * (px - u_embXf.xy) / u_embXf.z + 0.5;
  float em = dot(texture(u_emb, eq).rgb, u_embSel) * u_bodyOn * (1.0 - head) * (1.0 - glove);
  su = mix(su, mix(mix(mix(u_pE[0], u_pE[1], tA), u_pE[2], tB), u_pE[3], tS), em);

  // Ink: folds from the camera, panel seams, then the silhouette outline.
  su = mix(su, INK, smoothstep(0.14, 0.32, e) * 0.45 * (1.0 - em));
  su = mix(su, INK, seam * 0.9);
  vec3 bg = texture(u_city, vec2(px.x / u_res.x, 1.0 - px.y / u_res.y)).rgb;
  vec3 c = mix(bg, su, pm);
  // A thin rim light just inside the outline on the lit side, then the ink
  // (the black suit's ink crawls like the symbiote).
  float sym = step(1.5, u_look.y) * step(u_look.y, 2.5);
  float ow = u_fx.w * u_dpr * mix(1.0, 0.4 + 2.2 * noise(px / (7.0 * u_dpr) + vec2(u_time * 0.7, -u_time * 0.4)), sym);
  float gl = step(0.01, length(g) * u_dpr);
  float rim = step(0.5, m) * (1.0 - smoothstep(ow + 1.8 * u_dpr, ow + 2.8 * u_dpr, edge)) * smoothstep(0.0, 0.4, key);
  c = mix(c, u_pA[3], rim * gl * (0.55 + 0.35 * step(1.5, u_look.y)));
  return mix(c, INK, (1.0 - smoothstep(ow, ow + u_dpr, edge)) * gl * 0.95);
}

// Noir: hard black-and-white film lit through venetian blinds, grain,
// flicker, scratches and vignette; rain for the night looks.
vec3 post(vec3 c, vec2 px) {
  float noir = step(2.5, u_look.y);
  if (noir > 0.5) {
    float b = fract((px.x * 0.45 + px.y) / (30.0 * u_dpr) + 0.3 * sin(u_time * 0.21));
    float blind = smoothstep(0.05, 0.14, b) * (1.0 - smoothstep(0.6, 0.69, b));
    float l = smoothstep(0.03, 0.62, luma(c) * mix(0.42, 1.75, blind));
    c = vec3(l * l * (3.0 - 2.0 * l)) * vec3(1.0, 0.98, 0.94);
  }
  if (u_look.w > 0.0) c = mix(c, mix(vec3(0.72, 0.82, 1.0), vec3(1.0), noir), rain(px) * u_look.w);
  if (noir > 0.5) {
    c += (hash12(floor(px / (1.5 * u_dpr)) + fract(u_time * 13.0) * 97.0) - 0.5) * 0.16;
    c *= 1.0 - 0.8 * smoothstep(0.3, 0.78, length((v_local - 0.5) * vec2(1.0, 1.15)));
    c *= 0.93 + 0.07 * hash12(vec2(floor(u_time * 18.0), 1.0));
    c = mix(c, vec3(0.9), step(0.9975, hash12(vec2(floor(px.x / (2.0 * u_dpr)), floor(u_time * 9.0)))) * 0.5);
  }
  return c;
}

vec3 filt(vec2 px) {
  // Spider-Verse: rows slip sideways in short glitch bursts.
  float verse = step(0.5, u_look.y) * step(u_look.y, 1.5);
  float tick = floor(u_time * 12.0), row = floor(px.y / (16.0 * u_dpr));
  float burst = step(0.7, hash12(vec2(floor(u_time * 2.3), 5.3)));
  px.x += verse * burst * step(0.75, hash12(vec2(row, tick))) * (hash12(vec2(tick, row + 3.0)) - 0.5) * 44.0 * u_dpr;

  // 14 texture reads: 5 camera (misregistered plates, ink-line gradient),
  // 2 blurred light, 5 person mask (outline, body form), 1 backdrop,
  // 1 emblem.
  float d = 1.6 * u_dpr;
  vec3 C = cam(px);
  vec3 R = cam(px + vec2(d, 0.0)), L = cam(px - vec2(d, 0.0));
  vec3 U = cam(px - vec2(0.0, d)), D = cam(px + vec2(0.0, d));
  float l = luma(C);
  float e = length(vec2(luma(R) - luma(L), luma(D) - luma(U)));

  // Comic print of the camera (no mask yet, or blended in as it arrives),
  // in the version's colours.
  vec3 pc = vec3(R.r, C.g, L.b);
  pc = clamp(mix(vec3(l), pc, 1.55) * 1.08, 0.0, 1.0);
  pc = mix(pc, floor(pc * 4.0 + 0.5) / 4.0, 0.45);
  float sh = 1.0 - smoothstep(0.12, 0.55, l);
  pc = mix(pc, pc * 0.3 + INK, bd(px, 6.0 * u_dpr, sh * 0.85) * 0.75);
  pc *= vec3(1.07, 0.95, 0.92);
  pc = mix(pc, INK, smoothstep(0.1, 0.24, e) * 0.85);
  float pl = luma(pc);
  vec3 duo = mix(vec3(0.13, 0.03, 0.3), vec3(1.0, 0.24, 0.42), smoothstep(0.12, 0.8, pl)) + vec3(0.0, 0.3, 0.4) * smoothstep(0.82, 1.0, pl);
  pc = mix(pc, duo, 0.55 * verse);
  pc = mix(pc, vec3(pl) * vec3(0.82, 0.9, 1.06), 0.8 * step(1.5, u_look.y));
  vec3 c = pc;
  if (u_seg > 0.002) c = mix(pc, suit(px, C, l, e), u_seg);
  return post(c, px);
}`;

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

  // 2-5. The Spider-Man versions (SUIT above).
  suit: SUIT,

  // 6. Spider-Verse comic: posterized, CMY halftone in shadows, ink lines,
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

  // 7. Heat camera palette from blurred luminance (+ a little skin warmth).
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

  // 8. Green code rain: luminance x falling streaks, bright leading glyphs.
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

  // 9. Terminal ASCII art (amber phosphor).
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

  // 10. Glowing sobel edges with a travelling hue on black.
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

  // 11. Inverted cool-blue, hard contrast, scanlines, noise and a scan bar.
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

  // 12. Game Boy: chunky pixels, 4 greens, Bayer ordered dither, LCD grid.
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

  // 13. Datamosh: RGB split, slice displacement, block corruption, bursts.
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

  // 14. Eight mirrored wedges around the window centre, slowly turning.
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
  if (SUITS[id]) id = 'suit';
  if (!broken.has(id)) {
    try { return gfx.program('portal-' + id, COMMON + (BODIES[id] || FALLBACK) + MAIN); } catch (e) {
      broken.add(id);
      console.warn('[portal] filter shader failed, using fallback:', id, e.message);
    }
  }
  return gfx.program('portal-fallback', COMMON + FALLBACK + MAIN);
}

export function bgProgram(gfx) { return gfx.program('portal-bg', COMMON + BG); }

// The camera's light at two blur scales, in small screen-sized targets
// redrawn every frame (at most 1/36 and 1/576 of the screen's pixels):
// the suits' cel tones come from their difference, which follows folds and
// the lit side of a body but not fabric texture. Box blurs, 4 taps each.
const LUM_A = `
uniform float u_step;
void main() {
  float o = u_step;
  float l = 0.25 * (luma(cam(v_px + vec2(-o, -o))) + luma(cam(v_px + vec2(o, -o)))
                  + luma(cam(v_px + vec2(-o, o))) + luma(cam(v_px + vec2(o, o))));
  outColor = vec4(vec3(l), 1.0);
}`;
const LUM_B = `
uniform sampler2D u_src;
uniform float u_step;
float at(vec2 p) { return texture(u_src, vec2(p.x / u_res.x, 1.0 - p.y / u_res.y)).r; }
void main() {
  float o = u_step;
  float l = 0.25 * (at(v_px + vec2(-o, -o)) + at(v_px + vec2(o, -o)) + at(v_px + vec2(-o, o)) + at(v_px + vec2(o, o)));
  outColor = vec4(vec3(l), 1.0);
}`;
let lum = null;
export function lightTargets(gfx) {
  if (!lum) {
    const k = Math.min(1 / 6, 1 / (3 * gfx.dpr));  // ~2-3 CSS px per texel
    lum = { a: gfx.renderTarget(k), b: gfx.renderTarget(k / 4), ua: { u_step: 0.25 / k }, ub: { u_src: null, u_step: 1 / k } };
    lum.ub.u_src = lum.a;
  }
  gfx.bindTarget(lum.a);
  gfx.fullscreen(gfx.program('portal-lum-a', LUM_A), lum.ua);
  gfx.bindTarget(lum.b);
  gfx.fullscreen(gfx.program('portal-lum-b', LUM_B), lum.ub);
  gfx.bindTarget(null);
  return lum;
}

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

  return { glyphs: mipTexture(gfx, m), ascii: mipTexture(gfx, a), emb: mipTexture(gfx, emblemAtlas()) };
}

// --- Spider-Man emblems: one per channel of a 512 px atlas (head up) -----------

// A cubic leg [x0, y0, x1, y1, x2, y2, x3, y3] tapering from w0 to w1, and
// its mirror image.
function legs(g, list) {
  for (const [x0, y0, x1, y1, x2, y2, x3, y3, w0, w1] of list) {
    for (const k of [1, -1]) {
      const L = [], R = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        const x = k * (u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3);
        const y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        const dx = k * (3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2));
        const dy = 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2);
        const dl = Math.hypot(dx, dy) || 1, w = (w0 + (w1 - w0) * t) / 2;
        L.push(x - (dy / dl) * w, y + (dx / dl) * w); R.push(x + (dy / dl) * w, y - (dx / dl) * w);
      }
      g.beginPath();
      g.moveTo(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
      for (let i = R.length - 2; i >= 0; i -= 2) g.lineTo(R[i], R[i + 1]);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(k * x3, y3, w1 / 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function blobs(g, list) {
  g.beginPath();
  for (const [x, y, rx, ry] of list) { g.moveTo(x + rx, y); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  g.fill();
}

function emblemAtlas() {
  const N = 512, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, N, N);
  g.beginPath();
  g.rect(3, 3, N - 6, N - 6);  // black border: clamped lookups stay empty
  g.clip();
  g.globalCompositeOperation = 'lighter';
  const draw = (color, fn) => { g.save(); g.translate(N / 2, N / 2); g.scale(N / 2, N / 2); g.fillStyle = color; fn(); g.restore(); };
  // r: the classic small black chest spider (legs bent at the knee).
  draw('#f00', () => {
    blobs(g, [[0, -0.45, 0.09, 0.1], [0, -0.21, 0.135, 0.17], [0, 0.17, 0.155, 0.27]]);
    legs(g, [
      [0.06, -0.3, 0.2, -0.45, 0.3, -0.53, 0.33, -0.57, 0.1, 0.09], [0.33, -0.57, 0.35, -0.7, 0.37, -0.82, 0.39, -0.93, 0.08, 0.04],
      [0.1, -0.22, 0.3, -0.27, 0.45, -0.31, 0.54, -0.33, 0.1, 0.09], [0.54, -0.33, 0.6, -0.45, 0.65, -0.56, 0.69, -0.69, 0.08, 0.04],
      [0.1, -0.12, 0.3, -0.04, 0.45, 0.01, 0.54, 0.03, 0.1, 0.09], [0.54, 0.03, 0.6, 0.2, 0.65, 0.33, 0.69, 0.45, 0.08, 0.04],
      [0.07, 0.0, 0.2, 0.2, 0.3, 0.3, 0.33, 0.36, 0.1, 0.09], [0.33, 0.36, 0.35, 0.55, 0.37, 0.7, 0.39, 0.84, 0.08, 0.04],
    ]);
  });
  // g: Miles' big stylised red spider, curvy legs hooking at the tips.
  draw('#0f0', () => {
    blobs(g, [[0, -0.32, 0.1, 0.1], [0, -0.14, 0.125, 0.12], [0, 0.16, 0.155, 0.26]]);
    legs(g, [
      [0.07, -0.22, 0.3, -0.64, 0.68, -0.72, 0.8, -0.38, 0.13, 0.05],
      [0.12, -0.13, 0.5, -0.32, 0.88, -0.2, 0.92, 0.1, 0.12, 0.045],
      [0.12, 0.0, 0.48, 0.05, 0.75, 0.24, 0.74, 0.52, 0.12, 0.045],
      [0.08, 0.12, 0.3, 0.42, 0.52, 0.64, 0.34, 0.88, 0.13, 0.05],
    ]);
  });
  // b: the black suit's huge white spider; the legs run off the edges
  // (over the shoulders, round the ribs).
  draw('#00f', () => {
    blobs(g, [[0, -0.34, 0.12, 0.13], [0, 0.0, 0.15, 0.3]]);
    legs(g, [
      [0.05, -0.38, 0.14, -0.66, 0.3, -0.9, 0.48, -1.04, 0.16, 0.05],
      [0.1, -0.26, 0.42, -0.5, 0.8, -0.52, 1.04, -0.32, 0.16, 0.045],
      [0.12, -0.08, 0.46, -0.1, 0.78, 0.08, 1.0, 0.42, 0.15, 0.045],
      [0.08, 0.14, 0.26, 0.42, 0.42, 0.7, 0.52, 1.04, 0.15, 0.05],
    ]);
  });
  return c;
}
