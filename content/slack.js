// Slack-specific harvester
console.log("[AitherConnect] Slack module loaded");

function scrapeSlack() {
    // Attempt to find messages in the current view
    // Classes change frequently, relying on accessible roles
    const messages = Array.from(document.querySelectorAll('[role="listitem"]'))
        .map(el => el.innerText)
        .join("\n---\n");

    if (messages.length > 0) {
        chrome.runtime.sendMessage({
            type: "HARVEST_DATA",
            source: "slack",
            content: messages,
            metadata: {
                team: window.location.host.split('.')[0],
                channel: window.location.pathname
            }
        });
    }
}

// Observe DOM changes to capture new messages? 
// For now, just run once on load + interval
setInterval(scrapeSlack, 30000); // Poll every 30s
setTimeout(scrapeSlack, 5000);
