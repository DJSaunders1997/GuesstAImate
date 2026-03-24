/**
 * track.js — Backend API integration for GuesstAImate.
 *
 * Handles everything after the audio is captured:
 *   1. Build the FormData payload (audio blob + today's log entries).
 *   2. POST to the backend /track endpoint.
 *   3. Dispatch the response intent (add / edit / delete / multi) to storage.
 *
 * Globals consumed: BACKEND_URL, selectedDate, transcriptEl (main.js),
 *                   getLogs, addLog, updateLog, deleteLog (storage.js),
 *                   setStatus, showConfirm, escapeHtml (render.js),
 *                   btn, speechDetected (recording.js).
 */

const FIELD_LABELS = { calories: 'kcal', protein: 'g protein', carbs: 'g carbs', fat: 'g fat', fibre: 'g fibre', food: '' };

// Tracks foods currently being fetched to prevent duplicate concurrent requests.
const _imageFetchInFlight = new Set();

/**
 * Fetches a DALL-E image for `food` (using the local cache), then updates
 * any rendered log-entry thumbnails that have a matching data-food attribute.
 * Fire-and-forget — callers do not await this.
 */
async function fetchAndCacheFoodImage(food) {
  const key = food.toLowerCase().trim();
  // 1. localStorage hit — instant
  const cached = getCachedImage(food);
  if (cached) { _applyImageToEntries(food, cached); return; }
  // Deduplicate concurrent fetches for the same food
  if (_imageFetchInFlight.has(key)) return;
  _imageFetchInFlight.add(key);
  try {
    // 2. Global Firestore cache — free, shared across all users
    const firestoreUrl = await getGlobalFirestoreImage(food);
    if (firestoreUrl) { _applyImageToEntries(food, firestoreUrl); return; }
    // 3. Generate via DALL-E (costs money — only reached on first-ever log of this food)
    console.log('[/image] POST', `${BACKEND_URL}/image`, '— food:', food);
    const res = await fetch(`${BACKEND_URL}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ food }),
    });
    console.log('[/image] response status:', res.status);
    if (!res.ok) { console.warn('[/image] non-OK response for food:', food); return; }
    const { data_url } = await res.json();
    console.log('[/image] received data_url length:', data_url?.length, 'for food:', food);
    setCachedImage(food, data_url);
    _applyImageToEntries(food, data_url);
  } catch (err) { console.warn('[/image] fetch failed for food:', food, err); }
  finally { _imageFetchInFlight.delete(key); }
}

function _applyImageToEntries(food, dataUrl) {
  const key = food.toLowerCase().trim();
  document.querySelectorAll('.log-thumb[data-food]').forEach(img => {
    if (img.dataset.food.toLowerCase().trim() === key) {
      img.src = dataUrl;
      img.classList.remove('log-thumb--loading');
    }
  });
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
  items.forEach(({ food, calories, protein, carbs, fat, fibre, time_hint, meal }) =>
    addLog(food, calories, protein, carbs, fat, fibre, transcript, time_hint, meal)
  );
  items.forEach(({ food }) => fetchAndCacheFoodImage(food));
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
    action.items.forEach(({ food }) => fetchAndCacheFoodImage(food));
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
 *
 * Called by recording.js once the MediaRecorder has stopped.
 */
function triggerPhotoLog() {
  document.getElementById('photo-input').click();
}

function openTextTrack() {
  const dialog = document.getElementById('text-track-dialog');
  dialog.showModal();
  document.getElementById('text-track-input').focus();
}

async function submitTextTrack(e) {
  e.preventDefault();
  const input  = document.getElementById('text-track-input');
  const text   = input.value.trim();
  if (!text) return;

  input.value = '';
  document.getElementById('text-track-dialog').close();
  setStatus('Parsing…', '');
  transcriptEl.textContent = '';

  const todayStr     = selectedDate.toDateString();
  const todayEntries = getLogs()
    .filter(l => new Date(l.timestamp).toDateString() === todayStr)
    .map(({ id, food, calories, protein, carbs, fat, fibre }) =>
      ({ id, food, calories, protein, carbs, fat, fibre })
    );

  try {
    const res = await fetch(`${BACKEND_URL}/track-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ text, entries: JSON.stringify(todayEntries) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }
    const result = await res.json();
    transcriptEl.textContent = `"${text}"`;
    const handlers = { add: _handleAdd, edit: _handleEdit, delete: _handleDelete, multi: _handleMulti };
    const handler  = handlers[result.intent];
    if (!handler) throw new Error(`Unknown intent: ${result.intent}`);
    await handler(result, text);
  } catch (err) {
    transcriptEl.textContent = '';
    setStatus(`Error: ${err.message}`, 'error');
  }
}

document.getElementById('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // reset so the same file can be picked again
  if (!file) return;
  await logPhoto(file);
});

async function _resizeImageToJpeg(file, maxPx = 512) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.src = url;
  });
}

async function logPhoto(file) {
  const photoBtn = document.getElementById('photo-btn');
  photoBtn.disabled = true;
  photoBtn.classList.add('processing');
  setStatus('Analysing photo…', '');
  transcriptEl.textContent = '';
  try {
    const image_b64 = await _resizeImageToJpeg(file);
    console.log('[/log-photo] POST', `${BACKEND_URL}/log-photo`, '— b64 chars:', image_b64.length);
    const res = await fetch(`${BACKEND_URL}/log-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ image_b64 }),
    });
    console.log('[/log-photo] response status:', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error (${res.status})`);
    }
    const result = await res.json();
    console.log('[/log-photo] response body:', result);
    transcriptEl.textContent = '📷 Estimated from photo';
    _handleAdd(result, result.transcript);
  } catch (err) {
    transcriptEl.textContent = '';
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    photoBtn.disabled = false;
    photoBtn.classList.remove('processing');
  }
}

async function processAudio() {
  if (!speechDetected) {
    setStatus('🎙️ Record to add, edit or remove foods · 📷 Photo to log a meal', '');
    btn.className   = '';
    btn.textContent = '🎙️';
    btn.disabled    = false;
    return;
  }

  try {
    const formData = _buildFormData();
    // Show a warming-up hint if the backend takes more than 4 seconds to respond
    // (Azure Container Apps can have a cold-start delay after scaling to zero).
    const warmupHint = setTimeout(
      () => setStatus('Backend warming up, please wait…', ''),
      4000
    );
    let result;
    try {
      result = await _postToBackend(formData);
    } finally {
      clearTimeout(warmupHint);
    }
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
