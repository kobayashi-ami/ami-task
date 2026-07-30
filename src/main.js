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
let overlayWin = null; // the single full-screen, click-through bubble overlay
let panelWin = null; // the Lisa mission-control panel
let tray = null;
let overlayHidden = false;

// One transparent window covering the whole display. Every bubble is drawn and
// animated INSIDE its canvas (see float/float.js) — no OS window is ever moved,
// which is what removed the macOS transparent-window flicker. It is click-
// through by default; the renderer turns interaction on only while the pointer
// is over a bubble.
function createOverlay() {
  if (overlayWin) return overlayWin;
  const b = screen.getPrimaryDisplay().workArea; // exclude menu bar / Dock

  overlayWin = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'AmiTask',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.loadFile(path.join(__dirname, 'float', 'index.html'));

  overlayWin.once('ready-to-show', () => {
    if (!overlayHidden) overlayWin.showInactive();
    pushToOverlay();
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
  });
  return overlayWin;
}

function showOverlay(show) {
  overlayHidden = !show;
  if (show) {
    if (!overlayWin) createOverlay();
    else overlayWin.showInactive();
  } else if (overlayWin) {
    overlayWin.hide();
  }
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

function pushToOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send('projects:updated', {
      projects: state.projects.map(projectPayload),
      activeId: state.activeId,
    });
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
    { label: 'Show bubbles', click: () => showOverlay(true) },
    { label: 'Hide bubbles', click: () => showOverlay(false) },
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
  pushToOverlay();
  pushProjectsToPanel();
  refreshTray();
});

ipcMain.handle('project:add', () => {
  const p = newProject();
  state.projects.push(p);
  state.activeId = p.id;
  saveState();
  pushToOverlay();
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
  pushToOverlay();
  pushProjectsToPanel();
  refreshTray();
});

ipcMain.on('project:setActive', (_e, id) => {
  if (!findProject(id)) return;
  state.activeId = id;
  saveState();
  pushToOverlay();
  pushProjectsToPanel();
});

// The star toggles "this is where I am right now" on and off.
ipcMain.on('project:toggleActive', (_e, id) => {
  if (!findProject(id)) return;
  state.activeId = state.activeId === id ? null : id;
  saveState();
  pushToOverlay();
  pushProjectsToPanel();
});

// The overlay is click-through except while the pointer is over a bubble.
ipcMain.on('overlay:interactive', (_e, on) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  }
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
  items.push({ label: 'Hide bubbles', click: () => showOverlay(false) });
  items.push({ label: 'Quit AmiTask', click: () => app.quit() });
  Menu.buildFromTemplate(items).popup({ window: overlayWin || undefined });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createOverlay();
  createTray();

  // Refresh git branch / last-touched periodically so bubbles stay current.
  setInterval(() => {
    pushToOverlay();
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
        pushToOverlay();
      }
    });
  }

  app.on('activate', () => {
    if (!overlayWin) createOverlay();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});
