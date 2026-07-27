'use strict';

// ===========================================================================
// Mission Control — the panel that edits every project and keeps the bubbles
// in sync. Left rack selects a project; the phosphor console edits it.
// ===========================================================================

const listEl = document.getElementById('list');
const formEl = document.getElementById('form');
const emptyEl = document.getElementById('empty');
const metaEl = document.getElementById('meta');
const gitMetaEl = document.getElementById('f-gitmeta');

const F = {
  name: document.getElementById('f-name'),
  why: document.getElementById('f-why'),
  now: document.getElementById('f-now'),
  next0: document.getElementById('f-next0'),
  next1: document.getElementById('f-next1'),
  next2: document.getElementById('f-next2'),
  blocker: document.getElementById('f-blocker'),
  repo: document.getElementById('f-repo'),
  github: document.getElementById('f-github'),
  claude: document.getElementById('f-claude'),
  codex: document.getElementById('f-codex'),
  manus: document.getElementById('f-manus'),
  docs: document.getElementById('f-docs'),
};
const statusEl = document.getElementById('f-status');
const starEl = document.getElementById('f-active');

let projects = [];
let activeId = null;
let currentId = null; // project loaded into the form
let curStatus = 'green';

// ---------------------------------------------------------------------------
function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return Math.floor(s / 60) + '分前';
  if (s < 86400) return Math.floor(s / 3600) + '時間前';
  return Math.floor(s / 86400) + '日前';
}

function statusMark(s) {
  return s === 'green' ? '🟢' : s === 'amber' ? '🟡' : '🔴';
}

function findProj(id) {
  return projects.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
function renderList() {
  listEl.innerHTML = '';
  projects.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'item' + (p.id === currentId ? ' selected' : '');
    item.dataset.id = p.id;

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = i < 9 ? '⌘' + (i + 1) : '';

    const dot = document.createElement('span');
    dot.className = 'sdot ' + (p.status || 'green');

    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = p.name || '(untitled)';

    item.append(idx, dot, nm);
    if (p.id === activeId) {
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = '★';
      item.append(star);
    }
    item.addEventListener('click', () => selectProject(p.id));
    listEl.appendChild(item);
  });
}

function setStatus(s) {
  curStatus = s;
  [...statusEl.children].forEach((b) =>
    b.classList.toggle('on', b.dataset.s === s)
  );
}

function loadForm(p) {
  currentId = p.id;
  F.name.value = p.name || '';
  F.why.value = p.why || '';
  F.now.value = p.now || '';
  const nx = p.next || [];
  F.next0.value = nx[0] || '';
  F.next1.value = nx[1] || '';
  F.next2.value = nx[2] || '';
  F.blocker.value = p.blocker || '';
  F.repo.value = p.repoPath || '';
  const l = p.links || {};
  F.github.value = l.github || '';
  F.claude.value = l.claude || '';
  F.codex.value = l.codex || '';
  F.manus.value = l.manus || '';
  F.docs.value = l.docs || '';
  setStatus(p.status || 'green');
  starEl.classList.toggle('on', p.id === activeId);
  starEl.textContent = p.id === activeId ? '★' : '☆';
  renderGitMeta(p);
  metaEl.textContent = p.updatedAt ? 'Last saved ' + ago(p.updatedAt) : 'Never saved';
}

function renderGitMeta(p) {
  if (!p) {
    gitMetaEl.textContent = '';
    return;
  }
  if (!p.repoPath) {
    gitMetaEl.textContent = 'パス未設定（ブランチ自動取得なし）';
    return;
  }
  const parts = [];
  parts.push(p.branch ? '⑂ ' + p.branch : 'git未検出');
  if (p.lastTouched) parts.push('最終更新 ' + ago(p.lastTouched));
  gitMetaEl.textContent = parts.join('  ·  ');
}

function collectForm() {
  if (!currentId) return null;
  return {
    id: currentId,
    name: F.name.value,
    status: curStatus,
    why: F.why.value,
    now: F.now.value,
    next: [F.next0.value, F.next1.value, F.next2.value],
    blocker: F.blocker.value,
    repoPath: F.repo.value,
    links: {
      github: F.github.value,
      claude: F.claude.value,
      codex: F.codex.value,
      manus: F.manus.value,
      docs: F.docs.value,
    },
  };
}

function save() {
  const data = collectForm();
  if (data && window.ami) window.ami.saveProject(data);
}

function showForm(show) {
  formEl.style.display = show ? 'flex' : 'none';
  emptyEl.hidden = show;
}

function selectProject(id) {
  if (currentId && id !== currentId) save(); // commit edits before switching
  const p = findProj(id);
  if (!p) return;
  loadForm(p);
  renderList();
}

// ---------------------------------------------------------------------------
async function refresh(fromBackground) {
  const data = await window.ami.getProjects();
  projects = data.projects;
  activeId = data.activeId;
  if (projects.length === 0) {
    currentId = null;
    showForm(false);
    renderList();
    metaEl.textContent = '';
    return;
  }
  showForm(true);
  if (!currentId || !findProj(currentId)) {
    // pick active or first
    const start = findProj(activeId) || projects[0];
    loadForm(start);
  } else if (fromBackground) {
    // background tick: refresh only volatile bits, don't clobber edits
    renderGitMeta(findProj(currentId));
    starEl.classList.toggle('on', currentId === activeId);
    starEl.textContent = currentId === activeId ? '★' : '☆';
  }
  renderList();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
[...statusEl.children].forEach((b) =>
  b.addEventListener('click', () => {
    setStatus(b.dataset.s);
    save();
    // reflect status dot in the rack immediately
    const p = findProj(currentId);
    if (p) p.status = curStatus;
    renderList();
  })
);

starEl.addEventListener('click', () => {
  if (!currentId || !window.ami) return;
  // toggle "current" on/off so the click always does something visible
  const nowActive = activeId !== currentId;
  window.ami.toggleActive(currentId);
  activeId = nowActive ? currentId : null;
  starEl.classList.toggle('on', nowActive);
  starEl.textContent = nowActive ? '★' : '☆';
  renderList();
});

document.getElementById('add').addEventListener('click', async () => {
  if (currentId) save();
  const id = await window.ami.addProject();
  await refresh();
  if (id) selectProject(id);
  F.name.focus();
  F.name.select();
});

const saveBtnEl = document.getElementById('save');
let saveFlashTimer = null;

// Explicit save with a clear, visible confirmation so it never feels uncertain.
function saveWithConfirm() {
  if (!currentId) return;
  save();
  metaEl.textContent = '保存しました ✓ (たった今)';
  saveBtnEl.textContent = '保存 ✓';
  saveBtnEl.classList.add('ok');
  if (saveFlashTimer) clearTimeout(saveFlashTimer);
  saveFlashTimer = setTimeout(() => {
    saveBtnEl.innerHTML = 'Save&nbsp;↵';
    saveBtnEl.classList.remove('ok');
  }, 1300);
}

saveBtnEl.addEventListener('click', saveWithConfirm);

document.getElementById('delete').addEventListener('click', () => {
  if (!currentId || !window.ami) return;
  const p = findProj(currentId);
  const label = p ? p.name : 'this project';
  if (!confirm(`「${label}」を削除しますか？`)) return;
  window.ami.deleteProject(currentId);
  currentId = null;
});

document.getElementById('close').addEventListener('click', () => {
  save();
  if (window.ami) window.ami.cancelEditor();
});

document.getElementById('open-folder').addEventListener('click', () => {
  if (window.ami) window.ami.openFolder(F.repo.value);
});

document.querySelectorAll('.mini.open').forEach((b) =>
  b.addEventListener('click', () => {
    const target = document.getElementById(b.dataset.for);
    if (target && target.value && window.ami) window.ami.openLink(target.value.trim());
  })
);

// Commit on blur of any field so bubbles update as you go.
Object.values(F).forEach((el) =>
  el.addEventListener('change', () => {
    save();
    const p = findProj(currentId);
    if (p && el === F.name) {
      p.name = F.name.value;
      renderList();
    }
  })
);

// Esc closes, Cmd/Ctrl+S saves.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    save();
    if (window.ami) window.ami.cancelEditor();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveWithConfirm();
  }
});

window.addEventListener('beforeunload', save);

if (window.ami) {
  window.ami.onProjectsUpdated(() => refresh(true));
  window.ami.onPanelFocus((id) => selectProject(id));
  refresh();
}
