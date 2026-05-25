// Atlassian (Jira/Confluence) Harvester
console.log("[AitherConnect] Atlassian module loaded");

function scrapeAtlassian() {
    let source = "atlassian_generic";
    let content = "";
    let data = {};

    if (window.location.host.includes("jira")) {
        source = "jira";
        // Try to find issue details
        const summary = document.querySelector('h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]');
        const description = document.querySelector('[data-test-id="issue.views.issue-base.foundation.description.description-field-content"]');
        
        if (summary) {
            content += `Title: ${summary.innerText}\n`;
            data.title = summary.innerText;
        }
        if (description) {
            content += `Description: ${description.innerText}\n`;
        }

        // Comments
        const comments = document.querySelectorAll('[data-test-id="issue.activity.comment"]');
        if (comments.length > 0) {
            content += "\nComments:\n" + Array.from(comments).map(c => c.innerText).join("\n---\n");
        }

    } else if (window.location.pathname.includes("/wiki/")) {
        source = "confluence";
        // Try to find page title and body
        const title = document.querySelector('h1[data-test-id="renderer.title"]');
        const body = document.querySelector('[data-test-id="renderer-content"]');

        if (title) {
            content += `Page: ${title.innerText}\n`;
            data.title = title.innerText;
        }
        if (body) {
            content += body.innerText;
        }
    }

    if (content.length > 0) {
        chrome.runtime.sendMessage({
            type: "HARVEST_DATA",
            source: source,
            content: content,
            metadata: {
                url: window.location.href,
                ...data
            }
        });
    }
}

// Poll for changes (SPA navigation)
let lastUrl = location.href; 
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(scrapeAtlassian, 2000);
  }
}).observe(document, {subtree: true, childList: true});

setTimeout(scrapeAtlassian, 5000);
