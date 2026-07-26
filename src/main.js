'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// Everything the app remembers lives in a single JSON file inside the OS
// per-user application-support directory. One task, one place.
const storePath = () => path.join(app.getPath('userData'), 'ami-task.json');

const defaultState = {
  task: '',
  updatedAt: null,
  bubble: { x: null, y: null }, // last remembered position of the floating bubble
};

function loadState() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    return Object.assign({}, defaultState, JSON.parse(raw));
  } catch (_err) {
    return Object.assign({}, defaultState);
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(storePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

let state = loadState();

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
let floatWin = null; // the black soap-film bubble that floats on the desktop
let editorWin = null; // the Apple-Lisa-flavoured writing panel
let tray = null;

const BUBBLE_SIZE = 340;

function createFloatWindow() {
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;

  // Default: nestled toward the top-right of the work area, like a note you
  // stuck to the corner of your monitor.
  let x = state.bubble.x;
  let y = state.bubble.y;
  if (x === null || y === null) {
    x = Math.round(wa.x + wa.width - BUBBLE_SIZE - 48);
    y = Math.round(wa.y + 64);
  }

  floatWin = new BrowserWindow({
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
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

  // Sit above ordinary windows and follow the user across every Space,
  // including full-screen apps — this is the whole point: always in front.
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  floatWin.loadFile(path.join(__dirname, 'float', 'index.html'));

  floatWin.once('ready-to-show', () => {
    floatWin.showInactive();
    pushTaskToFloat();
  });

  // Remember where the user parks the bubble (debounced).
  let moveTimer = null;
  floatWin.on('move', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!floatWin) return;
      const [bx, by] = floatWin.getPosition();
      state.bubble.x = bx;
      state.bubble.y = by;
      saveState(state);
    }, 300);
  });

  floatWin.on('closed', () => {
    floatWin = null;
  });
}

function createEditorWindow() {
  if (editorWin) {
    editorWin.show();
    editorWin.focus();
    return;
  }

  editorWin = new BrowserWindow({
    width: 560,
    height: 460,
    minWidth: 460,
    minHeight: 360,
    frame: false, // we draw the industrial chrome ourselves
    transparent: true,
    hasShadow: true,
    resizable: true,
    fullscreenable: false,
    show: false,
    title: 'AmiTask — Note',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  editorWin.loadFile(path.join(__dirname, 'editor', 'index.html'));

  editorWin.once('ready-to-show', () => {
    editorWin.show();
    editorWin.focus();
  });

  editorWin.on('closed', () => {
    editorWin = null;
  });
}

function pushTaskToFloat() {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.webContents.send('task:updated', {
      task: state.task,
      updatedAt: state.updatedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Tray — the app has no dock window of its own, so give it a home in the menu bar
// ---------------------------------------------------------------------------
function buildTrayIcon() {
  // A tiny 16x16 template icon drawn as a filled ring (a bubble). Template
  // images automatically adapt to light/dark menu bars on macOS.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 7.5;
  const cy = 7.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      // ring between radius ~4.5 and ~6.5
      const a = d > 4.6 && d < 6.6 ? 255 : 0;
      const i = (y * size + x) * 4;
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
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
    // Tray creation can fail on headless/non-mac environments; not fatal.
    console.warn('Tray unavailable:', err.message);
    return;
  }
  tray.setToolTip('AmiTask');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Edit task…', click: () => createEditorWindow() },
    {
      label: 'Show bubble',
      click: () => {
        if (!floatWin) createFloatWindow();
        else floatWin.showInactive();
      },
    },
    {
      label: 'Hide bubble',
      click: () => {
        if (floatWin) floatWin.hide();
      },
    },
    { type: 'separator' },
    { label: 'Quit AmiTask', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.handle('task:get', () => ({
  task: state.task,
  updatedAt: state.updatedAt,
}));

ipcMain.on('task:save', (_evt, text) => {
  state.task = typeof text === 'string' ? text : '';
  state.updatedAt = new Date().toISOString();
  saveState(state);
  pushTaskToFloat();
  if (editorWin) editorWin.close();
  // The bubble may have been hidden; a fresh save should bring it back.
  if (!floatWin) createFloatWindow();
  else floatWin.showInactive();
});

ipcMain.on('editor:open', () => createEditorWindow());
ipcMain.on('editor:cancel', () => {
  if (editorWin) editorWin.close();
});

ipcMain.on('float:context-menu', () => {
  const menu = Menu.buildFromTemplate([
    { label: 'Edit task…', click: () => createEditorWindow() },
    {
      label: 'Hide bubble',
      click: () => {
        if (floatWin) floatWin.hide();
      },
    },
    { type: 'separator' },
    { label: 'Quit AmiTask', click: () => app.quit() },
  ]);
  menu.popup({ window: floatWin });
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // A floating utility — keep it out of the Dock so it feels ambient.
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  createFloatWindow();
  createTray();

  // If we've never captured a task, open the editor so the app has a purpose
  // the very first time it launches.
  if (!state.task) createEditorWindow();

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    createEditorWindow();
  });

  app.on('activate', () => {
    if (!floatWin) createFloatWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Keep running when all windows are closed — the bubble/tray is the app.
app.on('window-all-closed', () => {
  // Intentionally do nothing on macOS; the tray keeps us alive.
  if (process.platform !== 'darwin') {
    // On other platforms, also stay alive if the tray exists.
    if (!tray) app.quit();
  }
});
