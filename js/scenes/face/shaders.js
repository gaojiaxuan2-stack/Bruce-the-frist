// GLSL for the face portrait. All per-particle motion happens here, driven by
// a handful of uniforms (no per-particle state on the CPU):
//
//   home      = photo pixel + depth relief, breathing, hair sway, touch push
//   gathered  = home spiralling into a swirling ball   (uGather, fist)
//   exploded  = gathered + burst velocity + curl drift  (uBurstT, open palm / intro)
//   final     = mix(exploded, home, reform)             (uReform, re-assembly)
import { GLSL } from '../../core/glsl.js';

export const vertexShader = /* glsl */ `
${GLSL.simplex3}
${GLSL.curl}
${GLSL.hash}

uniform float uTime;
uniform float uPixelRatio;
uniform float uViewportHeight;

uniform vec2 uPortrait;      // world size of the full photo
uniform vec2 uPivotUV;       // photo uv of the local origin
uniform float uPivotDepth;   // depth (0..1) of the local origin
uniform float uDepthWorld;   // world depth of depth = 1
uniform float uSpacing;      // particle spacing in world units
uniform float uSize;         // user size multiplier
uniform float uExposure;
uniform vec3 uMode;          // blend weights: photo, mono, neon
uniform vec3 uCamLocal;      // camera position in the head's local space
uniform float uLife;         // idle motion amount

uniform sampler2D uTouch;
uniform vec2 uTouchTexel;
uniform float uPush;

uniform float uGather;
uniform vec3 uBallCenter;
uniform float uBallRadius;
uniform float uBallTime;

uniform float uBurstT;
uniform float uBurstScale;
uniform vec3 uBurstCenter;
uniform float uReform;

uniform vec3 uNeonNear;
uniform vec3 uNeonMid;
uniform vec3 uNeonFar;
uniform vec3 uGlowColor;

attribute vec3 aColor;   // photo colour, sRGB 0..1
attribute vec4 aInfo;    // x contrast luminance, y edge (0 silhouette .. 1 inside), z random, w size multiplier
attribute vec4 aExtra;   // x part label, y random, z brightness weight, w luminance
attribute vec2 aSlope;   // depth slope (per world unit, before the depth scale)

varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec2 rotate2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  float rnd = aInfo.z;
  float rnd2 = aExtra.y;
  float lumC = aInfo.x;
  float edge = aInfo.y;
  float label = aExtra.x;
  float lum = aExtra.w;
  float depth01 = position.z;
  vec2 uv = position.xy / uPortrait + uPivotUV;
  vec3 h3 = hash31(rnd * 4099.0 + rnd2 * 131.0);

  // ---------------------------------------------------------------- home
  vec3 home = vec3(position.xy, (depth01 - uPivotDepth) * uDepthWorld);
  home.z += (h3.x - 0.5) * 0.012 * uDepthWorld; // hides the 8-bit depth steps

  float breath = sin(uTime * 1.25);
  home.xy *= 1.0 + 0.005 * breath * uLife;
  home.z += 0.06 * breath * depth01 * uLife;
  float hair = 1.0 - step(0.5, abs(label - 1.0));
  home.x += hair * uLife * 0.022 * sin(uTime * 1.6 + uv.y * 11.0 + rnd2 * 1.2) * (1.0 - 0.6 * edge);
  home.y += hair * uLife * 0.012 * sin(uTime * 1.3 + uv.x * 9.0 + rnd * 1.2) * (1.0 - 0.6 * edge);
  home += (h3 - 0.5) * uSpacing * 0.9 * sin(uTime * (1.3 + 2.0 * rnd2) + rnd * 40.0) * uLife;

  // Touch trail: push away from the finger, forward in z, then spring back.
  float touch = texture2D(uTouch, uv).r;
  float pushed = 0.0;
  if (touch > 0.003) {
    float tR = texture2D(uTouch, uv + vec2(uTouchTexel.x, 0.0)).r;
    float tL = texture2D(uTouch, uv - vec2(uTouchTexel.x, 0.0)).r;
    float tU = texture2D(uTouch, uv + vec2(0.0, uTouchTexel.y)).r;
    float tD = texture2D(uTouch, uv - vec2(0.0, uTouchTexel.y)).r;
    vec2 grad = vec2(tR - tL, tU - tD);
    float a = rnd2 * 6.2831853;
    vec2 dir = -grad / (length(grad) + 0.025) + vec2(cos(a), sin(a)) * 0.45;
    float wave = 1.0 + 0.28 * sin(touch * 16.0 - uTime * 8.0 + rnd * 2.0);
    pushed = touch * wave * uPush;
    home.xy += dir * pushed * (0.3 + 0.7 * rnd);
    home.z += pushed * (0.4 + 1.3 * h3.y);
  }

  // Re-assembly progress after a burst / during the intro: the face first,
  // then hair and shoulders. Particles already home skip the work below.
  float rf = 1.0;
  bool bursting = uBurstT > 0.0;
  if (bursting) {
    float dc = clamp(length(home.xy) / 6.0, 0.0, 1.0);
    float delay = clamp(0.55 * rnd + 0.45 * dc, 0.0, 1.0);
    rf = clamp((uReform - delay * 0.55) / 0.45, 0.0, 1.0);
    rf = rf * rf * rf * (rf * (rf * 6.0 - 15.0) + 10.0);
  }

  // ---------------------------------------------------------------- gather (fist)
  vec3 p = home;
  float ge = 0.0;
  float ballBright = 1.0;
  if (uGather > 0.0 && (!bursting || rf < 1.0)) {
    float dn = clamp(length(home - uBallCenter) / 9.0, 0.0, 1.0);
    float delay = 0.6 * dn + 0.4 * rnd2;
    ge = clamp(uGather * 1.9 - delay * 0.9, 0.0, 1.0);
    ge = ge * ge * (3.0 - 2.0 * ge);

    // The orb: a dim core, five glowing orbit rings and a soft halo, all spinning.
    vec3 h4 = hash31(rnd2 * 2711.0 + 5.0);
    vec3 axis;
    float rr;
    float spin;
    if (h3.z < 0.3) {
      axis = normalize(h4 - 0.5 + 1e-4);
      rr = pow(h4.x, 1.6) * 0.55;
      spin = 3.2;
      ballBright = 0.8;
    } else if (h3.z < 0.75) {
      float ring = floor(h4.z * 5.0);
      float ra = ring * 2.39996 + 0.4;
      float tilt = 0.35 + ring * 0.24;
      axis = normalize(vec3(sin(ra) * sin(tilt), cos(tilt), cos(ra) * sin(tilt)) + (h4 - 0.5) * 0.1);
      rr = 0.88 + 0.12 * h4.y;
      spin = (1.6 + ring * 0.3) * (mod(ring, 2.0) * 2.0 - 1.0);
      ballBright = 1.7;
    } else {
      axis = normalize(h4.yzx - 0.5 + 1e-4);
      rr = 1.0 + 0.5 * h4.x * h4.x;
      spin = 0.7;
      ballBright = 0.45;
    }
    vec3 bu = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bv = cross(axis, bu);
    float rad = uBallRadius * rr;
    float th = rnd * 6.2831853 + uBallTime * spin;
    vec3 orb = (bu * cos(th) + bv * sin(th)) * rad;
    if (ge > 0.2) orb += curlNoise(orb * 1.2 + vec3(0.0, 0.0, uBallTime * 0.4)) * 0.08 * uBallRadius;
    vec3 ball = uBallCenter + orb;

    // Spiral path from home into the ball, with a turbulent wobble on the way.
    vec3 d = home - uBallCenter;
    d.xy = rotate2(d.xy, ge * (2.2 + 2.5 * rnd2));
    vec3 spiral = uBallCenter + d * (1.0 - ge);
    p = mix(spiral, ball, smoothstep(0.2, 1.0, ge));
    if (ge > 0.0 && ge < 1.0) p += curlNoise(home * 0.35 + vec3(uBallTime * 0.2)) * sin(ge * 3.14159) * 0.5;
  }

  // ---------------------------------------------------------------- burst + re-assembly
  float dust = 0.0;
  if (bursting && rf < 1.0) {
    vec3 rdir = normalize(hash31(rnd2 * 917.0 + 3.1) - 0.5 + 1e-4);
    vec3 away = p - uBurstCenter;
    vec3 dir = normalize(away + rdir * (0.6 + length(away) * 0.35));
    float spd = (2.0 + 8.5 * h3.y * h3.y) * uBurstScale;
    float k = 2.3;
    vec3 q = p + dir * spd * (1.0 - exp(-k * uBurstT)) / k;
    q += curlNoise(q * 0.22 + vec3(0.0, uBurstT * 0.12, 0.0)) * min(uBurstT, 2.5) * 0.55 * uBurstScale;

    vec3 back = mix(q, home, rf);
    back += rdir * sin(rf * 3.14159) * 0.9 * uBurstScale;
    p = back;
    dust = (1.0 - rf) * smoothstep(0.0, 0.35, uBurstT);
  }

  // ---------------------------------------------------------------- colour + size
  // Local contrast (unsharp mask baked per particle) keeps eyes, brows and lips crisp.
  vec3 photo = srgbToLinear(aColor) * clamp(mix(1.0, (lumC + 0.03) / (lum + 0.03), 0.65), 0.45, 1.8);
  float sPhoto = mix(0.82, 1.22, lum);

  // Mono: a coarse halftone (1 particle in 9), white dots sized by brightness.
  float m = smoothstep(0.08, 0.95, lumC);
  float keep = step(rnd2, 0.1111);
  vec3 cMono = vec3(1.0);
  float sMono = (0.12 + 0.95 * m) * 1.75 * keep;

  vec3 neon = mix(uNeonFar, uNeonMid, smoothstep(0.05, 0.45, depth01));
  neon = mix(neon, uNeonNear, smoothstep(0.5, 0.95, depth01));
  float scanPos = 1.15 - fract(uTime * 0.11) * 1.4;
  float scan = smoothstep(0.03, 0.0, abs(uv.y - scanPos));
  // Kept well below clipping so the eyes, brows and mouth stay darker dots.
  vec3 cNeon = neon * (0.03 + 0.9 * pow(lumC, 1.5)) * (1.0 + 1.2 * scan) * (1.0 + 0.7 * (1.0 - edge));
  float sNeon = 1.0 + 0.35 * lumC;

  vec3 col = photo * uMode.x + cMono * uMode.y + cNeon * uMode.z;
  float size = sPhoto * uMode.x + sMono * uMode.y + sNeon * uMode.z;
  float alpha = uExposure * aExtra.z;
  // Mono: fade dark dots away entirely (the REF look: dots only where it is bright).
  alpha *= mix(1.0, smoothstep(0.03, 0.14, lumC), uMode.y);

  // Clean silhouette: smaller, dimmer dots near the edge.
  size *= mix(0.5, 1.0, edge);
  alpha *= mix(0.4, 1.0, edge);

  // Even brightness when the head turns. Each particle stands for the same
  // patch of the photo plane; seen from the view direction that patch covers
  // |n . v| = |v.z - slope . v.xy| of its front-on screen area, so the on-screen
  // density grows by 1 / proj and the alpha has to shrink by proj.
  vec3 view = normalize(uCamLocal - home);
  float proj = abs(view.z - dot(aSlope * uDepthWorld, view.xy));
  alpha *= mix(1.0, clamp(proj, 0.2, 1.2), rf);

  // Shimmer, plus a rare glint here and there.
  alpha *= 1.0 - 0.18 * uLife * (0.5 + 0.5 * sin(uTime * (2.0 + 3.0 * rnd) + rnd2 * 50.0));
  float glintPhase = fract(uTime * (0.04 + 0.03 * rnd2) + rnd * 13.7);
  float glint = smoothstep(0.0025, 0.0, abs(glintPhase - 0.5)) * uLife;
  col *= 1.0 + glint * 1.5;
  size *= 1.0 + glint * 0.35;

  // Touched dots light up a little.
  col *= 1.0 + pushed * 0.45;

  // Glowing orb, and a hot flash when it bursts.
  float ballness = ge * exp(-3.0 * uBurstT);
  float flash = mix(0.4, 1.0, ge) * smoothstep(0.0, 0.08, uBurstT) * exp(-4.0 * uBurstT);
  vec3 hot = uGlowColor * (0.5 + 0.9 * h3.x) * ballBright;
  col = mix(col, hot, ballness * 0.75) * (1.0 + ballness * 0.6 + flash * 2.5);
  size *= mix(1.0, 0.7, ballness);
  alpha *= mix(1.0, 0.075 * ballBright, ballness);

  // Dust cloud: small sparkly specks in their own colours.
  size *= mix(1.0, 0.85, dust);
  alpha *= mix(1.0, 0.6 + 0.5 * h3.z, dust);
  vGlow = clamp(uMode.z + dust * 0.6 + ballness * 0.5, 0.0, 1.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uSpacing * uSize * aInfo.w * size * 1.55
    * projectionMatrix[1][1] * 0.5 * uViewportHeight * uPixelRatio / max(-mv.z, 0.05);
  // Keep the energy of sub-pixel dots instead of letting them flicker.
  if (px < 1.0) {
    alpha *= px * px;
    px = 1.0;
  }
  if (alpha < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    px = 0.0;
  }
  gl_PointSize = px;
  vColor = col;
  vAlpha = alpha;
}
`;

export const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float disc = smoothstep(1.0, 0.6, d);
  float glow = pow(max(1.0 - d, 0.0), 1.7) * 1.5;
  float a = mix(disc, glow, vGlow) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
}
`;
