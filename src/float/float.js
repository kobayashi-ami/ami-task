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
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 N = vec3(p, z);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  // Each bubble carries its own seed so no two membranes share a pattern.
  float t = (u_time + u_seed * 53.0) * 0.06;
  vec2 so = vec2(u_seed * 37.0, u_seed * 61.0);
  vec2 q = N.xy * 2.3 + so;
  vec2 warp = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, -t)));
  float film = fbm(q + warp * 1.8 + vec2(t * 0.5, -t * 0.3));

  float thickness = film * 0.9 + fres * 1.4 + r * 0.6 + t * 0.2 + u_seed;
  vec3 irid = pal(thickness);
  irid = mix(irid, irid.bgr, 0.35);
  // pull the oil-slick hue toward the project's status colour so 🟢🟡🔴 reads
  irid = mix(irid, u_tint * 2.0, 0.45);

  vec3 base = vec3(0.015, 0.02, 0.035) + u_tint * 0.03;
  float sheen = pow(film, 1.6) * 0.5 + fres * 0.9;
  vec3 col = base + irid * sheen;

  // status tint also washes the sheen and rim
  float rim = smoothstep(0.86, 1.0, r);
  col += u_tint * (sheen * 0.5 + rim * 0.7 + 0.12);

  vec2 lp = vec2(0.35 * cos(u_time * 0.2 + u_seed * 6.28),
                 0.42 + 0.2 * sin(u_time * 0.17 + u_seed * 6.28));
  float spec = pow(max(0.0, 1.0 - length(N.xy - lp) * 1.6), 8.0);
  col += vec3(0.6, 0.7, 0.9) * spec * 0.5;

  col += irid * rim * 0.9 + vec3(0.05) * rim;
  col *= mix(0.7, 1.0, r * 0.6 + 0.4);
  col *= (1.0 + 0.35 * u_hover);

  float edge = smoothstep(1.0, 0.9, r);
  float alpha = 0.9 * edge + rim * 0.6;
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

let program, uRes, uTime, uHover, uTint, uSeed;

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
  green: [0.05, 0.55, 0.28],
  amber: [0.6, 0.42, 0.06],
  red: [0.62, 0.08, 0.14],
};
let tint = TINTS.green;
let tintTarget = TINTS.green;

let hover = 0;
let hoverTarget = 0;
const start = performance.now();

function frame(now) {
  resize();
  hover += (hoverTarget - hover) * 0.08;
  for (let i = 0; i < 3; i++) tint[i] += (tintTarget[i] - tint[i]) * 0.05;
  if (gl && program) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uHover, hover);
    gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
    gl.uniform1f(uSeed, seed);
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
