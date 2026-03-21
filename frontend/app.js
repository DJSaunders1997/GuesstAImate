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

  renderChart(dayLogs);
}

// ── CHART ───────────────────────────────────────────────────────────────────
function renderChart(dayLogs) {
  const canvas = document.getElementById('cal-chart');
  if (!canvas) return;

  if (dayLogs.length < 2) { canvas.style.display = 'none'; return; }
  canvas.style.display = 'block';

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || canvas.parentElement.clientWidth;
  const H   = 140;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD  = { top: 12, right: 16, bottom: 28, left: 48 };
  const cW   = W - PAD.left - PAD.right;
  const cH   = H - PAD.top  - PAD.bottom;

  // Build cumulative series
  let cum = 0;
  const points = dayLogs.map(l => {
    cum += l.calories || 0;
    return { t: new Date(l.timestamp), cal: cum, label: l.food };
  });

  const minT  = points[0].t.getTime();
  const maxT  = points[points.length - 1].t.getTime();
  const maxCal = points[points.length - 1].cal;
  const tRange = maxT - minT || 1;

  const xOf = t  => PAD.left + ((t - minT) / tRange) * cW;
  const yOf = c  => PAD.top  + cH - (c / (maxCal * 1.15)) * cH;

  // Colours from CSS vars (approximated for canvas)
  const GREEN  = '#22c55e';
  const MUTED  = '#94a3b8';
  const BORDER = '#334155';

  // Grid lines
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  const steps = 3;
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((maxCal * 1.15 / steps) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle   = MUTED;
    ctx.font        = '10px system-ui,sans-serif';
    ctx.textAlign   = 'right';
    ctx.fillText(v.toLocaleString(), PAD.left - 6, y + 3);
  }

  // X-axis time labels
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  points.forEach(p => {
    const x   = xOf(p.t.getTime());
    const lbl = p.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillText(lbl, x, H - PAD.bottom + 14);
  });

  // Fill under line
  ctx.beginPath();
  ctx.moveTo(xOf(minT), yOf(0));
  points.forEach(p => ctx.lineTo(xOf(p.t.getTime()), yOf(p.cal)));
  ctx.lineTo(xOf(maxT), yOf(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.12)';
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = GREEN;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  points.forEach((p, i) => {
    const x = xOf(p.t.getTime()), y = yOf(p.cal);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots + tooltip-style labels
  points.forEach(p => {
    const x = xOf(p.t.getTime()), y = yOf(p.cal);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle   = GREEN;
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.fillStyle  = GREEN;
    ctx.font       = 'bold 10px system-ui,sans-serif';
    ctx.textAlign  = 'center';
    ctx.fillText(p.cal.toLocaleString(), x, y - 8);
  });
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
