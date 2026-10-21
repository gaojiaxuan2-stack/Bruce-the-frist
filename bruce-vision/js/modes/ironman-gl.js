// ironman-gl.js — the world as seen through the visor glass: a cinematic
// teal/orange grade, faint scanlines and a rolling scan band, chromatic
// aberration only at the extreme edges, heat shimmer around charging palms,
// light spilled by the repulsors, and the blast itself (flash, bloom, a
// radial zoom-blur "punch" toward the viewer and a refracting shockwave).
// The dark helmet frame is drawn on the 2D layer (ironman-visor.js) so it
// stays dark over bright rooms and blasts. At most 11 texture reads/pixel.

const FRAG = `
uniform float u_grade;     // 0..1 cinematic grade
uniform vec3  u_lo;        // shadow tint
uniform vec3  u_hi;        // highlight tint
uniform float u_sat;       // saturation
uniform float u_expo;      // exposure
uniform float u_visor;     // 0..1 scan band / glass effects
uniform vec3  u_hud;       // HUD colour (scan band)
uniform vec3  u_beam;      // repulsor light colour
uniform float u_flash;     // 0..1 full-screen flash
uniform vec2  u_shake;     // camera shake, device px
uniform vec4  u_blast;     // strongest blast: x, y, radius (device px), intensity
uniform vec4  u_wave;      // shockwave: x, y, ring radius (device px), strength
uniform vec4  u_light[3];  // repulsor light: x, y, radius (device px), intensity
uniform float u_heat[3];   // heat shimmer per light (charge)

float sq(float x) { return x * x; }

void main() {
  vec2 px = v_px;
  vec2 c = px - 0.5 * u_res;
  vec2 n = c / (0.5 * u_res);              // -1..1 across the screen
  vec2 sp = px + u_shake;

  // repulsor light + heat shimmer around charging palms
  float L = 0.0, heat = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 lt = u_light[i];
    if (lt.w > 0.0) {
      vec2 d = (px - lt.xy) / lt.z;
      float f = exp(-dot(d, d) * 2.2);
      L += lt.w * f;
      heat += u_heat[i] * exp(-dot(d, d) * 5.0);
    }
  }
  if (heat > 0.01) {
    vec2 q = px / (13.0 * u_dpr);
    vec2 w = vec2(noise(q + vec2(0.0, u_time * 5.0)), noise(q + vec2(7.3, 2.1) - vec2(0.0, u_time * 4.1))) - 0.5;
    sp += w * 6.0 * u_dpr * min(heat, 1.0);
  }

  // shockwave ring refracting the view
  float ring = 0.0;
  if (u_wave.w > 0.01) {
    vec2 d = sp - u_wave.xy;
    float r = max(length(d), 1.0);
    ring = exp(-sq((r - u_wave.z) / (34.0 * u_dpr))) * u_wave.w;
    sp -= d / r * ring * 26.0 * u_dpr;
  }

  // chromatic aberration that only shows toward the corners
  float edge = clamp(length(n) - 0.78, 0.0, 1.0);
  vec2 ca = c / max(length(c), 1.0) * (edge * edge * 16.0 + ring * 5.0) * u_dpr;
  vec3 col = vec3(cam(sp + ca).r, cam(sp).g, cam(sp - ca).b);

  // the blast punches out toward the viewer: radial zoom blur
  if (u_blast.w > 0.01) {
    vec2 d = sp - u_blast.xy;
    // tap step toward the blast, capped so the far side doesn't smear to mush
    vec2 st = d * 0.018 * min(u_blast.w, 1.5);
    float sl = length(st), cap = 5.0 * u_dpr;
    if (sl > cap) st *= cap / sl;
    float j = hash12(px + fract(u_time * 7.13) * 97.0);   // jitter hides the tap steps
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) acc += cam(sp - st * (float(i) + j));
    col = mix(col, acc / 8.0, clamp(u_blast.w * 1.2, 0.0, 0.9));
  }

  // grade: saturation, filmic S-curve, teal shadows / warm highlights
  float l = luma(col);
  vec3 g = mix(vec3(l), col, u_sat);
  g = clamp(g, 0.0, 1.0);
  g = mix(g, g * g * (3.0 - 2.0 * g), 0.5);
  g *= mix(u_lo, u_hi, smoothstep(0.04, 0.8, l));
  g *= u_expo;
  col = mix(col, g, u_grade);

  // light spilled by the repulsors, with a monotonic soft shoulder so
  // bright surfaces roll off instead of clipping (or inverting) to white
  L = min(L, 1.3);
  vec3 lit = col * (1.0 + u_beam * L * 0.9) + u_beam * L * 0.05;
  col = mix(lit, 0.8 + 0.2 * (1.0 - exp(-(lit - 0.8) * 5.0)), step(0.8, lit));
  col += u_beam * ring * 0.18;

  // blast bloom (white-hot centre, coloured falloff)
  if (u_blast.w > 0.0) {
    vec2 d = (px - u_blast.xy) / u_blast.z;
    float b = exp(-dot(d, d) * 1.6) * u_blast.w;
    col += u_beam * b * 0.95 + vec3(b * b * 0.45);
  }

  // faint scanlines and a slow rolling scan band
  float sl = 0.5 + 0.5 * sin(px.y * 3.14159 / (1.5 * u_dpr));
  col *= 1.0 - 0.05 * sl * u_grade;
  float band = fract(px.y / u_res.y - u_time * 0.06);
  col += u_hud * 0.035 * exp(-sq((band - 0.5) * 14.0)) * u_visor;
  // the glass: a faint cool sheen across the upper-left
  col += vec3(0.6, 0.85, 1.0) * exp(-sq((n.x + n.y * 0.8 + 0.95) / 0.09)) * 0.03 * u_visor;

  col = mix(col, vec3(0.9, 0.97, 1.0), clamp(u_flash, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}
`;

const lights = new Float32Array(12);
const heat = new Float32Array(3);

// p: { grade, lo, hi, sat, expo, visor, hud, beam, flash, shake:{x,y},
//      blast:[x,y,r,i], wave:[x,y,R,s], lights:[[x,y,r,i,heat]…] } (CSS px)
export function renderSuit(gfx, p) {
  const prog = gfx.program('ironman-world', FRAG);
  const d = gfx.dpr;
  lights.fill(0); heat.fill(0);
  for (let i = 0; i < Math.min(3, p.lights.length); i++) {
    const L = p.lights[i];
    lights[i * 4] = L[0] * d; lights[i * 4 + 1] = L[1] * d; lights[i * 4 + 2] = Math.max(1, L[2] * d); lights[i * 4 + 3] = L[3];
    heat[i] = L[4] || 0;
  }
  const b = p.blast, w = p.wave;
  gfx.fullscreen(prog, {
    u_grade: p.grade, u_lo: p.lo, u_hi: p.hi, u_sat: p.sat, u_expo: p.expo,
    u_visor: p.visor, u_hud: p.hud, u_beam: p.beam, u_flash: p.flash,
    u_shake: [p.shake.x * d, p.shake.y * d],
    u_blast: [b[0] * d, b[1] * d, Math.max(1, b[2] * d), b[3]],
    u_wave: [w[0] * d, w[1] * d, w[2] * d, w[3]],
    u_light: lights,
    u_heat: heat,
  });
}
