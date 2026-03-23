/**
 * recording.js — Microphone capture, VAD, waveform, and live captions.
 *
 * Owns the full recording lifecycle up to the point the audio is ready:
 *   1. Request microphone access and start MediaRecorder.
 *   2. Run voice activity detection (VAD) to auto-stop on silence.
 *   3. Draw a live waveform visualiser.
 *   4. Run Web Speech API in parallel for live caption preview.
 *   5. On stop, hand the captured chunks to processAudio() (track.js).
 *
 * Globals consumed: btn, transcriptEl (main.js), setStatus (render.js).
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
