/**
 * popup.js — AI Meeting Assistant
 * ------------------------------------
 * The popup handles two critical tasks that MUST happen in this context:
 *
 *   1. Microphone Permission Grant — Offscreen documents can't show browser
 *      permission prompts. The popup requests mic access once, then the
 *      offscreen document can use getUserMedia silently on every session.
 *
 *   2. Tab Capture Stream ID — chrome.tabCapture.getMediaStreamId() must
 *      originate from a user gesture in a visible foreground page.
 *
 * Flow:
 *   1. On first use: User clicks "Grant" → popup requests mic permission
 *   2. User clicks "Start Capture" → popup gets tab stream ID token
 *   3. Both the stream ID and mic-granted flag are sent to background.js
 *   4. background.js forwards to offscreen.js for audio mixing + recording
 */

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const timerEl = document.getElementById('timer');
const micBanner = document.getElementById('micBanner');
const micStatusText = document.getElementById('micStatusText');
const grantMicBtn = document.getElementById('grantMicBtn');

let timerInterval = null;
let seconds = 0;
let micPermissionGranted = false;

// ─── Timer Helpers ───────────────────────────────────────────────
function formatTime(s) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function startTimer() {
  seconds = 0;
  timerEl.textContent = '00:00';
  timerInterval = setInterval(() => {
    seconds++;
    timerEl.textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ─── UI State Management ─────────────────────────────────────────
function setRecordingUI() {
  startBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  statusDot.classList.add('recording');
  statusText.textContent = 'Recording (Tab + Mic)...';
  startTimer();
}

function setIdleUI(message = 'Ready to record') {
  startBtn.style.display = 'block';
  stopBtn.style.display = 'none';
  statusDot.classList.remove('recording');
  statusText.textContent = message;
  stopTimer();
}

function setMicGrantedUI() {
  micPermissionGranted = true;
  micBanner.classList.add('granted');
  micStatusText.textContent = '✓ Microphone access granted';
  grantMicBtn.style.display = 'none';
  startBtn.disabled = false;
}

function setMicDeniedUI() {
  micPermissionGranted = false;
  micBanner.classList.remove('granted');
  micStatusText.textContent = '⚠ Mic denied — will record tab only';
  grantMicBtn.textContent = 'Retry';
  grantMicBtn.style.display = 'inline-block';
  // Still allow recording with tab-only audio
  startBtn.disabled = false;
}

// ─── Check Existing Mic Permission ───────────────────────────────
// On popup load, check if mic permission was already granted in a previous session
async function checkMicPermission() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') {
      setMicGrantedUI();
    } else if (result.state === 'denied') {
      setMicDeniedUI();
    } else {
      // 'prompt' — user hasn't decided yet, keep the Grant button visible
      startBtn.disabled = true;  // Require mic grant before first use
    }
  } catch (e) {
    // permissions.query may not support 'microphone' in all contexts
    // Fall back to trying getUserMedia
    console.warn('[POPUP] permissions.query failed, will try on demand:', e);
    startBtn.disabled = false;
  }
}

// ─── Grant Microphone Permission ─────────────────────────────────
// This MUST happen in the popup — offscreen documents cannot show prompts.
grantMicBtn.addEventListener('click', async () => {
  try {
    grantMicBtn.textContent = 'Requesting...';
    grantMicBtn.disabled = true;

    // Request mic access — this triggers the browser's permission prompt
    const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Permission granted! Stop the test stream immediately
    testStream.getTracks().forEach(track => track.stop());

    setMicGrantedUI();
    console.log('[POPUP] Microphone permission granted');
  } catch (err) {
    console.error('[POPUP] Mic permission denied:', err);
    setMicDeniedUI();
  }
});

// ─── On page load, check if already recording + mic status ───────
checkMicPermission();

chrome.runtime.sendMessage({ action: 'queryStatus' }, (response) => {
  if (response && response.recording) {
    setRecordingUI();
    // Approximate timer from stored start time
    if (response.startTime) {
      seconds = Math.floor((Date.now() - response.startTime) / 1000);
      timerEl.textContent = formatTime(seconds);
      startTimer();
    }
  }
});

// ─── Start Capture ───────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  try {
    // CRITICAL: getMediaStreamId MUST be called from the popup (user gesture context).
    // This returns a token string, NOT an actual MediaStream object.
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id
    });

    // Send the stream ID token to background.js for processing
    // Include whether mic permission is available so offscreen.js knows to mix
    chrome.runtime.sendMessage({
      action: 'startCapture',
      streamId: streamId,
      includeMic: micPermissionGranted
    }, (response) => {
      if (response && response.success) {
        setRecordingUI();
      } else {
        statusText.textContent = 'Error: ' + (response?.error || 'Unknown');
        console.error('Start capture failed:', response?.error);
      }
    });
  } catch (err) {
    statusText.textContent = 'Capture error';
    console.error('tabCapture.getMediaStreamId failed:', err);
  }
});

// ─── Stop Capture ────────────────────────────────────────────────
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stopCapture' }, (response) => {
    if (response && response.success) {
      setIdleUI('✅ Saved! Check Downloads.');
    } else {
      setIdleUI('⚠️ Stop failed');
    }
  });
});