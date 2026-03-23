/**
 * recording.js - microphone capture, Whisper API submission, and live captions.
 *
 * Handles the full recording lifecycle:
 *   1. Request microphone access and start MediaRecorder.
 *   2. Run Web Speech API in parallel for live caption preview.
 *   3. On stop, POST the audio blob to the backend /track endpoint.
 *   4. Parse the response and hand results off to addLog() (storage.js).
 *
 * Globals consumed: BACKEND_URL, btn, status, transcriptEl (main.js),
 *                   addLog (storage.js), setStatus (render.js).
 */

const MAX_RECORD_SECS    = 60;
const SILENCE_THRESHOLD  = 0.008; // RMS amplitude below this = silence (tune if needed)
const SILENCE_DURATION_MS = 2500; // sustained silence for this long → auto-stop
const MIN_RECORDING_MS   = 750;  // never auto-stop before this many ms of recording

let mediaRecorder  = null;
let audioChunks    = [];
let isRecording    = false;
let recordingTimer = null;   // setTimeout handle - hard limit after MAX_RECORD_SECS
let liveRecognition = null;  // Web Speech API instance for live captions
let audioContext   = null;   // Web Audio API context for VAD
let vadInterval    = null;   // setInterval handle for audio level polling
let silenceSince   = null;   // timestamp when silence began (null if speaking)
let speechDetected = false;  // true once we've seen audio above the threshold
let recordingStart = 0;      // Date.now() at recording start
let waveformRaf    = null;   // requestAnimationFrame handle for waveform drawing

const FIELD_LABELS = { calories: 'kcal', protein: 'g protein', carbs: 'g carbs', fat: 'g fat', fibre: 'g fibre', food: '' };

function _pickMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
    .find(m => m === '' || MediaRecorder.isTypeSupported(m));
}

function _startVAD(vadAnalyser) {
  const vadBuf = new Uint8Array(vadAnalyser.fftSize);
  vadInterval = setInterval(() => {
    vadAnalyser.getByteTimeDomainData(vadBuf);
    let sum = 0;
    for (const b of vadBuf) { const v = (b - 128) / 128; sum += v * v; }
    const rms     = Math.sqrt(sum / vadBuf.length);
    const elapsed = Date.now() - recordingStart;

    if (rms >= SILENCE_THRESHOLD) {
      speechDetected = true;
      silenceSince   = null;
    } else if (speechDetected && elapsed >= MIN_RECORDING_MS) {
      if (!silenceSince) { silenceSince = Date.now(); setStatus('Finishing…', ''); }
      if (Date.now() - silenceSince >= SILENCE_DURATION_MS) stopRecording();
    }
  }, 100);
}

function _startWaveform(waveAnalyser) {
  const waveformCanvas = document.getElementById('waveform');
  waveformCanvas.removeAttribute('hidden');
  waveformCanvas.width  = 220 * devicePixelRatio;
  waveformCanvas.height = 44  * devicePixelRatio;
  const wctx    = waveformCanvas.getContext('2d');
  const drawBuf = new Float32Array(waveAnalyser.fftSize);
  let smoothedPeak = 0.01;
  const draw = () => {
    waveformRaf = requestAnimationFrame(draw);
    waveAnalyser.getFloatTimeDomainData(drawBuf);
    const W = waveformCanvas.width;
    const H = waveformCanvas.height;
    wctx.clearRect(0, 0, W, H);
    const color = !speechDetected ? '#94a3b8' : silenceSince ? '#f59e0b' : '#22c55e';
    wctx.beginPath();
    wctx.strokeStyle = color;
    wctx.lineWidth   = 2 * devicePixelRatio;
    let framePeak = 0.001;
    for (let i = 0; i < drawBuf.length; i++) {
      const abs = Math.abs(drawBuf[i]);
      if (abs > framePeak) framePeak = abs;
    }
    smoothedPeak = Math.max(smoothedPeak * 0.95, framePeak);
    const scale = (H / 2 * 0.9) / smoothedPeak;
    const sliceW = W / drawBuf.length;
    let x = 0;
    for (let i = 0; i < drawBuf.length; i++) {
      const y = H / 2 - drawBuf[i] * scale;
      if (i === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
      x += sliceW;
    }
    wctx.lineTo(W, H / 2);
    wctx.stroke();
  };
  draw();
}

function _startAudioAnalysis(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source         = audioContext.createMediaStreamSource(stream);
  const vadAnalyser    = audioContext.createAnalyser();
  vadAnalyser.fftSize  = 512;
  source.connect(vadAnalyser);
  const gainNode       = audioContext.createGain();
  gainNode.gain.value  = 20;
  const waveAnalyser   = audioContext.createAnalyser();
  waveAnalyser.fftSize = 512;
  source.connect(gainNode);
  gainNode.connect(waveAnalyser);
  _startVAD(vadAnalyser);
  _startWaveform(waveAnalyser);
}

function _startLiveCaptions() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  liveRecognition = new SpeechRecognition();
  liveRecognition.continuous     = true;
  liveRecognition.interimResults = true;
  liveRecognition.lang           = 'en-GB';
  liveRecognition.onresult = e => {
    let text = '';
    for (const result of e.results) text += result[0].transcript;
    transcriptEl.textContent = text;
  };
  liveRecognition.onerror = () => {}; // silently ignore - Whisper handles the final version
  liveRecognition.start();
}

/**
 * Requests microphone access, starts recording, launches the countdown UI,
 * schedules an auto-stop, and begins live captioning via Web Speech API.
 * Updates `btn` and `status` to reflect the recording state.
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];

    const mimeType = _pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      processAudio();
    };

    mediaRecorder.start(250);
    isRecording    = true;
    recordingStart = Date.now();
    speechDetected = false;
    silenceSince   = null;
    btn.className   = 'recording';
    btn.textContent = '⏹️';
    setStatus('Listening…', '');

    recordingTimer = setTimeout(() => stopRecording(), MAX_RECORD_SECS * 1000);
    _startAudioAnalysis(stream);
    _startLiveCaptions();
  } catch {
    setStatus('Microphone access denied. Please allow microphone access and try again.', 'error');
  }
}

/**
 * Stops an active recording session: clears timers, stops live captions,
 * stops the MediaRecorder, and puts the UI into a processing state.
 * Safe to call even if recording is not active.
 */
function stopRecording() {
  clearTimeout(recordingTimer);
  clearInterval(vadInterval);
  vadInterval = null;
  cancelAnimationFrame(waveformRaf);
  waveformRaf = null;
  document.getElementById('waveform').setAttribute('hidden', '');
  if (audioContext) { audioContext.close(); audioContext = null; }
  // Null the onresult handler before stopping to prevent the browser firing a
  // final flush event that would overwrite the Whisper transcript.
  if (liveRecognition) { liveRecognition.onresult = null; liveRecognition.stop(); liveRecognition = null; }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording     = false;
  btn.className   = 'processing';
  btn.textContent = '⏳';
  btn.disabled    = true;
  setStatus('Processing…', '');
}

function _buildFormData() {
  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const blob     = new Blob(audioChunks, { type: mimeType });
  const ext      = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const todayStr     = selectedDate.toDateString();
  const todayEntries = getLogs()
    .filter(l => new Date(l.timestamp).toDateString() === todayStr)
    .map(({ id, food, calories, protein, carbs, fat, fibre }) =>
      ({ id, food, calories, protein, carbs, fat, fibre })
    );
  console.log('[/track] audio blob:', blob.size, 'bytes,', mimeType);
  console.log('[/track] sending entries:', todayEntries);
  const formData = new FormData();
  formData.append('audio',   blob, `recording.${ext}`);
  formData.append('entries', JSON.stringify(todayEntries));
  return formData;
}

async function _postToBackend(formData) {
  console.log(`[/track] POST ${BACKEND_URL}/track`);
  const res = await fetch(`${BACKEND_URL}/track`, { method: 'POST', body: formData, credentials: 'omit' });
  console.log('[/track] response status:', res.status);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error (${res.status})`);
  }
  const result = await res.json();
  console.log('[/track] response body:', result);
  return result;
}

function _handleAdd({ items }, transcript) {
  items.forEach(({ food, calories, protein, carbs, fat, fibre, time_hint }) =>
    addLog(food, calories, protein, carbs, fat, fibre, transcript, time_hint)
  );
  if (items.length === 1) {
    setStatus(`Logged: ${items[0].food} - ${items[0].calories} kcal`, 'success');
  } else {
    const total = items.reduce((s, i) => s + i.calories, 0);
    setStatus(`Logged ${items.length} items - ${total} kcal total`, 'success');
  }
}

async function _handleEdit({ entry_id, updates }) {
  const entry = getLogs().find(l => l.id === entry_id);
  if (!entry) { setStatus("Couldn't find that entry in today's log.", 'error'); return; }
  const changedSummary = Object.entries(updates)
    .map(([k, v]) => `${k}: ${entry[k] ?? '?'} → ${v}${FIELD_LABELS[k] ?? ''}`)
    .join(', ');
  const confirmed = await showConfirm(
    `Update <strong>${escapeHtml(entry.food)}</strong>?<br><small style="color:var(--muted)">${escapeHtml(changedSummary)}</small>`
  );
  if (confirmed) {
    updateLog(entry_id, updates);
    setStatus(`Updated: ${entry.food}`, 'success');
  } else {
    setStatus('Edit cancelled.', '');
  }
}

async function _handleDelete({ entry_id }) {
  const entry = getLogs().find(l => l.id === entry_id);
  if (!entry) { setStatus("Couldn't find that entry in today's log.", 'error'); return; }
  const confirmed = await showConfirm(
    `Remove <strong>${escapeHtml(entry.food)}</strong> (${entry.calories} kcal) from the log?`
  );
  if (confirmed) {
    deleteLog(entry_id);
    setStatus(`Removed: ${entry.food}`, 'success');
  } else {
    setStatus('Deletion cancelled.', '');
  }
}

async function _handleMultiAction(action, transcript, summaryParts) {
  if (action.intent === 'add') {
    action.items.forEach(({ food, calories, protein, carbs, fat, fibre, time_hint }) =>
      addLog(food, calories, protein, carbs, fat, fibre, transcript, time_hint)
    );
    summaryParts.push(
      action.items.length === 1
        ? `added ${action.items[0].food}`
        : `added ${action.items.length} items`
    );

  } else if (action.intent === 'edit') {
    const entry = getLogs().find(l => l.id === action.entry_id);
    if (!entry) { summaryParts.push(`couldn't find entry to edit`); return; }
    const changedSummary = Object.entries(action.updates)
      .map(([k, v]) => `${k}: ${entry[k] ?? '?'} → ${v}${FIELD_LABELS[k] ?? ''}`)
      .join(', ');
    const confirmed = await showConfirm(
      `Update <strong>${escapeHtml(entry.food)}</strong>?<br><small style="color:var(--muted)">${escapeHtml(changedSummary)}</small>`
    );
    if (confirmed) {
      updateLog(action.entry_id, action.updates);
      summaryParts.push(`updated ${entry.food}`);
    } else {
      summaryParts.push(`skipped edit of ${entry.food}`);
    }

  } else if (action.intent === 'delete') {
    const entry = getLogs().find(l => l.id === action.entry_id);
    if (!entry) { summaryParts.push(`couldn't find entry to delete`); return; }
    const confirmed = await showConfirm(
      `Remove <strong>${escapeHtml(entry.food)}</strong> (${entry.calories} kcal) from the log?`
    );
    if (confirmed) {
      deleteLog(action.entry_id);
      summaryParts.push(`removed ${entry.food}`);
    } else {
      summaryParts.push(`kept ${entry.food}`);
    }
  }
}

async function _handleMulti({ actions }, transcript) {
  const summaryParts = [];
  for (const action of actions) {
    await _handleMultiAction(action, transcript, summaryParts);
  }
  setStatus(summaryParts.join(', '), 'success');
}

/**
 * POSTs the recorded audio blob to the backend /track endpoint along with
 * the current day's log entries (for edit/delete context). Handles the
 * response intent — 'add', 'edit', 'delete', or 'multi' — with confirmation
 * dialogs for destructive changes before applying them to storage.
 */
async function processAudio() {
  if (!speechDetected) {
    setStatus('Tap to record what you ate — or to remove / edit foods', '');
    btn.className   = '';
    btn.textContent = '🎙️';
    btn.disabled    = false;
    return;
  }

  try {
    const formData = _buildFormData();
    const result   = await _postToBackend(formData);
    const { intent, transcript } = result;

    transcriptEl.textContent = `"${transcript}"`;

    const handlers = { add: _handleAdd, edit: _handleEdit, delete: _handleDelete, multi: _handleMulti };
    const handler = handlers[intent];
    if (!handler) throw new Error(`Unknown intent: ${intent}`);
    await handler(result, transcript);

  } catch (err) {
    transcriptEl.textContent = '';
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.className   = '';
    btn.textContent = '🎙️';
    btn.disabled    = false;
  }
}
