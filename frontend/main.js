/**
 * main.js — Application entry point.
 *
 * Responsible for:
 *   - Resolving the backend URL based on the current hostname.
 *   - Sending a warm-up ping to prevent Azure cold-start delays.
 *   - Declaring global DOM element references used across all modules.
 *   - Wiring up top-level event listeners.
 *   - Kicking off the initial render.
 *
 * Load order in index.html: storage → render → charts → recording → main.
 * main.js must be last because it calls renderLogs() on init.
 */

// ── CONFIG ────────────────────────────────────────────────────────────────────

/**
 * Backend API base URL. Points to localhost in development, the Azure
 * Container App in production (detected via hostname).
 * @type {string}
 */
let BACKEND_URL;
if (window.location.hostname === 'localhost' || window.location.hostname === '0.0.0.0') {
  BACKEND_URL = 'http://localhost:8000';
} else {
  BACKEND_URL = 'https://guesstaimate.jollyocean-6818c6e0.ukwest.azurecontainerapps.io';
}

/**
 * The day currently being viewed. Defaults to today; updated by prev/nextDay().
 * @type {Date}
 */
let selectedDate = new Date();

// Warm-up ping — fires immediately on page load so the Azure Container App
// (which scales to zero when idle) is awake before the user starts recording.
fetch(`${BACKEND_URL}/health`).catch(() => {});

// ── DOM REFERENCES ────────────────────────────────────────────────────────────
// Declared as globals so recording.js and render.js can access them at runtime.

const btn          = document.getElementById('record-btn');
const status       = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const logList      = document.getElementById('log-list');
const totalCal     = document.getElementById('total-cal');

// ── EVENT LISTENERS ───────────────────────────────────────────────────────────

btn.addEventListener('click', () => {
  if (!isRecording) startRecording();
  else              stopRecording();
});

document.getElementById('export-btn').addEventListener('click', downloadCSV);

// ── INIT ──────────────────────────────────────────────────────────────────────

renderLogs();
