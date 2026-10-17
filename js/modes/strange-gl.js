// strange-gl.js — WebGL for the Doctor Strange mode:
//  * the world pass: warm cinematic grade, vignette, golden mist, light
//    spilled by shields/portals, the Mirror Dimension (kaleidoscope of
//    fractured mirror shards behind the person) and the Eye of Agamotto's
//    green time echoes (a ring of delayed camera snapshots);
//  * a portal: another place seen through the hole (three procedural
//    destinations) and its blazing additive rim.

const WORLD = `
uniform float u_grade;      // 0..1 cinematic grade
uniform float u_mirror;     // 0..1 Mirror Dimension (drives a radial wipe)
uniform float u_maskOK;     // 0..1 real segmentation (else a stand-in silhouette)
uniform vec2  u_center;     // fold centre, device px
uniform float u_echo;       // 0..1 time echoes
uniform vec4  u_hw;         // weight of each echo snapshot
uniform sampler2D u_h0;
uniform sampler2D u_h1;
uniform sampler2D u_h2;
uniform sampler2D u_h3;
uniform vec4  u_light[4];   // x, y, radius (device px), intensity
uniform vec3  u_tint;       // mystic orange / time green

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Rough head-and-shoulders, used until a real person mask arrives.
float standIn(vec2 px) {
  float S = min(u_res.x, u_res.y);
  float head = length((px - vec2(u_res.x * 0.5, u_res.y * 0.42)) / vec2(S * 0.16, S * 0.21));
  float body = length((px - vec2(u_res.x * 0.5, u_res.y * 1.08)) / vec2(S * 0.5, S * 0.48));
  return 1.0 - smoothstep(0.9, 1.15, min(head, body));
}

// Triangle-wave mirror so folded samples always land on the camera image.
vec2 mirrorRepeat(vec2 p) {
  vec2 a = u_vrect.xy, s = u_vrect.zw;
  vec2 q = (p - a) / s;
  q = 1.0 - abs(mod(q, 2.0) - 1.0);
  return a + q * s;
}

vec3 mirrorWorld(vec2 px, out float crack) {
  float S = min(u_res.x, u_res.y);
  float t = u_time;
  vec2 p = px - u_center;
  // space twists more the further it is from the user
  float tw = 0.35 * smoothstep(0.0, 1.2, length(p) / S) * sin(t * 0.3);
  p = rot2(t * 0.06 + tw) * p;
  // kaleidoscope: eight mirrored wedges around the user
  float a = atan(p.y, p.x), r = length(p);
  float w = 6.2831853 / 8.0;
  float fa = abs(mod(a + w * 0.5, w) - w * 0.5);
  vec2 q = vec2(cos(fa), sin(fa)) * r;
  // fractured mirror: drifting Voronoi shards, each re-projecting the room
  vec2 g = q / (S * 0.21) + vec2(t * 0.05, 0.0);
  vec2 ip = floor(g), fp = fract(g);
  float d1 = 9.0, d2 = 9.0;
  vec2 id = vec2(0.0), id2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = vec2(hash12(ip + o), hash12(ip + o + 17.1));
      vec2 pt = o + 0.5 + 0.38 * sin(t * 0.35 + 6.2831 * h);
      float d = length(pt - fp);
      if (d < d1) { d2 = d1; id2 = id; d1 = d; id = ip + o; } else if (d < d2) { d2 = d; id2 = ip + o; }
    }
  }
  // cracks: thin, each edge with its own brightness, glints sliding along
  float eh = hash12(id + id2 * 3.1);
  float glint = pow(0.5 + 0.5 * sin(dot(q, vec2(0.7, 0.7)) / S * 9.0 - t * 2.5 + eh * 6.0), 6.0);
  crack = (1.0 - smoothstep(0.0, 0.03, d2 - d1)) * (0.25 + 0.5 * eh + 0.9 * glint);
  float hr = hash12(id * 1.37 + 5.0);
  float ang = (hr - 0.5) * 1.2 + sin(t * 0.3 + hr * 6.28) * 0.12;
  vec2 sp = rot2(ang) * q * (0.7 + hr * 0.7);
  if (hr > 0.5) sp.x = -sp.x;                          // every other shard is a true mirror
  sp += normalize(sp + vec2(0.001)) * S * 0.07;
  sp = rot2(-t * 0.04 + hr * 2.0) * sp;
  vec2 spx = mirrorRepeat(u_center + sp);
  vec2 off = normalize(p + vec2(0.001)) * (2.0 + 3.0 * hr) * u_dpr;
  vec3 col = vec3(cam(spx + off).r, cam(spx).g, cam(spx - off).b);
  col *= 0.75 + 0.6 * hr;                              // facets catch the light differently
  col = mix(col, col.bgr * vec3(0.8, 0.95, 1.2), 0.15 + 0.2 * hr);   // prismatic cast
  // a faint sheen across each pane so dark rooms still read as glass
  float sheen = smoothstep(0.2, 1.0, fract(dot(fp, vec2(0.6, 0.8)) * 0.7 + hr + t * 0.05));
  col += mix(vec3(0.05, 0.08, 0.14), u_tint * 0.18, hr) * (0.5 + sheen);
  return col;
}

vec3 grade(vec3 c) {
  float l = luma(c);
  c = mix(vec3(l), c, 0.74);                              // a touch desaturated
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.4);               // filmic S-curve
  c *= mix(vec3(0.84, 0.94, 1.06), vec3(1.1, 0.97, 0.82), smoothstep(0.08, 0.75, l));  // teal shadows, amber highlights
  return c;
}

vec3 ghost(sampler2D tex, vec2 tuv, vec3 now, float w) {
  if (w <= 0.0) return vec3(0.0);
  vec3 h = texture(tex, tuv).rgb;
  float d = smoothstep(0.06, 0.26, length(h - now));
  return u_tint * luma(h) * d * w;
}

void main() {
  vec2 px = v_px;
  float S = min(u_res.x, u_res.y);
  vec3 raw = cam(px);
  vec3 col = mix(raw, grade(raw), u_grade);

  if (u_mirror > 0.001) {
    float m = mix(standIn(px), person(px), u_maskOK);
    float dist = length(px - u_center);
    float front = u_mirror * length(u_res) * 0.8;
    float inside = 1.0 - smoothstep(front - S * 0.06, front, dist);
    float bg = (1.0 - smoothstep(0.3, 0.6, m)) * inside;
    if (bg > 0.002) {
      float crack;
      vec3 mw = grade(mirrorWorld(px, crack));
      mw += u_tint * crack * 0.7;
      col = mix(col, mw, bg);
    }
    // the wipe's leading edge, and an amber rim light on the person
    float ef = (dist - front) / (S * 0.025);
    float edge = exp(-ef * ef) * (1.0 - smoothstep(0.85, 1.0, u_mirror));
    col += u_tint * edge * (1.0 - m) * 1.4;
    // rim light only where the mask has a crisp edge (not across fuzzy hair)
    float e = 3.0 * u_dpr;
    vec2 gm = vec2(person(px + vec2(e, 0.0)) - person(px - vec2(e, 0.0)), person(px + vec2(0.0, e)) - person(px - vec2(0.0, e)));
    float rim = smoothstep(0.25, 0.7, length(gm)) * smoothstep(0.35, 0.6, m);
    col += u_tint * rim * 0.8 * u_mirror * u_maskOK;
  }

  if (u_echo > 0.001) {
    vec2 tuv = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y);
    vec3 g = ghost(u_h0, tuv, raw, u_hw.x) + ghost(u_h1, tuv, raw, u_hw.y)
           + ghost(u_h2, tuv, raw, u_hw.z) + ghost(u_h3, tuv, raw, u_hw.w);
    col = col * (1.0 - 0.1 * u_echo) + g * u_echo * 0.9;
    col = mix(col, col * vec3(0.92, 1.06, 0.96), u_echo * 0.5);
  }

  // light spilled by sigils and portals
  float L = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 lt = u_light[i];
    if (lt.w > 0.0) {
      vec2 d = (px - lt.xy) / lt.z;
      L += lt.w * exp(-dot(d, d) * 2.0);
    }
  }
  // tint more than brighten, and mostly in the darker tones
  col += (col * (u_tint - 0.35) * 0.9 + u_tint * 0.05) * L * (1.0 - 0.6 * luma(col));

  // vignette, low golden mist, grain
  vec2 uv = px / u_res;
  float vg = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0));
  col *= 1.0 - smoothstep(0.4, 1.05, vg) * 0.45 * u_grade;
  if (uv.y > 0.5) {
    float mn = fbm(vec2(px.x / (S * 0.32) + u_time * 0.05, px.y / (S * 0.16) - u_time * 0.02));
    float mist = smoothstep(0.5, 1.0, uv.y) * smoothstep(0.42, 0.9, mn);
    col += (u_tint * 0.16 + 0.03) * mist * u_grade;
  }
  col += (hash12(px + fract(u_time * 7.0) * 113.0) - 0.5) * 0.035 * u_grade;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const COPY = 'void main() { outColor = vec4(cam(v_px), 1.0); }';

// Three destinations: Kamar-Taj peaks at blue hour, a red canyon at sunset,
// and the Dark Dimension.
const PORTAL = `
uniform vec2  u_c;      // centre, device px
uniform float u_r;      // radius, device px
uniform float u_open;   // 0..1 opening (a swirl that unwinds)
uniform float u_alpha;
uniform float u_scene;
uniform vec2  u_par;    // parallax from the portal's place on screen
uniform float u_seed;
uniform vec3  u_rim;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float ridged(float x, float s) {
  float a = 1.0 - abs(noise(vec2(x, s)) * 2.0 - 1.0);
  float b = 1.0 - abs(noise(vec2(x * 2.13, s + 3.1)) * 2.0 - 1.0);
  float c = 1.0 - abs(noise(vec2(x * 4.37, s + 7.7)) * 2.0 - 1.0);
  return a * a * 0.6 + b * b * 0.28 + c * 0.12;
}
float stars(vec2 uv, float dens) {
  vec2 g = uv * 34.0;
  vec2 i = floor(g), f = fract(g) - 0.5;
  float h = hash12(i + u_seed);
  vec2 o = vec2(hash12(i + 3.7), hash12(i + 9.1)) - 0.5;
  float d = length(f - o * 0.6);
  float tw = 0.6 + 0.4 * sin(u_time * (2.0 + h * 4.0) + h * 30.0);
  return step(1.0 - dens, h) * (1.0 - smoothstep(0.02, 0.09, d)) * tw;
}

float AA = 0.004;   // one pixel in scene units (set in main)

vec3 peaks(vec2 uv) {
  float y = uv.y, x = uv.x, hz = 0.2;
  vec3 col = mix(vec3(0.015, 0.03, 0.1), vec3(0.32, 0.42, 0.62), smoothstep(-1.1, hz, y));
  col += vec3(0.9, 0.95, 1.0) * stars(uv, 0.12) * (1.0 - smoothstep(-0.5, 0.0, y));
  // aurora curtains
  float band = fbm(vec2(x * 1.4 + u_time * 0.04, u_time * 0.05 + u_seed));
  float ya = -0.55 + (band - 0.5) * 0.6;
  float rays = 0.55 + 0.45 * noise(vec2(x * 26.0 + band * 6.0, u_time * 0.4));
  float ay = (y - ya) / 0.16;
  float aur = exp(-ay * ay) * rays;
  col += mix(vec3(0.1, 1.0, 0.55), vec3(0.55, 0.3, 1.0), smoothstep(-0.2, 0.25, ya - y)) * aur * 0.55;
  // moon
  float md = length(uv - vec2(-0.42, -0.5));
  col += vec3(0.85, 0.9, 1.0) * ((1.0 - smoothstep(0.075, 0.075 + AA * 2.0, md)) * 0.9 + exp(-md * 7.0) * 0.25);
  // three ranges, far → near, with snow on the high slopes
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float xx = x * (1.1 + fk * 0.55) + u_par.x * (0.12 + fk * 0.22) + fk * 9.3 + u_seed;
    float rid = ridged(xx, fk * 5.0);
    float top = hz + fk * 0.13 - (0.62 - fk * 0.15) * rid;
    float cov = smoothstep(top - AA, top + AA, y);
    if (cov > 0.0) {
      float depth = max(y - top, 0.0);
      vec3 rock = mix(vec3(0.3, 0.38, 0.55), vec3(0.03, 0.05, 0.1), fk / 2.0);
      float snow = (1.0 - smoothstep(0.0, 0.1 + 0.08 * noise(vec2(xx * 6.0, y * 9.0)), depth)) * (1.0 - fk * 0.35);
      float lit = smoothstep(-0.2, 0.6, (ridged(xx + 0.04, fk * 5.0) - rid) * 1.5 + 0.3);
      vec3 c = mix(rock * (0.7 + 0.5 * lit), vec3(0.75, 0.82, 0.95) * (0.6 + 0.5 * lit), snow);
      c = mix(c, vec3(0.32, 0.42, 0.62), (0.45 - fk * 0.2) * (1.0 - smoothstep(0.0, 0.5, depth)));
      col = mix(col, c, cov);
    }
  }
  // a few warm temple lights in the valley
  vec2 lg = vec2(uv.x * 18.0 + u_seed, uv.y * 30.0);
  float lh = hash12(floor(lg));
  float li = step(0.93, lh) * (1.0 - smoothstep(0.05, 0.3, length(fract(lg) - 0.5))) * smoothstep(0.42, 0.6, y);
  col += vec3(1.0, 0.7, 0.3) * li * 1.5;
  return col;
}

vec3 canyon(vec2 uv) {
  float y = uv.y, x = uv.x, hz = 0.16;
  vec3 col = mix(vec3(0.2, 0.06, 0.3), vec3(0.98, 0.42, 0.26), smoothstep(-1.0, -0.2, y));
  col = mix(col, vec3(1.0, 0.8, 0.5), smoothstep(-0.25, hz, y));
  // a low sun behind thin streaks of cloud
  vec2 sp = vec2(-0.22 + u_par.x * 0.04, hz - 0.16);
  float sd = length(uv - sp);
  col += vec3(1.0, 0.86, 0.6) * ((1.0 - smoothstep(0.14, 0.14 + AA * 2.0, sd)) * 0.85 + exp(-sd * 3.5) * 0.45);
  float cl = noise(vec2(x * 2.2 + u_time * 0.02 + u_seed, y * 14.0)) * noise(vec2(x * 5.0 - u_time * 0.01, y * 30.0 + 3.0));
  col = mix(col, vec3(0.75, 0.3, 0.42), smoothstep(0.22, 0.5, cl) * (1.0 - smoothstep(-0.1, hz, y)) * 0.7);
  // flat-topped buttes (far, mid), then a rolling foreground
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float xx = x * (0.8 + fk * 0.6) + u_par.x * (0.1 + fk * 0.25) + fk * 13.1 + u_seed;
    float h = noise(vec2(xx * 1.7, fk * 3.0 + 1.0));
    float mesa = smoothstep(0.5, 0.56, h) * (0.32 - fk * 0.09) + 0.012 * noise(vec2(xx * 18.0, fk));
    if (k == 2) mesa = 0.05 + 0.035 * sin(xx * 2.6) + 0.02 * noise(vec2(xx * 7.0, 2.0));
    float top = hz + fk * 0.1 - mesa;
    float cov = smoothstep(top - AA, top + AA, y);
    if (cov > 0.0) {
      float depth = max(y - top, 0.0);
      vec3 rock = k == 0 ? vec3(0.78, 0.45, 0.45) : k == 1 ? vec3(0.62, 0.24, 0.14) : vec3(0.17, 0.06, 0.05);
      float strata = 0.94 + 0.06 * sin((y + 0.02 * noise(vec2(xx * 3.0, y * 4.0))) * 70.0);
      float cap = 1.0 - smoothstep(0.0, 0.05 + 0.1 * (1.0 - fk * 0.4), depth);
      vec3 c = rock * strata * (0.72 + 0.45 * cap);
      c = mix(c, vec3(1.0, 0.72, 0.5), (0.4 - fk * 0.18) * (1.0 - smoothstep(0.0, 0.45, depth)));   // dusty haze
      col = mix(col, c, cov);
    }
  }
  return col;
}

vec3 darkDim(vec2 uv) {
  float t = u_time * 0.06;
  float r = length(uv);
  vec2 p = rot2(t * 2.0 + r * 1.6) * uv;
  float n1 = fbm(p * 1.8 + vec2(t, u_seed));
  float n2 = fbm(p * 3.2 + n1 * 2.2 - vec2(t * 1.3, 0.0));
  vec3 col = mix(vec3(0.04, 0.0, 0.08), vec3(0.45, 0.04, 0.5), smoothstep(0.3, 0.75, n2));
  col = mix(col, vec3(1.0, 0.35, 0.65), smoothstep(0.62, 0.9, n2) * 0.8);
  col += vec3(1.0, 0.75, 0.95) * stars(uv * 1.3, 0.1) * 0.8;
  // the vortex heart
  vec2 vc = vec2(0.15, -0.1) + u_par * 0.08;
  float vd = length(uv - vc);
  col += vec3(1.0, 0.45, 0.85) * exp(-vd * 6.0) * 0.6 + vec3(1.0, 0.9, 1.0) * exp(-vd * 22.0) * 0.5;
  // drifting rocks
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 c = vec2(sin(fk * 2.3 + t * 3.0) * 0.55, cos(fk * 1.7 + t * 2.0) * 0.45 + 0.1);
    vec2 d = (uv - c) / vec2(0.16 - fk * 0.03, 0.08 - fk * 0.015);
    float rock = length(d) - 1.0 + 0.35 * noise(d * 2.0 + fk);
    col = mix(col, vec3(0.03, 0.01, 0.05), 1.0 - smoothstep(0.0, 0.08, rock));
    col += vec3(1.0, 0.4, 0.8) * (1.0 - smoothstep(0.0, 0.12, abs(rock))) * smoothstep(0.0, 0.5, -d.y) * 0.5;
  }
  return col;
}

void main() {
  vec2 q = (v_px - u_c) / u_r;
  float r = length(q);
  float o = u_open;
  AA = 1.4 / u_r;
  float sw = (1.0 - o) * (1.0 - o) * 7.0 * (1.0 - r);
  vec2 uv = rot2(sw) * q * (1.0 + (1.0 - o) * 1.3);
  uv = uv * 0.9 + u_par * vec2(0.3, 0.12);
  uv += 0.012 * vec2(sin(q.y * 28.0 + u_time * 6.0), cos(q.x * 28.0 + u_time * 5.0)) * smoothstep(0.65, 1.0, r);
  vec3 col;
  if (u_scene < 0.5) col = peaks(uv);
  else if (u_scene < 1.5) col = canyon(uv);
  else col = darkDim(uv);
  col *= 0.5 + 0.5 * (1.0 - smoothstep(0.5, 1.0, r));      // depth: darker toward the edge
  col += u_rim * pow(smoothstep(0.72, 1.0, r), 3.0) * 1.3;  // rim light spilling in
  float a = 1.0 - smoothstep(0.9, 1.0, r);
  outColor = vec4(col, a * u_alpha);
}
`;

// The blazing ring itself: a thin white-hot core, a soft halo and three
// bands of spark dashes racing round it.
const RIM = `
uniform vec2  u_c;
uniform float u_r;
uniform float u_spin;
uniform float u_amp;
uniform float u_seed;
uniform vec3  u_col;

// Dashes in N angular cells, each at its own radial offset and flicker.
float dashes(float a, float x, float N, float speed, float seed, float spread, float thick) {
  float s = fract(a / 6.2831853 + 0.5 - u_time * speed) * N;
  float id = floor(s), f = fract(s);
  float h1 = hash12(vec2(id, seed + u_seed)), h2 = hash12(vec2(id + 7.3, seed + 1.9));
  float ro = (h1 - 0.5) * spread;
  float len = 0.3 + 0.6 * h2;
  float along = 1.0 - smoothstep(len * 0.5 - 0.12, len * 0.5, abs(f - 0.5));
  float dx = (x - ro) / thick;
  float flick = 0.45 + 0.55 * sin(u_time * (9.0 + h2 * 12.0) + h1 * 40.0);
  return along * exp(-dx * dx) * flick * step(0.2, h2);
}

void main() {
  vec2 d = v_px - u_c;
  float r = length(d) / u_r;
  float a = atan(d.y, d.x);
  float a2 = a - u_time * 2.6 * u_spin;
  vec2 cs = vec2(cos(a2), sin(a2));
  float n1 = noise(cs * 3.2 + vec2(u_seed, u_time * 1.6));
  float n2 = noise(cs * 12.0 + vec2(u_seed * 1.7, u_time * 5.0));
  float x = r - 1.0;
  float w = 0.008 + 0.01 * n1;
  float core = exp(-(x * x) / (w * w));
  float halo = exp(-abs(x) * 11.0) * (0.16 + 0.3 * n1);
  float flame = smoothstep(0.55, 0.95, n2) * exp(-abs(x - 0.02) * 22.0);
  float th = 1.4 * u_dpr / u_r;
  float sp = dashes(a, x, 150.0, 0.42 * u_spin, 1.0, 0.05, th)
           + dashes(a, x, 96.0, 0.62 * u_spin, 2.0, 0.11, th * 1.3)
           + dashes(a, x, 64.0, 0.3 * u_spin, 3.0, 0.03, th * 1.8);
  vec3 hot = vec3(1.0, 0.95, 0.82);
  vec3 c = u_col * (halo + flame * 0.6) + mix(u_col, hot, 0.55) * core * (0.75 + 0.5 * n2) + mix(u_col, hot, 0.6) * sp * 1.6;
  outColor = vec4(c * u_amp, 1.0);
}
`;

// Ring buffer of low-res camera snapshots for the time echoes.
export class TimeEcho {
  constructor() { this.rts = null; this.times = [-9, -9, -9, -9]; this.k = 0; this.last = -9; }
  capture(gfx, t, every = 0.09) {
    if (!this.rts) this.rts = [0, 1, 2, 3].map(() => gfx.renderTarget(0.35));
    if (t - this.last < every) return;
    this.last = t;
    const rt = this.rts[this.k];
    gfx.bindTarget(rt);
    gfx.fullscreen(gfx.program('strange-copy', COPY));
    gfx.bindTarget(null);
    this.times[this.k] = t;
    this.k = (this.k + 1) % 4;
  }
  // Older snapshots: fainter ghosts.
  weights(t) {
    return this.times.map((ts) => {
      const age = t - ts;
      return age > 0.6 || age < 0 ? 0 : 0.75 * (1 - age / 0.6) + 0.15;
    });
  }
  reset() { this.times = [-9, -9, -9, -9]; this.last = -9; }
}

const lights = new Float32Array(16);

// look: { grade, mirror, maskOK, center: [x, y] (CSS px), echo, echoObj,
//         lights: Float32Array(16) (CSS px), tint: [r, g, b] }
export function renderWorld(gfx, look, t) {
  const d = gfx.dpr;
  const L = look.lights;
  for (let i = 0; i < 4; i++) {
    lights[i * 4] = L[i * 4] * d; lights[i * 4 + 1] = L[i * 4 + 1] * d;
    lights[i * 4 + 2] = Math.max(1, L[i * 4 + 2] * d); lights[i * 4 + 3] = L[i * 4 + 3];
  }
  const u = {
    u_grade: look.grade,
    u_mirror: look.mirror,
    u_maskOK: look.maskOK,
    u_center: [look.center[0] * d, look.center[1] * d],
    u_echo: look.echo,
    u_hw: [0, 0, 0, 0],
    u_light: lights,
    u_tint: look.tint,
  };
  const E = look.echoObj;
  if (look.echo > 0.001 && E && E.rts) {
    u.u_hw = E.weights(t);
    u.u_h0 = E.rts[0]; u.u_h1 = E.rts[1]; u.u_h2 = E.rts[2]; u.u_h3 = E.rts[3];
  } else {
    // samplers must still point at something valid
    u.u_h0 = u.u_h1 = u.u_h2 = u.u_h3 = gfx.videoTex;
  }
  gfx.fullscreen(gfx.program('strange-world', WORLD), u);
}

// portals: [{ x, y, R, k, open, scene, spin, seed, state }] in CSS px.
export function renderPortals(gfx, portals, W, H, rim) {
  if (!portals.length) return;
  const d = gfx.dpr;
  const inner = gfx.program('strange-portal', PORTAL);
  const ring = gfx.program('strange-rim', RIM);
  for (const p of portals) {
    const r = p.R * p.k;
    if (r < 2) continue;
    const fade = p.state === 'closing' ? Math.min(1, p.k * 1.5) : 1;
    const seg = r > 160 ? 120 : 72;
    gfx.circle(inner, p.x, p.y, r, {
      u_c: [p.x * d, p.y * d], u_r: r * d, u_open: Math.min(1, p.open), u_alpha: fade,
      u_scene: p.scene, u_par: [(p.x / W - 0.5) * 2, (p.y / H - 0.5) * 2], u_seed: p.seed, u_rim: rim,
    }, { blend: 'alpha', segments: seg });
    gfx.circle(ring, p.x, p.y, r * 1.45, {
      u_c: [p.x * d, p.y * d], u_r: r * d, u_spin: p.spin, u_amp: Math.min(1.2, 0.4 + p.k), u_seed: p.seed, u_col: rim,
    }, { blend: 'add', segments: seg });
  }
}
