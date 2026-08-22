/**
 * Room Panel — Real-time event stream from the harness daemon.
 *
 * Subscribes to /rooms/main/stream and renders the six pillar lanes.
 * Falls back to polling /rooms/main if the stream stalls.
 *
 * IMPORTANT: The pillar list is imported from aither-events.generated.js,
 * which mirrors the platform's canonical event vocabulary (internal).
 * DO NOT hand-edit the pillar list here.
 */

(() => {
  "use strict";

  // Verify the generated vocabulary is loaded
  if (typeof window.PILLARS === 'undefined') {
    console.error('aither-events.generated.js was not loaded. Check sidepanel manifest.');
    return;
  }

  // State
  let roomState = {
    connected: false,
    streamAbortController: null,
    lastSeq: 0,
    pillars: {},
    pollTimeout: null,
    daemonHealthy: false,
  };

  // Initialize pillar state from generated vocabulary
  window.PILLARS.forEach(pillar => {
    roomState.pillars[pillar] = [];
  });

  const MAX_EVENTS_PER_PILLAR = 20;
  const ROOM_ID = "main";
  const DAEMON_BASE = "http://127.0.0.1:8362";

  // ── DOM ────────────────────────────────────────────────────────

  const roomStatus = document.getElementById("room-status");
  const roomPillars = document.getElementById("room-pillars");

  // ── Subscribe to room stream ───────────────────────────────────

  /**
 * Fetch through the background service worker, not from this page.
 *
 * The side panel is a PAGE: its fetch to the harness daemon is subject to CORS, and
 * chrome-extension:// is not in the daemon's allowlist — deliberately, because that
 * daemon spawns coding agents with filesystem access. The service worker holds
 * host_permissions and is not subject to page CORS, so it does the request for us and
 * the daemon's posture is untouched.
 *
 * Returns {ok, status, body, error}. A rejected fetch surfaces as ok:false with the
 * REASON, because the old code tested `resp.status === 0` for "CORS blocked" and a CORS
 * failure rejects the promise instead of returning a response — that branch never ran.
 */
async function roomFetch(url, headers) {
  try {
    return await chrome.runtime.sendMessage({ type: "room-fetch", url, headers });
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
}

async function subscribeRoomStream() {
    roomState.connected = false;
    roomState.daemonHealthy = false;
    if (roomStatus) roomStatus.textContent = "Connecting...";

    try {
      roomState.streamAbortController = new AbortController();
      const since = roomState.lastSeq;
      const token = await getDaemonToken();

      const resp = await fetch(
        `${DAEMON_BASE}/rooms/${ROOM_ID}/stream?since=${since}`,
        {
          credentials: "include",
          signal: roomState.streamAbortController.signal,
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!resp.ok || !resp.body) {
        const statusText = resp.error ? resp.error : `HTTP ${resp.status}`;
        if (roomStatus) {
          roomStatus.textContent = `Stream unavailable (${statusText})`;
          roomStatus.style.color = "#d32f2f";
        }
        schedulePoll();
        return;
      }

      roomState.connected = true;
      roomState.daemonHealthy = true;
      if (roomStatus) {
        roomStatus.textContent = `Connected (${DAEMON_BASE})`;
        roomStatus.style.color = "inherit";
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue;
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5).trim());
              roomState.lastSeq = Math.max(roomState.lastSeq, event.seq || 0);
              addEventToPillar(event);
            } catch { /* malformed JSON */ }
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const errorMsg = e.message || "unknown error";
        if (roomStatus) {
          roomStatus.textContent = `Stream failed: ${errorMsg} — polling`;
          roomStatus.style.color = "#d32f2f";
        }
        roomState.daemonHealthy = false;
        schedulePoll();
      }
    }
  }

  async function getDaemonToken() {
    try {
      const data = await chrome.storage.local.get("aither_daemon_token");
      return data.aither_daemon_token || "tok";
    } catch {
      return "tok";
    }
  }

  function addEventToPillar(event) {
    // Resolve pillar using the generated vocabulary, defaulting to intent
    const pillar = event.pillar || window.pillarFor(event.type) || "intent";
    if (!roomState.pillars[pillar]) {
      roomState.pillars[pillar] = [];
    }

    const entry = {
      type: event.type,
      actor: event.actor?.name || event.actor?.id || "?",
      payload: event.payload || {},
      seq: event.seq,
    };

    roomState.pillars[pillar].unshift(entry);
    if (roomState.pillars[pillar].length > MAX_EVENTS_PER_PILLAR) {
      roomState.pillars[pillar].pop();
    }

    renderPillars();
  }

  function renderPillars() {
    // Use generated PILLARS array — this is the source of truth
    for (const pillarName of window.PILLARS) {
      const laneEl = roomPillars?.querySelector(`[data-pillar="${pillarName}"]`);
      if (!laneEl) {
        // Lane element not in DOM, but pillar may receive events at runtime
        continue;
      }

      const eventsEl = laneEl.querySelector(".pillar-events");
      if (!eventsEl) continue;

      const events = roomState.pillars[pillarName] || [];
      if (events.length === 0) {
        // Show a visual indicator when the lane is empty
        const indicator = roomState.daemonHealthy ? "—" : "⚠ offline";
        eventsEl.innerHTML = `<div class="pillar-event empty">${indicator}</div>`;
        continue;
      }

      eventsEl.innerHTML = events
        .map(
          (e) =>
            `<div class="pillar-event" title="${escapeHtml(
              e.type
            )} from ${escapeHtml(
              e.actor
            )}"><strong>${escapeHtml(e.type)}</strong> @ ${escapeHtml(
              e.actor
            )}</div>`
        )
        .join("");
    }
  }

  function schedulePoll() {
    if (roomState.pollTimeout) clearTimeout(roomState.pollTimeout);
    roomState.pollTimeout = setTimeout(pollRoomState, 5000);
  }

  async function pollRoomState() {
    try {
      const resp = await fetch(
        `${DAEMON_BASE}/rooms/${ROOM_ID}/events?since=${roomState.lastSeq}&limit=10`,
        {
          credentials: "include",
          headers: { Authorization: `Bearer ${await getDaemonToken()}` },
        }
      );
      if (!resp.ok) {
        if (roomStatus) roomStatus.textContent = "Polling (unreachable)";
        schedulePoll();
        return;
      }

      const data = await resp.json();
      const events = data.events || [];
      roomState.lastSeq = data.last_seq || roomState.lastSeq;

      for (const event of events) {
        addEventToPillar(event);
      }

      if (roomStatus)
        roomStatus.textContent = `Polling (${events.length} new)`;
      schedulePoll();
    } catch {
      if (roomStatus) roomStatus.textContent = "Polling (error)";
      schedulePoll();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Tab integration ────────────────────────────────────────────

  const navTabs = document.getElementById("nav-tabs");
  if (navTabs) {
    const roomTab = navTabs.querySelector('[data-panel="room"]');
    if (roomTab) {
      // Start streaming when room tab is first clicked
      roomTab.addEventListener("click", () => {
        if (!roomState.connected && !roomState.streamAbortController) {
          subscribeRoomStream();
        }
      });
    }
  }

  // Initial render
  renderPillars();
})();
