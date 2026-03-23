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
console.log('[/health] GET', `${BACKEND_URL}/health`);
fetch(`${BACKEND_URL}/health`)
  .then(res => console.log('[/health] response status:', res.status))
  .catch(err => console.warn('[/health] warm-up ping failed:', err));

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
initAuth();

// ── IOS INSTALL NUDGE ────────────────────────────────────────────────────────
// iOS Safari never fires beforeinstallprompt, so we show our own banner
// telling users how to add to their home screen via the Share sheet.
(function showIOSInstallBanner() {
  const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed    = sessionStorage.getItem('ios-banner-dismissed');
  if (!isIOS || isStandalone || dismissed) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.innerHTML = `
    <span class="banner-icon">📲</span>
    <div class="banner-text">
      <strong>Add to Home Screen</strong>
      <span>Tap the <strong>Share</strong> button ⬆️ then <strong>"Add to Home Screen"</strong> to install GuesstAImate as an app.</span>
    </div>
    <button class="banner-close" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(banner);
  banner.querySelector('.banner-close').addEventListener('click', () => {
    banner.remove();
    sessionStorage.setItem('ios-banner-dismissed', '1');
  });
}());
