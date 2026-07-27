'use strict';

// ===========================================================================
// A project bubble — a black-ink soap film rendered with a WebGL shader.
// Thin-film iridescence over near-black, a Fresnel rim, a wet glint, oil flow,
// and a faint status tint (green / amber / red) bled into the sheen.
// ===========================================================================

const canvas = document.getElementById('membrane');
const gl = canvas.getContext('webgl', {
  alpha: true,
  premultipliedAlpha: false,
  antialias: true,
  depth: false,
});

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_hover;
uniform vec3  u_tint;
uniform float u_seed;
uniform float u_active;
uniform float u_mass;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
vec3 pal(float t) {
  vec3 a = vec3(0.5);
  vec3 b = vec3(0.5);
  vec3 c = vec3(1.0);
  vec3 d = vec3(0.0, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= u_res.x / u_res.y;
  float r = length(p);
  float a = atan(p.y, p.x);

  float tt = u_time + u_seed * 53.0;

  // Liquid, wobbling silhouette — the membrane breathes like real soap film.
  // Pure harmonics keep it seamless around the circle (no atan crease).
  float wob =
      0.030 * sin(a * 3.0 + tt * 0.9 + u_seed * 6.28)
    + 0.020 * sin(a * 5.0 - tt * 0.7)
    + 0.015 * sin(a * 7.0 + tt * 0.55 + u_seed * 3.0)
    + 0.012 * sin(a * 2.0 - tt * 1.15);
  // Mass from the task text gives the bubble weight: under gravity it sags
  // into a heavy droplet — the top pinches, the bottom fills out — and it
  // jiggles gently like jelly.
  float vdir = -p.y / max(r, 0.0001); // +1 at the bottom, -1 at the top
  float sag = u_mass * 0.11 * vdir * (1.0 + 0.12 * sin(tt * 1.6));
  float bound = 0.86 + wob + 0.02 * sin(tt * 0.6) + sag;
  bound = min(bound, 0.965); // never let it clip the window edge
  if (r > bound) { gl_FragColor = vec4(0.0); return; }

  float rn = r / bound; // normalised radius within the wobbling disc
  float z = sqrt(max(0.0, 1.0 - rn * rn));
  vec3 N = vec3(p / bound, z);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  // Turbulent, layered flow — more shimmer, faster and alive. Per-seed offset.
  float t = tt * 0.09;
  vec2 so = vec2(u_seed * 37.0, u_seed * 61.0);
  vec2 q = N.xy * 2.4 + so;
  vec2 warp = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, -t)));
  warp += 0.5 * vec2(fbm(q * 2.1 - t), fbm(q * 2.1 + t * 1.3));
  float film = fbm(q + warp * 2.2 + vec2(t * 0.6, -t * 0.35));
  float film2 = fbm(q * 1.7 - warp * 1.3 + vec2(-t * 0.4, t * 0.5));

  float thickness = film * 0.9 + film2 * 0.5 + fres * 1.5 + rn * 0.6 + t * 0.25 + u_seed;
  vec3 irid = pal(thickness);
  irid = mix(irid, irid.bgr, 0.35);
  // a Prince-purple bleeds through the raw oil-slick and pulses...
  vec3 prince = vec3(0.42, 0.06, 0.55);
  irid = mix(irid, prince, 0.16 + 0.10 * sin(tt * 0.5 + thickness * 3.0));
  // ...then the status colour dominates last, so 🟢🟡🔴 always reads (green
  // no longer gets washed out by the purple).
  irid = mix(irid, u_tint * 2.0, 0.5);

  vec3 base = vec3(0.015, 0.02, 0.04) + u_tint * 0.03;
  float sheen = pow(film, 1.5) * 0.6 + fres * 0.95;
  vec3 col = base + irid * sheen;

  // A soft, misty rim whose thickness wobbles around the bubble, so the edge
  // reads as a curved film — not a flat 2-D white outline.
  float rimWob = 0.55 + 0.30 * sin(a * 4.0 + tt * 0.8 + u_seed * 6.28)
                      + 0.15 * sin(a * 7.0 - tt * 0.6);
  float rimStart = 0.55 + 0.22 * clamp(rimWob, 0.0, 1.0);
  float rim = smoothstep(rimStart, 1.0, rn);
  rim *= 0.45 + 0.75 * film; // break the ring into drifting mist
  rim = clamp(rim, 0.0, 1.0);
  col += u_tint * (sheen * 0.5 + rim * 0.5 + 0.12);

  // Prince-PV glossy glints: a bright white catch-light and a magenta glam
  // streak, both drifting — high-contrast, wet, cinematic.
  vec2 lp1 = vec2(0.34 * cos(u_time * 0.35 + u_seed * 6.28),
                  0.40 + 0.22 * sin(u_time * 0.27 + u_seed * 6.28));
  float g1 = pow(max(0.0, 1.0 - length(N.xy - lp1) * 1.7), 10.0);
  vec2 lp2 = vec2(0.30 * cos(-u_time * 0.23 + u_seed * 3.0 + 2.0),
                 -0.35 + 0.20 * sin(u_time * 0.31 + u_seed * 3.0));
  float g2 = pow(max(0.0, 1.0 - length(N.xy - lp2) * 2.2), 12.0);
  col += vec3(0.90, 0.95, 1.0) * g1 * 0.7;
  col += vec3(0.85, 0.20, 0.95) * g2 * 0.7;

  // luminous rim that slowly breathes — coloured by the film's own
  // iridescence and purple, never a flat white line
  float pulse = 0.75 + 0.25 * sin(tt * 0.8);
  col += irid * rim * 0.8 + mix(prince, u_tint, 0.5) * rim * pulse * 0.6;

  // "current" marker: the active project wears a warm gold halo
  col += vec3(0.95, 0.72, 0.26) * rim * u_active * (0.55 + 0.45 * pulse);

  col *= mix(0.68, 1.0, rn * 0.6 + 0.4);
  col *= (1.0 + 0.4 * u_hover + 0.15 * u_active);

  float edge = smoothstep(1.0, 0.86, rn);
  float feather = smoothstep(bound, bound - 0.09, r); // softer, mistier lip
  float alpha = (0.9 * edge + rim * 0.6) * feather;
  alpha = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(sh));
  }
  return sh;
}

let program, uRes, uTime, uHover, uTint, uSeed, uActive, uMass;

// A stable per-project seed derived from the project id (FNV-1a hash → 0..1),
// so each bubble's membrane looks distinct and never repeats another's.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function initGL() {
  if (!gl) {
    console.error('WebGL unavailable.');
    return false;
  }
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uRes = gl.getUniformLocation(program, 'u_res');
  uTime = gl.getUniformLocation(program, 'u_time');
  uHover = gl.getUniformLocation(program, 'u_hover');
  uTint = gl.getUniformLocation(program, 'u_tint');
  uSeed = gl.getUniformLocation(program, 'u_seed');
  uActive = gl.getUniformLocation(program, 'u_active');
  uMass = gl.getUniformLocation(program, 'u_mass');

  gl.clearColor(0, 0, 0, 0);
  return true;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    if (gl) gl.viewport(0, 0, w, h);
  }
}

// status → tint colour
const TINTS = {
  green: [0.06, 0.72, 0.34],
  amber: [0.62, 0.42, 0.05],
  red: [0.64, 0.07, 0.13],
};
let tint = TINTS.green;
let tintTarget = TINTS.green;

let hover = 0;
let hoverTarget = 0;
let active = 0;
let activeTarget = 0;
let mass = 0;
let massTarget = 0;
const start = performance.now();

function frame(now) {
  resize();
  hover += (hoverTarget - hover) * 0.08;
  active += (activeTarget - active) * 0.06;
  mass += (massTarget - mass) * 0.05; // ease weight changes as you type
  for (let i = 0; i < 3; i++) tint[i] += (tintTarget[i] - tint[i]) * 0.05;
  if (gl && program) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uHover, hover);
    gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
    gl.uniform1f(uSeed, seed);
    gl.uniform1f(uActive, active);
    gl.uniform1f(uMass, mass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Project data + interactions
// ---------------------------------------------------------------------------
const nameEl = document.getElementById('name');
const taskEl = document.getElementById('task');
const taskTextEl = document.getElementById('task-text');
const branchEl = document.getElementById('branch');
const editBtn = document.getElementById('edit');

const myId = window.ami ? window.ami.projectId : null;
const seed = myId ? hashStr(myId) : Math.random();

function render(p) {
  if (!p || (myId && p.id !== myId)) return;
  nameEl.textContent = p.name || '—';
  const now = (p.now || '').trim();
  if (now) {
    taskTextEl.textContent = now;
    taskEl.classList.remove('empty');
  } else {
    taskTextEl.textContent = '…';
    taskEl.classList.add('empty');
  }
  branchEl.textContent = p.branch ? '⑂ ' + p.branch : '';
  tintTarget = TINTS[p.status] || TINTS.green;
  activeTarget = p.active ? 1 : 0;
  massTarget = Math.min(now.length / 80, 1); // heavier the more you write
}

if (window.ami && myId) {
  window.ami.getProject(myId).then(render);
  window.ami.onProjectUpdated(render);
}

editBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (window.ami) window.ami.openEditor(myId);
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (window.ami) window.ami.bubbleContextMenu(myId);
});

// Hovering swells the bubble (via main) and reveals its detail; leaving lets
// it drift off again.
document.body.addEventListener('mouseenter', () => {
  hoverTarget = 1;
  document.body.classList.add('expanded');
  if (window.ami) window.ami.setHover(myId, true);
});
document.body.addEventListener('mouseleave', () => {
  hoverTarget = 0;
  document.body.classList.remove('expanded');
  if (window.ami) window.ami.setHover(myId, false);
});

if (initGL()) {
  resize();
  requestAnimationFrame(frame);
}
