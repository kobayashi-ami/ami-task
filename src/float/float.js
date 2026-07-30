'use strict';

// ===========================================================================
// The overlay: ONE full-screen, transparent, click-through window that draws
// EVERY project bubble inside a single WebGL canvas. Bubbles drift in-canvas
// (no OS window is ever moved) — this removes the macOS transparent-window
// move-flicker at its source and collapses N GPU contexts into one.
//
// Text rides in a DOM layer above the canvas, each label following its bubble,
// with a frosted backplate so contrast stays readable over the glassy membrane
// and whatever desktop shows through. Motion is deliberately calm.
// ===========================================================================

const canvas = document.getElementById('membrane');
const labels = document.getElementById('bubbles');
const gl = canvas.getContext('webgl', {
  alpha: true,
  premultipliedAlpha: false,
  antialias: true,
  depth: false,
});

// --- one quad per bubble; the vertex shader places it at the bubble's rect ---
const VERT = `
attribute vec2 a_quad;      // [-1,1] local
uniform vec2  u_center;     // bubble centre in device px
uniform float u_half;       // half extent in device px (radius * margin)
uniform vec2  u_res;        // canvas size in device px
varying vec2  v_p;          // local coord, radius 1.0 == bubble edge scale
void main() {
  v_p = a_quad * 1.35;      // extra margin for the fog halo
  vec2 px = u_center + a_quad * u_half;
  vec2 clip = (px / u_res) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform float u_time;
uniform float u_hover;
uniform vec3  u_tint;
uniform float u_seed;
uniform float u_active;
uniform float u_mass;
varying vec2  v_p;

float hash(vec2 p){ p = fract(p*vec2(123.34,345.45)); p += dot(p,p+34.345); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=0.5; }
  return v;
}
vec3 pal(float t){ return 0.5+0.5*cos(6.28318*(vec3(1.0)*t+vec3(0.0,0.33,0.67))); }

void main(){
  vec2 p = v_p;
  float r = length(p);
  float a = atan(p.y, p.x);

  // Calm time: everything animates slowly to avoid peripheral-motion fatigue.
  float tt = u_time * 0.55 + u_seed * 53.0;

  // wobbling liquid silhouette (seamless harmonics)
  float wob = 0.030*sin(a*3.0+tt*0.9+u_seed*6.28)
            + 0.020*sin(a*5.0-tt*0.7)
            + 0.015*sin(a*7.0+tt*0.55+u_seed*3.0)
            + 0.012*sin(a*2.0-tt*1.15);
  float vdir = -p.y / max(r, 0.0001);
  float sag = u_mass * 0.11 * vdir * (1.0 + 0.12*sin(tt*1.6));
  float bound = 0.86 + wob + 0.02*sin(tt*0.6) + sag;
  bound = min(bound, 0.90);
  float fogOuter = 0.99;
  if (r > fogOuter) { gl_FragColor = vec4(0.0); return; }

  float rn = clamp(r/bound, 0.0, 1.0);
  float z = sqrt(max(0.0, 1.0-rn*rn));
  vec3 N = vec3(p/bound, z);
  float ndv = clamp(N.z, 0.0, 1.0);
  float fres = pow(1.0-ndv, 3.0);

  float t = tt*0.09;
  vec2 so = vec2(u_seed*37.0, u_seed*61.0);
  vec2 q = N.xy*2.4 + so;
  vec2 warp = vec2(fbm(q+vec2(0.0,t)), fbm(q+vec2(5.2,-t)));
  warp += 0.5*vec2(fbm(q*2.1-t), fbm(q*2.1+t*1.3));
  float film = fbm(q + warp*2.2 + vec2(t*0.6,-t*0.35));
  float film2 = fbm(q*1.7 - warp*1.3 + vec2(-t*0.4,t*0.5));

  float thickness = film*0.9 + film2*0.5 + fres*1.5 + rn*0.6 + t*0.25 + u_seed;
  vec3 irid = pal(thickness);
  irid = mix(irid, irid.bgr, 0.35);
  vec3 prince = vec3(0.42,0.06,0.55);
  irid = mix(irid, prince, 0.16 + 0.10*sin(tt*0.5 + thickness*3.0));
  irid = mix(irid, u_tint*2.0, 0.5);

  vec3 base = vec3(0.015,0.02,0.04) + u_tint*0.03;
  float sheen = pow(film,1.5)*0.6 + fres*0.95;
  vec3 col = base + irid*sheen;

  // thin, faint edge catch (no wide coloured outline)
  float rimStart = 0.90 + 0.05*sin(a*5.0 + tt*0.8 + u_seed*6.28);
  float rim = smoothstep(rimStart, 1.0, rn);
  rim *= 0.5 + 0.5*film;
  rim = clamp(rim, 0.0, 1.0);
  col += u_tint*(sheen*0.5 + 0.12);

  // slow glossy glints
  vec2 lp1 = vec2(0.34*cos(u_time*0.2+u_seed*6.28), 0.40+0.22*sin(u_time*0.16+u_seed*6.28));
  float g1 = pow(max(0.0,1.0-length(N.xy-lp1)*1.7),10.0);
  vec2 lp2 = vec2(0.30*cos(-u_time*0.13+u_seed*3.0+2.0), -0.35+0.20*sin(u_time*0.18+u_seed*3.0));
  float g2 = pow(max(0.0,1.0-length(N.xy-lp2)*2.2),12.0);
  col += vec3(0.90,0.95,1.0)*g1*0.7;
  col += vec3(0.85,0.20,0.95)*g2*0.7;

  float pulse = 0.75 + 0.25*sin(tt*0.8);
  col += irid*rim*0.30;
  col += vec3(0.95,0.72,0.26)*rim*u_active*(0.55+0.45*pulse);
  // soft dark core: gives the text zone contrast from the membrane itself
  // (no rectangular backplate needed) while the rim stays glassy and bright.
  col *= mix(0.40, 1.0, smoothstep(0.0, 0.6, rn));
  col *= (1.0 + 0.4*u_hover + 0.15*u_active);

  // glass, but present: clear-ish centre, denser grazing edge
  float edge = smoothstep(1.0, 0.82, rn);
  float bodyMask = smoothstep(bound, bound-0.06, r);
  float glass = 0.52 + 0.42*fres;
  float bodyAlpha = (glass*edge + rim*0.4) * bodyMask;

  // original wispy mist that streams outward and frays
  vec2 dir = p/max(r,0.0001);
  vec2 fp = p*3.2 + so;
  vec2 fw = vec2(fbm(fp+vec2(0.0,t)), fbm(fp+vec2(4.3,-t)));
  float mist = fbm(fp*1.5 + fw*1.9 - dir*t*1.1);
  float mist2 = fbm(fp*3.3 + fw*0.8 + dir*t*0.6);
  mist = mist*0.7 + mist2*0.3;
  float rr = clamp((r-bound)/(fogOuter-bound), 0.0, 1.0);
  float fall = pow(1.0-rr, 1.8);
  float density = clamp(fall*(0.22 + 1.15*mist), 0.0, 1.0);
  density *= smoothstep(0.02, 0.35, mist*(1.0-rr)+0.15);
  float haloAlpha = density*(0.18+0.05*sin(tt*0.6+u_seed*6.28))*(1.0-bodyMask);
  vec3 fogCol = mix(vec3(0.015,0.02,0.05), irid*0.45+prince*0.35+u_tint*0.25, 0.30+0.5*mist);

  vec3 outCol = mix(fogCol, col, bodyMask);
  float alpha = clamp(bodyAlpha + haloAlpha, 0.0, 1.0);
  gl_FragColor = vec4(outCol, alpha);
}
`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error('Shader:', gl.getShaderInfoLog(sh));
  return sh;
}

let program;
const U = {};
function initGL() {
  if (!gl) { console.error('WebGL unavailable'); return false; }
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_quad');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  for (const n of ['u_center','u_half','u_res','u_time','u_hover','u_tint','u_seed','u_active','u_mass']) {
    U[n] = gl.getUniformLocation(program, n);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------
const MIN = 116;      // CSS px, drifting size
const MAX = 250;      // CSS px, hovered/expanded size
const TINTS = {
  green: [0.06, 0.72, 0.34],
  amber: [0.62, 0.42, 0.05],
  red: [0.64, 0.07, 0.13],
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

const bubbles = new Map(); // id -> bubble state
let activeId = null;
let dragId = null;
let dragDX = 0, dragDY = 0;

function vw() { return window.innerWidth; }
function vh() { return window.innerHeight; }

function makeBubble(p) {
  const size = MIN;
  const ang = Math.random() * Math.PI * 2;
  const sp = 0.35 + Math.random() * 0.25; // calm drift
  const b = {
    id: p.id,
    cx: MIN / 2 + Math.random() * Math.max(1, vw() - MIN),
    cy: MIN / 2 + Math.random() * Math.max(1, vh() - MIN),
    vx: Math.cos(ang) * sp,
    vy: Math.sin(ang) * sp,
    size, target: MIN,
    hover: 0, hoverTarget: 0,
    active: 0, activeTarget: 0,
    mass: 0, massTarget: 0,
    tint: TINTS[p.status] || TINTS.green,
    tintTarget: TINTS[p.status] || TINTS.green,
    seed: hashStr(p.id),
    hovered: false,
    el: makeLabel(),
  };
  updateBubbleData(b, p);
  return b;
}

function makeLabel() {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML =
    '<div class="l-name"></div>' +
    '<div class="l-now"><span class="l-now-text">…</span></div>' +
    '<div class="l-branch"></div>' +
    '<button class="l-edit" title="Edit (⌘⇧Space)">✎</button>';
  labels.appendChild(el);
  return el;
}

function updateBubbleData(b, p) {
  b.data = p;
  b.tintTarget = TINTS[p.status] || TINTS.green;
  b.activeTarget = p.active ? 1 : 0;
  const now = (p.now || '').trim();
  b.massTarget = Math.min(now.length / 80, 1);
  b.el.querySelector('.l-name').textContent = p.name || '—';
  const nowText = b.el.querySelector('.l-now-text');
  nowText.textContent = now || '…';
  b.el.querySelector('.l-now').classList.toggle('empty', !now);
  b.el.querySelector('.l-branch').textContent = p.branch ? '⑂ ' + p.branch : '';
}

function syncProjects(payload) {
  const seen = new Set();
  activeId = payload.activeId;
  for (const p of payload.projects) {
    seen.add(p.id);
    if (bubbles.has(p.id)) updateBubbleData(bubbles.get(p.id), p);
    else bubbles.set(p.id, makeBubble(p));
  }
  for (const [id, b] of bubbles) {
    if (!seen.has(id)) { b.el.remove(); bubbles.delete(id); }
  }
}

// ---------------------------------------------------------------------------
// Physics — calm drift, gravity by mass, hover swell, dragging. All in CSS px.
// ---------------------------------------------------------------------------
function physics() {
  const W = vw(), H = vh();
  for (const b of bubbles.values()) {
    // ease visual params
    b.hover += (b.hoverTarget - b.hover) * 0.08;
    b.active += (b.activeTarget - b.active) * 0.06;
    b.mass += (b.massTarget - b.mass) * 0.05;
    for (let i = 0; i < 3; i++) b.tint[i] += (b.tintTarget[i] - b.tint[i]) * 0.05;
    b.target = b.hovered ? MAX : MIN;
    b.size += (b.target - b.size) * 0.18;

    if (b.id === dragId) continue; // being dragged: position set by mouse
    if (b.hovered) continue;       // paused while hovered

    // gentle gravity/buoyancy by mass
    b.vy += (b.mass - 0.35) * 0.02;
    // slow organic wander
    b.vx += (Math.random() - 0.5) * 0.03 * (1 - 0.5 * b.mass);
    b.vy += (Math.random() - 0.5) * 0.02;
    // clamp (calm speeds)
    b.vx = Math.max(-0.8, Math.min(0.8, b.vx));
    b.vy = Math.max(-0.9, Math.min(0.9, b.vy));
    b.vx *= 0.998;

    b.cx += b.vx;
    b.cy += b.vy;

    const half = b.size / 2;
    if (b.cx - half < 0) { b.cx = half; b.vx = Math.abs(b.vx); }
    else if (b.cx + half > W) { b.cx = W - half; b.vx = -Math.abs(b.vx); }
    if (b.cy - half < 0) { b.cy = half; b.vy = Math.abs(b.vy); }
    else if (b.cy + half > H) { b.cy = H - half; b.vy = -Math.abs(b.vy); }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(vw() * dpr), h = Math.floor(vh() * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
  }
}

const start = performance.now();
let lastRender = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastRender < 28) return; // ~35fps
  lastRender = now;
  resize();
  physics();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const time = (now - start) / 1000;
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(U.u_res, canvas.width, canvas.height);
  gl.uniform1f(U.u_time, time);

  for (const b of bubbles.values()) {
    const half = (b.size / 2) * 1.35 * dpr;
    gl.uniform2f(U.u_center, b.cx * dpr, b.cy * dpr);
    gl.uniform1f(U.u_half, half);
    gl.uniform1f(U.u_hover, b.hover);
    gl.uniform3f(U.u_tint, b.tint[0], b.tint[1], b.tint[2]);
    gl.uniform1f(U.u_seed, b.seed);
    gl.uniform1f(U.u_active, b.active);
    gl.uniform1f(U.u_mass, b.mass);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // position the text label (CSS px, centred on the bubble)
    const s = b.size;
    b.el.style.transform = `translate(${b.cx - s / 2}px, ${b.cy - s / 2}px)`;
    b.el.style.width = s + 'px';
    b.el.style.height = s + 'px';
    b.el.style.fontSize = (s * 0.11) + 'px'; // text scales with the bubble
    b.el.classList.toggle('expanded', b.hovered);
    b.el.classList.toggle('current', b.activeTarget === 1);
  }
}

// ---------------------------------------------------------------------------
// Interaction — hit-test against bubbles; toggle click-through accordingly.
// ---------------------------------------------------------------------------
let interactive = false;
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  if (window.ami) window.ami.setInteractive(on);
}

function bubbleAt(x, y) {
  // topmost (last drawn = last in map insertion? iterate reverse for top)
  const arr = [...bubbles.values()];
  for (let i = arr.length - 1; i >= 0; i--) {
    const b = arr[i];
    if (Math.hypot(x - b.cx, y - b.cy) <= b.size / 2) return b;
  }
  return null;
}

window.addEventListener('mousemove', (e) => {
  if (dragId) {
    const b = bubbles.get(dragId);
    if (b) { b.cx = e.clientX + dragDX; b.cy = e.clientY + dragDY; }
    return;
  }
  const hit = bubbleAt(e.clientX, e.clientY);
  for (const b of bubbles.values()) {
    const h = b === hit;
    if (h !== b.hovered) { b.hovered = h; b.hoverTarget = h ? 1 : 0; }
  }
  setInteractive(!!hit);
});

window.addEventListener('mousedown', (e) => {
  if (e.target.closest && e.target.closest('.l-edit')) return; // let the edit click through
  const hit = bubbleAt(e.clientX, e.clientY);
  if (!hit) return;
  if (e.button === 2) { // right click
    if (window.ami) window.ami.bubbleContextMenu(hit.id);
    return;
  }
  dragId = hit.id;
  dragDX = hit.cx - e.clientX;
  dragDY = hit.cy - e.clientY;
});
window.addEventListener('mouseup', () => { dragId = null; });

window.addEventListener('contextmenu', (e) => e.preventDefault());

// edit button clicks (delegated)
labels.addEventListener('click', (e) => {
  const btn = e.target.closest('.l-edit');
  if (!btn) return;
  e.preventDefault();
  const el = btn.closest('.label');
  for (const b of bubbles.values()) {
    if (b.el === el && window.ami) window.ami.openEditor(b.id);
  }
});

// When the pointer leaves the whole screen, drop interactivity.
window.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget && !dragId) {
    for (const b of bubbles.values()) { b.hovered = false; b.hoverTarget = 0; }
    setInteractive(false);
  }
});

// ---------------------------------------------------------------------------
if (window.ami) {
  window.ami.getProjects().then(syncProjects);
  window.ami.onProjectsUpdated(syncProjects);
}
if (initGL()) {
  resize();
  requestAnimationFrame(frame);
}
