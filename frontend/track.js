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
 *
 * Called by recording.js once the MediaRecorder has stopped.
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
