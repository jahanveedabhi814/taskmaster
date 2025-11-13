// -----------------------------
// TaskMaster - script.js (FINAL)
// - Deleted tray reliably opens via voice
// - Assistant stays SILENT (no speechSynthesis) but updates UI & screen reader
// - Add multiple tasks by voice (comma-separated)
// - Delete all tasks via voice
// - Edit & Restore via voice
// - Dynamic numbering
// -----------------------------

/* State */
let tasks = JSON.parse(localStorage.getItem('tasks') || '[]');
let currentFilter = 'all';
let currentPriorityFilter = 'all';
let currentSort = 'date';
let searchQuery = '';
let aiAssistant = null;

/* Helpers */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const byId = id => document.getElementById(id);

function saveTasks() {
  try { localStorage.setItem('tasks', JSON.stringify(tasks)); }
  catch (e) { console.warn('Could not save tasks', e); }
}

function escapeHtml(text) {
  const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}
function getPriorityIcon(p) { return p === 'high' ? '🔴' : p === 'low' ? '🟢' : '🟡'; }

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initSplash();
  initRouter();
  bindUI();
  ensureDeletedTrayExists();
  renderTasks();
  updateStats();
  initializeAIAssistantOnce();
  // Load email settings and start reminder scheduler
  loadEmailSettings();
  scheduleReminders();
});

/* ---------- Splash ---------- */
function initSplash() {
  const splash = byId('splashScreen');
  if (!splash) return;
  setTimeout(() => {
    splash.style.pointerEvents = 'none';
    setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 1200);
  }, 2800);
}

/* ---------- Router ---------- */
function initRouter() {
  const go = (hash) => {
    const page = (hash || window.location.hash.slice(1) || 'home');
    $$('.page').forEach(p => p.classList.remove('active'));
    const sel = byId(`${page}-page`);
    if (sel) {
      sel.classList.add('active');
      if (window.location.hash.slice(1) !== page) window.location.hash = '#' + page;
      window.scrollTo(0,0);
      if (page === 'tasks') { renderTasks(); updateStats(); }
    }
  };
  go();
  window.addEventListener('hashchange', () => go());
  $$('[data-action="navigate"]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const page = el.dataset.page || (el.getAttribute('href') || '').replace('#','') || 'home';
      go(page);
    });
  });
}

/* ---------- Render & Stats ---------- */
function updateStats() {
  // Optimization: Single pass through tasks instead of 4 separate filters
  let active = 0, completed = 0, deleted = 0, total = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.deleted) {
      deleted++;
    } else {
      total++;
      if (t.completed) completed++;
      else active++;
    }
  }
  const setIf = (id, text) => { const el = byId(id); if (el) el.textContent = text; };
  setIf('totalTasks', total);
  setIf('activeTasks', active);
  setIf('completedTasks', completed);
  setIf('deletedTasks', deleted);
}

function getFilteredTasks() {
  // Optimization: Efficient single-pass filtering with early returns
  const searchLower = searchQuery.toLowerCase();
  const hasSearch = searchLower.length > 0;
  const priorityCheck = currentPriorityFilter !== 'all';
  
  let filtered = [];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    
    // Filter by status
    if (currentFilter === 'active' && (task.completed || task.deleted)) continue;
    if (currentFilter === 'completed' && (!task.completed || task.deleted)) continue;
    if (currentFilter === 'deleted' && !task.deleted) continue;
    if (currentFilter === 'all' && task.deleted) continue;
    
    // Filter by priority
    if (priorityCheck && task.priority !== currentPriorityFilter) continue;
    
    // Filter by search
    if (hasSearch && !task.text.toLowerCase().includes(searchLower)) continue;
    
    filtered.push(task);
  }
  
  // Optimization: Sort based on type once
  if (currentSort === 'priority') {
    const order = { high: 0, medium: 1, low: 2 };
    filtered.sort((a, b) => order[a.priority] - order[b.priority]);
  } else if (currentSort === 'name') {
    filtered.sort((a, b) => a.text.localeCompare(b.text));
  } else {
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  
  return filtered;
}

function renderTasks() {
  const list = byId('tasksList');
  const completedList = byId('completedTasksList');
  if (!list) return;
  const filtered = getFilteredTasks();

  // Clear both lists first (completed section handled separately via tasks' completed flag)
  list.innerHTML = '';
  if (completedList) completedList.innerHTML = '';

  const visible = filtered.filter(t => !t.completed && !t.deleted);
  const completedVisible = filtered.filter(t => t.completed && !t.deleted);

  if (!visible.length && !completedVisible.length) {
    list.innerHTML = '<div class="empty-state"><p>🎉 No tasks found. Create one to get started!</p></div>';
  }

  // Active tasks with numbering
  visible.forEach((task, idx) => {
    const numberLabel = `<div style="min-width:32px;font-weight:700;color:var(--text-muted);">${idx+1}.</div>`;
    const checkbox = `<input type="checkbox" class="task-checkbox" data-id="${task.id}" ${task.completed ? 'checked' : ''} aria-label="Mark task ${idx+1} complete">`;
    const text = `<div class="task-text">${escapeHtml(task.text)}</div>`;
    let reminderHtml = '';
    if (task.reminderAt) {
      const rDate = new Date(task.reminderAt);
      const rStr = isNaN(rDate.getTime()) ? task.reminderAt : rDate.toLocaleString();
      const toPart = task.reminderTo ? ` — to ${escapeHtml(task.reminderTo)}` : '';
      reminderHtml = `<span class="task-reminder">🔔 ${rStr}${task.reminderSent ? ' (sent)' : ''}${toPart}</span>`;
    }
    const meta = `<div class="task-meta"><span class="task-date">📅 ${new Date(task.createdAt).toLocaleString()}</span><span class="task-priority ${task.priority}">${getPriorityIcon(task.priority)} ${task.priority.charAt(0).toUpperCase()+task.priority.slice(1)}</span>${reminderHtml}</div>`;
    const actions = `<button class="task-btn edit" data-action="edit" data-id="${task.id}" title="Edit">✏️</button>
                     <button class="task-btn" data-action="delete" data-id="${task.id}" title="Delete">❌</button>`;

    const el = document.createElement('div');
    el.className = `task-item ${task.completed ? 'completed' : ''}`;
    el.setAttribute('data-id', task.id);
    el.style.display = 'grid';
    el.style.gridTemplateColumns = '40px 1fr auto';
    el.style.gap = '15px';
    el.style.alignItems = 'center';
    el.innerHTML = `<div style="display:flex;align-items:center">${numberLabel}</div>
                    <div class="task-content" style="display:flex;flex-direction:column;gap:6px">
                      <div style="display:flex;align-items:center;gap:8px">${checkbox}<div style="font-weight:600">${text}</div></div>
                      ${meta}
                    </div>
                    <div class="task-actions">${actions}</div>`;
    list.appendChild(el);
  });

  // Completed tasks with numbering (its own section)
  if (completedList) {
    completedVisible.forEach((task, idx) => {
      const numberLabel = `<div style="min-width:32px;font-weight:700;color:var(--text-muted);">${idx+1}.</div>`;
      const checkbox = `<input type="checkbox" class="task-checkbox" data-id="${task.id}" ${task.completed ? 'checked' : ''} aria-label="Mark task ${idx+1} complete">`;
      const text = `<div class="task-text" style="text-decoration:line-through;color:var(--text-muted)">${escapeHtml(task.text)}</div>`;
      const meta = `<div class="task-meta"><span class="task-date">📅 ${new Date(task.createdAt).toLocaleString()}</span><span class="task-priority ${task.priority}">${getPriorityIcon(task.priority)} ${task.priority.charAt(0).toUpperCase()+task.priority.slice(1)}</span></div>`;
      const actions = `<button class="task-btn edit" data-action="edit" data-id="${task.id}" title="Edit">✏️</button>
                       <button class="task-btn" data-action="delete" data-id="${task.id}" title="Delete">❌</button>`;

      const el = document.createElement('div');
      el.className = `task-item completed`;
      el.setAttribute('data-id', task.id);
      el.style.display = 'grid';
      el.style.gridTemplateColumns = '40px 1fr auto';
      el.style.gap = '15px';
      el.style.alignItems = 'center';
      el.innerHTML = `<div style="display:flex;align-items:center">${numberLabel}</div>
                      <div class="task-content" style="display:flex;flex-direction:column;gap:6px">
                        <div style="display:flex;align-items:center;gap:8px">${checkbox}<div style="font-weight:600">${text}</div></div>
                        ${meta}
                      </div>
                      <div class="task-actions">${actions}</div>`;
      completedList.appendChild(el);
    });
  }
}

/* ---------- CRUD ---------- */
function addTask(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = byId('taskInput');
  const select = byId('prioritySelect');
  if (!input) return;
  const txt = input.value.trim();
  if (!txt) return;
  const priority = (select && select.value) ? select.value : 'medium';
  // Reminder fields
  const reminderToggle = byId('reminderToggle');
  const reminderInput = byId('reminderInput');
  const reminderEmailToggle = byId('reminderEmailToggle');
  let reminderAt = null;
  if (reminderToggle && reminderToggle.checked && reminderInput && reminderInput.value) {
    try { reminderAt = new Date(reminderInput.value).toISOString(); } catch (e) { reminderAt = null; }
  }
  const reminderEmailInput = byId('reminderEmailInput');
  const reminderTo = (reminderEmailInput && reminderEmailInput.value && String(reminderEmailInput.value).trim()) ? String(reminderEmailInput.value).trim() : '';

  const t = {
    id: Date.now(),
    text: txt,
    priority,
    completed: false,
    deleted: false,
    createdAt: new Date().toISOString(),
    reminderAt: reminderAt, // ISO string or null
    reminderEmail: !!(reminderEmailToggle && reminderEmailToggle.checked),
    reminderTo: reminderTo,
    reminderSent: false
  };
  tasks.unshift(t);
  saveTasks();
  input.value = '';
  renderTasks();
  updateStats();
  // silent: update screen reader
  announceToScreenReader(`Added task: ${t.text}`);
  // If a reminder was added, ensure the scheduler will pick it up sooner rather than later
  if (t.reminderAt) {
    // run check immediately and ensure interval is active
    try { checkReminders(); } catch (e) { console.warn('checkReminders error', e); }
  }
}
window.addTask = addTask;

function toggleTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  saveTasks(); renderTasks(); updateStats();
  announceToScreenReader(t.completed ? `Completed: ${t.text}` : `Marked active: ${t.text}`);
}
window.toggleTask = toggleTask;

function deleteTask(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.deleted = true; saveTasks(); renderTasks(); updateStats();
  announceToScreenReader(`Deleted: ${t.text}`);
}
window.deleteTask = deleteTask;

function restoreTask(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.deleted = false; saveTasks(); renderTasks(); updateStats();
  announceToScreenReader(`Restored: ${t.text}`);
}
window.restoreTask = restoreTask;

function permanentlyDeleteTask(id) {
  tasks = tasks.filter(x => x.id !== id); saveTasks(); renderTasks(); updateStats();
  announceToScreenReader('Task permanently deleted.');
}
window.permanentlyDeleteTask = permanentlyDeleteTask;

function clearCompleted() {
  const count = tasks.filter(t => t.completed && !t.deleted).length;
  if (!count) { alert('❌ No completed tasks to clear.'); return; }
  if (!confirm(`Delete ${count} completed task(s)?`)) return;
  tasks = tasks.filter(t => !(t.completed && !t.deleted)); saveTasks(); renderTasks(); updateStats();
  announceToScreenReader('Cleared completed tasks.');
}
window.clearCompleted = clearCompleted;

function emptyTrash() {
  const count = tasks.filter(t => t.deleted).length;
  if (!count) { alert('🗑️ Trash is already empty.'); return; }
  if (!confirm(`Permanently delete ${count} task(s) from trash?`)) return;
  tasks = tasks.filter(t => !t.deleted); saveTasks(); renderTasks(); updateStats();
  announceToScreenReader('Trash emptied.');
}
window.emptyTrash = emptyTrash;

function clearAll() {
  if (!tasks.length) { alert('❌ No tasks to delete.'); return; }
  if (!confirm(`⚠️ Delete ALL ${tasks.length} tasks?`)) return;
  if (!confirm('Are you absolutely sure?')) return;
  tasks = []; saveTasks(); renderTasks(); updateStats();
  announceToScreenReader('All tasks deleted.');
}
window.clearAll = clearAll;

/* ---------- Edit (manual) ---------- */
function editTaskById(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const newText = prompt('Edit task:', t.text);
  if (newText === null) return; // cancelled
  const trimmed = String(newText).trim();
  if (!trimmed) { alert('Task cannot be empty.'); return; }
  t.text = trimmed;
  saveTasks(); renderTasks(); updateStats();
  announceToScreenReader(`Task updated: ${trimmed}`);
}
window.editTaskById = editTaskById;

/* ---------- Deleted tray (slide-up) ---------- */
function ensureDeletedTrayExists() {
  const tray = byId('deletedTasksTray');
  if (!tray) return;
  tray.style.position = tray.style.position || 'fixed';
  tray.style.left = tray.style.left || '0';
  tray.style.right = tray.style.right || '0';
  tray.style.bottom = tray.style.bottom || '-100%';
  tray.style.zIndex = tray.style.zIndex || '1200';
  tray.style.transition = tray.style.transition || 'transform 320ms cubic-bezier(.2,.9,.2,1), bottom 320ms ease';
  tray.style.background = tray.style.background || 'linear-gradient(135deg, rgba(30,41,59,0.98), rgba(15,23,42,0.98))';
  tray.style.maxHeight = tray.style.maxHeight || '60vh';
  tray.style.overflowY = tray.style.overflowY || 'auto';
  const closeBtn = byId('closeDeletedTray');
  if (closeBtn) closeBtn.addEventListener('click', closeDeletedTray);
}

function openDeletedTray() {
  const tray = byId('deletedTasksTray');
  const list = byId('deletedTasksList');
  if (!tray || !list) {
    // fallback: if HTML IDs differ, try showHelp as fallback
    console.warn('Deleted tray elements not found');
    return;
  }
  renderDeletedTrayList();
  tray.style.display = 'block';
  // place at bottom 0 (slide up)
  tray.style.bottom = '0';
  tray.style.transform = 'translateY(0)';
}

function closeDeletedTray() {
  const tray = byId('deletedTasksTray');
  if (!tray) return;
  tray.style.transform = 'translateY(100%)';
  setTimeout(() => { tray.style.bottom = '-100%'; }, 320);
}

function renderDeletedTrayList() {
  const list = byId('deletedTasksList');
  if (!list) return;
  const deleted = tasks.filter(t => t.deleted);
  if (!deleted.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-muted)">No deleted tasks.</div>';
    return;
  }
  list.innerHTML = deleted.map((t, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-weight:700;color:var(--text)">${i+1}. ${escapeHtml(t.text)}</div>
        <div style="font-size:0.85em;color:var(--text-muted);margin-top:6px">${getPriorityIcon(t.priority)} ${t.priority.charAt(0).toUpperCase()+t.priority.slice(1)} • ${new Date(t.createdAt).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:8px;margin-left:12px">
        <button class="btn-secondary restore-deleted-btn" data-id="${t.id}">♻️ Restore</button>
        <button class="btn-danger perm-delete-deleted-btn" data-id="${t.id}">🗑️ Delete</button>
      </div>
    </div>
  `).join('');
  Array.from(document.querySelectorAll('.restore-deleted-btn')).forEach(b => {
    b.onclick = () => {
      const id = parseInt(b.dataset.id,10);
      restoreTask(id);
      renderDeletedTrayList();
    };
  });
  Array.from(document.querySelectorAll('.perm-delete-deleted-btn')).forEach(b => {
    b.onclick = () => {
      const id = parseInt(b.dataset.id,10);
      if (confirm('Permanently delete this task?')) {
        permanentlyDeleteTask(id);
        renderDeletedTrayList();
      }
    };
  });
}

/* ---------- UI Bindings ---------- */
function bindUI() {
  const form = document.querySelector('form');
  if (form) { form.removeEventListener('submit', addTask); form.addEventListener('submit', addTask); }

  $$('.priority-btn').forEach(btn => {
    btn.removeEventListener('click', priorityBtnHandler);
    btn.addEventListener('click', priorityBtnHandler);
  });

  $$('.sort-btn').forEach(b => {
    b.removeEventListener('click', sortBtnHandler);
    b.addEventListener('click', sortBtnHandler);
  });

  $$('[data-action="clear-completed"]').forEach(b => { b.removeEventListener('click', clearCompleted); b.addEventListener('click', clearCompleted); });
  $$('[data-action="empty-trash"]').forEach(b => { b.removeEventListener('click', emptyTrash); b.addEventListener('click', emptyTrash); });
  $$('[data-action="clear-all"]').forEach(b => { b.removeEventListener('click', clearAll); b.addEventListener('click', clearAll); });
  $$('[data-action="export-tasks"]').forEach(b => { b.removeEventListener('click', exportTasks); b.addEventListener('click', exportTasks); });

  const search = byId('searchInput');
  if (search) { search.removeEventListener('input', searchHandler); search.addEventListener('input', searchHandler); }

  const vBtn = byId('voiceToggleBtn');
  const aBtn = byId('autoStopToggleBtn');
  if (vBtn) vBtn.addEventListener('click', () => { if (aiAssistant) { aiAssistant.toggleVoice(); vBtn.textContent = aiAssistant.voiceEnabled ? 'Enabled' : 'Disabled'; } });
  if (aBtn) aBtn.addEventListener('click', () => { if (aiAssistant) { aiAssistant.setAutoStop(!aiAssistant.autoStopAfterAction); aBtn.textContent = aiAssistant.autoStopAfterAction ? 'Enabled' : 'Disabled'; } });

  // Enable/disable reminder inputs based on toggles
  const remEmailToggle = byId('reminderEmailToggle');
  const remEmailInput = byId('reminderEmailInput');
  if (remEmailToggle && remEmailInput) {
    remEmailInput.disabled = !remEmailToggle.checked;
    remEmailToggle.removeEventListener('change', () => {});
    remEmailToggle.addEventListener('change', () => {
      // enable/disable the input
      remEmailInput.disabled = !remEmailToggle.checked;
      // if toggled on and no email provided, prompt immediately
      if (remEmailToggle.checked && remEmailInput && !remEmailInput.value) {
        const ans = window.prompt('Enter email address to send the reminder to:', '');
        if (ans && String(ans).trim()) {
          remEmailInput.value = String(ans).trim();
        } else {
          // if user cancels or leaves blank, uncheck and disable
          remEmailToggle.checked = false;
          remEmailInput.disabled = true;
          announceToScreenReader('Reminder email not set. Email reminder disabled.');
        }
      }
    });
  }
  const remToggle = byId('reminderToggle');
  const remInput = byId('reminderInput');
  if (remToggle && remInput) {
    remInput.disabled = !remToggle.checked;
    remToggle.removeEventListener('change', () => {});
    remToggle.addEventListener('change', () => { remInput.disabled = !remToggle.checked; });
  }

  document.removeEventListener('click', delegatedClick); document.addEventListener('click', delegatedClick);
  document.removeEventListener('change', delegatedChange); document.addEventListener('change', delegatedChange);

  const contactForm = byId('contactForm');
  if (contactForm) { contactForm.removeEventListener('submit', contactSubmitHandler); contactForm.addEventListener('submit', contactSubmitHandler); }
}

function priorityBtnHandler(e) {
  const p = e.currentTarget.dataset.priority || e.currentTarget.textContent.trim().toLowerCase();
  setPriorityFilter(p);
}
function sortBtnHandler(e) {
  $$('.sort-btn').forEach(x => x.classList.remove('active'));
  e.currentTarget.classList.add('active');
  currentSort = e.currentTarget.dataset.sort || 'date';
  renderTasks();
}
function searchHandler(e) { searchQuery = e.target.value; renderTasks(); }
function delegatedClick(e) {
  const btn = e.target.closest('.task-btn');
  if (btn) {
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id,10);
    if (action === 'delete') deleteTask(id);
    else if (action === 'permanently-delete') { if (confirm('Permanently delete this task?')) permanentlyDeleteTask(id); }
    else if (action === 'restore') restoreTask(id);
    else if (action === 'edit') editTaskById(id);
    return;
  }
  const closeHelp = e.target.closest('[data-action="close-help"], .close-help-btn, [data-action="close-help"]');
  if (closeHelp) { const m = byId('helpModal'); if (m) m.style.display = 'none'; }
}
function delegatedChange(e) {
  if (e.target.matches('.task-checkbox')) {
    const id = parseInt(e.target.dataset.id,10);
    toggleTask(id);
  }
}
function contactSubmitHandler(e) {
  e.preventDefault();
  const note = byId('formNote');
  if (note) { note.textContent = "Thank you for your message! We'll get back soon."; note.style.color = '#10b981'; }
  e.target.reset();
  setTimeout(()=> { if (note) note.textContent = ''; }, 3000);
}

/* ---------- Filters & Export ---------- */
function setPriorityFilter(p) {
  currentPriorityFilter = p || 'all';
  $$('.priority-btn').forEach(b => b.classList.remove('active'));
  const mapId = { all:'priorAll', high:'priorHigh', medium:'priorMedium', low:'priorLow' };
  const el = byId(mapId[currentPriorityFilter]);
  if (el) el.classList.add('active');
  renderTasks();
}
window.filterByPriority = setPriorityFilter;

function exportTasks() {
  const data = JSON.stringify(tasks, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `tasks_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
window.exportTasks = exportTasks;

/* ---------- A11y ---------- */
function announceToScreenReader(msg) { const el = byId('voiceStatus'); if (el) el.textContent = msg; }

/* ---------- Voice Assistant (silent mode) ---------- */
function initializeAIAssistantOnce() {
  if (aiAssistant) return;
  try { aiAssistant = new SimpleAIAssistant(); } catch (e) { console.warn('AI init failed', e); }
}

class SimpleAIAssistant {
  constructor() {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    this.Synth = window.speechSynthesis || null; // speech synthesis (used when voiceEnabled)
    this.recognition = null;
    this.listening = false;
    this.voiceEnabled = JSON.parse(localStorage.getItem('aiVoiceEnabled') || 'false'); // restore user preference
    this.autoStopAfterAction = JSON.parse(localStorage.getItem('aiAutoStop') || 'true');
    this.lastMessage = '';
    this.previewEl = byId('transcriptPreview');
    this.statusEl = byId('assistantStatus');
    this.statusTextEl = byId('statusText');
    this.micBtn = byId('aiAssistantBtn');

    // Optimization: Cache command patterns and debounce
    this.lastCommandTime = 0;
    this.commandDebounce = 100; // ms
    this.lastProcessedCommand = '';
    this.commandCache = new Map(); // Cache for frequently used commands

    // Optimization: Pre-compile regex patterns
    this._compilePatterns();

    this._initRecognition();
    this.updateStatus('Ready', 'ready');
    this.syncUI();
  }

  _loadVoices() {
    if (!this.Synth) return;
    this.voices = this.Synth.getVoices() || [];
    // prefer en-US voice if available
    this.voice = this.voices.find(v => /en-?us/i.test(v.lang)) || this.voices[0] || null;
  }

  _compilePatterns() {
    // Pre-compile all regex patterns for faster matching
    this.patterns = {
      stop: /^(stop|exit|quit|done|end)$/,
      help: /^(help|commands|what can you do)/,
      showDeleted: /(show|view|open).*(deleted|trash|bin)/,
      hideDeleted: /(hide|close|dismiss).*(deleted|trash|bin)/,
      deleteAll: /^(?:delete|clear|remove|reset)\s+(?:all|everything|tasks)$|(?:delete|clear).*(all|everything)/,
      add: /^(?:add|create|remind(?:\s+me)?\s+to)\s+(.+)/i,
      restore: /^(?:restore|undelete)\s+(?:task\s+)?#?(\d+|.+)$/i,
      edit: /^(?:edit|rename)\s+(?:task\s+)?#?(\d+)\s*(?:to|as|change\s+name\s+to)\s+(.+)$/i,
      delete: /^(?:delete|remove|discard|clear)\s+(?:task\s+)?#?(\d+|.+)$/i,
      complete: /^(?:complete|done|finish|mark)\s+(?:task\s+)?#?(\d+)/i,
      list: /^(?:list|show|display).*(?:tasks|todo|items)?/
    };
  }

  _initRecognition() {
    if (!this.SR) {
      this.updateStatus('Speech recognition not supported', 'error'); return;
    }
    this.recognition = new this.SR();
    this.recognition.lang = 'en-US';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onstart = () => { this.listening = true; this._setMicClass('listening'); this.updateStatus('Listening...', 'listening'); };
    this.recognition.onresult = (ev) => this._onResult(ev);
    this.recognition.onerror = (ev) => { console.warn('rec error',ev); this.updateStatus('Recognition error', 'error'); announceToScreenReader('Voice recognition error.'); };
    this.recognition.onend = () => {
      if (this.listening) {
        try { this.recognition.start(); } catch (e) { console.warn('restart failed',e); }
      } else { this._setMicClass(); this.updateStatus('Ready','ready'); }
    };

    if (this.micBtn) this.micBtn.addEventListener('click', () => this.toggleListening());

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement !== byId('taskInput')) { e.preventDefault(); this.toggleListening(); }
      if ((e.key === 'a' || e.key === 'A')) { this.setAutoStop(!this.autoStopAfterAction); const btn = byId('autoStopToggleBtn'); if (btn) btn.textContent = this.autoStopAfterAction ? 'Enabled' : 'Disabled'; }
    });

    // Setup speech synthesis voices if available
    if (this.Synth) {
      // load voices (may be asynchronous in some browsers)
      this._loadVoices();
      // ensure we refresh when voices change
      this.Synth.onvoiceschanged = () => { try { this._loadVoices(); } catch (e) { /* ignore */ } };
    }
  }

  _onResult(event) {
    // Optimization: Build strings more efficiently
    let interim = '', final = '';
    const len = event.results.length;
    
    for (let i = event.resultIndex; i < len; i++) {
      const transcript = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }
    
    // Update preview with interim results
    if (interim.trim() && this.previewEl) {
      this.previewEl.textContent = interim.trim();
    }
    
    // Process final results with debounce
    if (final.trim()) {
      const norm = this._normalize(final.trim());
      if (this.previewEl) this.previewEl.textContent = norm;
      this._processCommandDebounced(norm);
    }
  }

  _normalize(s) {
    // Optimization: Streamlined normalization
    let t = s.toLowerCase();
    
    // Remove wake words and punctuation in one pass
    t = t.replace(/^(?:hey|ok|hi|hello)\s+/i, '')
         .replace(/[.,!?;:]/g, ' ')
         .replace(/\s+/g, ' ')
         .trim();
    
    // Number mapping (cached for efficiency)
    const map = {
      zero:'0', one:'1', two:'2', three:'3', four:'4', five:'5',
      six:'6', seven:'7', eight:'8', nine:'9', ten:'10',
      first:'1', second:'2', third:'3'
    };
    
    return t.split(' ').map(w => map[w] || w).join(' ');
  }

  _processCommandDebounced(text) {
    // Optimization: Debounce duplicate commands
    const now = Date.now();
    
    // Skip if same command within debounce window
    if (text === this.lastProcessedCommand && now - this.lastCommandTime < this.commandDebounce) {
      return;
    }
    
    this.lastProcessedCommand = text;
    this.lastCommandTime = now;
    this.processCommand(text);
  }

  toggleListening() {
    if (!this.recognition) { this.updateStatus('Recognition unavailable', 'error'); return; }
    if (this.listening) {
      this.listening = false; try { this.recognition.stop(); } catch(e){}; this._setMicClass(); this.updateStatus('Ready','ready'); announceToScreenReader('Session ended.');
    } else {
      try { this.recognition.start(); }
      catch (e) { try { this.recognition.stop(); this.recognition.start(); } catch (e2) { console.warn(e2); } }
    }
  }

  _setMicClass(cls) {
    if (!this.micBtn) return;
    this.micBtn.classList.remove('listening','processing');
    if (cls) this.micBtn.classList.add(cls);
  }

  /* SILENT announce: update UI/status and screen reader but DO NOT speak */
  silentAnnounce(msg) {
    if (!msg) return;
    this.lastMessage = msg;
    if (this.statusEl && this.statusTextEl) {
      this.updateStatus(msg, 'ready');
    }
    announceToScreenReader(msg);
  }

  /* Speak using Web Speech API when voice is enabled */
  speak(msg, opts = {}) {
    if (!msg) return;
    if (!this.voiceEnabled) return; // respect user setting
    if (!this.Synth) { console.warn('Speech synthesis not supported in this browser.'); return; }

    try {
      // stop any ongoing speech optionally
      if (opts.cancelOngoing) this.Synth.cancel();

      const ut = new SpeechSynthesisUtterance(msg);
      if (this.voice) ut.voice = this.voice;
      ut.lang = this.voice && this.voice.lang ? this.voice.lang : (opts.lang || 'en-US');
      ut.rate = typeof opts.rate === 'number' ? opts.rate : 1;
      ut.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1;

      ut.onstart = () => { this.updateStatus('Speaking...', 'processing'); };
      ut.onend = () => { this.updateStatus('Ready', 'ready'); };
      ut.onerror = (e) => { console.warn('Speech synthesis error', e); this.updateStatus('Speech error', 'error'); };

      this.Synth.speak(ut);
    } catch (e) {
      console.warn('speak failed', e);
    }
  }

  processCommand(text) {
    // Optimization: Use pre-compiled patterns for faster matching
    this.updateStatus('Processing...', 'processing');

    // Quick command check using pre-compiled patterns
    if (this.patterns.stop.test(text)) {
      this.toggleListening();
      return;
    }

    if (this.patterns.help.test(text)) {
      this.silentAnnounce('You can say: add buy milk, delete 1, complete 1, edit task 2 to buy milk, restore task 2, show deleted tasks.');
      return;
    }

    if (this.patterns.showDeleted.test(text)) {
      openDeletedTray();
      this.silentAnnounce('Showing deleted tasks.');
      return;
    }

    if (this.patterns.hideDeleted.test(text)) {
      closeDeletedTray();
      this.silentAnnounce('Closed deleted tasks.');
      return;
    }

    if (this.patterns.deleteAll.test(text)) {
      clearAll();
      this.silentAnnounce('All tasks deleted.');
      return;
    }

    // Add tasks (optimized)
    let match = text.match(this.patterns.add);
    if (match && match[1]) {
      this._handleAddCommand(match[1].trim());
      return;
    }

    // Restore task (optimized)
    match = text.match(this.patterns.restore);
    if (match && match[1]) {
      this._handleRestoreCommand(match[1].trim());
      return;
    }

    // Edit task (optimized)
    match = text.match(this.patterns.edit);
    if (match && match[1] && match[2]) {
      this._handleEditCommand(parseInt(match[1], 10), match[2].trim());
      return;
    }

    // Delete task (optimized)
    match = text.match(this.patterns.delete);
    if (match && match[1]) {
      this._handleDeleteCommand(match[1].trim());
      return;
    }

    // Complete task (optimized)
    match = text.match(this.patterns.complete);
    if (match && match[1]) {
      this._handleCompleteCommand(parseInt(match[1], 10));
      return;
    }

    // List tasks
    if (this.patterns.list.test(text)) {
      const activeCount = tasks.filter(t => !t.completed && !t.deleted).length;
      this.silentAnnounce(`You have ${activeCount} active task${activeCount !== 1 ? 's' : ''}.`);
      return;
    }

    // Unrecognized
    this.updateStatus("Unrecognized command", 'error');
    announceToScreenReader("Command not recognized. Say 'help' for examples.");
  }

  _handleAddCommand(body) {
    // Optimization: Batch DOM updates
    const parts = body.split(',').map(p => p.trim()).filter(Boolean);
    const newTasks = [];
    
    parts.forEach(item => {
      let priority = 'medium';
      const w = item.split(' ');
      const last = w[w.length - 1].toLowerCase();
      
      if (['high', 'urgent', 'important', 'asap'].includes(last)) {
        priority = 'high';
        w.pop();
      } else if (['low', 'minor', 'normal'].includes(last)) {
        priority = 'low';
        w.pop();
      }
      
      const textItem = w.join(' ').trim();
      if (textItem) {
        newTasks.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          text: textItem,
          priority,
          completed: false,
          deleted: false,
          createdAt: new Date().toISOString()
        });
      }
    });

    if (newTasks.length) {
      tasks.unshift(...newTasks);
      saveTasks();
      renderTasks();
      updateStats();
      this.silentAnnounce(`Added ${newTasks.length} task${newTasks.length !== 1 ? 's' : ''}.`);
      if (this.autoStopAfterAction) this.maybeAutoStop();
    }
  }

  _handleRestoreCommand(val) {
    // Optimization: Cache deleted list
    const deletedList = tasks.filter(t => t.deleted);
    const num = parseInt(val, 10);

    if (!isNaN(num)) {
      const idx = num - 1;
      if (idx >= 0 && idx < deletedList.length) {
        restoreTask(deletedList[idx].id);
        renderDeletedTrayList();
        this.silentAnnounce(`Restored task ${num}.`);
        if (this.autoStopAfterAction) this.maybeAutoStop();
        return;
      }
      this.silentAnnounce(`Deleted task ${num} not found.`);
      return;
    }

    // Text-based restore
    const found = deletedList.find(t => t.text.toLowerCase().includes(val.toLowerCase()));
    if (found) {
      restoreTask(found.id);
      renderDeletedTrayList();
      this.silentAnnounce('Restored item.');
      if (this.autoStopAfterAction) this.maybeAutoStop();
    }
  }

  _handleEditCommand(taskNum, newText) {
    const visible = getFilteredTasks();
    const idx = taskNum - 1;

    if (idx >= 0 && idx < visible.length) {
      const taskObj = tasks.find(t => t.id === visible[idx].id);
      if (taskObj) {
        taskObj.text = newText;
        saveTasks();
        renderTasks();
        updateStats();
        this.silentAnnounce(`Task ${taskNum} updated.`);
        if (this.autoStopAfterAction) this.maybeAutoStop();
        return;
      }
    }
    this.silentAnnounce(`Task ${taskNum} not found.`);
  }

  _handleDeleteCommand(val) {
    const num = parseInt(val, 10);

    if (!isNaN(num)) {
      const visible = getFilteredTasks();
      const idx = num - 1;

      if (idx >= 0 && idx < visible.length) {
        deleteTask(visible[idx].id);
        this.silentAnnounce(`Deleted task ${num}.`);
        if (this.autoStopAfterAction) this.maybeAutoStop();
        return;
      }
      this.silentAnnounce(`Task ${num} not found.`);
      return;
    }

    // Text-based delete
    const found = tasks.find(t => !t.deleted && t.text.toLowerCase().includes(val.toLowerCase()));
    if (found) {
      deleteTask(found.id);
      this.silentAnnounce('Deleted matching task.');
      if (this.autoStopAfterAction) this.maybeAutoStop();
    }
  }

  _handleCompleteCommand(taskNum) {
    const visible = getFilteredTasks();
    const idx = taskNum - 1;

    if (idx >= 0 && idx < visible.length) {
      toggleTask(visible[idx].id);
      this.silentAnnounce(`Completed task ${taskNum}.`);
      if (this.autoStopAfterAction) this.maybeAutoStop();
      return;
    }
    this.silentAnnounce(`Task ${taskNum} not found.`);
  }

  // announcer intentionally silent (no speechSynthesis)
  announce(msg) {
    if (!msg) return;
    this.lastMessage = msg;
    this.updateStatus(msg, 'ready');
    // screen reader update always
    announceToScreenReader(msg);
    // speak if voice mode enabled
    if (this.voiceEnabled) {
      // cancel any interim recognition audio
      this.speak(msg, { cancelOngoing: true });
    }
  }

  speakLast() { /* no-op in silent mode */ }

  speakLast() {
    if (!this.lastMessage) return;
    if (this.voiceEnabled) this.speak(this.lastMessage, { cancelOngoing: true });
  }

  toggleVoice() { this.setVoiceEnabled(!this.voiceEnabled); }
  setVoiceEnabled(v) {
    this.voiceEnabled = !!v;
    localStorage.setItem('aiVoiceEnabled', JSON.stringify(this.voiceEnabled));
    this.updateStatus(this.voiceEnabled ? 'Voice enabled' : 'Voice muted', 'ready');
    // when enabling, speak the last message for context
    if (this.voiceEnabled && this.lastMessage) {
      // speak a short version to avoid long readouts
      const msg = String(this.lastMessage).slice(0, 240);
      this.speak(msg, { cancelOngoing: true });
    }
  }

  setAutoStop(v) { this.autoStopAfterAction = !!v; localStorage.setItem('aiAutoStop', JSON.stringify(this.autoStopAfterAction)); this.updateStatus(this.autoStopAfterAction ? 'Auto-stop ON' : 'Auto-stop OFF', 'ready'); }
  maybeAutoStop() { if (!this.listening || !this.autoStopAfterAction) return; setTimeout(()=>{ try{ this.toggleListening(); }catch(e){} }, 500); }

  updateStatus(text, status) {
    if (!this.statusEl || !this.statusTextEl) return;
    this.statusEl.classList.remove('ready','listening','processing','error');
    this.statusEl.classList.add(status || 'ready','show');
    this.statusTextEl.textContent = text;
  }
  syncUI() {
    const voiceBtn = byId('voiceToggleBtn'); if (voiceBtn) voiceBtn.textContent = this.voiceEnabled ? 'Enabled' : 'Disabled';
    const autoBtn = byId('autoStopToggleBtn'); if (autoBtn) autoBtn.textContent = this.autoStopAfterAction ? 'Enabled' : 'Disabled';
    const autoStopBtn = byId('autoStopBtn'); if (autoStopBtn) autoStopBtn.textContent = this.autoStopAfterAction ? 'AutoStop:On' : 'AutoStop:Off';
  }
}

/* ---------- Expose compatibility ---------- */
/* ---------- Reminders & Email ---------- */

// Load saved EmailJS settings from localStorage
function loadEmailSettings() {
  const service = localStorage.getItem('emailServiceId') || '';
  const template = localStorage.getItem('emailTemplateId') || '';
  const user = localStorage.getItem('emailUserId') || '';
  const from = localStorage.getItem('emailFrom') || '';
  const to = localStorage.getItem('emailTo') || '';
  const noteEl = byId('emailSettingsNote');
  if (byId('emailServiceId')) byId('emailServiceId').value = service;
  if (byId('emailTemplateId')) byId('emailTemplateId').value = template;
  if (byId('emailUserId')) byId('emailUserId').value = user;
  if (byId('emailFrom')) byId('emailFrom').value = from;
  if (byId('emailTo')) byId('emailTo').value = to;
  if (service && user) {
    try { if (window.emailjs && emailjs.init) emailjs.init(user); } catch (e) { console.warn('emailjs init failed', e); }
    if (noteEl) noteEl.textContent = 'EmailJS configured (not tested).';
  } else {
    if (noteEl) noteEl.textContent = 'EmailJS not configured — mailto fallback will be used.';
  }
}

function saveEmailSettings() {
  const service = (byId('emailServiceId') && byId('emailServiceId').value) || '';
  const template = (byId('emailTemplateId') && byId('emailTemplateId').value) || '';
  const user = (byId('emailUserId') && byId('emailUserId').value) || '';
  const from = (byId('emailFrom') && byId('emailFrom').value) || '';
  const to = (byId('emailTo') && byId('emailTo').value) || '';
  localStorage.setItem('emailServiceId', service);
  localStorage.setItem('emailTemplateId', template);
  localStorage.setItem('emailUserId', user);
  localStorage.setItem('emailFrom', from);
  localStorage.setItem('emailTo', to);
  loadEmailSettings();
  announceToScreenReader('Email settings saved.');
}

function testEmailSettings() {
  // Try a quick test using emailjs if configured, else open mailto
  const sample = { subject: 'Task Master test', message: 'This is a test email from Task Master.' };
  const service = localStorage.getItem('emailServiceId');
  const template = localStorage.getItem('emailTemplateId');
  const user = localStorage.getItem('emailUserId');
  if (service && template && user && window.emailjs && emailjs.send) {
    const params = { from_email: localStorage.getItem('emailFrom') || '', to_email: localStorage.getItem('emailTo') || '', subject: sample.subject, message: sample.message };
    emailjs.send(service, template, params).then(() => { announceToScreenReader('Test email sent.'); alert('Test email sent.'); }).catch(err => { console.warn(err); alert('Test email failed: ' + (err && err.text) ); });
  } else {
    // fallback to mailto
    const to = localStorage.getItem('emailTo') || '';
    const subject = encodeURIComponent(sample.subject);
    const body = encodeURIComponent(sample.message);
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }
}

// Schedule checking every 20 seconds (lightweight) for reminders
let _reminderInterval = null;
function scheduleReminders() {
  if (_reminderInterval) clearInterval(_reminderInterval);
  // Run immediately then every 20s
  checkReminders();
  _reminderInterval = setInterval(checkReminders, 20000);
}

function checkReminders() {
  const now = Date.now();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t && t.reminderAt && !t.reminderSent && !t.deleted) {
      const when = new Date(t.reminderAt).getTime();
      if (!isNaN(when) && when <= now) {
        // Trigger reminder
        sendReminder(t);
      }
    }
  }
}

function sendReminder(task) {
  // Show native notification if permitted
  const title = `Reminder: ${task.text}`;
  const body = `Task due: ${task.text}`;
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch (e) { console.warn('notify failed', e); }
  } else if (window.Notification && Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') { try { new Notification(title, { body }); } catch(e){} } });
  }

  // Screen reader announce
  announceToScreenReader(`Reminder: ${task.text}`);

  // Also show an in-app popup/modal to ensure user sees the reminder in-page
  try { showReminderPopup(task); } catch (e) { console.warn('showReminderPopup failed', e); }

  // Email if requested
  if (task.reminderEmail) {
    // Try EmailJS if configured
    const service = localStorage.getItem('emailServiceId');
    const template = localStorage.getItem('emailTemplateId');
    const user = localStorage.getItem('emailUserId');
    if (service && template && user && window.emailjs && emailjs.send) {
      const params = {
          from_email: localStorage.getItem('emailFrom') || '',
          to_email: task.reminderTo || localStorage.getItem('emailTo') || '',
        subject: `Reminder: ${task.text}`,
        message: `Reminder for task: ${task.text}\nCreated: ${new Date(task.createdAt).toLocaleString()}`
      };
      emailjs.send(service, template, params).then(() => {
        task.reminderSent = true; saveTasks(); renderTasks(); announceToScreenReader('Reminder email sent.');
      }).catch(err => {
        console.warn('emailjs send failed', err);
        // fallback to mailto
        openMailtoAsFallback(task);
        task.reminderSent = true; saveTasks(); renderTasks();
      });
    } else {
      openMailtoAsFallback(task);
      task.reminderSent = true; saveTasks(); renderTasks();
    }
  } else {
    // Mark as sent for non-email reminders to avoid repeated announcements
    task.reminderSent = true; saveTasks(); renderTasks();
  }
}

function openMailtoAsFallback(task) {
  const toRaw = task.reminderTo || localStorage.getItem('emailTo') || '';
  const to = encodeURIComponent(toRaw);
  const subject = encodeURIComponent(`Reminder: ${task.text}`);
  const body = encodeURIComponent(`Reminder for task: ${task.text}\nCreated: ${new Date(task.createdAt).toLocaleString()}`);
  // Use a small delay to ensure UI updates to 'sent' state if needed
  window.open(`mailto:${to}?subject=${subject}&body=${body}`);
}

function showReminderPopup(task) {
  const modal = byId('taskModal');
  const title = byId('modalTitle');
  const body = byId('modalBody');
  if (!modal || !title || !body) return;
  title.textContent = `Reminder: ${task.text}`;
  const when = task.reminderAt ? (new Date(task.reminderAt).toLocaleString()) : 'Now';
  const to = task.reminderTo || localStorage.getItem('emailTo') || '';
  body.innerHTML = `
    <p style="margin-bottom:8px">${escapeHtml(task.text)}</p>
    <p style="color:var(--text-muted);font-size:0.95em;margin-bottom:12px">When: ${escapeHtml(when)}${to ? ' • Email: ' + escapeHtml(to) : ''}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn-secondary" id="snoozeBtn">Snooze 10 min</button>
      <button class="btn-primary" id="dismissReminderBtn">Dismiss</button>
    </div>
  `;
  modal.style.display = 'block';

  // Wire buttons
  const dismiss = byId('dismissReminderBtn');
  const snooze = byId('snoozeBtn');
  if (dismiss) {
    dismiss.onclick = () => { modal.style.display = 'none'; };
  }
  if (snooze) {
    snooze.onclick = () => {
      // snooze for 10 minutes
      const d = new Date(); d.setMinutes(d.getMinutes() + 10);
      task.reminderAt = d.toISOString();
      task.reminderSent = false;
      saveTasks();
      modal.style.display = 'none';
      announceToScreenReader('Reminder snoozed 10 minutes.');
    };
  }
  // Close handler for the modal's close icon
  const closeIcon = modal.querySelector('.close');
  if (closeIcon) closeIcon.onclick = () => { modal.style.display = 'none'; };
}

// Bind save/test email settings buttons
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.getAttribute('data-action');
  if (action === 'save-email-settings') { saveEmailSettings(); }
  if (action === 'test-email-settings') { testEmailSettings(); }
});

/* ---------- End Reminders & Email ---------- */
window.exportTasks = exportTasks;
window.clearCompleted = clearCompleted;
window.emptyTrash = emptyTrash;
window.clearAll = clearAll;
window.filterTasks = (s) => { currentFilter = s; renderTasks(); };
window.filterByPriority = (p) => setPriorityFilter(p);
window.sortTasks = (e) => { if (e && e.target && e.target.dataset && e.target.dataset.sort) currentSort = e.target.dataset.sort; renderTasks(); };
window.searchTasks = () => { const inp = byId('searchInput'); searchQuery = inp ? inp.value : ''; renderTasks(); };
window.showHelp = () => { const m = byId('helpModal'); if (m) m.style.display = 'block'; };
window.closeHelpModal = () => { const m = byId('helpModal'); if (m) m.style.display = 'none'; };
window.closeModal = () => { const m = byId('taskModal'); if (m) m.style.display = 'none'; };
