// ============================================================
//  Trainingsplaner – App-Logik
// ============================================================

const WEEKDAY_LABELS = ['Mo','Di','Mi','Do','Fr','Sa','So'];
const MONTH_LABELS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const PIN_LENGTH = 4;

const state = {
  categories: [], series: [], sessions: [], tactics: [],
  calView: 'week', calRefDate: new Date(), calSelectedDate: isoDate(new Date()),
  statsRange: '4w'
};
let currentUserId = null;

// ── Utils ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISODate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function weekdayOfDate(d) { return (d.getDay() + 6) % 7; }
function startOfWeek(d) { return addDays(d, -weekdayOfDate(d)); }
function uuid() { return crypto.randomUUID(); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sortByTime(a, b) { return (a.start_time || '99:99').localeCompare(b.start_time || '99:99'); }

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

// ── Theme (hell/dunkel/System) ──────────────────────────────────────────
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('tp_theme', theme);
  updateThemeToggleUI();
}
function updateThemeToggleUI() {
  const current = localStorage.getItem('tp_theme') || 'system';
  document.querySelectorAll('#theme-toggle .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === current));
}
document.querySelectorAll('#theme-toggle .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

function showView(id) {
  ['view-loading', 'view-setup', 'view-pin-create', 'view-lock', 'view-app'].forEach(v => {
    document.getElementById(v).hidden = v !== id;
  });
}

function openModal(id) { document.getElementById('modal-backdrop').hidden = false; document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; document.getElementById('modal-backdrop').hidden = true; }
function closeAllModals() { document.querySelectorAll('.modal').forEach(m => m.hidden = true); document.getElementById('modal-backdrop').hidden = true; }
document.getElementById('modal-backdrop').addEventListener('click', closeAllModals);
document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));

// ── Lokaler Cache & Offline-Queue ───────────────────────────────────────
function loadStateFromLocal() {
  state.categories = JSON.parse(localStorage.getItem('tp_categories') || '[]');
  state.series = JSON.parse(localStorage.getItem('tp_series') || '[]');
  state.sessions = JSON.parse(localStorage.getItem('tp_sessions') || '[]');
  state.tactics = JSON.parse(localStorage.getItem('tp_tactics') || '[]');
}
function saveLocal(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getQueue() { return JSON.parse(localStorage.getItem('tp_pending') || '[]'); }
function setQueue(q) { localStorage.setItem('tp_pending', JSON.stringify(q)); updateSyncBadge(); }
function queueChange(table, action, id, payload) {
  let q = getQueue();
  q = q.filter(item => !(item.table === table && item.id === id));
  q.push({ table, action, id, payload });
  setQueue(q);
}
function updateSyncBadge() {
  const badge = document.getElementById('sync-badge');
  const n = getQueue().length;
  badge.hidden = n === 0;
  badge.textContent = `offline · ${n} Änderung${n === 1 ? '' : 'en'} ausstehend`;
}
function syncNow() { processPendingQueue(); }

async function processPendingQueue() {
  if (!currentUserId) return;
  const queue = getQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      if (item.action === 'delete') {
        const { error } = await sb.from(item.table).delete().eq('id', item.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from(item.table).upsert(item.payload);
        if (error) throw error;
      }
    } catch (e) {
      remaining.push(item);
    }
  }
  setQueue(remaining);
  if (!remaining.length) await pullAll();
}

async function pullAll() {
  if (!currentUserId) return;
  const queue = getQueue();
  if (queue.length) return; // erst pullen, wenn keine lokalen Änderungen ausstehen
  try {
    const [catRes, seriesRes, sessRes, tacRes] = await Promise.all([
      sb.from('categories').select('*').order('created_at'),
      sb.from('series').select('*'),
      sb.from('sessions').select('*').gte('date', isoDate(addDays(new Date(), -90))).lte('date', isoDate(addDays(new Date(), 200))),
      sb.from('tactic_notes').select('*').order('created_at', { ascending: false }).limit(300)
    ]);
    if (!catRes.error) { state.categories = catRes.data; saveLocal('tp_categories', state.categories); }
    if (!seriesRes.error) { state.series = seriesRes.data; saveLocal('tp_series', state.series); }
    if (!sessRes.error) { state.sessions = sessRes.data; saveLocal('tp_sessions', state.sessions); }
    if (!tacRes.error) { state.tactics = tacRes.data; saveLocal('tp_tactics', state.tactics); }
  } catch (e) { /* offline - lokaler Cache bleibt gültig */ }
}

// ── PIN Hashing ──────────────────────────────────────────────────────────
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(pin + ':' + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
}
function renderPinDots(container, length, filledCount) {
  container.innerHTML = '';
  for (let i = 0; i < length; i++) {
    const d = document.createElement('span');
    if (i < filledCount) d.classList.add('filled');
    container.appendChild(d);
  }
}
function buildKeypad(container, onDigit, onBackspace) {
  container.innerHTML = '';
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (k === '') { btn.style.visibility = 'hidden'; }
    else {
      btn.textContent = k;
      btn.addEventListener('click', () => k === '⌫' ? onBackspace() : onDigit(k));
    }
    container.appendChild(btn);
  });
}

// ── PIN erstellen ────────────────────────────────────────────────────────
let pinCreateStage = 'first', pinFirstValue = '', pinBuffer = '';
function initPinCreateView() {
  pinCreateStage = 'first'; pinFirstValue = ''; pinBuffer = '';
  document.getElementById('pin-confirm-dots').hidden = true;
  document.getElementById('pin-create-error').textContent = '';
  renderPinDots(document.getElementById('pin-create-dots'), PIN_LENGTH, 0);
  buildKeypad(document.getElementById('pin-create-keypad'), onPinCreateDigit, onPinCreateBackspace);
}
function onPinCreateDigit(d) {
  if (pinBuffer.length >= PIN_LENGTH) return;
  pinBuffer += d;
  const dotsEl = document.getElementById(pinCreateStage === 'first' ? 'pin-create-dots' : 'pin-confirm-dots');
  renderPinDots(dotsEl, PIN_LENGTH, pinBuffer.length);
  if (pinBuffer.length === PIN_LENGTH) {
    if (pinCreateStage === 'first') {
      pinFirstValue = pinBuffer; pinBuffer = '';
      pinCreateStage = 'confirm';
      document.getElementById('pin-confirm-dots').hidden = false;
      renderPinDots(document.getElementById('pin-confirm-dots'), PIN_LENGTH, 0);
    } else if (pinBuffer === pinFirstValue) {
      finalizePinCreate(pinBuffer);
    } else {
      document.getElementById('pin-create-error').textContent = 'PINs stimmen nicht überein, bitte erneut.';
      pinCreateStage = 'first'; pinFirstValue = ''; pinBuffer = '';
      document.getElementById('pin-confirm-dots').hidden = true;
      renderPinDots(document.getElementById('pin-create-dots'), PIN_LENGTH, 0);
    }
  }
}
function onPinCreateBackspace() {
  pinBuffer = pinBuffer.slice(0, -1);
  const dotsEl = document.getElementById(pinCreateStage === 'first' ? 'pin-create-dots' : 'pin-confirm-dots');
  renderPinDots(dotsEl, PIN_LENGTH, pinBuffer.length);
}
async function finalizePinCreate(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  localStorage.setItem('tp_pin_salt', salt);
  localStorage.setItem('tp_pin_hash', hash);
  await proceedToApp();
}

// ── PIN Lock ─────────────────────────────────────────────────────────────
let lockBuffer = '';
function initLockView() {
  lockBuffer = '';
  document.getElementById('lock-error').textContent = '';
  renderPinDots(document.getElementById('lock-dots'), PIN_LENGTH, 0);
  buildKeypad(document.getElementById('lock-keypad'), onLockDigit, onLockBackspace);
}
function onLockDigit(d) {
  if (lockBuffer.length >= PIN_LENGTH) return;
  lockBuffer += d;
  renderPinDots(document.getElementById('lock-dots'), PIN_LENGTH, lockBuffer.length);
  if (lockBuffer.length === PIN_LENGTH) checkLockPin(lockBuffer);
}
function onLockBackspace() {
  lockBuffer = lockBuffer.slice(0, -1);
  renderPinDots(document.getElementById('lock-dots'), PIN_LENGTH, lockBuffer.length);
}
async function checkLockPin(pin) {
  const salt = localStorage.getItem('tp_pin_salt');
  const storedHash = localStorage.getItem('tp_pin_hash');
  const hash = await hashPin(pin, salt);
  if (hash === storedHash) {
    await proceedToApp();
  } else {
    document.getElementById('lock-error').textContent = 'Falscher PIN';
    lockBuffer = '';
    setTimeout(() => renderPinDots(document.getElementById('lock-dots'), PIN_LENGTH, 0), 250);
  }
}
document.getElementById('lock-unlink').addEventListener('click', unlinkDevice);
document.getElementById('btn-logout').addEventListener('click', unlinkDevice);
async function unlinkDevice() {
  if (!confirm('Dieses Gerät von deinem Konto trennen? Lokale Zwischenspeicherung wird gelöscht (Cloud-Daten bleiben erhalten).')) return;
  try { await sb.auth.signOut(); } catch (e) {}
  ['tp_pin_hash','tp_pin_salt','tp_categories','tp_series','tp_sessions','tp_tactics','tp_pending','tp_notified']
    .forEach(k => localStorage.removeItem(k));
  location.reload();
}

// ── Setup (Registrierung / Gerät verknüpfen) ────────────────────────────
let setupMode = 'signup';
document.querySelectorAll('#setup-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setupMode = btn.dataset.mode;
    document.querySelectorAll('#setup-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.getElementById('setup-submit').textContent = setupMode === 'signup' ? 'Konto erstellen' : 'Anmelden';
    document.getElementById('setup-hint').textContent = setupMode === 'signup'
      ? 'Einmalig ein Konto erstellen. Danach reicht auf diesem Gerät ein PIN.'
      : 'Mit bestehendem Konto auf diesem Gerät anmelden. Danach reicht ein PIN.';
    document.getElementById('setup-error').textContent = '';
  });
});
function translateAuthError(err) {
  const msg = err?.message || '';
  if (/already registered|already exists/i.test(msg)) return 'Diese E-Mail ist bereits registriert. Nutze "Gerät verknüpfen".';
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.';
  if (/password.*(least|short)/i.test(msg)) return 'Passwort muss mindestens 6 Zeichen haben.';
  return msg || 'Ein Fehler ist aufgetreten.';
}
document.getElementById('setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('setup-email').value.trim();
  const password = document.getElementById('setup-password').value;
  const btn = document.getElementById('setup-submit');
  const errEl = document.getElementById('setup-error');
  errEl.textContent = ''; btn.disabled = true;
  try {
    if (setupMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        errEl.textContent = 'Konto erstellt. Bitte E-Mail bestätigen und danach über "Gerät verknüpfen" anmelden.';
        btn.disabled = false;
        return;
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    showView('view-pin-create');
    initPinCreateView();
  } catch (err) {
    errEl.textContent = translateAuthError(err);
  } finally {
    btn.disabled = false;
  }
});

async function getCurrentUserId() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.id || null;
}
async function proceedToApp() {
  currentUserId = await getCurrentUserId();
  if (!currentUserId) {
    document.getElementById('lock-error').textContent = 'Sitzung abgelaufen, bitte Konto erneut verknüpfen.';
    setTimeout(() => showView('view-setup'), 1500);
    return;
  }
  await enterApp();
}

// ── Kategorien ───────────────────────────────────────────────────────────
function populateCategorySelects() {
  const opts = state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('session-category').innerHTML = opts || '<option value="">– zuerst Kategorie anlegen –</option>';
  document.getElementById('tactic-category').innerHTML = '<option value="">–</option>' + opts;
  document.getElementById('tactics-filter').innerHTML = '<option value="">Alle Kategorien</option>' + opts;
}

function renderCategories() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  if (!state.categories.length) {
    list.innerHTML = '<div class="empty-state">Noch keine Kategorien. Lege deine erste an (z.B. Teamtraining, Lauf, Kraft).</div>';
    return;
  }
  state.categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `<span class="category-dot" style="background:${cat.color}"></span><span class="name">${escapeHtml(cat.name)}</span><button class="icon-btn btn-edit-cat">✎</button>`;
    row.querySelector('.btn-edit-cat').addEventListener('click', () => openCategoryModal(cat));
    list.appendChild(row);
  });
}
function openCategoryModal(cat) {
  document.getElementById('category-form').reset();
  if (cat) {
    document.getElementById('category-modal-title').textContent = 'Kategorie bearbeiten';
    document.getElementById('category-id').value = cat.id;
    document.getElementById('category-name').value = cat.name;
    document.getElementById('category-color').value = cat.color;
    document.getElementById('category-field-distance').checked = !!cat.field_flags?.distance;
    document.getElementById('category-field-exercises').checked = !!cat.field_flags?.exercises;
    document.getElementById('btn-delete-category').hidden = false;
  } else {
    document.getElementById('category-modal-title').textContent = 'Neue Kategorie';
    document.getElementById('category-id').value = '';
    document.getElementById('category-color').value = '#3b82f6';
    document.getElementById('btn-delete-category').hidden = true;
  }
  openModal('modal-category');
}
document.getElementById('btn-add-category').addEventListener('click', () => openCategoryModal(null));
document.getElementById('category-form').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('category-id').value || uuid();
  const existingIdx = state.categories.findIndex(c => c.id === id);
  const row = {
    id, user_id: currentUserId,
    name: document.getElementById('category-name').value.trim(),
    color: document.getElementById('category-color').value,
    field_flags: {
      distance: document.getElementById('category-field-distance').checked,
      exercises: document.getElementById('category-field-exercises').checked
    },
    created_at: existingIdx >= 0 ? state.categories[existingIdx].created_at : new Date().toISOString()
  };
  if (existingIdx >= 0) state.categories[existingIdx] = row; else state.categories.push(row);
  saveLocal('tp_categories', state.categories);
  queueChange('categories', 'upsert', id, row);
  populateCategorySelects();
  renderCategories();
  renderCalendar();
  closeModal('modal-category');
  toast('Kategorie gespeichert');
  syncNow();
});
document.getElementById('btn-delete-category').addEventListener('click', () => {
  deleteCategory(document.getElementById('category-id').value);
});
function deleteCategory(id) {
  if (!confirm('Kategorie und ALLE zugehörigen Termine werden gelöscht. Fortfahren?')) return;
  const sessionIdsToRemove = state.sessions.filter(s => s.category_id === id).map(s => s.id);
  const seriesIdsToRemove = state.series.filter(s => s.category_id === id).map(s => s.id);
  state.sessions = state.sessions.filter(s => s.category_id !== id);
  state.series = state.series.filter(s => s.category_id !== id);
  state.categories = state.categories.filter(c => c.id !== id);
  state.tactics.forEach(t => { if (t.category_id === id) t.category_id = null; });
  saveLocal('tp_sessions', state.sessions);
  saveLocal('tp_series', state.series);
  saveLocal('tp_categories', state.categories);
  saveLocal('tp_tactics', state.tactics);
  let queue = getQueue().filter(q => !(
    (q.table === 'sessions' && sessionIdsToRemove.includes(q.id)) ||
    (q.table === 'series' && seriesIdsToRemove.includes(q.id))
  ));
  setQueue(queue);
  queueChange('categories', 'delete', id, null);
  closeModal('modal-category');
  populateCategorySelects();
  renderCategories();
  renderCalendar();
  syncNow();
}

// ── Detail-Felder im Termin-Formular ─────────────────────────────────────
document.getElementById('session-category').addEventListener('change', updateSessionDetailGroups);
function updateSessionDetailGroups() {
  const cat = state.categories.find(c => c.id === document.getElementById('session-category').value);
  document.getElementById('session-detail-distance').hidden = !cat?.field_flags?.distance;
  document.getElementById('session-detail-exercises').hidden = !cat?.field_flags?.exercises;
}
document.getElementById('session-recurring').addEventListener('change', function () {
  document.getElementById('recurring-options').hidden = !this.checked;
});
document.getElementById('weekday-picker').addEventListener('click', e => {
  const btn = e.target.closest('.wd-btn');
  if (btn) btn.classList.toggle('active');
});
document.getElementById('btn-add-exercise').addEventListener('click', () => addExerciseRow());
function addExerciseRow(ex = {}) {
  const row = document.createElement('div');
  row.className = 'exercise-row';
  row.innerHTML = `
    <input type="text" placeholder="Übung" class="ex-name" value="${escapeHtml(ex.name || '')}">
    <input type="number" placeholder="Sätze" class="ex-sets" value="${ex.sets ?? ''}">
    <input type="number" placeholder="Wdh." class="ex-reps" value="${ex.reps ?? ''}">
    <input type="number" placeholder="Kg" class="ex-weight" value="${ex.weight ?? ''}">
    <button type="button" class="ex-remove">×</button>`;
  row.querySelector('.ex-remove').addEventListener('click', () => row.remove());
  document.getElementById('exercise-rows').appendChild(row);
}
function collectExerciseRows() {
  return [...document.querySelectorAll('#exercise-rows .exercise-row')].map(r => ({
    name: r.querySelector('.ex-name').value.trim(),
    sets: r.querySelector('.ex-sets').value ? parseInt(r.querySelector('.ex-sets').value, 10) : null,
    reps: r.querySelector('.ex-reps').value ? parseInt(r.querySelector('.ex-reps').value, 10) : null,
    weight: r.querySelector('.ex-weight').value ? parseFloat(r.querySelector('.ex-weight').value) : null
  })).filter(e => e.name);
}
function collectDetailFields(category) {
  const details = {};
  if (category?.field_flags?.distance) {
    const km = document.getElementById('detail-distance-km').value;
    const pace = document.getElementById('detail-pace').value.trim();
    if (km) details.distance_km = parseFloat(km);
    if (pace) details.pace = pace;
  }
  if (category?.field_flags?.exercises) {
    details.exercises = collectExerciseRows();
  }
  return details;
}

// ── Termin-Modal ─────────────────────────────────────────────────────────
function openSessionModal(session, defaultDate) {
  document.getElementById('session-form').reset();
  document.getElementById('exercise-rows').innerHTML = '';
  document.getElementById('session-detail-distance').hidden = true;
  document.getElementById('session-detail-exercises').hidden = true;
  document.getElementById('recurring-options').hidden = true;
  document.querySelectorAll('#weekday-picker .wd-btn').forEach(b => b.classList.remove('active'));
  populateCategorySelects();

  const recurringLabel = document.getElementById('session-recurring').closest('label');

  if (session) {
    document.getElementById('session-modal-title').textContent = 'Termin bearbeiten';
    document.getElementById('session-id').value = session.id;
    document.getElementById('session-category').value = session.category_id;
    document.getElementById('session-title').value = session.title;
    document.getElementById('session-date').value = session.date;
    document.getElementById('session-time').value = (session.start_time || '').slice(0, 5);
    document.getElementById('session-duration').value = session.duration_minutes;
    document.getElementById('session-notes').value = session.notes || '';
    document.getElementById('btn-delete-session').hidden = false;
    recurringLabel.style.display = session.series_id ? 'none' : '';
    const cat = state.categories.find(c => c.id === session.category_id);
    updateSessionDetailGroups();
    if (cat?.field_flags?.distance) {
      document.getElementById('detail-distance-km').value = session.details?.distance_km ?? '';
      document.getElementById('detail-pace').value = session.details?.pace ?? '';
    }
    if (cat?.field_flags?.exercises) {
      const exs = session.details?.exercises || [];
      (exs.length ? exs : [{}]).forEach(ex => addExerciseRow(ex));
    }
  } else {
    document.getElementById('session-modal-title').textContent = 'Neuer Termin';
    document.getElementById('session-id').value = '';
    document.getElementById('session-date').value = defaultDate || isoDate(new Date());
    document.getElementById('session-duration').value = 60;
    document.getElementById('btn-delete-session').hidden = true;
    recurringLabel.style.display = '';
    updateSessionDetailGroups();
  }
  openModal('modal-session');
}

document.getElementById('session-form').addEventListener('submit', e => {
  e.preventDefault();
  const categoryId = document.getElementById('session-category').value;
  if (!categoryId) { toast('Bitte zuerst eine Kategorie anlegen (Mehr → Kategorien)'); return; }
  const category = state.categories.find(c => c.id === categoryId);
  const title = document.getElementById('session-title').value.trim() || category?.name || 'Training';
  const date = document.getElementById('session-date').value;
  const time = document.getElementById('session-time').value || null;
  const duration = parseInt(document.getElementById('session-duration').value, 10) || 60;
  const notes = document.getElementById('session-notes').value.trim();
  const details = collectDetailFields(category);
  const isRecurring = document.getElementById('session-recurring').checked;

  if (isRecurring) {
    const byweekday = [...document.querySelectorAll('#weekday-picker .wd-btn.active')].map(b => parseInt(b.dataset.wd, 10));
    if (!byweekday.length) { toast('Bitte mindestens einen Wochentag wählen'); return; }
    const untilDate = document.getElementById('session-until').value || null;
    const series = {
      id: uuid(), user_id: currentUserId, category_id: categoryId, title,
      byweekday, start_time: time, duration_minutes: duration,
      until_date: untilDate, details: { ...details, anchor_date: date },
      created_at: new Date().toISOString()
    };
    state.series.push(series);
    saveLocal('tp_series', state.series);
    queueChange('series', 'upsert', series.id, series);
    materializeAndQueue(series);
    toast('Serie erstellt');
  } else {
    const existingId = document.getElementById('session-id').value;
    const id = existingId || uuid();
    const existingIdx = state.sessions.findIndex(s => s.id === id);
    const prev = existingIdx >= 0 ? state.sessions[existingIdx] : null;
    const row = {
      id, user_id: currentUserId, category_id: categoryId,
      series_id: prev ? prev.series_id : null,
      title, date, start_time: time, duration_minutes: duration,
      status: prev ? prev.status : 'planned',
      intensity: prev ? prev.intensity : null,
      performance_rating: prev ? prev.performance_rating : null,
      fitness_rating: prev ? prev.fitness_rating : null,
      notes, details,
      created_at: prev ? prev.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (existingIdx >= 0) state.sessions[existingIdx] = row; else state.sessions.push(row);
    saveLocal('tp_sessions', state.sessions);
    queueChange('sessions', 'upsert', id, row);
    toast('Gespeichert');
  }
  closeModal('modal-session');
  renderCalendar();
  syncNow();
});

document.getElementById('btn-delete-session').addEventListener('click', () => {
  const id = document.getElementById('session-id').value;
  if (!id) return;
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  if (session.series_id) {
    const deleteAll = confirm('Ganze Serie ab diesem Termin löschen?\nOK = ganze Serie (ab hier), Abbrechen = nur diesen Termin.');
    if (deleteAll) deleteSeriesFuture(session.series_id, session.date);
    else deleteSingleSession(id);
  } else {
    if (!confirm('Diesen Termin löschen?')) return;
    deleteSingleSession(id);
  }
  closeModal('modal-session');
  syncNow();
});
function deleteSingleSession(id) {
  state.sessions = state.sessions.filter(s => s.id !== id);
  saveLocal('tp_sessions', state.sessions);
  queueChange('sessions', 'delete', id, null);
  renderCalendar();
  toast('Termin gelöscht');
}
function deleteSeriesFuture(seriesId, fromDate) {
  const toDelete = state.sessions.filter(s => s.series_id === seriesId && s.date >= fromDate);
  state.sessions = state.sessions.filter(s => !(s.series_id === seriesId && s.date >= fromDate));
  saveLocal('tp_sessions', state.sessions);
  toDelete.forEach(s => queueChange('sessions', 'delete', s.id, null));
  const series = state.series.find(s => s.id === seriesId);
  if (series) {
    const dayBefore = isoDate(addDays(parseISODate(fromDate), -1));
    if (!series.until_date || series.until_date > dayBefore) {
      series.until_date = dayBefore;
      saveLocal('tp_series', state.series);
      queueChange('series', 'upsert', series.id, series);
    }
  }
  renderCalendar();
  toast('Serie beendet');
}
function markSkipped(id) {
  const s = state.sessions.find(x => x.id === id);
  s.status = 'skipped'; s.updated_at = new Date().toISOString();
  saveLocal('tp_sessions', state.sessions);
  queueChange('sessions', 'upsert', id, s);
  renderCalendar();
  syncNow();
}

// ── Serientermine materialisieren ────────────────────────────────────────
function materializeSeries(series, horizonDate) {
  const existingDates = new Set(state.sessions.filter(s => s.series_id === series.id).map(s => s.date));
  let startFrom;
  if (existingDates.size) {
    startFrom = addDays(parseISODate([...existingDates].sort().pop()), 1);
  } else {
    const anchor = series.details?.anchor_date ? parseISODate(series.details.anchor_date) : new Date();
    const today = parseISODate(isoDate(new Date()));
    startFrom = anchor > today ? anchor : today;
  }
  const until = series.until_date ? parseISODate(series.until_date) : null;
  const created = [];
  let d = new Date(startFrom), safety = 0;
  while (d <= horizonDate && safety < 400) {
    safety++;
    if (!(until && d > until) && series.byweekday.includes(weekdayOfDate(d))) {
      const dateStr = isoDate(d);
      if (!existingDates.has(dateStr)) {
        created.push({
          id: uuid(), user_id: currentUserId, category_id: series.category_id,
          series_id: series.id, title: series.title, date: dateStr,
          start_time: series.start_time, duration_minutes: series.duration_minutes,
          status: 'planned', intensity: null, performance_rating: null, fitness_rating: null,
          notes: '', details: series.details || {},
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        });
      }
    }
    d = addDays(d, 1);
  }
  return created;
}
function materializeAndQueue(series) {
  const horizon = addDays(new Date(), 26 * 7);
  const rows = materializeSeries(series, horizon);
  if (rows.length) {
    state.sessions.push(...rows);
    saveLocal('tp_sessions', state.sessions);
    rows.forEach(r => queueChange('sessions', 'upsert', r.id, r));
  }
}
function ensureSeriesMaterialized() {
  state.series.forEach(series => materializeAndQueue(series));
}

// ── Nach-Training-Umfrage ────────────────────────────────────────────────
function openSurveyModal(session) {
  document.getElementById('survey-session-id').value = session.id;
  const intensity = session.intensity ?? 5;
  document.getElementById('survey-intensity').value = intensity;
  document.getElementById('survey-intensity-val').textContent = intensity;
  renderStarRating('survey-performance', session.performance_rating ?? 3);
  renderStarRating('survey-fitness', session.fitness_rating ?? 3);
  document.getElementById('survey-tactic-note').value = '';
  openModal('modal-survey');
}
document.getElementById('survey-intensity').addEventListener('input', function () {
  document.getElementById('survey-intensity-val').textContent = this.value;
});
function renderStarRating(containerId, value) {
  const el = document.getElementById(containerId);
  el.dataset.value = value;
  el.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = '★';
    if (i <= value) b.classList.add('on');
    b.addEventListener('click', () => renderStarRating(containerId, i));
    el.appendChild(b);
  }
}
document.getElementById('survey-form').addEventListener('submit', e => {
  e.preventDefault();
  const id = document.getElementById('survey-session-id').value;
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;
  session.status = 'done';
  session.intensity = parseInt(document.getElementById('survey-intensity').value, 10);
  session.performance_rating = parseInt(document.getElementById('survey-performance').dataset.value, 10);
  session.fitness_rating = parseInt(document.getElementById('survey-fitness').dataset.value, 10);
  session.updated_at = new Date().toISOString();
  saveLocal('tp_sessions', state.sessions);
  queueChange('sessions', 'upsert', id, session);

  const noteText = document.getElementById('survey-tactic-note').value.trim();
  if (noteText) {
    const note = {
      id: uuid(), user_id: currentUserId, session_id: id, category_id: session.category_id,
      content: noteText, created_at: new Date().toISOString()
    };
    state.tactics.unshift(note);
    saveLocal('tp_tactics', state.tactics);
    queueChange('tactic_notes', 'upsert', note.id, note);
  }
  closeModal('modal-survey');
  renderCalendar();
  toast('Training gespeichert');
  syncNow();
});

// ── Kalender ─────────────────────────────────────────────────────────────
function buildSessionCard(session) {
  const cat = state.categories.find(c => c.id === session.category_id) || { color: '#888', name: '—' };
  const card = document.createElement('div');
  card.className = `session-card status-${session.status}`;
  card.style.borderLeftColor = cat.color;
  const timeLabel = session.start_time ? session.start_time.slice(0, 5) + ' Uhr' : 'ganztägig';
  const metaParts = [cat.name, `${session.duration_minutes} Min.`];
  if (session.details?.distance_km) metaParts.push(`${session.details.distance_km} km`);
  if (session.status === 'done') {
    metaParts.push(`RPE ${session.intensity ?? '–'}/10`);
    metaParts.push(`Leistung ${session.performance_rating ?? '–'}/5`);
  }
  card.innerHTML = `
    <div class="session-card-top">
      <span class="session-card-title">${escapeHtml(session.title)}</span>
      <span class="session-card-time">${timeLabel}</span>
    </div>
    <div class="session-card-meta">${metaParts.join(' · ')}</div>
    <div class="session-card-actions"></div>`;
  const actions = card.querySelector('.session-card-actions');
  if (session.status === 'planned') {
    actions.innerHTML = `<button class="primary">Erledigt</button><button class="btn-skip">Ausgefallen</button><button class="btn-edit">✎</button>`;
    actions.children[0].addEventListener('click', () => openSurveyModal(session));
    actions.children[1].addEventListener('click', () => markSkipped(session.id));
    actions.children[2].addEventListener('click', () => openSessionModal(session));
  } else {
    actions.innerHTML = `<button class="btn-edit">Details / Bearbeiten</button>`;
    actions.children[0].addEventListener('click', () => openSessionModal(session));
  }
  return card;
}
function buildAgendaDayBlock(day) {
  const wrap = document.createElement('div');
  wrap.className = 'agenda-day';
  const label = document.createElement('div');
  label.className = 'agenda-day-label';
  const isToday = isoDate(day) === isoDate(new Date());
  label.textContent = `${WEEKDAY_LABELS[weekdayOfDate(day)]}, ${day.getDate()}. ${MONTH_LABELS[day.getMonth()]}` + (isToday ? ' · Heute' : '');
  wrap.appendChild(label);
  const dayStr = isoDate(day);
  const daySessions = state.sessions.filter(s => s.date === dayStr).sort(sortByTime);
  if (!daySessions.length) {
    const empty = document.createElement('div');
    empty.className = 'agenda-empty';
    empty.textContent = 'Keine Trainings';
    wrap.appendChild(empty);
  } else {
    daySessions.forEach(s => wrap.appendChild(buildSessionCard(s)));
  }
  return wrap;
}
function renderWeekAgenda() {
  const start = startOfWeek(state.calRefDate);
  const end = addDays(start, 6);
  document.getElementById('cal-range-label').textContent =
    `${start.getDate()}.–${end.getDate()}. ${MONTH_LABELS[end.getMonth()]} ${end.getFullYear()}`;
  const agenda = document.getElementById('cal-agenda');
  agenda.innerHTML = '';
  for (let i = 0; i < 7; i++) agenda.appendChild(buildAgendaDayBlock(addDays(start, i)));
}
function renderMonthGrid() {
  const ref = state.calRefDate;
  document.getElementById('cal-range-label').textContent = `${MONTH_LABELS[ref.getMonth()]} ${ref.getFullYear()}`;
  const grid = document.getElementById('cal-month-grid');
  grid.innerHTML = '';
  WEEKDAY_LABELS.forEach(l => {
    const el = document.createElement('div'); el.className = 'wd-label'; el.textContent = l; grid.appendChild(el);
  });
  const firstOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -weekdayOfDate(firstOfMonth));
  const todayStr = isoDate(new Date());
  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    const dayStr = isoDate(day);
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    if (day.getMonth() !== ref.getMonth()) cell.classList.add('other-month');
    if (dayStr === todayStr) cell.classList.add('today');
    if (dayStr === state.calSelectedDate) cell.classList.add('selected');
    const num = document.createElement('div'); num.className = 'cal-day-num'; num.textContent = day.getDate();
    cell.appendChild(num);
    const daySessions = state.sessions.filter(s => s.date === dayStr);
    if (daySessions.length) {
      const dots = document.createElement('div'); dots.className = 'cal-day-dots';
      daySessions.slice(0, 4).forEach(s => {
        const cat = state.categories.find(c => c.id === s.category_id);
        const dot = document.createElement('span'); dot.style.background = cat?.color || '#888';
        dots.appendChild(dot);
      });
      cell.appendChild(dots);
    }
    cell.addEventListener('click', () => { state.calSelectedDate = dayStr; renderCalendar(); });
    grid.appendChild(cell);
  }
  const agenda = document.getElementById('cal-agenda');
  agenda.innerHTML = '';
  agenda.appendChild(buildAgendaDayBlock(parseISODate(state.calSelectedDate)));
}
function renderCalendar() {
  document.querySelectorAll('#cal-view-toggle .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.calView));
  document.getElementById('cal-month-grid').hidden = state.calView !== 'month';
  if (state.calView === 'month') renderMonthGrid(); else renderWeekAgenda();
}
document.getElementById('cal-prev').addEventListener('click', () => {
  state.calRefDate = state.calView === 'week' ? addDays(state.calRefDate, -7) : new Date(state.calRefDate.getFullYear(), state.calRefDate.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  state.calRefDate = state.calView === 'week' ? addDays(state.calRefDate, 7) : new Date(state.calRefDate.getFullYear(), state.calRefDate.getMonth() + 1, 1);
  renderCalendar();
});
document.getElementById('cal-today').addEventListener('click', () => {
  state.calRefDate = new Date(); state.calSelectedDate = isoDate(new Date()); renderCalendar();
});
document.querySelectorAll('#cal-view-toggle .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => { state.calView = btn.dataset.view; renderCalendar(); });
});
document.getElementById('fab-add-session').addEventListener('click', () => {
  if (!state.categories.length) { toast('Bitte zuerst eine Kategorie anlegen (Mehr → Kategorien)'); return; }
  openSessionModal(null, state.calSelectedDate || isoDate(new Date()));
});

// ── Taktikblatt ──────────────────────────────────────────────────────────
document.getElementById('btn-add-tactic').addEventListener('click', () => {
  document.getElementById('tactic-form').reset();
  openModal('modal-tactic');
});
document.getElementById('tactic-form').addEventListener('submit', e => {
  e.preventDefault();
  const note = {
    id: uuid(), user_id: currentUserId, session_id: null,
    category_id: document.getElementById('tactic-category').value || null,
    content: document.getElementById('tactic-content').value.trim(),
    created_at: new Date().toISOString()
  };
  state.tactics.unshift(note);
  saveLocal('tp_tactics', state.tactics);
  queueChange('tactic_notes', 'upsert', note.id, note);
  closeModal('modal-tactic');
  renderTactics();
  toast('Erkenntnis gespeichert');
  syncNow();
});
document.getElementById('tactics-filter').addEventListener('change', renderTactics);
function renderTactics() {
  const filter = document.getElementById('tactics-filter').value;
  const list = document.getElementById('tactics-list');
  list.innerHTML = '';
  const items = state.tactics.filter(t => !filter || t.category_id === filter)
    .slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!items.length) { list.innerHTML = '<div class="empty-state">Noch keine Erkenntnisse gesammelt.</div>'; return; }
  items.forEach(t => {
    const cat = state.categories.find(c => c.id === t.category_id);
    const card = document.createElement('div'); card.className = 'tactic-card';
    const dateLabel = new Date(t.created_at).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
    card.innerHTML = `
      <div class="tactic-card-meta">
        ${cat ? `<span class="tactic-cat-dot" style="background:${cat.color}"></span><span>${escapeHtml(cat.name)}</span>` : ''}
        <span>${dateLabel}</span>
      </div>
      <div class="tactic-card-content">${escapeHtml(t.content)}</div>`;
    list.appendChild(card);
  });
}

// ── Statistik ────────────────────────────────────────────────────────────
let chartHoursInstance = null, chartCategoryInstance = null;
document.querySelectorAll('#stats-range-toggle .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#stats-range-toggle .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    state.statsRange = btn.dataset.range;
    renderStats();
  });
});
function buildWeekPeriods(n) {
  const periods = [];
  const thisWeekStart = startOfWeek(new Date());
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(thisWeekStart, -7 * i);
    periods.push({ label: `${start.getDate()}.${start.getMonth() + 1}.`, start, end: addDays(start, 6) });
  }
  return periods;
}
function buildMonthPeriods(n) {
  const periods = [];
  const ref = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    periods.push({ label: MONTH_LABELS[start.getMonth()].slice(0, 3), start, end });
  }
  return periods;
}
function renderStats() {
  const range = state.statsRange || '4w';
  const periods = range === '4w' ? buildWeekPeriods(4) : range === '12w' ? buildWeekPeriods(12) : buildMonthPeriods(12);
  const cutoffStart = periods[0].start;
  const doneSessions = state.sessions.filter(s => s.status === 'done' && parseISODate(s.date) >= cutoffStart);

  const totalMin = doneSessions.reduce((a, s) => a + s.duration_minutes, 0);
  const withIntensity = doneSessions.filter(s => s.intensity != null);
  const avgIntensity = withIntensity.length ? (withIntensity.reduce((a, s) => a + s.intensity, 0) / withIntensity.length).toFixed(1) : '–';
  document.getElementById('stats-summary').innerHTML = `
    <div class="stat-box"><div class="num">${(totalMin / 60).toFixed(1)}</div><div class="lbl">Stunden</div></div>
    <div class="stat-box"><div class="num">${doneSessions.length}</div><div class="lbl">Trainings</div></div>
    <div class="stat-box"><div class="num">${avgIntensity}</div><div class="lbl">Ø Intensität</div></div>`;

  const catTotals = {};
  doneSessions.forEach(s => { catTotals[s.category_id] = (catTotals[s.category_id] || 0) + s.duration_minutes; });
  const catIds = Object.keys(catTotals);
  const catLabels = catIds.map(id => state.categories.find(c => c.id === id)?.name || '—');
  const catColors = catIds.map(id => state.categories.find(c => c.id === id)?.color || '#888');
  const catHours = catIds.map(id => +(catTotals[id] / 60).toFixed(1));

  if (chartCategoryInstance) chartCategoryInstance.destroy();
  chartCategoryInstance = new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: { labels: catLabels, datasets: [{ data: catHours, backgroundColor: catColors }] },
    options: { plugins: { title: { display: true, text: 'Stunden pro Kategorie' }, legend: { position: 'bottom' } }, maintainAspectRatio: false }
  });

  const datasets = catIds.map(id => ({
    label: state.categories.find(c => c.id === id)?.name || '—',
    backgroundColor: state.categories.find(c => c.id === id)?.color || '#888',
    data: periods.map(p => {
      const mins = doneSessions.filter(s => s.category_id === id && parseISODate(s.date) >= p.start && parseISODate(s.date) <= p.end)
        .reduce((a, s) => a + s.duration_minutes, 0);
      return +(mins / 60).toFixed(1);
    })
  }));
  if (chartHoursInstance) chartHoursInstance.destroy();
  chartHoursInstance = new Chart(document.getElementById('chart-hours'), {
    type: 'bar',
    data: { labels: periods.map(p => p.label), datasets },
    options: { plugins: { title: { display: true, text: 'Stunden im Verlauf' } }, responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
  });
}

// ── Erinnerungen ─────────────────────────────────────────────────────────
function updateNotificationButtonLabel() {
  const btn = document.getElementById('btn-enable-notifications');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    btn.textContent = 'Erinnerungen aktiv ✓'; btn.disabled = true;
  }
}
document.getElementById('btn-enable-notifications').addEventListener('click', async () => {
  if (typeof Notification === 'undefined') { toast('Benachrichtigungen werden von diesem Browser nicht unterstützt'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') { toast('Erinnerungen aktiviert'); startNotificationChecker(); updateNotificationButtonLabel(); }
  else toast('Berechtigung nicht erteilt');
});
let notificationTimer = null;
function startNotificationChecker() {
  if (notificationTimer) return;
  checkUpcomingSessions();
  notificationTimer = setInterval(checkUpcomingSessions, 60000);
}
function checkUpcomingSessions() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = new Date();
  const todayStr = isoDate(now);
  const notified = JSON.parse(localStorage.getItem('tp_notified') || '{}');
  if (notified._day !== todayStr) { for (const k in notified) delete notified[k]; notified._day = todayStr; }
  state.sessions.filter(s => s.date === todayStr && s.status === 'planned' && s.start_time).forEach(s => {
    const [h, m] = s.start_time.split(':').map(Number);
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const diffMin = (startDate - now) / 60000;
    if (diffMin > 0 && diffMin <= 30 && !notified[s.id]) {
      const body = `${s.title} um ${s.start_time.slice(0, 5)} Uhr`;
      if (navigator.serviceWorker?.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification('Training in Kürze', { body, icon: 'icon.svg' }));
      } else {
        new Notification('Training in Kürze', { body, icon: 'icon.svg' });
      }
      notified[s.id] = true;
    }
  });
  localStorage.setItem('tp_notified', JSON.stringify(notified));
}

// ── Navigation ───────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + btn.dataset.tab);
    document.getElementById('app-title').textContent = {
      calendar: 'Kalender', stats: 'Statistik', tactics: 'Taktikblatt', settings: 'Einstellungen'
    }[btn.dataset.tab];
    if (btn.dataset.tab === 'stats') renderStats();
    if (btn.dataset.tab === 'tactics') renderTactics();
    if (btn.dataset.tab === 'settings') { renderCategories(); updateThemeToggleUI(); }
  });
});

// ── App-Eintritt & Init ──────────────────────────────────────────────────
async function enterApp() {
  showView('view-app');
  loadStateFromLocal();
  populateCategorySelects();
  renderCalendar();
  renderCategories();
  updateNotificationButtonLabel();
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') startNotificationChecker();

  await pullAll();
  ensureSeriesMaterialized();
  populateCategorySelects();
  renderCalendar();
  renderCategories();

  processPendingQueue();
  setInterval(processPendingQueue, 60000);
  window.addEventListener('online', processPendingQueue);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function init() {
  updateThemeToggleUI();
  loadStateFromLocal();
  populateCategorySelects();
  const pinSet = !!localStorage.getItem('tp_pin_hash');
  if (pinSet) {
    showView('view-lock');
    initLockView();
  } else {
    showView('view-setup');
  }
}
init();
