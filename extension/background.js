/**
 * background.js — AI Meeting Assistant (Service Worker)
 * ----------------------------------------------------------
 * Orchestrates communication between popup.js and offscreen.js.
 *
 * Why offscreen?
 *   Manifest V3 service workers have NO access to DOM APIs like
 *   MediaRecorder, AudioContext, Blob, or URL.createObjectURL.
 *   The offscreen document is a hidden page with full DOM access
 *   that can perform the actual audio recording.
 *
 * Flow:
 *   popup.js  →  background.js  →  offscreen.js
 *              (orchestrator)     (recorder)
 */

let isRecording = false;
let recordingStartTime = null;

// ─── Ensure offscreen document exists ────────────────────────────
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return; // Already exists
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],       // Required reason for getUserMedia
    justification: 'Recording tab audio via MediaRecorder for meeting transcription'
  });
}

// ─── Message Router ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Route based on action
  switch (message.action) {

    // ── From popup: Start recording ──────────────────────────
    case 'startCapture':
      handleStartCapture(message.streamId, message.includeMic)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('[BG] startCapture error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep the message channel open for async response

    // ── From popup: Stop recording ───────────────────────────
    case 'stopCapture':
      handleStopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('[BG] stopCapture error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    // ── From popup: Query current status ─────────────────────
    case 'queryStatus':
      sendResponse({ recording: isRecording, startTime: recordingStartTime });
      return false;

    // ── From offscreen: Recording data ready for download ────
    case 'downloadRecording':
      handleDownload(message.dataUrl, message.filename);
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

// ─── Start Capture Handler ───────────────────────────────────────
async function handleStartCapture(streamId, includeMic) {
  if (isRecording) {
    throw new Error('Already recording');
  }

  // 1. Create the offscreen document if it doesn't exist
  await ensureOffscreenDocument();

  // 2. Forward the stream ID to the offscreen document to start recording
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'startRecording',
    streamId: streamId,
    includeMic: includeMic
  });

  isRecording = true;
  recordingStartTime = Date.now();
  console.log('[BG] Recording started at', new Date().toISOString());
}

// ─── Stop Capture Handler ────────────────────────────────────────
async function handleStopCapture() {
  if (!isRecording) {
    throw new Error('Not recording');
  }

  // Tell offscreen to stop recording — it will send 'downloadRecording' back
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: 'stopRecording'
  });

  isRecording = false;
  recordingStartTime = null;
  console.log('[BG] Recording stopped at', new Date().toISOString());
}

// ─── Download Handler ────────────────────────────────────────────
function handleDownload(dataUrl, filename) {
  // Generate a timestamped filename
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const finalName = filename || `Meeting_${ts}.webm`;

  chrome.downloads.download({
    url: dataUrl,
    filename: finalName,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[BG] Download error:', chrome.runtime.lastError.message);
    } else {
      console.log('[BG] Download started, ID:', downloadId);
    }
  });
}