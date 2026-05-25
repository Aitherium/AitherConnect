/**
 * AitherConnect Text Actions — Floating Action Menu
 * ===================================================
 *
 * Injects a floating action menu when the user selects text on any page.
 * Provides quick prompts (Analyze, Summarize, Explain, Review, Translate)
 * and sends the selected text + chosen action to the AitherConnect sidepanel.
 *
 * Author: AitherZero
 */

(() => {
  "use strict";

  // ── Guard against double injection ──
  if (window.__aitherTextActionsLoaded) return;
  window.__aitherTextActionsLoaded = true;

  // ── Constants ──
  const MIN_SELECTION_LENGTH = 3;
  const MENU_DISMISS_DELAY = 150;
  const MENU_ID = "aither-text-actions-menu";

  // ── Action definitions ──
  const TEXT_ACTIONS = [
    { id: "analyze",   icon: "\uD83D\uDD0D", label: "Analyze",   prompt: "Analyze this text in detail. Identify key themes, arguments, claims, and any notable patterns or issues:" },
    { id: "summarize", icon: "\uD83D\uDCDD", label: "Summarize", prompt: "Provide a concise summary of the following text, capturing the key points:" },
    { id: "explain",   icon: "\uD83D\uDCA1", label: "Explain",   prompt: "Explain this text in simple, clear terms. Break down any complex concepts:" },
    { id: "review",    icon: "\u2696\uFE0F",  label: "Review",    prompt: "Review this text for accuracy, clarity, tone, and potential issues. Provide constructive feedback:" },
    { id: "extract",   icon: "\uD83D\uDCCB", label: "Extract",   prompt: "Extract all key facts, data points, names, dates, and actionable items from this text:" },
    { id: "remember",  icon: "\uD83D\uDCBE", label: "Remember",  prompt: "Store this in memory" },
    { id: "forge",     icon: "\u26A1",       label: "Forge",     prompt: "Send to Forge agent for processing" },
    { id: "add-to-deck", icon: "\uD83D\uDCC4", label: "Add to Deck", prompt: "Add selected text as a content block" },
  ];

  // ── State ──
  let menuEl = null;
  let dismissTimer = null;

  // ── Toast notification helper ──
  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = "aither-toast";
    toast.dataset.type = type;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.classList.add("visible"); });
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ── Inject styles ──
  const style = document.createElement("style");
  style.textContent = `
    .aither-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      z-index: 2147483647;
      padding: 10px 20px;
      border-radius: 10px;
      background: #1a1a2e;
      border: 1px solid rgba(124, 111, 196, 0.5);
      color: #e0dff5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      backdrop-filter: blur(12px);
      opacity: 0;
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
    }
    .aither-toast.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .aither-toast[data-type="success"] { border-color: rgba(34,197,94,0.5); }
    .aither-toast[data-type="error"]   { border-color: rgba(239,68,68,0.5); }
    .aither-toast[data-type="info"]    { border-color: rgba(124,111,196,0.5); }
    #${MENU_ID} {
      position: absolute;
      z-index: 2147483647;
      display: flex;
      gap: 2px;
      padding: 4px;
      background: #1a1a2e;
      border: 1px solid rgba(124, 111, 196, 0.5);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(124,111,196,0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: aitherMenuFadeIn 0.15s ease-out;
      backdrop-filter: blur(12px);
      pointer-events: auto;
    }
    #${MENU_ID} button {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: #e0dff5;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
      line-height: 1;
    }
    #${MENU_ID} button:hover {
      background: rgba(124, 111, 196, 0.3);
      color: #fff;
    }
    #${MENU_ID} button:active {
      background: rgba(124, 111, 196, 0.5);
    }
    #${MENU_ID} .aither-action-icon {
      font-size: 14px;
      line-height: 1;
    }
    #${MENU_ID} .aither-sep {
      width: 1px;
      background: rgba(124, 111, 196, 0.3);
      margin: 2px 0;
    }
    #${MENU_ID} .aither-brand {
      display: flex;
      align-items: center;
      padding: 0 6px 0 4px;
      font-size: 10px;
      color: rgba(124, 111, 196, 0.7);
      font-weight: 600;
      letter-spacing: 0.5px;
      cursor: default;
      user-select: none;
    }
    @keyframes aitherMenuFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.documentElement.appendChild(style);

  // ── Build menu DOM ──
  function createMenu() {
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.setAttribute("role", "toolbar");
    menu.setAttribute("aria-label", "AitherConnect text actions");

    // Brand badge
    const brand = document.createElement("span");
    brand.className = "aither-brand";
    brand.textContent = "A";
    brand.title = "AitherConnect";
    menu.appendChild(brand);

    // Separator
    const sep = document.createElement("div");
    sep.className = "aither-sep";
    menu.appendChild(sep);

    // Action buttons
    TEXT_ACTIONS.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = action.label;
      btn.dataset.action = action.id;
      btn.innerHTML = `<span class="aither-action-icon">${action.icon}</span><span>${action.label}</span>`;

      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAction(action);
      });

      menu.appendChild(btn);
    });

    // Prevent menu clicks from clearing the selection
    menu.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    return menu;
  }

  // ── Show menu near selection ──
  function showMenu() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const text = selection.toString().trim();
    if (text.length < MIN_SELECTION_LENGTH) return;

    // Don't show inside inputs/textareas (contenteditable is fine)
    const anchor = selection.anchorNode;
    if (anchor) {
      const el = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
      if (el && (el.closest("input, textarea, [role='textbox']") && !el.closest("[contenteditable='true']"))) return;
    }

    // Get selection bounding rect
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    // Remove existing menu
    hideMenu();

    menuEl = createMenu();
    document.body.appendChild(menuEl);

    // Position above the selection, centered
    const menuRect = menuEl.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;

    let left = rect.left + scrollX + (rect.width / 2) - (menuRect.width / 2);
    let top = rect.top + scrollY - menuRect.height - 8;

    // If no room above, show below
    if (top - scrollY < 0) {
      top = rect.bottom + scrollY + 8;
    }

    // Clamp to viewport
    const vpWidth = document.documentElement.clientWidth;
    if (left < scrollX + 4) left = scrollX + 4;
    if (left + menuRect.width > scrollX + vpWidth - 4) {
      left = scrollX + vpWidth - menuRect.width - 4;
    }

    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
  }

  // ── Hide menu ──
  function hideMenu() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (menuEl) {
      menuEl.remove();
      menuEl = null;
    }
  }

  // ── Handle action button click ──
  function handleAction(action) {
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    if (!text) {
      hideMenu();
      return;
    }

    // Special handlers for memory and forge actions
    if (action.id === "remember") {
      showToast("💾 Saving to knowledge base…", "info");
      chrome.runtime.sendMessage({
        type: "knowledge-ingest",
        content: text,
        source: window.location.href,
        title: document.title,
        tags: ["text-action", "browser-highlight"],
        collection: "browser",
      }).then((resp) => {
        if (resp?.success) {
          showToast("✓ Saved to knowledge base", "success");
        } else {
          showToast("⚠ Could not save — AitherOS may be offline", "error");
        }
      }).catch(() => {
        showToast("⚠ Extension disconnected", "error");
      });
      hideMenu();
      selection.removeAllRanges();
      return;
    }

    if (action.id === "add-to-deck") {
      showToast("\uD83D\uDCC4 Adding to content deck\u2026", "info");
      chrome.runtime.sendMessage({
        type: "content-from-selection",
        slug: "draft",
        slideIndex: 0,
        element: {
          type: "text",
          tag: "p",
          content: text,
          classes: "body anim",
          style: "",
        },
      }).then((resp) => {
        if (resp?.success) {
          showToast("\u2713 Added to deck", "success");
        } else {
          showToast("\u26A0 Could not add \u2014 AitherOS may be offline", "error");
        }
      }).catch(() => {
        showToast("\u26A0 Extension disconnected", "error");
      });
      hideMenu();
      selection.removeAllRanges();
      return;
    }

    if (action.id === "forge") {
      showToast("⚡ Dispatching to Forge agent…", "info");
      chrome.runtime.sendMessage({
        type: "forge-dispatch",
        task: `Analyze and process: ${text}`,
        agent: "demiurge",
      }).then((resp) => {
        if (resp?.success) {
          showToast("✓ Forge agent is processing", "success");
        } else {
          showToast("⚠ Forge dispatch failed", "error");
        }
      }).catch(() => {
        showToast("⚠ Extension disconnected", "error");
      });
      hideMenu();
      selection.removeAllRanges();
      return;
    }

    const pageUrl = window.location.href;
    const pageTitle = document.title;

    // Send to background -> sidepanel (opens side panel for discussion)
    showToast(`🔍 ${action.label}ing — opening AitherConnect…`, "info");
    try {
      if (!chrome.runtime?.id) {
        // Extension was reloaded — this content script is orphaned
        showToast("⚠ Extension was reloaded — please refresh this page", "error");
        hideMenu();
        return;
      }
      chrome.runtime.sendMessage({
        type: "text-action",
        action: action.id,
        prompt: action.prompt,
        text: text,
        source: pageUrl,
        title: pageTitle,
      }).catch(() => {
        showToast("⚠ Extension context lost — please refresh this page", "error");
      });
    } catch (e) {
      showToast("⚠ Extension was reloaded — please refresh this page", "error");
    }

    hideMenu();
    // Clear selection so the user knows it was captured
    selection.removeAllRanges();
  }

  // ── Selection change listener ──
  let selectionCheckTimer = null;

  document.addEventListener("mouseup", (e) => {
    // Don't trigger if clicking inside the menu
    if (menuEl && menuEl.contains(e.target)) return;

    // Small delay to let the browser finalize the selection
    clearTimeout(selectionCheckTimer);
    selectionCheckTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : "";
      if (text.length >= MIN_SELECTION_LENGTH) {
        showMenu();
      } else {
        hideMenu();
      }
    }, 80);
  });

  // Dismiss on click elsewhere, scroll, or escape
  document.addEventListener("mousedown", (e) => {
    if (menuEl && !menuEl.contains(e.target)) {
      dismissTimer = setTimeout(hideMenu, MENU_DISMISS_DELAY);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl) {
      hideMenu();
    }
  });

  // Hide on scroll (with debounce so small scrolls during selection don't dismiss)
  let scrollDismissTimer = null;
  window.addEventListener("scroll", () => {
    if (!menuEl) return;
    clearTimeout(scrollDismissTimer);
    scrollDismissTimer = setTimeout(hideMenu, 200);
  }, { passive: true });

  // ── Message listener for external triggers ──
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true, script: "text-actions" });
      return;
    }

    if (msg.action === "get-selection") {
      const sel = window.getSelection();
      sendResponse({ text: sel ? sel.toString().trim() : "" });
      return;
    }
  });

  console.log("[AitherConnect] Text actions content script loaded");
})();
