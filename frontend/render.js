/**
 * render.js — DOM rendering, day navigation, entry forms, and UI utilities.
 *
 * Owns the log list display, day navigation controls, inline edit/add forms,
 * and small utility functions used across the app.
 *
 * Globals consumed: selectedDate (main.js), logList, totalCal (main.js),
 *                   getLogs, saveLogs, addLog, deleteLog (storage.js),
 *                   renderCharts (charts.js).
 */

// ── UTILITIES ─────────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe insertion into HTML to prevent XSS.
 * @param {string} str - Raw user-supplied string.
 * @returns {string} HTML-escaped string.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sets the text and CSS class of the status element.
 * @param {string} msg  - Message to display.
 * @param {string} type - CSS class to apply (e.g. 'success', 'error', or '').
 */
function setStatus(msg, type) {
  status.textContent = msg;
  status.className   = type;
}

/**
 * Shows a modal confirmation dialog with the given HTML message.
 * Returns a Promise that resolves to true (confirmed) or false (cancelled).
 * @param {string} htmlMessage - Inner HTML to display as the prompt.
 * @returns {Promise<boolean>}
 */
function showConfirm(htmlMessage) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    const msgEl   = document.getElementById('confirm-message');
    msgEl.innerHTML = htmlMessage;
    overlay.classList.add('active');

    const yesBtn = document.getElementById('confirm-yes');
    const noBtn  = document.getElementById('confirm-no');

    function finish(result) {
      overlay.classList.remove('active');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      resolve(result);
    }
    const onYes = () => finish(true);
    const onNo  = () => finish(false);
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

// ── DAY NAVIGATION ────────────────────────────────────────────────────────────

/**
 * Returns a human-friendly label for a date ("Today" or "Mon 22 Mar").
 * @param {Date} date - The date to label.
 * @returns {string} Display label.
 */
function formatDayLabel(date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Synchronises the day navigation labels and disables the "next" button
 * when the currently viewed day is today.
 */
function updateDayNav() {
  const isToday  = selectedDate.toDateString() === new Date().toDateString();
  const label    = formatDayLabel(selectedDate);
  const dayLabel   = document.getElementById('day-label');
  const dailyLabel = document.getElementById('daily-label');
  const nextBtn    = document.getElementById('next-day');
  if (dayLabel)   dayLabel.textContent   = label;
  if (dailyLabel) dailyLabel.textContent = label;
  if (nextBtn)    nextBtn.disabled       = isToday;
}

// Whether the entry list is currently collapsed.
let logsCollapsed = false;

/**
 * Toggles the entry list collapsed/expanded state.
 */
function toggleLogs() {
  logsCollapsed = !logsCollapsed;
  applyCollapseState();
}

/**
 * Syncs the DOM to the current logsCollapsed state.
 */
function applyCollapseState() {
  const list = document.getElementById('log-list');
  const btn  = document.getElementById('entries-toggle');
  if (!list || !btn) return;
  const count = list.querySelectorAll('.log-entry').length;
  btn.style.display = count > 0 ? '' : 'none';
  list.style.display = logsCollapsed ? 'none' : '';
  const label = `${count} entr${count === 1 ? 'y' : 'ies'}`;
  btn.textContent = logsCollapsed ? `▶ ${label}` : `▼ ${label}`;
}

/**
 * Navigates to the previous day and re-renders the log list.
 */
function prevDay() {
  const d = new Date(selectedDate);
  d.setDate(d.getDate() - 1);
  selectedDate = d;
  logsCollapsed = true;
  renderLogs();
}

/**
 * Navigates to the next day (no-op if already on today) and re-renders.
 */
function nextDay() {
  if (selectedDate.toDateString() === new Date().toDateString()) return;
  const d = new Date(selectedDate);
  d.setDate(d.getDate() + 1);
  selectedDate = d;
  logsCollapsed = selectedDate.toDateString() !== new Date().toDateString();
  renderLogs();
}

// ── ENTRY FORMS ───────────────────────────────────────────────────────────────

/**
 * Builds the inner HTML for a food entry edit/create form.
 * @param {{food: string, calories: number|string, protein: number, carbs: number,
 *           fat: number, fibre: number, timeVal: string}} vals - Pre-fill values.
 * @param {string} saveCall - JS expression to call when Save is clicked (e.g. 'saveLog(123)').
 * @returns {string} HTML string for the form fields and action buttons.
 */
function entryFormHTML(vals, saveCall) {
  const suggestions = getUniqueFoods()
    .filter(f => f !== vals.food)
    .map(f => `<option value="${escapeHtml(f)}">`)
    .join('');
  return `
    <div class="log-left">
      <div class="edit-fields">
        <datalist id="food-suggestions">${suggestions}</datalist>
        <input class="edit-food" list="food-suggestions" placeholder="Food description" value="${escapeHtml(vals.food)}" />
        <input class="edit-calories" type="number" min="0" placeholder="0" value="${vals.calories}" />
        <span class="edit-unit">kcal</span>
      </div>
      <div class="edit-macros">
        <label>P  <input class="edit-protein" type="number" min="0" step="0.1" value="${vals.protein}" />g</label>
        <label>C  <input class="edit-carbs"   type="number" min="0" step="0.1" value="${vals.carbs}" />g</label>
        <label>F  <input class="edit-fat"     type="number" min="0" step="0.1" value="${vals.fat}" />g</label>
        <label>Fi <input class="edit-fibre"   type="number" min="0" step="0.1" value="${vals.fibre}" />g</label>
        <label class="edit-time-label">🕐 <input class="edit-time" type="time" value="${vals.timeVal}" /></label>
      </div>
    </div>
    <div class="log-right">
      <button class="save-btn" onclick="${saveCall}">Save</button>
      <button class="cancel-btn" onclick="renderLogs()">✕</button>
    </div>`;
}

/**
 * Wires up auto-fill on the food input inside a form container so that
 * selecting a previous entry from the datalist populates macros and kcal.
 * @param {HTMLElement} container - The `.log-entry` element containing the form.
 */
function attachFoodAutofill(container) {
  const foodInput = container.querySelector('.edit-food');
  if (!foodInput) return;
  foodInput.addEventListener('change', () => {
    const chosen = foodInput.value.trim();
    if (!chosen) return;
    // Find the most recent log that matches this food name exactly.
    const match = getLogs().find(l => l.food === chosen);
    if (!match) return;
    const cal = container.querySelector('.edit-calories');
    const pro = container.querySelector('.edit-protein');
    const crb = container.querySelector('.edit-carbs');
    const fat = container.querySelector('.edit-fat');
    const fib = container.querySelector('.edit-fibre');
    if (cal) cal.value = match.calories ?? '';
    if (pro) pro.value = match.protein  ?? 0;
    if (crb) crb.value = match.carbs    ?? 0;
    if (fat) fat.value = match.fat      ?? 0;
    if (fib) fib.value = match.fibre    ?? 0;
  });
}

/**
 * Reads the current values from an entry form element.
 * @param {HTMLElement} entry - The `.log-entry` element containing the form inputs.
 * @returns {{food: string, calories: number, protein: number, carbs: number,
 *            fat: number, fibre: number, timeStr: string}}
 */
function readEntryForm(entry) {
  return {
    food:     entry.querySelector('.edit-food').value.trim(),
    calories: parseInt(entry.querySelector('.edit-calories').value, 10),
    protein:  parseFloat(entry.querySelector('.edit-protein').value) || 0,
    carbs:    parseFloat(entry.querySelector('.edit-carbs').value)   || 0,
    fat:      parseFloat(entry.querySelector('.edit-fat').value)     || 0,
    fibre:    parseFloat(entry.querySelector('.edit-fibre').value)   || 0,
    timeStr:  entry.querySelector('.edit-time').value,
  };
}

/**
 * Replaces a log entry's display row with an inline edit form.
 * @param {number} id - ID of the entry to edit.
 */
function editLog(id) {
  const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
  if (!entry) return;
  const log = getLogs().find(l => l.id === id);
  if (!log) return;
  const timeVal = new Date(log.timestamp).toTimeString().slice(0, 5);
  entry.innerHTML = entryFormHTML(
    { food: log.food, calories: log.calories,
      protein: log.protein || 0, carbs: log.carbs || 0,
      fat: log.fat || 0, fibre: log.fibre || 0, timeVal },
    `saveLog(${id})`
  );
  attachFoodAutofill(entry);
  entry.querySelector('.edit-food').focus();
}

/**
 * Reads the edit form for an existing entry, validates the values, updates
 * the timestamp if the time field changed, saves, and re-renders.
 * @param {number} id - ID of the entry being saved.
 */
function saveLog(id) {
  const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
  if (!entry) return;
  const { food, calories, protein, carbs, fat, fibre, timeStr } = readEntryForm(entry);
  if (!food || isNaN(calories) || calories < 0) return;
  const logs = getLogs().map(l => {
    if (l.id !== id) return l;
    let timestamp = l.timestamp;
    if (timeStr) {
      const d = new Date(l.timestamp);
      const [h, m] = timeStr.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      timestamp = d.toISOString();
    }
    return { ...l, food, calories, protein, carbs, fat, fibre, timestamp };
  });
  saveLogs(logs);
  renderLogs();
}

/**
 * Inserts a blank add-entry form at the top of the log list.
 * If one is already open, focuses it instead of creating another.
 */
function showAddForm() {
  const existing = document.getElementById('new-entry-form');
  if (existing) { existing.querySelector('.edit-food').focus(); return; }
  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const ref     = isToday
    ? new Date()
    : (() => { const d = new Date(selectedDate); d.setHours(12, 0, 0, 0); return d; })();
  const timeVal = ref.toTimeString().slice(0, 5);
  document.getElementById('empty-state')?.remove();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.id        = 'new-entry-form';
  div.innerHTML = entryFormHTML(
    { food: '', calories: '', protein: 0, carbs: 0, fat: 0, fibre: 0, timeVal },
    'saveNewLog()'
  );
  logList.insertBefore(div, logList.firstChild);
  attachFoodAutofill(div);
  div.querySelector('.edit-food').focus();
}

/**
 * Reads the new-entry form, validates it, and calls addLog() to persist.
 * Re-focuses the food input if validation fails.
 */
function saveNewLog() {
  const entry = document.getElementById('new-entry-form');
  if (!entry) return;
  const { food, calories, protein, carbs, fat, fibre, timeStr } = readEntryForm(entry);
  if (!food || isNaN(calories) || calories < 0) { entry.querySelector('.edit-food').focus(); return; }
  addLog(food, calories, protein, carbs, fat, fibre, '', timeStr || null);
}

// ── LOG LIST ──────────────────────────────────────────────────────────────────

// ── STREAK ───────────────────────────────────────────────────────────────────

function updateStreakDisplay() {
  const el = document.getElementById('streak-display');
  if (!el) return;
  const { current } = getStreak();
  if (current === 0) { el.innerHTML = ''; return; }
  const label = current === 1 ? 'day' : 'days';
  el.innerHTML = `<span class="streak-badge">🔥 ${current} ${label} streak</span>`;
}

/**
 * Re-renders the entire log list and macro summary for the selected day,
 * then delegates chart drawing to renderCharts().
 */
function renderLogs() {
  const selStr  = selectedDate.toDateString();
  const dayLogs = getLogs()
    .filter(l => new Date(l.timestamp).toDateString() === selStr)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const total    = dayLogs.reduce((sum, l) => sum + (l.calories || 0), 0);
  const totProt  = dayLogs.reduce((sum, l) => sum + (l.protein  || 0), 0);
  const totCarbs = dayLogs.reduce((sum, l) => sum + (l.carbs    || 0), 0);
  const totFat   = dayLogs.reduce((sum, l) => sum + (l.fat      || 0), 0);
  const totFibre = dayLogs.reduce((sum, l) => sum + (l.fibre    || 0), 0);

  totalCal.textContent = total.toLocaleString();
  const fmt = v => Math.round(v);
  document.getElementById('total-protein').textContent = fmt(totProt);
  document.getElementById('total-carbs').textContent   = fmt(totCarbs);
  document.getElementById('total-fat').textContent     = fmt(totFat);
  document.getElementById('total-fibre').textContent   = fmt(totFibre);
  updateDayNav();
  updateStreakDisplay();

  if (dayLogs.length === 0) {
    const isToday = selectedDate.toDateString() === new Date().toDateString();
    logList.innerHTML = `<div id="empty-state">${isToday
      ? 'No entries yet today - tap the button above and tell me what you ate!'
      : 'No entries for this day.'}</div>`;
    renderCharts(dayLogs);
    applyCollapseState();
    return;
  }

  logList.innerHTML = dayLogs.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const p  = Math.round(entry.protein || 0);
    const c  = Math.round(entry.carbs   || 0);
    const f  = Math.round(entry.fat     || 0);
    const fi = Math.round(entry.fibre   || 0);
    const cached = getCachedImage(entry.food);
    const thumbSrc   = cached ? `src="${cached}"` : '';
    const thumbClass = cached ? 'log-thumb' : 'log-thumb log-thumb--loading';
    return `
      <div class="log-entry" data-id="${entry.id}">
        <img class="${thumbClass}" ${thumbSrc} data-food="${escapeHtml(entry.food)}" alt="" aria-hidden="true">
        <div class="log-left">
          <div class="log-food">${escapeHtml(entry.food)}</div>
          <div class="log-time">${time}</div>
          <div class="log-macros">
            <span><span class="macro-p">P</span> ${p}g</span>
            <span><span class="macro-c">C</span> ${c}g</span>
            <span><span class="macro-f">F</span> ${f}g</span>
            <span><span class="macro-fi">Fi</span> ${fi}g</span>
          </div>
        </div>
        <div class="log-right">
          <div class="log-calories">${entry.calories} <span>kcal</span></div>
          <button class="edit-btn"   onclick="editLog(${entry.id})"   title="Edit entry">✏️</button>
          <button class="delete-btn" onclick="deleteLog(${entry.id})" title="Remove entry">✕</button>
        </div>
      </div>`;
  }).join('');

  // Kick off image fetches for any entries not yet cached (fire-and-forget).
  if (typeof fetchAndCacheFoodImage === 'function') {
    const seen = new Set();
    for (const entry of dayLogs) {
      const key = entry.food.toLowerCase().trim();
      if (!seen.has(key) && !getCachedImage(entry.food)) {
        seen.add(key);
        fetchAndCacheFoodImage(entry.food);
      }
    }
  }

  renderCharts(dayLogs);
  applyCollapseState();
}
