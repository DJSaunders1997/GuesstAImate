// ── CONFIG ──────────────────────────────────────────────────────────────────
let BACKEND_URL;
if (window.location.hostname === 'localhost' || window.location.hostname === '0.0.0.0') {
  BACKEND_URL = 'http://localhost:8000';
} else {
  BACKEND_URL = 'https://guesstaimate.jollyocean-6818c6e0.ukwest.azurecontainerapps.io';
}

const STORAGE_KEY = 'guesstaimate_logs';

// ── ELEMENTS ────────────────────────────────────────────────────────────────
const btn      = document.getElementById('record-btn');
const status   = document.getElementById('status');
const logList  = document.getElementById('log-list');
const totalCal = document.getElementById('total-cal');

document.getElementById('export-btn').addEventListener('click', downloadCSV);

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

    const { food, calories, transcript } = await res.json();
    addLog(food, calories, transcript);
    setStatus(`Logged: ${food} — ${calories} kcal`, 'success');
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

function addLog(food, calories, transcript) {
  const logs = getLogs();
  logs.unshift({ id: Date.now(), timestamp: new Date().toISOString(), food, calories, transcript: transcript || '' });
  saveLogs(logs);
  renderLogs();
}

function deleteLog(id) {
  saveLogs(getLogs().filter(l => l.id !== id));
  renderLogs();
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderLogs() {
  const today     = new Date().toDateString();
  const todayLogs = getLogs().filter(l => new Date(l.timestamp).toDateString() === today);
  const total     = todayLogs.reduce((sum, l) => sum + (l.calories || 0), 0);

  totalCal.textContent = total.toLocaleString();

  if (todayLogs.length === 0) {
    logList.innerHTML = '<div id="empty-state">No entries yet today — tap the button above and tell me what you ate!</div>';
    return;
  }

  logList.innerHTML = todayLogs.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="log-entry">
        <div>
          <div class="log-food">${escapeHtml(entry.food)}</div>
          <div class="log-time">${time}</div>
        </div>
        <div class="log-right">
          <div class="log-calories">${entry.calories} <span>kcal</span></div>
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
