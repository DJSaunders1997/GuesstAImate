/**
 * storage.js - localStorage persistence and CSV export.
 *
 * All food log data lives in a single JSON array under STORAGE_KEY.
 * No other file should read/write localStorage directly.
 *
 * Globals consumed: selectedDate (main.js), renderLogs (render.js)
 */

const STORAGE_KEY = 'guesstaimate_logs';

// ── FIRESTORE SYNC ───────────────────────────────────────────────────────────
// All cloud functions are no-ops when the user isn't signed in.
// saveLogs() is patched below to fire-and-forget to Firestore on every write.

function _firestoreDoc(uid) {
  return firebase.firestore().collection('users').doc(uid);
}

/**
 * Uploads the current logs array to Firestore for the signed-in user.
 * Fire-and-forget — callers do not await this.
 */
function _pushToFirestore(logs) {
  const user = getCurrentUser ? getCurrentUser() : null;
  if (!user) return;
  _firestoreDoc(user.uid).set({ logs, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(err => console.error('Firestore write failed:', err));
}

/**
 * Fetches logs from Firestore, merges with any existing localStorage entries
 * (de-duplicated by ID), saves locally, and re-renders.
 * Called on sign-in.
 * @param {string} uid - The signed-in user's UID.
 */
async function syncFromFirestore(uid) {
  const doc = await _firestoreDoc(uid).get();
  const cloudLogs = doc.exists ? (doc.data().logs || []) : [];
  const localLogs = getLogs();

  // Merge: use ID as key, cloud wins on conflict (most recent write wins).
  const byId = {};
  for (const l of localLogs) byId[l.id] = l;
  for (const l of cloudLogs) byId[l.id] = l;   // cloud overwrites local
  const merged = Object.values(byId).sort((a, b) => b.id - a.id);

  saveLogs(merged);  // writes localStorage + pushes back to Firestore
  renderLogs();
}

/**
 * Clears in-memory cloud state when the user signs out.
 * Local data is wiped so another user can sign in cleanly.
*/
function clearCloudState() {
  localStorage.removeItem(STORAGE_KEY);
}

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
  _pushToFirestore(logs);
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
 * Applies a partial update to an existing log entry (e.g. from a voice edit).
 * Only the keys present in `updates` are changed; all other fields are preserved.
 * @param {number} id      - ID of the entry to update.
 * @param {Object} updates - Partial object with fields to overwrite (calories, protein, etc.).
 */
function updateLog(id, updates) {
  const logs = getLogs().map(l => l.id === id ? { ...l, ...updates } : l);
  saveLogs(logs);
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

/**
 * Computes the current daily logging streak and the all-time best streak.
 * A "streak" is a run of consecutive calendar days each containing at least one log.
 * Today is included if it has any logs.
 * @returns {{current: number, best: number}}
 */
function getStreak() {
  const logs = getLogs();
  if (logs.length === 0) return { current: 0, best: 0 };

  const loggedDays = new Set(logs.map(l => new Date(l.timestamp).toDateString()));

  // Current streak — walk backwards from today until a day has no logs.
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (loggedDays.has(cursor.toDateString())) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Best streak — sort all logged date values and count the longest run.
  const sorted = [...loggedDays]
    .map(s => { const d = new Date(s); d.setHours(0, 0, 0, 0); return d.getTime(); })
    .sort((a, b) => a - b);

  let best = sorted.length ? 1 : 0;
  let run  = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gapDays = Math.round((sorted[i] - sorted[i - 1]) / 86400000);
    run = gapDays === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  return { current, best };
}
