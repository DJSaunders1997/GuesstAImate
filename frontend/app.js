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
    items.forEach(({ food, calories, protein, carbs, fat, fibre, time_hint }) =>
      addLog(food, calories, protein, carbs, fat, fibre, transcript, time_hint)
    );
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

function addLog(food, calories, protein, carbs, fat, fibre, transcript, timeHint) {
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
  logs.unshift({ id: Date.now(), timestamp, food, calories,
    protein: protein || 0, carbs: carbs || 0, fat: fat || 0, fibre: fibre || 0,
    transcript: transcript || '' });
  saveLogs(logs);
  renderLogs();
}

function deleteLog(id) {
  saveLogs(getLogs().filter(l => l.id !== id));
  renderLogs();
}

// ── SHARED ENTRY FORM ────────────────────────────────────────────────────────
function entryFormHTML(vals, saveCall) {
  return `
    <div class="edit-fields">
      <input class="edit-food" placeholder="Food description" value="${escapeHtml(vals.food)}" />
      <input class="edit-calories" type="number" min="0" placeholder="0" value="${vals.calories}" />
      <span class="edit-unit">kcal</span>
    </div>
    <div class="edit-macros">
      <label>P <input class="edit-protein" type="number" min="0" step="0.1" value="${vals.protein}" />g</label>
      <label>C <input class="edit-carbs"   type="number" min="0" step="0.1" value="${vals.carbs}" />g</label>
      <label>F <input class="edit-fat"     type="number" min="0" step="0.1" value="${vals.fat}" />g</label>
      <label>Fi <input class="edit-fibre"  type="number" min="0" step="0.1" value="${vals.fibre}" />g</label>
      <label class="edit-time-label">🕐 <input class="edit-time" type="time" value="${vals.timeVal}" /></label>
    </div>
    <div class="log-right">
      <button class="save-btn" onclick="${saveCall}">Save</button>
      <button class="cancel-btn" onclick="renderLogs()">✕</button>
    </div>`;
}

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

function editLog(id) {
  const entry = document.querySelector(`.log-entry[data-id="${id}"]`);
  if (!entry) return;
  const log = getLogs().find(l => l.id === id);
  if (!log) return;
  const timeVal = new Date(log.timestamp).toTimeString().slice(0, 5);
  entry.innerHTML = entryFormHTML(
    { food: log.food, calories: log.calories, protein: log.protein || 0,
      carbs: log.carbs || 0, fat: log.fat || 0, fibre: log.fibre || 0, timeVal },
    `saveLog(${id})`
  );
  entry.querySelector('.edit-food').focus();
}

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

function showAddForm() {
  const existing = document.getElementById('new-entry-form');
  if (existing) { existing.querySelector('.edit-food').focus(); return; }
  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const ref = isToday ? new Date() : (() => { const d = new Date(selectedDate); d.setHours(12, 0, 0, 0); return d; })();
  const timeVal = ref.toTimeString().slice(0, 5);
  document.getElementById('empty-state')?.remove();
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.id = 'new-entry-form';
  div.innerHTML = entryFormHTML(
    { food: '', calories: '', protein: 0, carbs: 0, fat: 0, fibre: 0, timeVal },
    'saveNewLog()'
  );
  logList.insertBefore(div, logList.firstChild);
  div.querySelector('.edit-food').focus();
}

function saveNewLog() {
  const entry = document.getElementById('new-entry-form');
  if (!entry) return;
  const { food, calories, protein, carbs, fat, fibre, timeStr } = readEntryForm(entry);
  if (!food || isNaN(calories) || calories < 0) { entry.querySelector('.edit-food').focus(); return; }
  addLog(food, calories, protein, carbs, fat, fibre, '', timeStr || null);
}

// ── RENDER ──────────────────────────────────────────────────────────────────
function renderLogs() {
  const selStr  = selectedDate.toDateString();
  const dayLogs = getLogs()
    .filter(l => new Date(l.timestamp).toDateString() === selStr)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const total    = dayLogs.reduce((sum, l) => sum + (l.calories || 0), 0);
  const totProt   = dayLogs.reduce((sum, l) => sum + (l.protein  || 0), 0);
  const totCarbs  = dayLogs.reduce((sum, l) => sum + (l.carbs    || 0), 0);
  const totFat    = dayLogs.reduce((sum, l) => sum + (l.fat      || 0), 0);
  const totFibre  = dayLogs.reduce((sum, l) => sum + (l.fibre    || 0), 0);

  totalCal.textContent = total.toLocaleString();
  const fmt = v => Math.round(v);
  document.getElementById('total-protein').textContent = fmt(totProt);
  document.getElementById('total-carbs').textContent   = fmt(totCarbs);
  document.getElementById('total-fat').textContent     = fmt(totFat);
  document.getElementById('total-fibre').textContent   = fmt(totFibre);
  updateDayNav();

  if (dayLogs.length === 0) {
    const isToday = selectedDate.toDateString() === new Date().toDateString();
    logList.innerHTML = `<div id="empty-state">${isToday ? 'No entries yet today - tap the button above and tell me what you ate!' : 'No entries for this day.'}</div>`;
    return;
  }

  logList.innerHTML = dayLogs.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const p = Math.round(entry.protein || 0);
    const c = Math.round(entry.carbs   || 0);
    const f = Math.round(entry.fat     || 0);
    const fi= Math.round(entry.fibre   || 0);
    return `
      <div class="log-entry" data-id="${entry.id}">
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
          <button class="edit-btn" onclick="editLog(${entry.id})" title="Edit entry">✏️</button>
          <button class="delete-btn" onclick="deleteLog(${entry.id})" title="Remove entry">✕</button>
        </div>
      </div>`;
  }).join('');

  renderCharts(dayLogs);
}

// ── CHART ───────────────────────────────────────────────────────────────────
const MACRO_COLOURS = {
  calories: { line: '#22c55e', fill: 'rgba(34,197,94,0.12)' },
  protein:  { line: '#60a5fa', fill: 'rgba(96,165,250,0.12)' },
  carbs:    { line: '#fbbf24', fill: 'rgba(251,191,36,0.12)'  },
  fat:      { line: '#f87171', fill: 'rgba(248,113,113,0.12)' },
  fibre:    { line: '#a78bfa', fill: 'rgba(167,139,250,0.12)' },
};

// General adult daily targets — persisted in localStorage so the user can edit them
const TARGET_DEFAULTS = { calories: 2000, protein: 50, carbs: 260, fat: 70, fibre: 30 };
let DAILY_TARGETS = Object.assign({}, TARGET_DEFAULTS,
  JSON.parse(localStorage.getItem('guesstaimate_targets') || 'null'));

function openTargets() {
  document.getElementById('t-calories').value = DAILY_TARGETS.calories;
  document.getElementById('t-protein').value  = DAILY_TARGETS.protein;
  document.getElementById('t-carbs').value    = DAILY_TARGETS.carbs;
  document.getElementById('t-fat').value      = DAILY_TARGETS.fat;
  document.getElementById('t-fibre').value    = DAILY_TARGETS.fibre;
  document.getElementById('targets-overlay').classList.add('open');
  document.getElementById('targets-dialog').classList.add('open');
}

function closeTargets() {
  document.getElementById('targets-overlay').classList.remove('open');
  document.getElementById('targets-dialog').classList.remove('open');
}

function saveTargets() {
  const parse = (id, fallback) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? fallback : v; };
  DAILY_TARGETS = {
    calories: parse('t-calories', TARGET_DEFAULTS.calories),
    protein:  parse('t-protein',  TARGET_DEFAULTS.protein),
    carbs:    parse('t-carbs',    TARGET_DEFAULTS.carbs),
    fat:      parse('t-fat',      TARGET_DEFAULTS.fat),
    fibre:    parse('t-fibre',    TARGET_DEFAULTS.fibre),
  };
  localStorage.setItem('guesstaimate_targets', JSON.stringify(DAILY_TARGETS));
  closeTargets();
  renderLogs(); // redraw charts with new targets
}

/**
 * Draw one or more cumulative lines on `canvas`.
 * series: [{ label, colour: {line, fill}, values: [number], target?: number }]
 * timestamps: [Date]  (same length as values arrays)
 */
function drawCumulativeChart(canvas, timestamps, series, unit) {
  if (!canvas) return;
  canvas.style.display = 'block';

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;
  const H   = 150;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const MUTED  = '#94a3b8';
  const BORDER = '#334155';
  const PAD    = { top: 12, right: 48, bottom: 28, left: 48 };
  const cW     = W - PAD.left - PAD.right;
  const cH     = H - PAD.top  - PAD.bottom;

  const hasData = timestamps.length > 0;
  const single  = timestamps.length === 1;

  // X range: use data if available, otherwise span midnight→midnight for the viewed day
  let minT, maxT, tRange;
  if (hasData) {
    const ms = timestamps.map(t => t.getTime());
    minT   = ms[0];
    maxT   = ms[ms.length - 1];
    tRange = maxT - minT || 1;
  } else {
    const dayStart = new Date(selectedDate); dayStart.setHours(0, 0, 0, 0);
    minT   = dayStart.getTime();
    maxT   = minT + 86400000;
    tRange = 86400000;
  }

  const times = timestamps.map(t => t.getTime());
  const xOf   = t => single ? PAD.left + cW / 2 : PAD.left + ((t - minT) / tRange) * cW;

  // Cumulative totals per series
  const cumSeries = series.map(s => {
    let acc = 0;
    return s.values.map(v => { acc += v || 0; return acc; });
  });

  // Scale y-axis to fit both data AND targets
  const dataMax    = hasData ? Math.max(...cumSeries.map(cum => cum[cum.length - 1])) : 0;
  const targetMax  = Math.max(0, ...series.map(s => s.target || 0));
  const overallMax = Math.max(dataMax, targetMax);

  const yOf = v => PAD.top + cH - (v / (overallMax * 1.15 || 1)) * cH;

  // Grid lines + y-axis labels
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 3; i++) {
    const v = Math.round((overallMax * 1.15 / 3) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font      = '10px system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v + (unit ? unit : ''), PAD.left - 6, y + 3);
  }

  // X-axis time labels (only when there's data to label)
  if (hasData) {
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    timestamps.forEach((t, i) => {
      const lbl = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      ctx.fillText(lbl, xOf(times[i]), H - PAD.bottom + 14);
    });
  }

  // Target reference lines (always drawn)
  series.forEach(s => {
    if (!s.target) return;
    const y = yOf(s.target);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = s.colour.line;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle   = s.colour.line;
    ctx.font        = series.length > 1 ? 'bold 8px system-ui,sans-serif' : 'bold 10px system-ui,sans-serif';
    ctx.textAlign   = 'left';
    ctx.globalAlpha = 0.85;
    const lbl = series.length > 1 ? s.label[0] : s.target.toLocaleString() + (unit || '');
    ctx.fillText(lbl, PAD.left + cW + 4, y + 4);
    ctx.globalAlpha = 1;
  });

  // Data series — only when there are entries
  if (!hasData) return;

  series.forEach((s, si) => {
    const cum    = cumSeries[si];
    const colour = s.colour;

    // Fill
    ctx.beginPath();
    ctx.moveTo(xOf(times[0]), yOf(0));
    cum.forEach((v, i) => ctx.lineTo(xOf(times[i]), yOf(v)));
    ctx.lineTo(xOf(times[times.length - 1]), yOf(0));
    ctx.closePath();
    ctx.fillStyle = colour.fill;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = colour.line;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    cum.forEach((v, i) => { const x = xOf(times[i]), y = yOf(v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();

    // Dots + value labels
    if (series.length === 1) {
      cum.forEach((v, i) => {
        const x = xOf(times[i]), y = yOf(v);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = colour.line; ctx.fill();
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = colour.line;
        ctx.font = 'bold 10px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(v.toLocaleString(), x, y - 8);
      });
    } else {
      cum.forEach((v, i) => {
        const x = xOf(times[i]), y = yOf(v);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = colour.line; ctx.fill();
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1; ctx.stroke();
      });
    }
  });

  // Legend for multi-series
  if (series.length > 1) {
    const legendX = PAD.left;
    let   legendY = PAD.top + 2;
    series.forEach(s => {
      ctx.fillStyle = s.colour.line;
      ctx.font      = 'bold 9px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, legendX, legendY);
      legendY += 11;
    });
  }
}

function renderCharts(dayLogs) {
  const timestamps = dayLogs.map(l => new Date(l.timestamp));

  // Calorie chart
  drawCumulativeChart(
    document.getElementById('cal-chart'),
    timestamps,
    [{ label: 'kcal', colour: MACRO_COLOURS.calories, values: dayLogs.map(l => l.calories || 0), target: DAILY_TARGETS.calories }],
    ''
  );

  // Individual macro charts (2×2 grid)
  const macros = [
    { id: 'chart-protein', label: 'Protein', key: 'protein', colour: MACRO_COLOURS.protein },
    { id: 'chart-carbs',   label: 'Carbs',   key: 'carbs',   colour: MACRO_COLOURS.carbs   },
    { id: 'chart-fat',     label: 'Fat',     key: 'fat',     colour: MACRO_COLOURS.fat     },
    { id: 'chart-fibre',   label: 'Fibre',   key: 'fibre',   colour: MACRO_COLOURS.fibre   },
  ];
  macros.forEach(m => {
    drawCumulativeChart(
      document.getElementById(m.id),
      timestamps,
      [{ label: m.label, colour: m.colour, values: dayLogs.map(l => l[m.key] || 0), target: DAILY_TARGETS[m.key] }],
      'g'
    );
  });

  // Show/hide the chart sections based on whether there's data
  const hasSeries = timestamps.length >= 2;
  document.querySelectorAll('.chart-section').forEach(el => {
    el.style.display = hasSeries ? '' : 'none';
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
