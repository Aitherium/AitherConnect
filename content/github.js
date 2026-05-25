// GitHub Harvester
console.log("[AitherConnect] GitHub module loaded");

function scrapeGitHub() {
    let source = "github";
    let content = "";
    let metadata = {};

    // Repo check
    const repoHeader = document.querySelector('[data-pjax="#js-repo-pjax-container"]');
    if (repoHeader) {
        metadata.repo = repoHeader.innerText.trim();
    }

    // Issue / PR
    if (window.location.pathname.includes("/issues/") || window.location.pathname.includes("/pull/")) {
        const title = document.querySelector('.js-issue-title');
        const body = document.querySelector('.comment-body');
        
        if (title) {
            content += `Title: ${title.innerText.trim()}\n`;
            metadata.title = title.innerText.trim();
        }
        if (body) {
            content += `Body: ${body.innerText.trim()}\n`;
        }

        const comments = document.querySelectorAll('.timeline-comment-group .comment-body');
        if (comments.length > 0) {
            content += "\nComments:\n" + Array.from(comments).map(c => c.innerText.trim()).join("\n---\n");
        }
    } 
    // Code blob
    else if (window.location.pathname.includes("/blob/")) {
        const rawButton = document.querySelector('#raw-url');
        if (rawButton) {
           // We might not want to scrape full code text here to avoid massive payloads, 
           // maybe just metadata that we are looking at this file.
           content = `Viewing file: ${window.location.pathname}\n`;
        }
        const textArea = document.querySelector('textarea[id="read-only-cursor-text-area"]');
        if (textArea) {
             content += textArea.value.substring(0, 10000); // Grab snippet
        }
    }

    if (content.length > 0 || Object.keys(metadata).length > 0) {
        chrome.runtime.sendMessage({
            type: "HARVEST_DATA",
            source: source,
            content: content || "Metadata capture",
            metadata: {
                url: window.location.href,
                ...metadata
            }
        });
    }
}

// Handle PJAX navigation
document.addEventListener('pjax:end', scrapeGitHub);
setTimeout(scrapeGitHub, 3000);
