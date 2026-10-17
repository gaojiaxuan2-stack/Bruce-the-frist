// ironman-gl.js — the world as seen from inside the helmet: a cinematic
// teal/orange grade, the dark curved edges of the visor, faint scanlines,
// chromatic aberration only at the extreme edges, light spilled by charging
// repulsors, and the blast itself (white flash, bloom and a radial zoom-blur
// "punch" toward the viewer). At most 11 texture reads per pixel.

const FRAG = `
uniform float u_grade;     // 0..1 cinematic grade
uniform vec3  u_lo;        // shadow tint
uniform vec3  u_hi;        // highlight tint
uniform float u_sat;       // saturation
uniform float u_expo;      // exposure
uniform float u_visor;     // 0..1 helmet framing
uniform vec3  u_hud;       // HUD colour (visor rim, scan band)
uniform vec3  u_beam;      // repulsor light colour
uniform float u_flash;     // 0..1 full-screen flash
uniform vec2  u_shake;     // camera shake, device px
uniform vec4  u_blast;     // strongest blast: x, y, radius (device px), intensity
uniform vec4  u_light[3];  // repulsor light: x, y, radius (device px), intensity

float sq(float x) { return x * x; }

void main() {
  vec2 px = v_px;
  vec2 c = px - 0.5 * u_res;
  vec2 n = c / (0.5 * u_res);              // -1..1 across the screen
  vec2 sp = px + u_shake;

  // chromatic aberration that only shows toward the corners
  float edge = clamp(length(n) - 0.78, 0.0, 1.0);
  vec2 ca = c / max(length(c), 1.0) * edge * edge * 16.0 * u_dpr;
  vec3 col = vec3(cam(sp + ca).r, cam(sp).g, cam(sp - ca).b);

  // the blast punches out toward the viewer: radial zoom blur
  if (u_blast.w > 0.01) {
    vec2 d = sp - u_blast.xy;
    float k = 0.027 * min(u_blast.w, 1.5);
    float j = hash12(px + fract(u_time * 7.13) * 97.0);   // jitter hides the tap steps
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) acc += cam(u_blast.xy + d * (1.0 - k * (float(i) + j)));
    col = mix(col, acc / 8.0, clamp(u_blast.w * 1.4, 0.0, 1.0));
  }

  // grade: saturation, filmic S-curve, teal shadows / warm highlights
  float l = luma(col);
  vec3 g = mix(vec3(l), col, u_sat);
  g = clamp(g, 0.0, 1.0);
  g = mix(g, g * g * (3.0 - 2.0 * g), 0.5);
  g *= mix(u_lo, u_hi, smoothstep(0.04, 0.8, l));
  g *= u_expo;
  col = mix(col, g, u_grade);

  // light spilled by charging repulsors
  float L = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 lt = u_light[i];
    if (lt.w > 0.0) {
      vec2 d = (px - lt.xy) / lt.z;
      L += lt.w * exp(-dot(d, d) * 2.2);
    }
  }
  col += col * u_beam * L * 1.5 + u_beam * L * 0.08;

  // blast bloom (white-hot centre, coloured falloff)
  if (u_blast.w > 0.0) {
    vec2 d = (px - u_blast.xy) / u_blast.z;
    float b = exp(-dot(d, d) * 1.6) * u_blast.w;
    col += u_beam * b * 1.1 + vec3(b * b * 0.6);
  }

  // faint scanlines and a slow rolling scan band
  float sl = 0.5 + 0.5 * sin(px.y * 3.14159 / (1.5 * u_dpr));
  col *= 1.0 - 0.05 * sl * u_grade;
  float band = fract(px.y / u_res.y - u_time * 0.06);
  col += u_hud * 0.03 * exp(-sq((band - 0.5) * 14.0)) * u_visor;

  // helmet visor: a rounded eye slot, pinched at the lower corners,
  // dark curved edges and a faint HUD-coloured rim on the glass
  vec2 q = n;
  q.y -= 0.06;
  float d = pow(pow(abs(q.x) / 1.03, 4.0) + pow(abs(q.y) / 1.0, 4.0), 0.25);
  d += max(q.y, 0.0) * abs(q.x) * 0.26;
  float shade = smoothstep(0.82, 1.1, d);
  col *= 1.0 - shade * 0.86 * u_visor;
  float rim = exp(-sq((d - 0.86) / 0.035));
  col += u_hud * rim * 0.09 * u_visor;
  // glass sheen across the upper-left
  float sheen = exp(-sq((n.x + n.y * 0.8 + 0.95) / 0.09)) * (1.0 - shade);
  col += vec3(0.6, 0.85, 1.0) * sheen * 0.035 * u_visor;

  col = mix(col, vec3(0.9, 0.97, 1.0), clamp(u_flash, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}
`;

const lights = new Float32Array(12);

// p: { grade, lo, hi, sat, expo, visor, hud, beam, flash, shake:{x,y}, blast:[x,y,r,i] (CSS px), lights:[[x,y,r,i]…] (CSS px) }
export function renderSuit(gfx, p) {
  const prog = gfx.program('ironman-world', FRAG);
  const d = gfx.dpr;
  lights.fill(0);
  for (let i = 0; i < Math.min(3, p.lights.length); i++) {
    const L = p.lights[i];
    lights[i * 4] = L[0] * d; lights[i * 4 + 1] = L[1] * d; lights[i * 4 + 2] = Math.max(1, L[2] * d); lights[i * 4 + 3] = L[3];
  }
  const b = p.blast;
  gfx.fullscreen(prog, {
    u_grade: p.grade, u_lo: p.lo, u_hi: p.hi, u_sat: p.sat, u_expo: p.expo,
    u_visor: p.visor, u_hud: p.hud, u_beam: p.beam, u_flash: p.flash,
    u_shake: [p.shake.x * d, p.shake.y * d],
    u_blast: [b[0] * d, b[1] * d, Math.max(1, b[2] * d), b[3]],
    u_light: lights,
  });
}
