/**
 * offscreen.js — AI Meeting Assistant (Audio Mixer + Recorder)
 * -----------------------------------------------------------------
 * Runs inside offscreen.html with FULL DOM access.
 * Captures tab audio AND microphone, mixes them into a single stream,
 * and records the mixed output using MediaRecorder.
 *
 * Audio Mixing Pipeline:
 *   ┌──────────────┐     ┌──────────────────────────────────────┐
 *   │  Tab Audio   │────▶│                                      │
 *   │  (streamId)  │     │  AudioContext                        │
 *   └──────────────┘     │  ┌────────────────────────────────┐  │
 *                        │  │ createMediaStreamDestination() │  │
 *   ┌──────────────┐     │  │        (mixed output)          │──│──▶ MediaRecorder
 *   │  Microphone  │────▶│  └────────────────────────────────┘  │
 *   │  (getUserMe) │     │                                      │
 *   └──────────────┘     └──────────────────────────────────────┘
 *
 * The tab audio is also routed to audioContext.destination (speakers)
 * so the user can still hear the meeting. The mic is NOT routed to
 * speakers to avoid feedback loops.
 */

let mediaRecorder = null;
let recordedChunks = [];
let tabStream = null;
let micStream = null;
let audioContext = null;

// ─── Listen for commands from background.js ──────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.action) {
    case 'startRecording':
      startRecording(message.streamId, message.includeMic)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('[OFFSCREEN] Start error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'stopRecording':
      stopRecording()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('[OFFSCREEN] Stop error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    default:
      return false;
  }
});

// ─── Start Recording with Audio Mixing ───────────────────────────
async function startRecording(streamId, includeMic) {
  // 1. Get the tab audio stream from the stream ID token
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
  console.log('[OFFSCREEN] Tab audio stream acquired');

  // 2. Create the AudioContext and mixing destination
  audioContext = new AudioContext();
  const mixedDestination = audioContext.createMediaStreamDestination();

  // 3. Connect tab audio to BOTH the mixer AND speakers
  const tabSource = audioContext.createMediaStreamSource(tabStream);
  tabSource.connect(mixedDestination);       // → mixed recording
  tabSource.connect(audioContext.destination); // → speakers (so user hears meeting)

  // 4. Attempt to get microphone stream and connect to mixer
  if (includeMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const micSource = audioContext.createMediaStreamSource(micStream);
      // Connect mic to mixer ONLY (NOT to speakers — prevents feedback)
      micSource.connect(mixedDestination);
      console.log('[OFFSCREEN] Microphone stream mixed in');
    } catch (micErr) {
      console.warn('[OFFSCREEN] Mic unavailable, recording tab only:', micErr.message);
      // Continue with tab-only recording — graceful degradation
    }
  } else {
    console.log('[OFFSCREEN] Mic not requested, recording tab audio only');
  }

  // 5. Configure MediaRecorder on the MIXED stream
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  mediaRecorder = new MediaRecorder(mixedDestination.stream, {
    mimeType: mimeType,
    audioBitsPerSecond: 128000
  });

  recordedChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.start(1000);
  console.log('[OFFSCREEN] Recording started | mimeType:', mimeType,
    '| Mic mixed:', !!micStream);
}

// ─── Stop Recording ──────────────────────────────────────────────
function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('No active recording'));
      return;
    }

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        console.log('[OFFSCREEN] Recording complete. Size:', sizeMB, 'MB');

        const dataUrl = await blobToDataUrl(blob);

        chrome.runtime.sendMessage({
          action: 'downloadRecording',
          dataUrl: dataUrl,
          filename: null
        });

        cleanup();
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[OFFSCREEN] MediaRecorder error:', event.error);
      cleanup();
      reject(event.error);
    };

    mediaRecorder.stop();
  });
}

// ─── Helpers ─────────────────────────────────────────────────────
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanup() {
  if (tabStream) {
    tabStream.getTracks().forEach(t => t.stop());
    tabStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  mediaRecorder = null;
  recordedChunks = [];
  console.log('[OFFSCREEN] All resources cleaned up');
}
