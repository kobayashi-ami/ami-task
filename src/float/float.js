'use strict';

// ===========================================================================
// The membrane — a black-ink soap film rendered with a WebGL fragment shader.
// Thin-film iridescence over a near-black base, a Fresnel rim, a slow wet
// glint, and domain-warped flow so the surface breathes like oil on water.
// ===========================================================================

const canvas = document.getElementById('membrane');
const gl = canvas.getContext('webgl', {
  alpha: true,
  premultipliedAlpha: false, // we output straight (non-premultiplied) RGBA
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

// iq cosine palette — the raw hues of thin-film interference.
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

  // Treat the disc as a sphere to get a believable membrane curvature.
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 N = vec3(p, z);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);

  float t = u_time * 0.06;

  // Domain-warped flow over the surface — oil crawling across the film.
  vec2 q = N.xy * 2.3;
  vec2 warp = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, -t)));
  float film = fbm(q + warp * 1.8 + vec2(t * 0.5, -t * 0.3));

  // Interference index: thicker toward the rim, stirred by the flow.
  float thickness = film * 0.9 + fres * 1.4 + r * 0.6 + t * 0.2;
  vec3 irid = pal(thickness);
  irid = mix(irid, irid.bgr, 0.35); // bias toward eerie violets/greens

  // Near-black ink base, faintly blue.
  vec3 base = vec3(0.015, 0.02, 0.035);

  // Sheen only where the film crests or the rim catches light.
  float sheen = pow(film, 1.6) * 0.5 + fres * 0.9;
  vec3 col = base + irid * sheen;

  // A wet, glassy glint drifting slowly across the surface.
  vec2 lp = vec2(0.35 * cos(u_time * 0.2), 0.42 + 0.2 * sin(u_time * 0.17));
  float spec = pow(max(0.0, 1.0 - length(N.xy - lp) * 1.6), 8.0);
  col += vec3(0.6, 0.7, 0.9) * spec * 0.5;

  // The tell-tale luminous ring at the edge of the bubble.
  float rim = smoothstep(0.86, 1.0, r);
  col += irid * rim * 0.9 + vec3(0.05) * rim;

  // Interior depth.
  col *= mix(0.7, 1.0, r * 0.6 + 0.4);

  // Hover: the whole membrane leans in and brightens.
  col *= (1.0 + 0.35 * u_hover);

  // Ink body opaque, edge feathered, rim luminous.
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

let program;
let uRes;
let uTime;
let uHover;

function initGL() {
  if (!gl) {
    document.body.classList.add('no-webgl');
    console.error('WebGL unavailable.');
    return false;
  }
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  // Fullscreen triangle.
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uRes = gl.getUniformLocation(program, 'u_res');
  uTime = gl.getUniformLocation(program, 'u_time');
  uHover = gl.getUniformLocation(program, 'u_hover');

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

let hover = 0;
let hoverTarget = 0;
const start = performance.now();

function frame(now) {
  resize();
  hover += (hoverTarget - hover) * 0.08;
  if (gl && program) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uHover, hover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Task text + interactions
// ---------------------------------------------------------------------------
const taskEl = document.getElementById('task');
const taskTextEl = document.getElementById('task-text');
const editBtn = document.getElementById('edit');

function renderTask(payload) {
  const text = (payload && payload.task ? payload.task : '').trim();
  if (text) {
    taskTextEl.textContent = text;
    taskEl.classList.remove('empty');
  } else {
    taskTextEl.textContent = '…';
    taskEl.classList.add('empty');
  }
}

if (window.ami) {
  window.ami.getTask().then(renderTask);
  window.ami.onTaskUpdated(renderTask);
}

editBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (window.ami) window.ami.openEditor();
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (window.ami) window.ami.bubbleContextMenu();
});

document.body.addEventListener('mouseenter', () => (hoverTarget = 1));
document.body.addEventListener('mouseleave', () => (hoverTarget = 0));

// ---------------------------------------------------------------------------
if (initGL()) {
  resize();
  requestAnimationFrame(frame);
}
