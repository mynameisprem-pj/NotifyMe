/* ===== NotifyMe - app.js ===== */
'use strict';

// ── State ──────────────────────────────────────────────────────
let reminders     = [];
let notes         = [];
let editingId     = null;
let editingNoteId = null;
let activeFilter  = 'all';
let currentView   = 'home';
let settings      = { speak: true, speed: 1, pitch: 1 };
let persistentSpeakingId = null;
let persistentSpeakingInterval = null;

// ── DOM ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Persistence ────────────────────────────────────────────────
function initIndexedDB() {
  return new Promise(resolve => {
    const req = indexedDB.open('NotifyMeDB', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = e => {
      try {
        e.target.result.createObjectStore('reminders', { keyPath: 'id' });
      } catch {}
    };
  });
}

async function saveToIndexedDB() {
  try {
    const db = await initIndexedDB();
    if (!db) return;
    const tx = db.transaction('reminders', 'readwrite');
    const store = tx.objectStore('reminders');
    store.clear();
    reminders.forEach(r => store.add(r));
  } catch (e) {
    console.error('IndexedDB save error:', e);
  }
}

function save() {
  localStorage.setItem('nm_reminders', JSON.stringify(reminders));
  localStorage.setItem('nm_notes',     JSON.stringify(notes));
  localStorage.setItem('nm_settings',  JSON.stringify(settings));
  saveToIndexedDB(); // Also save to IndexedDB for Service Worker access
}
function load() {
  try { reminders = JSON.parse(localStorage.getItem('nm_reminders')) || []; } catch { reminders = []; }
  try { notes     = JSON.parse(localStorage.getItem('nm_notes'))     || []; } catch { notes = []; }
  try { settings  = { speak:true, speed:1, pitch:1, ...JSON.parse(localStorage.getItem('nm_settings')) }; } catch {}
}

// ── Utils ──────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function formatDate(date, time) {
  if (!date) return '';
  const d     = new Date(date + 'T' + (time || '00:00'));
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rd    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff  = (rd - today) / 86400000;
  let dayStr;
  if      (diff === 0)  dayStr = 'Today';
  else if (diff === 1)  dayStr = 'Tomorrow';
  else if (diff === -1) dayStr = 'Yesterday';
  else                  dayStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  if (!time) return dayStr;
  const h = d.getHours(), m = d.getMinutes().toString().padStart(2,'0');
  return `${dayStr}, ${h%12||12}:${m} ${h>=12?'PM':'AM'}`;
}

function formatNoteDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month:'short', day:'numeric', year:'numeric',
    hour:'numeric', minute:'2-digit'
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const REPEAT_LABELS = {
  daily:'🔁 Daily', weekdays:'🔁 Weekdays',
  weekly:'🔁 Weekly', monthly:'🔁 Monthly', yearly:'🔁 Yearly'
};

// ══════════════════════════════════════════════════════════════
// NAVIGATION — panel switching, nav always visible
// ══════════════════════════════════════════════════════════════

const PANELS = { home: 'panelHome', calendar: 'panelCalendar', notes: 'panelNotes' };

function showView(view) {
  currentView = view;

  // Hide all panels
  Object.values(PANELS).forEach(id => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });

  // Update app class for view-specific styling
  $('app').classList.toggle('view-notes', view === 'notes');

  // Show the right panel
  if (view === 'home' || view === 'search') {
    $('panelHome').style.display = 'flex';
    $('addBtn').style.display = 'flex';
    if (view === 'search') setTimeout(() => $('searchInput').focus(), 50);
  } else if (view === 'calendar') {
    $('panelCalendar').style.display = 'flex';
    $('addBtn').style.display = 'none';
    renderCalendar(new Date());
  } else if (view === 'notes') {
    $('panelNotes').style.display = 'flex';
    $('addBtn').style.display = 'none';
    renderNotes();
  }

  // Update nav active state
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ══════════════════════════════════════════════════════════════
// REMINDERS
// ══════════════════════════════════════════════════════════════

function renderReminders(query = '') {
  const listEl  = $('remindersList');
  const emptyEl = $('emptyState');
  const q = query.toLowerCase();

  let filtered = reminders.filter(r => {
    if (activeFilter !== 'all' && r.category !== activeFilter) return false;
    if (q && !r.title.toLowerCase().includes(q) && !(r.note||'').toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date+'T'+(a.time||'00:00')) - new Date(b.date+'T'+(b.time||'00:00'));
  });

  emptyEl.style.display = filtered.length === 0 ? 'flex' : 'none';
  listEl.querySelectorAll('.reminder-card').forEach(el => el.remove());

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'reminder-card' + (r.done ? ' done' : '');

    const check = document.createElement('div');
    check.className = 'r-check' + (r.done ? ' checked' : '');
    check.addEventListener('click', e => { e.stopPropagation(); toggleDone(r.id); });

    const body = document.createElement('div');
    body.className = 'r-body';

    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = r.title;

    const meta = document.createElement('div');
    meta.className = 'r-meta';

    if (r.date || r.time) {
      const t = document.createElement('span');
      t.className = 'r-time';
      t.textContent = formatDate(r.date, r.time);
      meta.appendChild(t);
    }

    const tag = document.createElement('span');
    tag.className = 'r-tag';
    tag.dataset.cat = r.category;
    tag.textContent = r.category.charAt(0).toUpperCase() + r.category.slice(1);
    meta.appendChild(tag);

    if (r.recurring && r.recurring !== 'none') {
      const rep = document.createElement('span');
      rep.className = 'r-recurring';
      rep.textContent = REPEAT_LABELS[r.recurring] || '';
      meta.appendChild(rep);
    }

    if (r.persistent) {
      const per = document.createElement('span');
      per.className = 'r-persistent';
      per.innerHTML = '🔔 Persistent';
      meta.appendChild(per);
    }

    if (r.speakText) {
      const spk = document.createElement('span');
      spk.className = 'r-recurring';
      spk.textContent = '🔊 Custom voice';
      meta.appendChild(spk);
    }

    body.appendChild(title);
    body.appendChild(meta);

    const more = document.createElement('button');
    more.className = 'r-more';
    more.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
    more.addEventListener('click', e => { e.stopPropagation(); openEditModal(r.id); });

    card.appendChild(check);
    card.appendChild(body);
    card.appendChild(more);
    card.addEventListener('click', () => openEditModal(r.id));
    listEl.appendChild(card);
  });
}

function toggleDone(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  
  // Stop persistent speaking if marking as done
  if (r.done && r.persistent && persistentSpeakingId === id) {
    stopPersistentSpeaking();
  }
  
  save();
  renderReminders($('searchInput').value);
}

// ── Reminder Modal ─────────────────────────────────────────────
function openAddModal() {
  editingId = null;
  $('modalTitle').textContent  = 'New Reminder';
  $('reminderTitle').value     = '';
  $('reminderDate').value      = '';
  $('reminderTime').value      = '';
  $('reminderRecurring').value = 'none';
  $('reminderNote').value      = '';
  $('speakToggle').checked     = settings.speak;
  $('speakText').value         = '';
  $('persistentToggle').checked = false;
  $('deleteBtn').style.display = 'none';
  setActiveCatOpt('personal');
  updateSpeakWrap();
  openModal($('modalOverlay'));
  setTimeout(() => $('reminderTitle').focus(), 300);
}

function openEditModal(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  $('modalTitle').textContent  = 'Edit Reminder';
  $('reminderTitle').value     = r.title;
  $('reminderDate').value      = r.date || '';
  $('reminderTime').value      = r.time || '';
  $('reminderRecurring').value = r.recurring || 'none';
  $('reminderNote').value      = r.note || '';
  $('speakToggle').checked     = r.speak !== false;
  $('speakText').value         = r.speakText || '';
  $('persistentToggle').checked = r.persistent === true;
  $('deleteBtn').style.display = 'flex';
  setActiveCatOpt(r.category);
  updateSpeakWrap();
  openModal($('modalOverlay'));
}

function saveReminder() {
  const title = $('reminderTitle').value.trim();
  if (!title) { showToast('⚠️ Please enter a title'); $('reminderTitle').focus(); return; }

  const data = {
    id:        editingId || uid(),
    title,
    category:  getSelectedCat(),
    date:      $('reminderDate').value,
    time:      $('reminderTime').value,
    recurring: $('reminderRecurring').value,
    note:      $('reminderNote').value.trim(),
    speak:     $('speakToggle').checked,
    speakText: $('speakText').value.trim(),
    persistent: $('persistentToggle').checked,
    done:      false,
    createdAt: editingId ? (reminders.find(r=>r.id===editingId)?.createdAt || Date.now()) : Date.now()
  };

  if (editingId) {
    const idx = reminders.findIndex(r => r.id === editingId);
    if (idx !== -1) { data.done = reminders[idx].done; reminders[idx] = data; }
  } else {
    reminders.push(data);
  }

  save();
  renderReminders($('searchInput').value);
  closeModal($('modalOverlay'));
  showToast(editingId ? '✅ Reminder updated' : '🔔 Reminder saved');
}

function deleteReminder() {
  if (!editingId) return;
  reminders = reminders.filter(r => r.id !== editingId);
  save();
  renderReminders($('searchInput').value);
  closeModal($('modalOverlay'));
  showToast('🗑️ Reminder deleted');
}

function updateSpeakWrap() {
  $('speakTextWrap').classList.toggle('hidden', !$('speakToggle').checked);
}
$('speakToggle').addEventListener('change', updateSpeakWrap);

$('previewSpeakBtn').addEventListener('click', () => {
  const text = $('speakText').value.trim() || $('reminderTitle').value.trim() || 'Your reminder';
  speak(text);
});

// Category helpers
function setActiveCatOpt(val) {
  document.querySelectorAll('.cat-opt').forEach(b => b.classList.toggle('active', b.dataset.val === val));
}
function getSelectedCat() {
  return document.querySelector('.cat-opt.active')?.dataset.val || 'personal';
}
document.querySelectorAll('.cat-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Category filter pills
document.querySelectorAll('.cat-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.cat;
    renderReminders($('searchInput').value);
  });
});

// Quick note → switches to Notes tab and opens new note
$('quickNoteBtn').addEventListener('click', () => {
  showView('notes');
  setTimeout(() => openNoteModal(), 100);
});

// Search input
$('searchInput').addEventListener('input', () => renderReminders($('searchInput').value));

// Reminder modal events
$('addBtn').addEventListener('click', openAddModal);
$('closeModalBtn').addEventListener('click', () => closeModal($('modalOverlay')));
$('saveBtn').addEventListener('click', saveReminder);
$('deleteBtn').addEventListener('click', deleteReminder);
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal($('modalOverlay')); });
$('reminderTitle').addEventListener('keydown', e => { if (e.key === 'Enter') saveReminder(); });

// ══════════════════════════════════════════════════════════════
// NOTES
// ══════════════════════════════════════════════════════════════

function renderNotes(query = '') {
  const listEl  = $('notesList');
  const emptyEl = $('notesEmptyState');
  const q = query.toLowerCase();

  const filtered = notes
    .filter(n => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  emptyEl.style.display = filtered.length === 0 ? 'flex' : 'none';
  listEl.querySelectorAll('.note-card').forEach(el => el.remove());

  filtered.forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div class="note-card-title">${escHtml(n.title || 'Untitled')}</div>
      ${n.content ? `<div class="note-card-preview">${escHtml(n.content)}</div>` : ''}
      <div class="note-card-date">${formatNoteDate(n.updatedAt)}</div>
    `;
    card.addEventListener('click', () => openNoteModal(n.id));
    listEl.appendChild(card);
  });
}

function openNoteModal(id) {
  const n = id ? notes.find(x => x.id === id) : null;
  editingNoteId = id || null;
  $('noteModalTitle').textContent  = n ? 'Edit Note' : 'New Note';
  $('noteTitle').value             = n?.title   || '';
  $('noteContent').value           = n?.content || '';
  $('deleteNoteBtn').style.display = n ? 'flex' : 'none';
  openModal($('noteModalOverlay'));
  setTimeout(() => (n ? $('noteContent') : $('noteTitle')).focus(), 300);
}

function saveNote() {
  const title   = $('noteTitle').value.trim();
  const content = $('noteContent').value.trim();
  if (!title && !content) { showToast('⚠️ Note is empty'); return; }
  const now = Date.now();
  if (editingNoteId) {
    const idx = notes.findIndex(n => n.id === editingNoteId);
    if (idx !== -1) { notes[idx] = { ...notes[idx], title, content, updatedAt: now }; }
  } else {
    notes.push({ id: uid(), title, content, createdAt: now, updatedAt: now });
  }
  save();
  renderNotes($('notesSearchInput').value);
  closeModal($('noteModalOverlay'));
  showToast(editingNoteId ? '✅ Note updated' : '📝 Note saved');
}

function deleteNote() {
  if (!editingNoteId) return;
  notes = notes.filter(n => n.id !== editingNoteId);
  save();
  renderNotes($('notesSearchInput').value);
  closeModal($('noteModalOverlay'));
  showToast('🗑️ Note deleted');
}

$('addNoteBtn').addEventListener('click', () => openNoteModal());
$('closeNoteModalBtn').addEventListener('click', () => closeModal($('noteModalOverlay')));
$('saveNoteBtn').addEventListener('click', saveNote);
$('deleteNoteBtn').addEventListener('click', deleteNote);
$('noteModalOverlay').addEventListener('click', e => { if (e.target === $('noteModalOverlay')) closeModal($('noteModalOverlay')); });
$('notesSearchInput').addEventListener('input', () => renderNotes($('notesSearchInput').value));

// ══════════════════════════════════════════════════════════════
// VOICE
// ══════════════════════════════════════════════════════════════

function speak(text) {
  if (!settings.speak || !text) return;
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate  = settings.speed;
  u.pitch = settings.pitch;
  window.speechSynthesis.speak(u);
}

function startPersistentSpeaking(reminderId, text) {
  // Stop any existing persistent speaking
  stopPersistentSpeaking();
  
  persistentSpeakingId = reminderId;
  // Speak immediately
  speak(text);
  
  // Repeat speaking every 10 seconds
  persistentSpeakingInterval = setInterval(() => {
    // Only continue if the reminder is not marked as done
    const reminder = reminders.find(r => r.id === reminderId);
    if (!reminder || reminder.done) {
      stopPersistentSpeaking();
      return;
    }
    speak(text);
  }, 10000);
}

function stopPersistentSpeaking() {
  if (persistentSpeakingInterval) {
    clearInterval(persistentSpeakingInterval);
    persistentSpeakingInterval = null;
  }
  persistentSpeakingId = null;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function fireNotification(r) {
  const text = r.speakText || r.title;
  
  if (r.speak !== false) {
    if (r.persistent) {
      startPersistentSpeaking(r.id, text);
    } else {
      speak(text);
    }
  }
  
  if (Notification.permission === 'granted') {
    const notification = new Notification('NotifyMe 🔔', {
      body:  text + (r.note ? '\n' + r.note : ''),
      icon:  'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag:   r.id,
      requireInteraction: r.persistent
    });

    // Handle notification click for persistent reminders
    if (r.persistent) {
      notification.addEventListener('click', () => {
        markReminderDone(r.id);
        notification.close();
      });
    }
  }
}

function markReminderDone(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  
  r.done = true;
  stopPersistentSpeaking();
  save();
  renderReminders($('searchInput').value);
  showToast('✅ Reminder marked as done');
}

function checkReminders() {
  const now    = new Date();
  const pad    = n => String(n).padStart(2,'0');
  const nowMin = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  reminders.forEach(r => {
    if (r.done || !r.date || !r.time) return;
    if (`${r.date}T${r.time}` === nowMin) {
      fireNotification(r);
      
      // Handle non-persistent reminders
      if (!r.persistent) {
        if (r.recurring && r.recurring !== 'none') {
          r.date = getNextDate(new Date(`${r.date}T${r.time}`), r.recurring).toISOString().slice(0,10);
        } else {
          r.done = true;
        }
      }
      // Persistent reminders stay active until manually marked as done
      
      save();
      renderReminders($('searchInput').value);
    }
  });
}

function getNextDate(d, recurring) {
  const next = new Date(d);
  switch (recurring) {
    case 'daily':    next.setDate(next.getDate() + 1); break;
    case 'weekdays': do { next.setDate(next.getDate() + 1); } while ([0,6].includes(next.getDay())); break;
    case 'weekly':   next.setDate(next.getDate() + 7); break;
    case 'monthly':  next.setMonth(next.getMonth() + 1); break;
    case 'yearly':   next.setFullYear(next.getFullYear() + 1); break;
  }
  return next;
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

$('settingsBtn').addEventListener('click', () => {
  $('globalSpeakToggle').checked   = settings.speak;
  $('voiceSpeed').value            = settings.speed;
  $('voicePitch').value            = settings.pitch;
  $('voiceSpeedLabel').textContent = settings.speed.toFixed(1) + 'x';
  $('voicePitchLabel').textContent = settings.pitch.toFixed(1) + 'x';
  openModal($('settingsOverlay'));
});
$('closeSettingsBtn').addEventListener('click', () => closeModal($('settingsOverlay')));
$('settingsOverlay').addEventListener('click', e => { if (e.target === $('settingsOverlay')) closeModal($('settingsOverlay')); });

$('globalSpeakToggle').addEventListener('change', e => { settings.speak = e.target.checked; save(); });
$('voiceSpeed').addEventListener('input', e => {
  settings.speed = parseFloat(e.target.value);
  $('voiceSpeedLabel').textContent = settings.speed.toFixed(1) + 'x';
  save();
});
$('voicePitch').addEventListener('input', e => {
  settings.pitch = parseFloat(e.target.value);
  $('voicePitchLabel').textContent = settings.pitch.toFixed(1) + 'x';
  save();
});
$('testVoiceBtn').addEventListener('click', () => speak('This is how NotifyMe will speak your reminders!'));
$('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL reminders? This cannot be undone.')) return;
  reminders = []; save(); closeModal($('settingsOverlay')); renderReminders();
  showToast('🗑️ All reminders cleared');
});
$('clearNotesBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL notes? This cannot be undone.')) return;
  notes = []; save(); closeModal($('settingsOverlay')); renderNotes();
  showToast('🗑️ All notes cleared');
});

// ══════════════════════════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════════════════════════

let calSelectedDate = null;

function renderCalendar(d) {
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays    = new Date(year, month, 0).getDate();
  const today       = new Date();

  $('calendarGrid').innerHTML = `
    <div class="cal-month-header">
      <button class="cal-nav" id="calPrev">&#8249;</button>
      <h3>${d.toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h3>
      <button class="cal-nav" id="calNext">&#8250;</button>
    </div>
    <div class="cal-days-header">
      ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(x=>`<span>${x}</span>`).join('')}
    </div>
    <div class="cal-days" id="calDaysGrid"></div>
  `;

  const grid = $('calDaysGrid');

  for (let i = firstDay - 1; i >= 0; i--) {
    const el = document.createElement('div');
    el.className = 'cal-day other-month';
    el.textContent = prevDays - i;
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const el      = document.createElement('div');
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = day===today.getDate() && month===today.getMonth() && year===today.getFullYear();
    el.className  = 'cal-day';
    el.textContent = day;
    if (isToday)                      el.classList.add('today');
    if (calSelectedDate === dateStr)  el.classList.add('selected');
    if (reminders.some(r=>r.date===dateStr)) el.classList.add('has-reminder');
    el.addEventListener('click', () => { calSelectedDate = dateStr; renderCalendar(d); showDayReminders(dateStr); });
    grid.appendChild(el);
  }

  $('calPrev').addEventListener('click', () => renderCalendar(new Date(year, month-1, 1)));
  $('calNext').addEventListener('click', () => renderCalendar(new Date(year, month+1, 1)));
  if (calSelectedDate) showDayReminders(calSelectedDate);
}

function showDayReminders(dateStr) {
  const dl      = $('calendarDayReminders');
  const dayRems = reminders.filter(r => r.date === dateStr);
  const display = new Date(dateStr+'T00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  dl.innerHTML = `<h4>${display}</h4>`;
  if (!dayRems.length) {
    dl.innerHTML += `<p style="color:var(--text3);font-size:13px">No reminders this day.</p>`;
    return;
  }
  dayRems.forEach(r => {
    const el = document.createElement('div');
    el.className = 'reminder-card' + (r.done ? ' done' : '');
    el.style.cursor = 'pointer';
    el.innerHTML = `
      <div class="r-check${r.done?' checked':''}"></div>
      <div class="r-body">
        <div class="r-title">${escHtml(r.title)}</div>
        <div class="r-meta">
          ${r.time ? `<span class="r-time">${formatDate(r.date,r.time)}</span>` : ''}
          <span class="r-tag" data-cat="${r.category}">${r.category}</span>
        </div>
      </div>`;
    el.addEventListener('click', () => { showView('home'); openEditModal(r.id); });
    dl.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════

function openModal(overlay) { overlay.classList.add('open'); }
function closeModal(overlay) { overlay.classList.remove('open'); }

// ══════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    // Listen for messages from Service Worker
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'REMINDERS_UPDATED') {
        load();
        renderReminders();
      }
    });
    
    // Request periodic background sync every 1 minute
    if ('periodicSync' in reg) {
      reg.periodicSync.register('check-reminders', { minInterval: 1 * 60 * 1000 }).catch(() => {});
    }
  }).catch(() => {});
}

load();
showView('home');
renderReminders();
setInterval(checkReminders, 30000);
checkReminders();

// Sync reminders with Service Worker before closing
window.addEventListener('beforeunload', () => {
  stopPersistentSpeaking();
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SYNC_DATA', reminders });
  }
});