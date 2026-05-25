document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme immediately
  if (typeof loadAndApplyTheme === 'function') {
    await loadAndApplyTheme();
  }

  const $ = (id) => document.getElementById(id);
  const statusDot = $('status-dot');
  const statusText = $('status-text');
  const servicesRow = $('services-row');
  const feedback = $('feedback');

  // Load connection settings to show configured URL
  try {
    const settingsResp = await chrome.runtime.sendMessage({ type: 'get-settings' });
    if (settingsResp?.ok && settingsResp.settings) {
      const s = settingsResp.settings;
      const label = $('veil-url-label');
      if (label) {
        if (s.remoteUrl) {
          label.textContent = new URL(s.remoteUrl).host;
        } else {
          const host = (s.baseUrl || 'http://localhost').replace(/^https?:\/\//, '');
          label.textContent = `${host}:${s.veilPort || 3000}`;
        }
      }
    }
  } catch { /* ignore */ }

  // ── Helper: show transient feedback message ──────────────────
  function showFeedback(msg, type = 'info', duration = 3000) {
    feedback.textContent = msg;
    feedback.className = `feedback show ${type}`;
    if (duration > 0) {
      setTimeout(() => { feedback.className = 'feedback'; }, duration);
    }
  }

  // ── 1. Get ecosystem status (detailed) ──────────────────────
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'get-ecosystem-status' });
    if (resp?.ok) {
      const up = resp.services.filter(s => s.status === 'up');
      const overall = resp.overallStatus || (up.length > 0 ? 'online' : 'offline');

      // Status dot + text
      statusDot.className = `status-dot ${overall}`;
      statusText.className = `status-text ${overall}`;
      if (overall === 'online') {
        statusText.textContent = `Ecosystem Online — ${up.length}/${resp.services.length} services`;
      } else if (overall === 'degraded') {
        statusText.textContent = `Degraded — ${up.length}/${resp.services.length} services`;
      } else {
        statusText.textContent = 'Ecosystem Offline';
      }

      // Service pills
      servicesRow.innerHTML = resp.services
        .map(s => `<span class="svc-pill ${s.status === 'up' ? 'up' : 'down'}">${s.name}</span>`)
        .join('');
    } else {
      throw new Error('No response');
    }
  } catch {
    // Fallback to basic status check
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'get-status' });
      if (resp?.status === 'online' || resp?.connected) {
        statusDot.className = 'status-dot online';
        statusText.className = 'status-text online';
        statusText.textContent = 'System Online';
      } else {
        statusDot.className = 'status-dot offline';
        statusText.className = 'status-text offline';
        statusText.textContent = 'System Offline';
      }
    } catch {
      statusDot.className = 'status-dot offline';
      statusText.className = 'status-text offline';
      statusText.textContent = 'Cannot reach service worker';
    }
  }

  // ── 2. Dashboard buttons ────────────────────────────────────
  $('btn-veil-local').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-veil-local' });
    window.close();
  });

  $('btn-veil-cloud').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-veil-cloud' });
    window.close();
  });

  // ── 3. Ecosystem buttons ────────────────────────────────────
  $('btn-desktop').addEventListener('click', async () => {
    showFeedback('Launching AitherDesktop...', 'info', 0);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'launch-desktop' });
      if (resp?.ok) {
        showFeedback(resp.message || 'AitherDesktop launched!', 'success');
      } else {
        showFeedback(resp?.message || 'Could not launch Desktop', 'error', 5000);
      }
    } catch (e) {
      showFeedback('Error: ' + e.message, 'error', 5000);
    }
  });

  $('btn-sidepanel').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-sidepanel' });
    window.close();
  });

  // Settings button — opens options page
  $('btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ── 4. Quick Actions ────────────────────────────────────────
  $('btn-harvest').addEventListener('click', async () => {
    showFeedback('Harvesting page...', 'info', 0);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        // First extract via agent context (structured data)
        chrome.runtime.sendMessage({ type: 'agent-context-push' });

        // Also trigger content script harvest
        chrome.tabs.sendMessage(tab.id, { action: 'snapshot' }, (response) => {
          if (response?.status === 'harvested') {
            showFeedback('Page harvested & sent to knowledge base!', 'success');
          } else {
            showFeedback('Harvest signal sent', 'success');
          }
        });
      } else {
        showFeedback('No active tab', 'error');
      }
    } catch (e) {
      showFeedback('Harvest error: ' + e.message, 'error');
    }
  });

  // ── 5. Get AitherOS Products ────────────────────────────────
  const PRODUCT_URLS = {
    'btn-get-aitheros':      'https://github.com/Aitherium/AitherOS/releases/latest',
    'btn-get-aithershell':   'https://pypi.org/project/aithershell/',
    'btn-get-aithernode':    'https://pypi.org/project/aithernode/',
    'btn-get-aitherdesktop': 'https://github.com/Aitherium/AitherOS/releases/latest',
  };

  Object.entries(PRODUCT_URLS).forEach(([btnId, url]) => {
    $(btnId).addEventListener('click', () => {
      chrome.tabs.create({ url });
      window.close();
    });
  });

  // ── 6. Connect shortcuts ───────────────────────────────────
  $('btn-tunnel').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://tunnel.aitherium.com' });
    window.close();
  });

  $('btn-irc').addEventListener('click', async () => {
    // Open sidepanel on IRC tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (chrome.sidePanel && tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
      // Brief delay then tell sidepanel to switch to IRC
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'switch-panel', panel: 'irc' }).catch(() => {});
      }, 400);
    } catch { /* ignore */ }
    window.close();
  });
});
