// Shaders for the Live Mirror scene.
//
// Every particle is one cell of a (jittered) grid laid over the source picture.
// The vertex shader samples the source texture (webcam / photo / file) for colour,
// turns brightness into depth (3D relief), reads the person mask (background
// removal) and applies every interaction analytically from a handful of uniforms:
// finger void + trail, fist collapse into a swirling ball, explosion, intro fly-in,
// idle wave. Nothing is computed per particle on the CPU.
import { GLSL } from '../../core/glsl.js';
import { MUSIC_GLSL } from '../music/MusicReact.js';

/** Number of "void" slots: [0] follows the fingertip, the rest are its fading trail. */
export const VOID_COUNT = 8;

export const STYLE_IDS = { Colour: 0, Mono: 1, Matrix: 2, Thermal: 3 };

export const vertexShader = /* glsl */ `
#define VOIDS ${VOID_COUNT}
#define TAU 6.28318530718
#define HOLE_SPREAD 1.8

attribute vec4 aRand;

uniform float uTime;
uniform float uPixelRatio;
uniform float uViewportHeight;
uniform float uFovScale;      // 1 / (2 tan(fov / 2))
uniform float uTanHalf;       // tan(fov / 2)
uniform float uCamDist;       // camera distance to the sheet

uniform sampler2D uMap;
uniform float uMapLinear;     // 1: sampler returns linear colour (sRGB image), 0: raw sRGB (video)
uniform float uLod;           // mip level where one texel ~ one particle
uniform vec4 uUvRect;         // visible window of the source: x0, y0, width, height
uniform float uFlipX;         // selfie mirror

uniform sampler2D uMaskA;     // previous person mask
uniform sampler2D uMaskB;     // newest person mask
uniform float uMaskBlend;     // 0 -> A, 1 -> B (smooth between segmenter updates)
uniform vec4 uMaskSel;        // which channel holds the mask
uniform float uMaskFlipY;     // DataTexture rows run top -> bottom
uniform float uMaskOn;        // 0..1 background removal amount

uniform vec2 uSheet;          // world size of the visible sheet
uniform vec2 uGrid;           // columns, rows
uniform float uSpacing;       // world distance between neighbours
uniform float uSize;
uniform float uGain;
uniform float uDepth;         // relief strength (world units)
uniform float uPop;           // how far the person stands out in front of the background
uniform float uWave;          // idle wave 0..1
uniform float uIntro;         // 0..1 fly-in
uniform float uStyle;
uniform float uFacing;        // 1 facing the camera .. ~0.35 seen edge-on

uniform vec4 uVoids[VOIDS];   // xy centre, z radius (screen units: NDC * (aspect, 1)), w strength
uniform float uVoidOn;        // 1 while any void is active
uniform vec4 uFist;           // xyz ball centre, w ball radius
uniform float uCollapse;      // 0..1 how far the particles have been pulled into the ball
uniform vec4 uBlast;          // xyz explosion centre, w strength

varying vec3 vColor;
varying float vAlpha;

${GLSL.hash}
${MUSIC_GLSL}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 srcSrgb(vec2 uv, float lod) {
  vec3 t = textureLod(uMap, uv, lod).rgb;
  return uMapLinear > 0.5 ? toSrgb(t) : t;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float maskAt(vec2 uv) {
  vec2 m = vec2(uv.x, mix(uv.y, 1.0 - uv.y, uMaskFlipY));
  float a = dot(texture2D(uMaskA, m), uMaskSel);
  float b = dot(texture2D(uMaskB, m), uMaskSel);
  return mix(a, b, uMaskBlend);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0) * 5.0;
  vec3 c = mix(vec3(0.0, 0.0, 0.02), vec3(0.14, 0.02, 0.5), clamp(t, 0.0, 1.0));
  c = mix(c, vec3(0.7, 0.0, 0.6), clamp(t - 1.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.22, 0.05), clamp(t - 2.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 0.75, 0.08), clamp(t - 3.0, 0.0, 1.0));
  c = mix(c, vec3(1.0, 1.0, 0.88), clamp(t - 4.0, 0.0, 1.0));
  return toLinear(c);
}

void main() {
  vec2 g = position.xy;                                  // 0..1 across the visible sheet
  vec2 uv = uUvRect.xy + g * uUvRect.zw;
  if (uFlipX > 0.5) uv.x = 1.0 - uv.x;
  vec3 rnd = aRand.xyz * 2.0 - 1.0;

  // ---- colour + brightness relief
  vec3 srgb = srcSrgb(uv, uLod);
  float lum = luma(srgb);
  // smooth relief from the mip chain (cheap blur, keeps webcam noise out of the depth)
  float blur = luma(srcSrgb(uv, uLod + 2.0)) * 0.5 + luma(srcSrgb(uv, uLod + 3.5)) * 0.5;
  float relief = mix(lum, blur, 0.7);

  // ---- person mask (background removal)
  float person = 1.0;
  float bg = 0.0;
  if (uMaskOn > 0.001) {
    person = smoothstep(0.25, 0.75, maskAt(uv));
    bg = (1.0 - person) * uMaskOn;
  }

  // ---- sheet position with relief
  vec3 p = vec3((g - 0.5) * uSheet, 0.0);
  p.z = (relief - 0.45) * uDepth + person * uMaskOn * uPop + rnd.z * 0.02 * uDepth;

  // idle wave
  float wv = sin(p.x * 0.75 + uTime * 1.1) * 0.5
           + sin(p.y * 1.05 - uTime * 0.8 + p.x * 0.3) * 0.35
           + sin(length(p.xy) * 1.5 - uTime * 1.6) * 0.3;
  p.z += wv * uWave * 0.24;

  // ---- music (the relief itself pumps with the bass: uDepth, set by the scene)
  // treble: every particle shivers on its own; a beat: a ripple ring runs out from the middle
  vec4 mu = music();
  float beatW = 0.0;
  if (mu.w + uBeatWave.y + uBeatWave.w > 0.0) {
    float sh = sin(uTime * (11.0 + 9.0 * aRand.w) + aRand.x * 60.0);
    p.xy += rnd.xy * mu.w * uSpacing * 1.8 * sh;
    p.z += rnd.z * mu.w * uSpacing * 4.0 * sh;
    float rc = length(p.xy) / uSheet.y;
    beatW = beatRing(rc, 0.75, 0.055);
    p.z += beatW * 0.09 * uSheet.y;
  }

  // background particles drift away and fade into dust
  if (bg > 0.001) {
    float d = bg * (0.5 + aRand.w);
    vec2 outward = normalize(p.xy + rnd.xy * 1.5 + 1e-4);
    p.xy += outward * d * 1.1;
    p.xy += vec2(sin(uTime * 0.23 + aRand.x * 40.0), cos(uTime * 0.19 + aRand.y * 40.0)) * 0.45 * bg;
    p.z -= d * 3.2;
  }

  // ---- finger void (+ its springy trail)
  // Worked out on SCREEN, so the hole sits exactly under the fingertip whatever the
  // particle's depth (dust far behind, person in front) or the sheet's tilt.
  // Each void moves particles outward so that r'^2 = r^2 + (R w)^2 fall(r): an
  // area-preserving push that leaves a clean hole of radius ~R and piles the
  // particles into a soft, wide rim (max ~2x density) instead of a hard ring.
  // Particles are also pushed back along their own view ray, which keeps them
  // exactly where they are on screen. Negative strength (springy release, trail
  // ripples) only bulges the particles forward - it never pulls them through
  // the centre into a bright star.
  float rim = 0.0;
  if (uVoidOn > 0.5) {
    vec3 mv0 = (modelViewMatrix * vec4(p, 1.0)).xyz;
    float zd = max(-mv0.z, 0.5);
    vec2 s = mv0.xy / (zd * uTanHalf);
    float dens = 1.0;
    float back = 0.0;
    for (int i = 0; i < VOIDS; i++) {
      vec4 v = uVoids[i];
      if (abs(v.w) < 1e-3) continue;
      vec2 d = s - v.xy;
      float r2 = max(dot(d, d), 1e-10);
      float R2 = v.z * v.z;
      float fall = exp(-r2 / (R2 * HOLE_SPREAD));
      // w^2: the hole's radius grows linearly with strength (sqrt would leave a visible
      // pinhole for every faint trail ripple)
      float w = max(v.w, 0.0);
      w *= w * (0.82 + 0.36 * aRand.y);
      s = v.xy + d * sqrt(1.0 + R2 * w * fall / r2);
      dens *= max(1.0 - w * fall / HOLE_SPREAD, 0.2);
      back += v.w * exp(-r2 / (R2 * 0.6)) * v.z;
    }
    float zn = zd + back * 0.9 * uCamDist * uTanHalf;
    vec3 mv1 = vec3(s * (zn * uTanHalf), -zn);
    // view-space offset back into the sheet's own space (pure rotation: transpose = inverse)
    p += transpose(mat3(modelViewMatrix)) * (mv1 - mv0);
    rim = min(1.0 / dens - 1.0, 1.5);
  }

  // ---- fist: collapse into a swirling ball
  float t = 0.0;
  if (uCollapse > 0.0) {
    float dist = length(p.xy - uFist.xy);
    float delay = clamp(dist / 9.0, 0.0, 1.0) * 0.75 + aRand.w * 0.25;
    t = clamp(uCollapse * 2.0 - delay, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float ct = aRand.z * 2.0 - 1.0;
    float st = sqrt(max(1.0 - ct * ct, 0.0));
    float ph = aRand.y * TAU;
    vec3 sp;
    if (aRand.w > 0.86) {
      // ~14 %: a fast ring orbiting the ball
      float rr = uFist.w * (1.35 + 0.55 * aRand.x);
      float a = ph + uTime * (2.2 / rr * uFist.w);
      vec3 rp = vec3(cos(a) * rr, (aRand.z - 0.5) * 0.08 * uFist.w, sin(a) * rr);
      rp.yz = rot(1.15) * rp.yz;
      rp.xy = rot(-0.4) * rp.xy;
      sp = uFist.xyz + rp;
    } else {
      // the ball: a rippling shell that spins faster inside (differential swirl)
      vec3 dir = vec3(st * cos(ph), ct, st * sin(ph));
      float shell = 0.35 + 0.65 * pow(aRand.x, 0.3);
      float ang = uTime * (1.4 / (0.25 + shell)) + aRand.w * 0.5;
      dir.xz = rot(ang) * dir.xz;
      dir.yz = rot(0.45) * dir.yz;
      dir.xy = rot(0.3) * dir.xy;
      float ripple = 1.0 + 0.09 * sin(ph * 3.0 + ct * 7.0 - uTime * 2.5);
      sp = uFist.xyz + dir * (uFist.w * shell * ripple);
    }
    vec3 q = mix(p, sp, t);
    float swirl = t * (1.0 - t) * 6.0;
    q.xy = uFist.xy + rot(swirl) * (q.xy - uFist.xy);
    p = q;
  }

  // ---- open palm after the fist: explosion that springs back
  if (uBlast.w > 0.0) {
    vec3 d = normalize(p - uBlast.xyz + rnd * 0.9 + 1e-4);
    d.z *= 0.45; // mostly sideways: nothing flies into the camera
    p += d * uBlast.w * (1.2 + aRand.x * 5.0);
    p.z = p.z > 3.0 ? 3.0 + (p.z - 3.0) * 0.3 : p.z;
  }

  // ---- intro: fly in from the dark
  float alpha = uGain;
  if (uIntro < 1.0) {
    float e = clamp(uIntro * 1.6 - aRand.w * 0.6, 0.0, 1.0);
    e = e * e * (3.0 - 2.0 * e);
    vec3 from = vec3(rnd.xy * uSheet * 0.8, -10.0 - aRand.x * 12.0);
    p = mix(from, p, e);
    alpha *= e;
  }

  // ---- style
  // Auto exposure: the last mip level is the average brightness of the whole frame,
  // so a bright wall or an over-exposed video does not flood the screen. Mostly off
  // while the background is removed (the person alone is the picture then).
  float avg = luma(srcSrgb(vec2(0.5), 14.0));
  float expo = mix(clamp(0.5 / max(avg, 0.05), 0.6, 1.3), 1.0, uMaskOn * 0.75);
  float lumE = lum * expo;
  float detail = (lum - blur) * expo;
  float sz = mix(0.6, 1.4, aRand.x);
  vec3 col;
  if (uStyle < 0.5) {
    // Colour: the real picture, a little richer
    vec3 s = clamp(mix(vec3(lum), srgb, 1.18), 0.0, 1.0);
    s = clamp((s - 0.5) * 1.06 + 0.5, 0.0, 1.0);
    col = toLinear(s) * 0.95 * mix(1.0, expo, 0.7);
    sz *= mix(0.8, 1.1, lum);
  } else if (uStyle < 1.5) {
    // Mono: white dots, bigger where bright
    float v = smoothstep(0.04, 0.92, lumE);
    col = vec3(0.9, 0.94, 1.0) * (0.05 + 0.75 * v * v);
    sz *= mix(0.3, 1.25, v);
  } else if (uStyle < 2.5) {
    // Matrix: mint glow + falling code streaks. Edges / highlights (detail vs. the
    // blurred surroundings) glow; big flat areas stay a calm, darker green.
    float v = smoothstep(0.04, 0.9, lumE * 0.62 + detail * 1.8 + 0.06 + 0.12 * person * uMaskOn);
    float colId = floor(g.x * uGrid.x / 2.0);
    float speed = 0.08 + hash11(colId) * 0.22;
    float head = 1.0 - fract(uTime * speed + hash11(colId + 31.7));
    float above = fract(g.y - head);
    float streak = exp(-above * 30.0) * step(0.7, hash11(colId + 7.3));
    vec3 mint = vec3(0.3, 1.0, 0.62);
    col = mix(vec3(0.02, 0.05, 0.035), mint, smoothstep(0.08, 0.75, v)) * (0.14 + 0.85 * v * v);
    col += vec3(0.5, 1.0, 0.78) * streak * (0.2 + 0.5 * v) * 0.55;
    sz *= mix(0.4, 1.3, v) * (1.0 + streak * 0.25);
  } else {
    // Thermal: brightness + person -> heat
    float h = clamp(lumE * 0.78 + person * uMaskOn * 0.28 - 0.04, 0.0, 1.0);
    col = thermal(h) * 0.95;
    sz *= mix(0.7, 1.15, h);
  }

  // music: the beat ring glows, the bright particles sparkle with the treble
  if (mu.x + mu.w + beatW > 0.0) {
    float tw = musicGlint(aRand.y * 5.3 + aRand.w, uTime) * mu.w * smoothstep(0.3, 0.8, lum);
    col = mix(col, vec3(max(max(col.r, col.g), col.b)), 0.3 * min(beatW, 1.0)); // whiter in every style
    col *= (1.0 + beatW * 1.5 + 0.12 * mu.x) * (1.0 + tw * 1.6);
    sz *= (1.0 + beatW * 0.4) * (1.0 + tw * 0.35);
  }

  // void rim: a faint mint tint; the packed particles themselves make the glow
  col += vec3(0.55, 1.0, 0.85) * rim * 0.08 * (0.35 + lum);
  sz *= 1.0 + rim * 0.1;
  alpha *= 1.0 / (1.0 + 0.35 * rim);

  // soft fade at the sheet's edges (no hard cut, no bloom blobs in the corners)
  vec2 edge = min(g, 1.0 - g) * uSheet;
  alpha *= mix(smoothstep(0.0, 0.7, min(edge.x, edge.y)), 1.0, t);

  // soft highlight roll-off so white shirts / walls do not burn out
  col = col / (1.0 + 0.45 * max(max(col.r, col.g), col.b));

  // background dust is small and faint (but joins the ball at full strength)
  float dust = smoothstep(0.0, 0.6, bg) * (1.0 - t);
  sz *= mix(1.0, 0.5, dust);
  alpha *= mix(1.0, 0.06, dust);

  // the ball packs every particle into a small space: smaller, much fainter, hotter
  sz *= mix(1.0, 0.75, t);
  alpha *= mix(1.0, 0.12, t);
  col *= 1.0 + t * 0.6 + uBlast.w * 0.5;

  // a tilted sheet piles particles up on screen: dim to keep the brightness even
  alpha *= uFacing;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.5);
  float px = uSpacing * uSize * sz * uPixelRatio * uViewportHeight * uFovScale / dist;
  // nearer particles look bigger; dim them so brightness per area stays even
  float near = dist / 10.0;
  alpha *= clamp(near * near, 0.25, 1.6);
  float minPx = 1.5;
  alpha *= px < minPx ? (px * px) / (minPx * minPx) : 1.0;
  gl_PointSize = clamp(px, minPx, 64.0 * uPixelRatio);

  vColor = col;
  vAlpha = alpha;
}
`;

export const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, d) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}
`;
