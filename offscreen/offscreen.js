/**
 * AitherConnect Offscreen Document — Audio Recording ONLY
 * ========================================================
 * getUserMedia + MediaRecorder. Returns base64 audio to background via Port.
 * Does NOT do any fetch/transcription — background.js handles that.
 */

let _recorder = null;
let _chunks = [];
let _stream = null;
let _port = null;

// Connect to background immediately on load
_port = chrome.runtime.connect({ name: "offscreen-audio" });
_port.onMessage.addListener(async (msg) => {
  if (msg.type === "start-recording") {
    try {
      await startRecording();
      _port.postMessage({ type: "recording-started", ok: true });
    } catch (e) {
      _port.postMessage({ type: "recording-started", ok: false, error: e.message });
    }
  }

  if (msg.type === "stop-recording") {
    try {
      const b64 = await stopRecording();
      _port.postMessage({ type: "recording-stopped", ok: true, audio_base64: b64 });
    } catch (e) {
      _port.postMessage({ type: "recording-stopped", ok: false, error: e.message });
    }
  }
});

async function startRecording() {
  if (_recorder && _recorder.state === "recording") return;
  _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _chunks = [];
  _recorder = new MediaRecorder(_stream, { mimeType: "audio/webm" });
  _recorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };
  _recorder.start();
}

function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!_recorder || _recorder.state !== "recording") {
      reject(new Error("Not recording"));
      return;
    }
    _recorder.onstop = async () => {
      if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
      const blob = new Blob(_chunks, { type: "audio/webm" });
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      resolve(btoa(binary));
    };
    _recorder.stop();
  });
}
