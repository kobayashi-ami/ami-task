'use strict';

const note = document.getElementById('note');
const meta = document.getElementById('meta');
const saveBtn = document.getElementById('save');
const cancelBtn = document.getElementById('cancel');
const closeBtn = document.getElementById('close');

function formatStamp(iso) {
  if (!iso) return 'Never saved';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `Last saved ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Load the current task into the display.
if (window.ami) {
  window.ami.getTask().then(({ task, updatedAt }) => {
    note.value = task || '';
    meta.textContent = formatStamp(updatedAt);
    note.focus();
    // place caret at end
    note.setSelectionRange(note.value.length, note.value.length);
  });
}

function save() {
  if (window.ami) window.ami.saveTask(note.value);
}

function cancel() {
  if (window.ami) window.ami.cancelEditor();
}

saveBtn.addEventListener('click', save);
cancelBtn.addEventListener('click', cancel);
closeBtn.addEventListener('click', cancel);

// Keyboard: Cmd/Ctrl+Enter or plain Enter (without Shift) saves; Esc cancels.
note.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
    // Enter saves; Shift+Enter inserts a newline for multi-line notes.
    e.preventDefault();
    save();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
  }
});
