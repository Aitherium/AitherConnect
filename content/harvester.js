// AitherConnect — Auto-harvester (runs on all pages)
// Captures page content for knowledge base ingestion when enabled.
(function() {
  function harvest() {
    const payload = {
      type: "HARVEST_DATA",
      source: "generic_web",
      content: document.body.innerText.substring(0, 50000),
      metadata: {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname,
        path: window.location.pathname,
        captured_at: new Date().toISOString(),
      }
    };
    chrome.runtime.sendMessage(payload);
  }

  // Check if auto-harvest is enabled before firing
  chrome.storage.local.get("aither_settings", (data) => {
    const settings = data.aither_settings || {};
    if (settings.autoHarvest) {
      // Delay to let page finish rendering
      setTimeout(harvest, 3000);
    }
  });

  // Always listen for manual triggers from background/sidepanel
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "snapshot") {
      harvest();
      sendResponse({ status: "harvested" });
    }
  });
})();
