/**
 * storage.js - localStorage persistence and CSV export.
 *
 * All food log data lives in a single JSON array under STORAGE_KEY.
 * No other file should read/write localStorage directly.
 *
 * Globals consumed: selectedDate (main.js), renderLogs (render.js)
 */

const STORAGE_KEY = 'guesstaimate_logs';

/**
 * Returns all log entries from localStorage, newest first.
 * Silently returns an empty array if storage is corrupt.
 * @returns {Array<Object>} Array of log entry objects.
 */
function getLogs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

/**
 * Persists the full log array to localStorage, overwriting any previous data.
 * @param {Array<Object>} logs - Complete log array to save.
 */
function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

/**
 * Creates a new log entry, resolves its timestamp from the GPT time hint or
 * the current time, prepends it, saves, and triggers a re-render.
 * @param {string} food       - Human-readable food description.
 * @param {number} calories   - Estimated calories (kcal).
 * @param {number} protein    - Protein in grams.
 * @param {number} carbs      - Carbohydrates in grams.
 * @param {number} fat        - Fat in grams.
 * @param {number} fibre      - Fibre in grams.
 * @param {string} transcript - Original speech transcript from Whisper.
 * @param {string} timeHint   - GPT-suggested time string (HH:MM format), may be null/invalid.
 */
function addLog(food, calories, protein, carbs, fat, fibre, transcript, timeHint) {
  const logs = getLogs();
  const base  = new Date(selectedDate);
  let timestamp;

  // Validate the GPT time hint - only apply if it's a well-formed HH:MM value.
  const parts = typeof timeHint === 'string' ? timeHint.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (parts) {
    const hours = Number(parts[1]), minutes = Number(parts[2]);
    if (hours <= 23 && minutes <= 59) base.setHours(hours, minutes, 0, 0);
    timestamp = base.toISOString();
  } else {
    const now = new Date();
    if (selectedDate.toDateString() === now.toDateString()) {
      timestamp = now.toISOString();
    } else {
      base.setHours(12, 0, 0, 0);
      timestamp = base.toISOString();
    }
  }

  logs.unshift({
    id: Date.now(), timestamp, food, calories,
    protein: protein || 0, carbs: carbs || 0,
    fat: fat || 0, fibre: fibre || 0,
    transcript: transcript || '',
  });
  saveLogs(logs);
  renderLogs();
}

/**
 * Removes a single log entry by its ID, saves, and triggers a re-render.
 * @param {number} id - The entry ID to delete.
 */
function deleteLog(id) {
  saveLogs(getLogs().filter(l => l.id !== id));
  renderLogs();
}

/**
 * Returns a deduplicated list of all food descriptions ever logged,
 * preserving most-recent-first order, for use in autocomplete suggestions.
 * @returns {string[]} Unique food strings.
 */
function getUniqueFoods() {
  const seen = new Set();
  const result = [];
  for (const l of getLogs()) {
    if (l.food && !seen.has(l.food)) {
      seen.add(l.food);
      result.push(l.food);
    }
  }
  return result;
}

/**
 * Serialises all log entries to CSV and triggers a browser download.
 * Columns: Date, Time, Food, Calories, Transcript.
 * Alerts the user if there are no entries to export.
 */
function downloadCSV() {
  const logs = getLogs();
  if (logs.length === 0) { alert('No entries to export yet!'); return; }

  const q    = s => `"${String(s || '').replace(/"/g, '""')}"`;
  const rows = logs.map(l => {
    const d = new Date(l.timestamp);
    return [d.toLocaleDateString(), d.toLocaleTimeString(), q(l.food), l.calories, q(l.transcript)].join(',');
  });

  const csv  = ['Date,Time,Food,Calories,Transcript', ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `guesstaimate_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
