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

const MAX_RECORD_SECS = 60;

let mediaRecorder  = null;
let audioChunks    = [];
let isRecording    = false;
let recordingTimer = null;   // setTimeout handle - auto-stops after MAX_RECORD_SECS
let countdownTimer = null;   // setInterval handle - ticks countdown in the UI
let liveRecognition = null;  // Web Speech API instance for live captions

/**
 * Requests microphone access, starts recording, launches the countdown UI,
 * schedules an auto-stop, and begins live captioning via Web Speech API.
 * Updates `btn` and `status` to reflect the recording state.
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks  = [];

    // Pick the best supported MIME type (webm on Chrome/Edge, ogg on Firefox).
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', '']
      .find(m => m === '' || MediaRecorder.isTypeSupported(m));

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      processAudio();
    };

    mediaRecorder.start(250); // collect chunks every 250 ms
    isRecording     = true;
    btn.className   = 'recording';
    btn.textContent = '⏹️';

    // Countdown UI - tick every second to show time remaining.
    let secsLeft = MAX_RECORD_SECS;
    const updateCountdown = () => setStatus(`Recording… ${secsLeft}s remaining`, '');
    updateCountdown();
    countdownTimer = setInterval(() => { secsLeft--; updateCountdown(); }, 1000);

    // Auto-stop after the time limit.
    recordingTimer = setTimeout(() => stopRecording(), MAX_RECORD_SECS * 1000);

    // Live transcription via Web Speech API (Chrome/Edge/Safari only).
    // Nulling onresult before stop() prevents a final flush event from
    // overwriting the accurate Whisper transcript after it arrives.
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
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
  clearInterval(countdownTimer);
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

/**
 * POSTs the recorded audio blob to the backend /track endpoint along with
 * the current day's log entries (for edit/delete context). Handles the
 * response intent — 'add', 'edit', or 'delete' — with confirmation dialogs
 * for destructive changes before applying them to storage.
 */
async function processAudio() {
  try {
    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    const blob     = new Blob(audioChunks, { type: mimeType });
    const ext      = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';

    // Send today's entries as context so the AI can match edit/delete requests.
    const todayStr     = selectedDate.toDateString();
    const todayEntries = getLogs()
      .filter(l => new Date(l.timestamp).toDateString() === todayStr)
      .map(({ id, food, calories, protein, carbs, fat, fibre }) =>
        ({ id, food, calories, protein, carbs, fat, fibre })
      );

    const formData = new FormData();
    formData.append('audio',   blob, `recording.${ext}`);
    formData.append('entries', JSON.stringify(todayEntries));

    const res = await fetch(`${BACKEND_URL}/track`, { method: 'POST', body: formData, credentials: 'omit' });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }

    const result = await res.json();
    const { intent, transcript } = result;

    // Whisper's accurate transcript replaces the live Web Speech API preview.
    transcriptEl.textContent = `"${transcript}"`;

    if (intent === 'add') {
      const { items } = result;
      items.forEach(({ food, calories, protein, carbs, fat, fibre, time_hint }) =>
        addLog(food, calories, protein, carbs, fat, fibre, transcript, time_hint)
      );
      if (items.length === 1) {
        setStatus(`Logged: ${items[0].food} - ${items[0].calories} kcal`, 'success');
      } else {
        const total = items.reduce((s, i) => s + i.calories, 0);
        setStatus(`Logged ${items.length} items - ${total} kcal total`, 'success');
      }

    } else if (intent === 'edit') {
      const { entry_id, updates } = result;
      const entry = getLogs().find(l => l.id === entry_id);
      if (!entry) {
        setStatus("Couldn't find that entry in today's log.", 'error');
        return;
      }
      const fieldLabels = { calories: 'kcal', protein: 'g protein', carbs: 'g carbs', fat: 'g fat', fibre: 'g fibre', food: '' };
      const changedSummary = Object.entries(updates)
        .map(([k, v]) => `${k}: ${entry[k] ?? '?'} → ${v}${fieldLabels[k] ?? ''}`)
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

    } else if (intent === 'delete') {
      const { entry_id } = result;
      const entry = getLogs().find(l => l.id === entry_id);
      if (!entry) {
        setStatus("Couldn't find that entry in today's log.", 'error');
        return;
      }
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

  } catch (err) {
    transcriptEl.textContent = '';
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.className   = '';
    btn.textContent = '🎙️';
    btn.disabled    = false;
  }
}
