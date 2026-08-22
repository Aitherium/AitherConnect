/**
 * Awconnect Recorder Tab
 * ==========================
 * Opens in a real browser tab where getUserMedia permission prompts work.
 * Records audio via MediaRecorder, converts to base64, sends back to
 * the extension background.js which relays it to the sidepanel for STT.
 */

const micBtn = document.getElementById("mic-btn");
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");

let recorder = null;
let chunks = [];
let stream = null;
let startTime = 0;
let timerInterval = null;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  timerEl.textContent = `${m}:${s}`;
}

micBtn.addEventListener("click", async () => {
  if (recorder && recorder.state === "recording") {
    // Stop recording
    recorder.stop();
    return;
  }

  // Start recording
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setStatus("Microphone access denied. Please allow and reload.", "error");
    return;
  }

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstart = () => {
    micBtn.textContent = "\u23F9"; // stop icon
    micBtn.className = "recording";
    setStatus("Recording... click to stop");
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  };

  recorder.onstop = async () => {
    clearInterval(timerInterval);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    micBtn.textContent = "\u23F3"; // hourglass
    micBtn.className = "processing";
    setStatus("Processing...");

    const blob = new Blob(chunks, { type: "audio/webm" });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const audio_base64 = btoa(binary);

    // Send audio back to background.js
    try {
      chrome.runtime.sendMessage({
        type: "recorder-result",
        audio_base64,
      }, (resp) => {
        if (resp?.ok) {
          setStatus("Sent to transcription!", "success");
        } else {
          setStatus("Send failed: " + (resp?.error || "unknown"), "error");
        }
        // Close tab after short delay
        setTimeout(() => window.close(), 1500);
      });
    } catch (e) {
      setStatus("Error: " + e.message, "error");
    }
  };

  recorder.start();

  // Auto-stop after 60 seconds
  setTimeout(() => {
    if (recorder?.state === "recording") recorder.stop();
  }, 60000);
});

// Auto-start recording on page load (permission prompt will show).
// Once permission is granted here, the sidepanel's getUserMedia will also work.
setTimeout(() => micBtn.click(), 500);

// Also update the subtitle to explain
document.querySelector(".sub").textContent =
  "Grant mic permission here, then use the mic button in the sidepanel. Or record here directly.";
