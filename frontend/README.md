# GuesstAImate — Frontend

Vanilla JS single-page app. No build step, no framework, no bundler — just plain files served by GitHub Pages (or nginx locally).

---

## File Structure

```
frontend/
├── index.html          # App shell — all markup, script tags
├── styles.css          # Dark-theme CSS
│
├── main.js             # Entry point (load last)
├── storage.js          # localStorage — load first
├── render.js           # DOM rendering — depends on storage + charts
├── charts.js           # Canvas charts — depends on storage
├── recording.js        # Microphone + Whisper API
│
├── manifest.json       # PWA manifest
├── service-worker.js   # PWA offline caching
├── icons/
│   ├── icon-192.png    # PWA home-screen icon (small)
│   └── icon-512.png    # PWA home-screen icon (large)
│
└── Dockerfile          # Nginx image for local Docker testing
```

### Script load order

`index.html` loads scripts in dependency order:

```html
<script src="storage.js"></script>   <!-- no deps -->
<script src="render.js"></script>    <!-- needs storage, charts -->
<script src="charts.js"></script>    <!-- needs storage -->
<script src="recording.js"></script> <!-- needs storage, render -->
<script src="main.js"></script>      <!-- needs everything -->
```

All functions are globals on `window` — no ES modules, intentionally keeping it simple.

---

## JS Module Breakdown

### `storage.js`
Owns all `localStorage` access. Nothing else touches it directly.

| Function | Description |
|---|---|
| `getLogs()` | Returns full log array (newest first). Safe — returns `[]` on corrupt data. |
| `saveLogs(logs)` | Overwrites the entire log array. |
| `addLog(...)` | Creates a new entry, resolves timestamp from GPT hint or current time, saves. |
| `deleteLog(id)` | Removes one entry by ID. |
| `getUniqueFoods()` | Returns deduplicated food names (most recent first) — used for autocomplete. |
| `downloadCSV()` | Serialises all entries to CSV and triggers a browser download. |

### `render.js`
Builds all DOM. Depends on `storage.js` and `charts.js`.

| Function | Description |
|---|---|
| `renderLogs()` | Re-renders the full log list + macro summary for the selected day. |
| `showAddForm()` | Injects a blank add-entry form at the top of the list. |
| `editLog(id)` | Replaces a log row with an inline edit form. |
| `saveLog(id)` | Reads the edit form, validates, saves, re-renders. |
| `saveNewLog()` | Reads the add form, calls `addLog()`. |
| `prevDay()` / `nextDay()` | Navigate the selected day. |
| `escapeHtml(str)` | XSS-safe HTML escaping for user content. |
| `setStatus(msg, type)` | Updates the status bar text + CSS class. |

Food input uses a `<datalist>` fed from `getUniqueFoods()` — selecting a previous food auto-fills its macros and calories via a `change` listener attached by `attachFoodAutofill()`.

### `charts.js`
Canvas 2D charts. No external charting library.

| Function | Description |
|---|---|
| `renderCharts(dayLogs)` | Draws the calorie + 4 macro step-charts for the given day. |
| `drawCumulativeChart(...)` | Low-level: draws one step chart on a canvas element. |
| `openTargets()` | Opens/saves the daily target dialog (calories, protein, carbs, fat, fibre). |

**X-axis:** always 07:00–24:00 by default; extends left only if an entry is before 07:00. Seven fixed hour labels. The step line extends flat to 24:00 after the last entry.

### `recording.js`
Handles the microphone, live speech preview, and backend API call.

| Function | Description |
|---|---|
| `startRecording()` | Requests mic, starts `MediaRecorder` + Web Speech API live preview, 60 s countdown. |
| `stopRecording()` | Stops both; sends WebM blob to `/track`; Whisper result overwrites live preview. |
| `processAudio(blob)` | POSTs audio to backend, parses JSON, calls `addLog()` for each returned item. |

**Live transcription fix:** `liveRecognition.onresult = null` is set *before* `.stop()` is called — this prevents the browser's final-result flush event from overwriting the more accurate Whisper transcript.

### `main.js`
Entry point — wires everything together.

- Sets `BACKEND_URL` (`localhost:8000` locally, Azure Container App in production) based on `window.location.hostname`
- Grabs DOM refs (`btn`, `status`, `transcriptEl`, `logList`, `totalCal`)
- Fires a warm-up `GET /health` so the container isn't cold when you first record
- Attaches click listeners and calls `renderLogs()` to initialise the view

---

## PWA — Progressive Web App

GuesstAImate is installable on any device as a PWA. This means it gets a home-screen icon, launches full-screen (no browser chrome), and works offline for the UI.

### What "installable" means

A PWA behaves like a native app:
- On **Android (Chrome):** you get an "Add to Home Screen" banner, or find it in the browser menu → "Install app"
- On **iPhone (Safari):** tap Share → "Add to Home Screen"
- On **desktop Chrome/Edge:** look for the install icon in the address bar

Once installed, it opens in its own window without the browser address bar.

### How it works — `manifest.json`

The manifest tells the browser how to present the app when installed:

```json
{
  "name": "GuesstAImate",
  "short_name": "GuesstAImate",
  "display": "standalone",       ← opens without browser UI
  "background_color": "#0f172a", ← splash screen colour
  "theme_color": "#22c55e",      ← status bar / title bar colour (green)
  "start_url": "/",
  "icons": [ ... ]               ← home-screen icons (192px and 512px)
}
```

### How it works — `service-worker.js`

A service worker is a background script that intercepts network requests. GuesstAImate's service worker:

1. **On install:** pre-caches all static files (HTML, CSS, JS, icons, manifest) so they're available with no network
2. **On each page load:** serves static files from cache first, then updates the cache from the network in the background (stale-while-revalidate style)
3. **API calls:** never intercepted — `/track` and `/health` always go to the live backend

This means:
- The UI loads instantly even on a slow connection
- If you lose signal mid-session, you can still browse your logs and charts (data is in `localStorage`)
- You **cannot** record/transcribe offline (that needs the backend), but everything else works

### Updating the cache

The cache is keyed `guesstaimate-v1`. To force users to pick up new files after a deploy, bump this version string in `service-worker.js`:

```js
const CACHE = 'guesstaimate-v2';  // ← increment when deploying changes
```

The old cache is deleted during the `activate` event.

### Icons

Icons were generated with Pillow (Python) to match the in-app branding:
- "Guesst" — white (`#f1f5f9`)
- "AI" — green (`#22c55e`)
- "mate" — white
- Background — dark navy (`#0f172a`)

Regenerate with:
```bash
python3 - << 'EOF'
# ... (see icon generation script in project history)
EOF
```

---

## Local Development

```bash
# From repo root:
export OPENAI_API_KEY=sk-...
docker compose up --build
```

| URL | Purpose |
|---|---|
| `http://localhost:8080` | Frontend (nginx) |
| `http://localhost:8000` | Backend API |
| `http://localhost:8000/docs` | Swagger UI |

The frontend detects `localhost` via `window.location.hostname` and automatically hits the local backend. Any other hostname hits the Azure Container App.

> **Note:** Service workers don't cache during local Docker testing — they require either HTTPS or `localhost` served directly (not via a Docker port-forward on a different IP). The live GitHub Pages site (`https://`) always uses the service worker correctly.
