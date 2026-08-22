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

  // ── Access requests (A2A permission cards) ───────────────────
  // A federated agent is blocked RIGHT NOW waiting on a decision here. The
  // portal tray and `adk approvals` show the same cards from the same store,
  // so deciding in any one of them clears the others.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function renderApprovals() {
    const section = $('approvals-section');
    const list = $('approvals-list');
    if (!section || !list) return;

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'get-access-requests' });
    } catch {
      section.style.display = 'none';
      return;
    }
    // Signed out or unreachable: stay hidden rather than showing a stale or
    // empty panel that implies "nothing is waiting" when we simply cannot see.
    if (!resp?.ok || !resp.cards?.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = resp.cards.map((c) => `
      <div class="appr-card" data-id="${esc(c.id)}">
        <div class="appr-agent">${esc(c.requesting_agent || 'agent')} <span style="font-weight:400;color:var(--text-muted)">· ${esc(c.requesting_tenant || 'unknown')}</span></div>
        <div class="appr-res">${esc(c.requested_resource || c.message || '')}</div>
        <div class="appr-why">${esc(c.message || '')}</div>
        <div class="appr-actions">
          <button class="appr-btn appr-approve" data-decision="approve">Approve</button>
          <button class="appr-btn appr-deny" data-decision="deny">Deny</button>
        </div>
        <div class="appr-out"></div>
      </div>
    `).join('');

    list.querySelectorAll('.appr-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.appr-card');
        const out = card.querySelector('.appr-out');
        const decision = btn.dataset.decision;
        card.querySelectorAll('.appr-btn').forEach((b) => { b.disabled = true; });
        out.innerHTML = '';

        const r = await chrome.runtime.sendMessage({
          type: 'decide-access-request', id: card.dataset.id, decision,
        }).catch((e) => ({ ok: false, error: String(e) }));

        // Keep the card on failure. Removing it would report success for a
        // decision that did not happen — and take away the only surface here
        // that could retry it.
        if (!r?.ok) {
          out.innerHTML = `<div class="appr-err">${esc(r?.error || 'Failed')}</div>`;
          card.querySelectorAll('.appr-btn').forEach((b) => { b.disabled = false; });
          return;
        }

        const token = r.result?.grant_token;
        if (token) {
          // Returned exactly once. Show it, or the approval is unusable.
          out.innerHTML = `<div class="appr-token">
            <span style="font-size:10px;color:var(--success)">Send back as X-A2A-Grant${r.result?.ttl_minutes ? ` (${esc(r.result.ttl_minutes)}m)` : ''}</span>
            <code>${esc(token)}</code>
          </div>`;
          card.querySelector('.appr-actions').style.display = 'none';
        } else {
          card.remove();
          if (!list.children.length) section.style.display = 'none';
        }
      });
    });
  }

  renderApprovals();

  // ── Decision Cards ───────────────────────────────────────────
  async function renderDecisions() {
    const section = $('decisions-section');
    const list = $('decisions-list');
    const errorDiv = $('decisions-error');
    const noTokenDiv = $('decisions-no-token');
    if (!section || !list) return;

    try {
      // Use GenesisAuth (from genesis-auth.js) to list open decisions.
      // GenesisAuth uses portal bearer authentication (from chrome.storage.session).
      if (typeof self.GenesisAuth === 'undefined') {
        // Try to get decisions via background message instead
        const resp = await chrome.runtime.sendMessage({ type: 'list-decisions' });
        if (!resp?.ok || !resp.decisions?.decisions?.length) {
          section.style.display = 'none';
          return;
        }
        renderDecisionCards(resp.decisions.decisions);
        section.style.display = '';
        errorDiv.style.display = 'none';
        noTokenDiv.style.display = 'none';
      } else {
        const data = await self.GenesisAuth.listDecisions('open');
        if (!data?.decisions?.length) {
          section.style.display = 'none';
          return;
        }
        renderDecisionCards(data.decisions);
        section.style.display = '';
        errorDiv.style.display = 'none';
        noTokenDiv.style.display = 'none';
      }
    } catch (e) {
      console.debug('[popup] decisions render failed:', e);
      // Check if it's a "not found" or unavailable error
      if (e.code === 'ENDPOINT_NOT_FOUND') {
        errorDiv.textContent = 'Decisions unavailable — Genesis is still loading';
        errorDiv.style.display = '';
        noTokenDiv.style.display = 'none';
      } else if (e.code === 'GENESIS_UNAVAILABLE') {
        errorDiv.textContent = 'Cannot reach Genesis — service offline or unreachable';
        errorDiv.style.display = '';
        noTokenDiv.style.display = 'none';
      } else if (String(e).includes('401')) {
        noTokenDiv.textContent = 'Sign in to your account to see pending decisions';
        noTokenDiv.style.display = '';
        errorDiv.style.display = 'none';
      } else {
        errorDiv.textContent = `Failed: ${e.message || String(e)}`;
        errorDiv.style.display = '';
        noTokenDiv.style.display = 'none';
      }
      section.style.display = '';
      list.innerHTML = '';
    }

    function renderDecisionCards(decisions) {
      list.innerHTML = decisions.map((card) => {
        const urgencyClass = card.urgency === 'critical' || card.urgency === 'high' ? card.urgency : '';
        const sourceInfo = [];
        if (card.source?.session_id) sourceInfo.push(card.source.session_id.slice(0, 8));
        if (card.source?.cwd) {
          const cwdBase = card.source.cwd.split(/[/\\]/).pop();
          if (cwdBase) sourceInfo.push(cwdBase);
        }
        const sourceStr = sourceInfo.length ? sourceInfo.join(' · ') : '';

        // Render options as buttons. Text is never truncated here (gate DC001).
        const optionsHtml = (card.options || []).map((opt) => `
          <button class="decision-opt-btn" data-card-id="${esc(card.id)}" data-choice="${esc(opt.key)}"
            title="${esc(opt.label)}">${esc(opt.label)}</button>
        `).join('');

        return `
          <div class="decision-card ${urgencyClass}" data-card-id="${esc(card.id)}">
            <div class="decision-title">${esc(card.title || 'Decision')}</div>
            <div class="decision-meta">
              ${card.urgency ? `<span class="decision-badge ${card.urgency === 'critical' || card.urgency === 'high' ? 'urgent' : ''}">${esc(card.urgency)}</span>` : ''}
              ${sourceStr ? `<span class="decision-badge">${esc(sourceStr)}</span>` : ''}
            </div>
            <div class="decision-options">${optionsHtml}</div>
            <div class="decision-feedback" style="font-size:10px;color:var(--error);margin-top:4px;display:none"></div>
          </div>
        `;
      }).join('');

      // Add click handlers to option buttons
      list.querySelectorAll('.decision-opt-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const cardId = btn.dataset.cardId;
          const choice = btn.dataset.choice;
          const card = btn.closest('.decision-card');
          const feedback = card?.querySelector('.decision-feedback');
          const allBtns = card?.querySelectorAll('.decision-opt-btn') || [];

          // Disable all buttons while submitting
          allBtns.forEach((b) => { b.disabled = true; });
          if (feedback) feedback.style.display = 'none';

          try {
            // Use GenesisAuth if available, else go through background
            let result;
            if (typeof self.GenesisAuth !== 'undefined') {
              result = await self.GenesisAuth.answerDecision(cardId, choice, '', 'awconnect');
            } else {
              const r = await chrome.runtime.sendMessage({
                type: 'answer-decision',
                cardId,
                choice,
                via: 'awconnect',
              });
              result = r;
            }

            if (result?.status === 'error' || !result?.ok) {
              if (feedback) {
                feedback.textContent = result?.error || 'Failed to submit';
                feedback.style.display = '';
              }
              allBtns.forEach((b) => { b.disabled = false; });
              return;
            }

            // Success: remove the card (or show success)
            card?.remove();
            if (!list.children.length) section.style.display = 'none';
            showFeedback('Decision submitted', 'success', 2000);
          } catch (err) {
            if (feedback) {
              feedback.textContent = String(err.message || err);
              feedback.style.display = '';
            }
            allBtns.forEach((b) => { b.disabled = false; });
          }
        });
      });
    }
  }

  renderDecisions();

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

  // ── 1b. Account / plan + available features ─────────────────
  // After portal sign-in the user lands here with their tier + feature set.
  // Reuses the shared license/gating layer (no new feature list invented).
  async function renderEntitlement() {
    const emailEl = $('account-email');
    const subEl = $('account-sub');
    const iconEl = $('account-icon');
    const badgeEl = $('tier-badge');
    const featsRow = $('feats-row');
    if (!emailEl || !badgeEl) return;

    let lic = { ok: false, tier: 'free' };
    try {
      if (self.AitherLicense?.getStoredLicense) {
        lic = await self.AitherLicense.getStoredLicense();
      }
    } catch { /* fall back to free */ }

    const tier = (lic.tier || 'free').toLowerCase();
    const signedIn = !!(lic.email || (lic.source && lic.source !== 'local'));

    badgeEl.textContent = tier.toUpperCase();
    badgeEl.className = `tier-badge ${['free', 'trial', 'pro'].includes(tier) ? tier : 'free'}`;

    if (signedIn) {
      iconEl.textContent = '✅';
      emailEl.textContent = lic.email || 'Signed in';
      subEl.textContent = tier === 'free'
        ? 'Manage plan & upgrade'
        : `${tier === 'pro' ? 'Pro' : 'Trial'} plan · manage account`;
    } else {
      iconEl.textContent = '👤';
      emailEl.textContent = 'Sign in to your apps';
      subEl.textContent = 'portal.aitherium.com — unlock your features';
    }

    // Feature availability for this tier (from the shared gating map).
    try {
      const feats = self.AitherGating?.FEATURES ? Object.keys(self.AitherGating.FEATURES) : [];
      if (feats.length && signedIn) {
        const pills = await Promise.all(feats.map(async (f) => {
          let on = false;
          try { on = (await self.AitherGating.checkGate(f)).allowed; } catch { /* default off */ }
          const label = f.replace(/_/g, ' ');
          return `<span class="feat-pill ${on ? 'on' : 'off'}">${on ? '✓' : '🔒'} ${label}</span>`;
        }));
        featsRow.innerHTML = pills.join('');
        featsRow.style.display = 'flex';
      } else {
        featsRow.style.display = 'none';
      }
    } catch { featsRow.style.display = 'none'; }
  }

  // Clicking the account bar opens Settings (portal sign-in + plan management).
  $('account-bar').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  renderEntitlement();
  // Kick a refresh of the authenticated entitlement, then re-render once it lands.
  chrome.runtime.sendMessage({ type: 'pull-entitlement' })
    .then(() => renderEntitlement())
    .catch(() => {});
  // Also re-render if the background broadcasts a fresh entitlement.
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === 'entitlement-updated') renderEntitlement();
  });

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

  // OS Over This Page — pull up the holographic Living OS over the current tab.
  $('btn-os-overlay').addEventListener('click', async () => {
    showFeedback('Pulling up the OS over this page...', 'info', 0);
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'toggle-overlay' });
      if (resp?.ok) {
        window.close();
      } else {
        showFeedback(resp?.error || 'OS overlay unavailable', 'error', 5000);
      }
    } catch (e) {
      showFeedback('Error: ' + e.message, 'error', 5000);
    }
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

  // ── 4b. Session Capture (HAR) ───────────────────────────────
  const harIdle = $('har-idle');
  const harRecording = $('har-recording');
  const harDone = $('har-done');
  let harPollTimer = null;

  function harShow(state) {
    harIdle.style.display = state === 'idle' ? 'block' : 'none';
    harRecording.style.display = state === 'recording' ? 'block' : 'none';
    harDone.style.display = state === 'done' ? 'block' : 'none';
    if (state !== 'recording' && harPollTimer) { clearInterval(harPollTimer); harPollTimer = null; }
  }

  async function harRefresh() {
    try {
      const s = await chrome.runtime.sendMessage({ type: 'har-capture-status' });
      if (!s?.ok) return;
      if (s.active) {
        $('har-count').textContent = s.entryCount;
        harShow('recording');
        if (!harPollTimer) {
          harPollTimer = setInterval(async () => {
            const st = await chrome.runtime.sendMessage({ type: 'har-capture-status' }).catch(() => null);
            if (st?.active) $('har-count').textContent = st.entryCount; else harRefresh();
          }, 1000);
        }
      } else if (s.hasCapture) {
        harShow('done');
      } else {
        harShow('idle');
      }
    } catch { /* SW unreachable — leave idle */ }
  }

  $('btn-har-start').addEventListener('click', async () => {
    const redact = $('har-redact').checked;
    const r = await chrome.runtime.sendMessage({ type: 'har-capture-start', redact });
    if (r?.ok) { harShow('recording'); harRefresh(); }
    else { showFeedback(r?.error || 'Could not start capture', 'error', 5000); }
  });

  $('btn-har-stop').addEventListener('click', async () => {
    const r = await chrome.runtime.sendMessage({ type: 'har-capture-stop' });
    if (r?.ok) {
      $('har-done-count').textContent = r.entryCount;
      $('har-trunc').textContent = r.truncated ? ' (capped — very large session)' : '';
      harShow('done');
    }
  });

  async function harSend(destination) {
    showFeedback('Uploading capture…', 'info', 0);
    const r = await chrome.runtime.sendMessage({ type: 'har-upload', destination });
    if (r?.ok) {
      showFeedback(destination === 'aitherium'
        ? 'Sent to Aitherium (encrypted). Thank you!'
        : 'Saved to your workspace vault.', 'success', 4000);
      harShow('idle');
    } else {
      showFeedback(r?.error || 'Upload failed', 'error', 6000);
    }
  }
  $('btn-har-send-aitherium').addEventListener('click', () => harSend('aitherium'));
  $('btn-har-send-workspace').addEventListener('click', () => harSend('workspace'));
  $('btn-har-discard').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'har-capture-stop' }).catch(() => {});
    harShow('idle');
    showFeedback('Capture discarded', 'info', 2000);
  });

  harRefresh();

  // ── 5. Get AitherOS Products ────────────────────────────────
  const PRODUCT_URLS = {
    'btn-get-aitheros':      'https://github.com/Aitherium/AitherOS/releases/latest',
    'btn-get-aithershell':   'https://pypi.org/project/aithershell/',
    'btn-get-awnode':    'https://pypi.org/project/awnode/',
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

  // ── X session sync: hand this browser's own logged-in X session to the fleet
  //    so Aither can post as the account. No password is read or sent. ──
  const xBtn = $('btn-x-sync');
  const xStatus = $('x-sync-status');
  if (xBtn) {
    xBtn.addEventListener('click', async () => {
      xBtn.disabled = true;
      xStatus.textContent = 'Reading your X session and verifying it in a browser…';
      xStatus.style.color = '#94a3b8';
      let resp;
      try {
        resp = await chrome.runtime.sendMessage({ type: 'x-session-sync' });
      } catch (e) {
        resp = { ok: false, error: e.message };
      }
      if (resp && resp.ok) {
        xStatus.style.color = '#10b981';
        xStatus.textContent = `Synced. Aither can now post as @${resp.handle || 'your account'} `
          + `(${resp.cookieCount} cookies). Flip x_autopost.enabled to go live.`;
      } else if (resp && resp.needsManualImport && resp.storageState) {
        // The route is not reachable through the bridge yet (Genesis not rebuilt).
        // Download the verified-by-you session so it can be imported via the
        // worker path: `adk x-session import --state <downloaded file>`.
        try {
          const blob = new Blob([JSON.stringify(resp.storageState)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          await chrome.downloads.download({ url, filename: 'x_session_state.json', saveAs: true });
          xStatus.style.color = '#f59e0b';
          xStatus.innerHTML = 'Saved <b>x_session_state.json</b>. Finish with:<br>'
            + '<code style="font-size:10px">adk x-session import --state x_session_state.json</code>';
        } catch (e) {
          xStatus.style.color = '#ef4444';
          xStatus.textContent = `Could not save the session file: ${e.message}`;
        }
      } else {
        xStatus.style.color = '#ef4444';
        xStatus.textContent = (resp && resp.error) || 'Sync failed — are you logged in to x.com?';
      }
      xBtn.disabled = false;
    });
  }
});
