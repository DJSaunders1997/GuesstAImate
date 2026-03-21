// ── CONFIG ──────────────────────────────────────────────────────────────────
let BACKEND_URL;
if (window.location.hostname === 'localhost' || window.location.hostname === '0.0.0.0') {
  BACKEND_URL = 'http://localhost:8000';
} else {
  BACKEND_URL = 'https://guesstaimate.jollyocean-6818c6e0.ukwest.azurecontainerapps.io';
}

const STORAGE_KEY = 'guesstaimate_logs';
let selectedDate = new Date();

// ── ELEMENTS ────────────────────────────────────────────────────────────────
const btn      = document.getElementById('record-btn');
const status   = document.getElementById('status');
const logList  = document.getElementById('log-list');
const totalCal = document.getElementById('total-cal');

document.getElementById('export-btn').addEventListener('click', downloadCSV);

// ── DAY NAVIGATION ───────────────────────────────────────────────────────────
function formatDayLabel(date) {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

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

function prevDay() {
  const d = new Date(selectedDate);
  d.setDate(d.getDate() - 1);
  selectedDate = d;
  renderLogs();
}

function nextDay() {
  if (selectedDate.toDateString() === new Date().toDateString()) return;
  const d = new Date(selectedDate);
  d.setDate(d.getDate() + 1);
  selectedDate = d;
  renderLogs();
}

// ── RECORDING STATE ──────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;

btn.addEventListener('click', () => {
  if (!isRecording) startRecording();
  else              stopRecording();
});

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];

    // Pick the best supported MIME type (webm on Chrome, ogg on Firefox)
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
      .find(m => m === '' || MediaRecorder.isTypeSupported(m));

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      processAudio();
    };

    mediaRecorder.start(250); // collect chunks every 250 ms
    isRecording = true;
    btn.className   = 'recording';
    btn.textContent = '⏹️';
    setStatus('Recording… tap to stop', '');
  } catch {
    setStatus('Microphone access denied. Please allow microphone access and try again.', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording     = false;
  btn.className   = 'processing';
  btn.textContent = '⏳';
  btn.disabled    = true;
  setStatus('Processing…', '');
}

async function processAudio() {
  try {
    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    const blob     = new Blob(audioChunks, { type: mimeType });
    const ext      = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';

    const formData = new FormData();
    formData.append('audio', blob, `recording.${ext}`);

    const res = await fetch(`${BACKEND_URL}/track`, { method: 'POST', body: formData, credentials: 'omit' });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }

    const { items, transcript } = await res.json();
    items.forEach(({ food, calories, time_hint }) => addLog(food, calories, transcript, time_hint));
    if (items.length === 1) {
      setStatus(`Logged: ${items[0].food} - ${items[0].calories} kcal`, 'success');
    } else {
      const total = items.reduce((s, i) => s + i.calories, 0);
      setStatus(`Logged ${items.length} items — ${total} kcal total`, 'success');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.className   = '';
    btn.textContent = '🎙️';
    btn.disabled    = false;
  }
}

// ── STORAGE ─────────────────────────────────────────────────────────────────
function getLogs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function addLog(food, calories, transcript, timeHint) {
  const logs = getLogs();
  const base  = new Date(selectedDate);
  let timestamp;
  if (timeHint) {
    const [hours, minutes] = timeHint.split(':').map(Number);
    base.setHours(hours, minutes, 0, 0);
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
  logs.unshift({ id: Date.now(), timestamp, food, calories, transcript: transcript || '' });
  saveLogs(logs);
  renderLogs();
}

function deleteLog(id) {
  saveLogs(getLogs().filter(l => l.id !== id));
  renderLogs();
}

function editLog(id) {
  const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
  if (!entry) return;
  const log = getLogs().find(l => l.id === id);
  if (!log) return;

  entry.innerHTML = `
    <div class="edit-fields">
      <input class="edit-food" value="${escapeHtml(log.food)}" />
      <input class="edit-calories" type="number" min="0" value="${log.calories}" />
      <span class="edit-unit">kcal</span>
    </div>
    <div class="log-right">
      <button class="save-btn" onclick="saveLog(${id})">Save</button>
      <button class="cancel-btn" onclick="renderLogs()">✕</button>
    </div>`;

  entry.querySelector('.edit-food').focus();
}

function saveLog(id) {
  const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
  if (!entry) return;
  const food     = entry.querySelector('.edit-food').value.trim();
  const calories = parseInt(entry.querySelector('.edit-calories').value, 10);
  if (!food || isNaN(calories) || calories < 0) return;

  const logs = getLogs().map(l => l.id === id ? { ...l, food, calories } : l);
  saveLogs(logs);
  renderLogs();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderLogs() {
  const selStr  = selectedDate.toDateString();
  const dayLogs = getLogs()
    .filter(l => new Date(l.timestamp).toDateString() === selStr)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const total   = dayLogs.reduce((sum, l) => sum + (l.calories || 0), 0);

  totalCal.textContent = total.toLocaleString();
  updateDayNav();

  if (dayLogs.length === 0) {
    const isToday = selectedDate.toDateString() === new Date().toDateString();
    logList.innerHTML = `<div id="empty-state">${isToday ? 'No entries yet today - tap the button above and tell me what you ate!' : 'No entries for this day.'}</div>`;
    return;
  }

  logList.innerHTML = dayLogs.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `
      <div class="log-entry" data-id="${entry.id}">
        <div>
          <div class="log-food">${escapeHtml(entry.food)}</div>
          <div class="log-time">${time}</div>
        </div>
        <div class="log-right">
          <div class="log-calories">${entry.calories} <span>kcal</span></div>
          <button class="edit-btn" onclick="editLog(${entry.id})" title="Edit entry">✏️</button>
          <button class="delete-btn" onclick="deleteLog(${entry.id})" title="Remove entry">✕</button>
        </div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function setStatus(msg, type) {
  status.textContent = msg;
  status.className   = type;
}

// ── CSV EXPORT ──────────────────────────────────────────────────────────────
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

// ── INIT ────────────────────────────────────────────────────────────────────
renderLogs();
