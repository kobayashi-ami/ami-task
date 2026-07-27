'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Expand a leading ~ to the user's home directory (Node's fs does not do this).
function expandPath(p) {
  if (!p || typeof p !== 'string') return p;
  p = p.trim();
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// ===========================================================================
// AmiTask — a floating command post.
//
// Each project is a black soap-film bubble that floats on the desktop, always
// in front, showing its NOW. The Lisa-flavoured panel is mission control:
// Why / Now / Next / Blocker / Branch / Links for every project.
// ===========================================================================

// ---------------------------------------------------------------------------
// Persistence — one JSON file, the whole brain.
// ---------------------------------------------------------------------------
const storePath = () => path.join(app.getPath('userData'), 'ami-task.json');

const STATUSES = ['green', 'amber', 'red'];

function newProject(partial = {}) {
  return Object.assign(
    {
      id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: 'New Project',
      status: 'green', // green | amber | red
      why: '',
      now: '',
      next: ['', '', ''],
      blocker: '',
      repoPath: '',
      links: { github: '', claude: '', codex: '', manus: '', docs: '' },
      bubble: { x: null, y: null, hidden: false },
      updatedAt: null,
    },
    partial
  );
}

const defaultState = () => ({
  projects: [newProject({ name: 'Ares', now: 'ここに“今やっていること”を書く' })],
  activeId: null,
});

function loadState() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.projects)) return defaultState();
    // normalise older / partial records
    parsed.projects = parsed.projects.map((p) => newProject(p));
    if (!parsed.activeId && parsed.projects[0]) parsed.activeId = parsed.projects[0].id;
    return parsed;
  } catch (_err) {
    return defaultState();
  }
}

function saveState() {
  try {
    fs.writeFileSync(storePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

let state = loadState();
if (!state.activeId && state.projects[0]) state.activeId = state.projects[0].id;

const findProject = (id) => state.projects.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// Local git — branch + last-touched, no token, fully offline.
// ---------------------------------------------------------------------------
function gitInfo(repoPath) {
  const info = { branch: null, lastTouched: null };
  repoPath = expandPath(repoPath);
  if (!repoPath) return info;
  try {
    let gitDir = path.join(repoPath, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      // worktree / submodule: ".git" is a file pointing elsewhere
      const txt = fs.readFileSync(gitDir, 'utf8').trim();
      const m = txt.match(/^gitdir:\s*(.+)$/);
      if (m) gitDir = path.resolve(repoPath, m[1]);
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/ref:\s*refs\/heads\/(.+)$/);
    info.branch = ref ? ref[1] : head.slice(0, 7); // detached HEAD → short sha
  } catch (_err) {
    /* not a repo / unreadable */
  }
  try {
    info.lastTouched = fs.statSync(repoPath).mtime.toISOString();
  } catch (_err) {
    /* path gone */
  }
  return info;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
const bubbles = new Map(); // projectId -> BrowserWindow
const motion = new Map(); // projectId -> drift/size state {cx,cy,vx,vy,size,target,hovered}
let panelWin = null; // the Lisa mission-control panel
let tray = null;

// Small while drifting, larger while hovered so you can read / grab / edit it.
const BUBBLE_MIN = 112;
const BUBBLE_MAX = 250;
const DRIFT_MS = 30; // motion tick

function randomStart(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  const half = size / 2;
  return {
    cx: wa.x + half + Math.random() * (wa.width - size),
    cy: wa.y + half + Math.random() * (wa.height - size),
  };
}

function createBubble(project) {
  if (bubbles.has(project.id)) return bubbles.get(project.id);

  const { cx, cy } = randomStart(BUBBLE_MIN);
  const ang = Math.random() * Math.PI * 2;
  const speed = 0.7 + Math.random() * 0.5;
  motion.set(project.id, {
    cx,
    cy,
    vx: Math.cos(ang) * speed,
    vy: Math.sin(ang) * speed,
    size: BUBBLE_MIN,
    target: BUBBLE_MIN,
    hovered: false,
  });

  const win = new BrowserWindow({
    width: BUBBLE_MIN,
    height: BUBBLE_MIN,
    x: Math.round(cx - BUBBLE_MIN / 2),
    y: Math.round(cy - BUBBLE_MIN / 2),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: project.name,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--ami-project=${project.id}`],
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'float', 'index.html'));

  win.once('ready-to-show', () => {
    if (!(project.bubble && project.bubble.hidden)) win.showInactive();
    pushProjectToBubble(project.id);
  });

  win.on('closed', () => {
    bubbles.delete(project.id);
    motion.delete(project.id);
  });

  bubbles.set(project.id, win);
  return win;
}

// The desktop drift: every bubble wanders gently across the screen, bouncing
// off the edges. Hovering a bubble pauses it and swells it so you can read,
// grab, or edit it; moving away lets it float off again.
function driftTick() {
  if (bubbles.size === 0) return;
  for (const [id, win] of bubbles) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    const m = motion.get(id);
    if (!m) continue;

    const disp = screen.getDisplayNearestPoint({
      x: Math.round(m.cx),
      y: Math.round(m.cy),
    });
    const wa = disp.workArea;
    const resizing = Math.abs(m.size - m.target) > 0.5;

    if (m.hovered) {
      // Follow the user if they drag it; only re-lay-out while swelling.
      const b = win.getBounds();
      m.cx = b.x + b.width / 2;
      m.cy = b.y + b.height / 2;
      if (resizing) {
        m.size += (m.target - m.size) * 0.28;
        const s = Math.round(m.size);
        win.setBounds({
          x: Math.round(m.cx - s / 2),
          y: Math.round(m.cy - s / 2),
          width: s,
          height: s,
        });
      }
      continue;
    }

    if (resizing) m.size += (m.target - m.size) * 0.28;

    // integrate + a little organic wander
    m.cx += m.vx;
    m.cy += m.vy;
    m.vx += (Math.random() - 0.5) * 0.05;
    m.vy += (Math.random() - 0.5) * 0.05;
    const sp = Math.hypot(m.vx, m.vy);
    const MAXV = 1.3;
    const MINV = 0.45;
    if (sp > MAXV) {
      m.vx *= MAXV / sp;
      m.vy *= MAXV / sp;
    } else if (sp < MINV && sp > 0) {
      m.vx *= MINV / sp;
      m.vy *= MINV / sp;
    }

    const half = m.size / 2;
    if (m.cx - half < wa.x) {
      m.cx = wa.x + half;
      m.vx = Math.abs(m.vx);
    } else if (m.cx + half > wa.x + wa.width) {
      m.cx = wa.x + wa.width - half;
      m.vx = -Math.abs(m.vx);
    }
    if (m.cy - half < wa.y) {
      m.cy = wa.y + half;
      m.vy = Math.abs(m.vy);
    } else if (m.cy + half > wa.y + wa.height) {
      m.cy = wa.y + wa.height - half;
      m.vy = -Math.abs(m.vy);
    }

    const s = Math.round(m.size);
    win.setBounds({
      x: Math.round(m.cx - s / 2),
      y: Math.round(m.cy - s / 2),
      width: s,
      height: s,
    });
  }
}

function syncBubbles() {
  // Close bubbles for deleted projects.
  for (const id of [...bubbles.keys()]) {
    if (!findProject(id)) {
      const w = bubbles.get(id);
      if (w && !w.isDestroyed()) w.close();
      bubbles.delete(id);
    }
  }
  // Open bubbles for new projects.
  state.projects.forEach((p) => {
    if (!bubbles.has(p.id)) createBubble(p);
  });
}

function projectPayload(p) {
  const info = gitInfo(p.repoPath);
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    why: p.why,
    now: p.now,
    next: p.next,
    blocker: p.blocker,
    repoPath: p.repoPath,
    links: p.links,
    branch: info.branch,
    lastTouched: info.lastTouched,
    updatedAt: p.updatedAt,
    active: p.id === state.activeId,
  };
}

function pushProjectToBubble(id) {
  const win = bubbles.get(id);
  const p = findProject(id);
  if (win && !win.isDestroyed() && p) {
    win.webContents.send('project:updated', projectPayload(p));
  }
}

function pushProjectsToPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('projects:updated', {
      projects: state.projects.map(projectPayload),
      activeId: state.activeId,
    });
  }
}

function createPanel(focusId) {
  if (panelWin) {
    panelWin.show();
    panelWin.focus();
    if (focusId) panelWin.webContents.send('panel:focus', focusId);
    return;
  }

  panelWin = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 620,
    minHeight: 460,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    fullscreenable: false,
    show: false,
    title: 'AmiTask — Mission Control',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  panelWin.loadFile(path.join(__dirname, 'editor', 'index.html'));
  panelWin.once('ready-to-show', () => {
    panelWin.show();
    panelWin.focus();
    if (focusId) panelWin.webContents.send('panel:focus', focusId);
  });
  panelWin.on('closed', () => (panelWin = null));
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 7.5;
  const cy = 7.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const a = d > 4.6 && d < 6.6 ? 255 : 0;
      const i = (y * size + x) * 4;
      buf[i + 3] = a;
    }
  }
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  try {
    tray = new Tray(buildTrayIcon());
  } catch (err) {
    console.warn('Tray unavailable:', err.message);
    return;
  }
  tray.setToolTip('AmiTask');
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const projItems = state.projects.map((p, i) => ({
    label: `${p.status === 'green' ? '🟢' : p.status === 'amber' ? '🟡' : '🔴'}  ${
      p.name
    }${i < 9 ? `   ⌘${i + 1}` : ''}`,
    click: () => createPanel(p.id),
  }));
  const menu = Menu.buildFromTemplate([
    { label: 'Mission Control…', accelerator: 'CommandOrControl+Shift+Space', click: () => createPanel() },
    { type: 'separator' },
    ...(projItems.length ? projItems : [{ label: '(no projects)', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Show all bubbles',
      click: () => {
        state.projects.forEach((p) => (p.bubble.hidden = false));
        saveState();
        bubbles.forEach((w) => !w.isDestroyed() && w.showInactive());
      },
    },
    { label: 'Quit AmiTask', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('projects:get', () => ({
  projects: state.projects.map(projectPayload),
  activeId: state.activeId,
}));

ipcMain.handle('project:get', (_e, id) => {
  const p = findProject(id);
  return p ? projectPayload(p) : null;
});

ipcMain.on('project:save', (_e, data) => {
  const p = findProject(data.id);
  if (!p) return;
  const fields = ['name', 'status', 'why', 'now', 'blocker', 'repoPath'];
  for (const f of fields) if (typeof data[f] === 'string') p[f] = data[f];
  if (Array.isArray(data.next)) p.next = data.next.slice(0, 3);
  if (data.links && typeof data.links === 'object') {
    p.links = Object.assign({ github: '', claude: '', codex: '', manus: '', docs: '' }, data.links);
  }
  if (!STATUSES.includes(p.status)) p.status = 'green';
  p.updatedAt = new Date().toISOString();
  saveState();
  syncBubbles();
  pushProjectToBubble(p.id);
  pushProjectsToPanel();
  refreshTray();
});

ipcMain.handle('project:add', () => {
  const p = newProject();
  state.projects.push(p);
  state.activeId = p.id;
  saveState();
  syncBubbles();
  pushProjectsToPanel();
  refreshTray();
  return p.id;
});

ipcMain.on('project:delete', (_e, id) => {
  const idx = state.projects.findIndex((x) => x.id === id);
  if (idx === -1) return;
  state.projects.splice(idx, 1);
  if (state.activeId === id) {
    state.activeId = state.projects[0] ? state.projects[0].id : null;
  }
  saveState();
  syncBubbles();
  pushProjectsToPanel();
  refreshTray();
});

ipcMain.on('project:setActive', (_e, id) => {
  if (!findProject(id)) return;
  state.activeId = id;
  saveState();
  bubbles.forEach((_w, pid) => pushProjectToBubble(pid));
  pushProjectsToPanel();
});

// The star toggles "this is where I am right now" on and off.
ipcMain.on('project:toggleActive', (_e, id) => {
  if (!findProject(id)) return;
  state.activeId = state.activeId === id ? null : id;
  saveState();
  bubbles.forEach((_w, pid) => pushProjectToBubble(pid));
  pushProjectsToPanel();
});

ipcMain.on('bubble:hide', (_e, id) => {
  const p = findProject(id);
  const w = bubbles.get(id);
  if (p) {
    p.bubble.hidden = true;
    saveState();
  }
  if (w && !w.isDestroyed()) w.hide();
});

ipcMain.on('editor:open', (_e, id) => createPanel(id));
ipcMain.on('editor:cancel', () => {
  if (panelWin) panelWin.close();
});

ipcMain.on('link:open', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.on('folder:open', (_e, p) => {
  const full = expandPath(p);
  if (full && full.trim()) shell.openPath(full);
});

// A bubble reports when the pointer enters/leaves it: pause its drift and let
// it swell, then release it back into motion.
ipcMain.on('bubble:hover', (_e, payload) => {
  const m = motion.get(payload && payload.id);
  if (!m) return;
  m.hovered = !!payload.hovered;
  m.target = m.hovered ? BUBBLE_MAX : BUBBLE_MIN;
  if (!m.hovered) {
    const w = bubbles.get(payload.id);
    if (w && !w.isDestroyed()) {
      const b = w.getBounds();
      m.cx = b.x + b.width / 2;
      m.cy = b.y + b.height / 2;
    }
  }
});

ipcMain.on('bubble:context-menu', (_e, id) => {
  const p = findProject(id);
  if (!p) return;
  const items = [
    { label: `Edit “${p.name}”…`, click: () => createPanel(id) },
    { type: 'separator' },
  ];
  const linkDefs = [
    ['GitHub', p.links.github],
    ['Claude', p.links.claude],
    ['Codex', p.links.codex],
    ['Manus', p.links.manus],
    ['Docs', p.links.docs],
  ];
  let anyLink = false;
  for (const [label, url] of linkDefs) {
    if (url && /^https?:\/\//i.test(url)) {
      anyLink = true;
      items.push({ label: `Open ${label}`, click: () => shell.openExternal(url) });
    }
  }
  if (p.repoPath) {
    anyLink = true;
    items.push({ label: 'Open folder', click: () => shell.openPath(p.repoPath) });
  }
  if (anyLink) items.push({ type: 'separator' });
  items.push({ label: 'Hide this bubble', click: () => {
    p.bubble.hidden = true;
    saveState();
    const w = bubbles.get(id);
    if (w && !w.isDestroyed()) w.hide();
  }});
  items.push({ label: 'Quit AmiTask', click: () => app.quit() });
  Menu.buildFromTemplate(items).popup({ window: bubbles.get(id) });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  syncBubbles();
  createTray();

  // Set every bubble adrift across the desktop.
  setInterval(driftTick, DRIFT_MS);

  // Refresh git branch / last-touched periodically so bubbles stay current.
  setInterval(() => {
    bubbles.forEach((_w, id) => pushProjectToBubble(id));
    pushProjectsToPanel();
  }, 15000);

  // First run with an empty starter → open mission control.
  if (state.projects.length === 1 && !state.projects[0].now) createPanel(state.projects[0].id);

  globalShortcut.register('CommandOrControl+Shift+Space', () => createPanel());
  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`CommandOrControl+${i}`, () => {
      const p = state.projects[i - 1];
      if (p) {
        state.activeId = p.id;
        saveState();
        createPanel(p.id);
        bubbles.forEach((_w, pid) => pushProjectToBubble(pid));
      }
    });
  }

  app.on('activate', () => {
    if (bubbles.size === 0) syncBubbles();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});
