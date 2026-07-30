/**
 * CORS spike test runner for AitherConnect providers.
 *
 * Tests network connectivity and CORS headers for each provider.
 * Verdict: PASS (HTTP response), BLOCKED (CORS error), ERROR (timeout/network)
 */

(function () {
  "use strict";

  // Wait for AitherProviders to be available
  const waitForProviders = () => {
    return new Promise((resolve) => {
      const check = () => {
        if (typeof self !== "undefined" && self.AitherProviders) {
          resolve(self.AitherProviders);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  };

  // Default test keys shaped like real ones (but invalid)
  const DEFAULT_KEYS = {
    anthropic: "sk-ant-invalid1234567890abcdefghijklmnopqrstuvwxyz",
    openai: "sk-invalid1234567890abcdefghijklmnopqrstuvwxyz",
    openrouter: "sk-or-v1-invalid1234567890abcdefghijklmnopqrstuvwxyz",
    gemini: "AIzainvalid1234567890abcdefghijklmnopqrstuvwxyz",
    ollama: "", // Ollama doesn't use keys
  };

  // State: { provider => { enabled, key, baseUrl } }
  const state = {};

  // Results: { provider => { outcome, status, verdict, latency } }
  const results = {};

  /**
   * Initialize the provider checkboxes and key inputs.
   */
  async function initProviders() {
    const providers = await waitForProviders();
    const container = document.getElementById("providers");
    container.innerHTML = "";

    const providerList = providers.listProviders().filter((id) => id !== "custom");

    providerList.forEach((id) => {
      const provider = providers.getProvider(id);
      if (!provider) return;

      state[id] = {
        enabled: false,
        key: DEFAULT_KEYS[id] || "",
        baseUrl: provider.baseUrl || "",
      };

      const keyLabel = provider.keyPlaceholder || "API Key";
      const note = provider.needsOriginsHelp
        ? `Note: Requires OLLAMA_ORIGINS env var. Extension ID: ${chrome.runtime.id}`
        : "";

      const row = document.createElement("div");
      row.className = "provider-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `provider-${id}`;
      checkbox.dataset.provider = id;
      checkbox.checked = false;
      checkbox.addEventListener("change", (e) => {
        state[id].enabled = e.target.checked;
      });

      const label = document.createElement("label");
      label.className = "provider-name";
      label.htmlFor = `provider-${id}`;
      label.textContent = provider.name;

      const keyContainer = document.createElement("div");
      keyContainer.className = "provider-key";

      const keyInput = document.createElement("input");
      keyInput.type = "text";
      keyInput.placeholder = keyLabel;
      keyInput.value = state[id].key;
      keyInput.dataset.provider = id;
      keyInput.addEventListener("input", (e) => {
        state[id].key = e.target.value;
      });

      keyContainer.appendChild(keyInput);

      row.appendChild(checkbox);
      row.appendChild(label);
      row.appendChild(keyContainer);

      if (note) {
        const noteEl = document.createElement("div");
        noteEl.className = "ollama-hint";
        noteEl.textContent = note;
        row.appendChild(noteEl);
      }

      container.appendChild(row);
    });
  }

  /**
   * Run CORS tests for enabled providers.
   */
  async function runTests() {
    const providers = await waitForProviders();
    const runBtn = document.getElementById("runBtn");
    const resultsBody = document.getElementById("resultsBody");

    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner"></span> Testing...';

    resultsBody.innerHTML = ""; // Clear previous results

    const enabledProviders = Object.entries(state)
      .filter(([, cfg]) => cfg.enabled)
      .map(([id]) => id);

    if (enabledProviders.length === 0) {
      resultsBody.innerHTML =
        '<tr><td colspan="6" style="text-align: center; color: #666;">Select at least one provider to test</td></tr>';
      runBtn.disabled = false;
      runBtn.textContent = "Run Tests";
      return;
    }

    for (const id of enabledProviders) {
      const cfg = state[id];
      const result = await testProvider(providers, id, cfg);
      results[id] = result;

      const row = document.createElement("tr");

      const provider = providers.getProvider(id);
      const endpoint = provider.baseUrl + (provider.chatPath || "");

      const cells = [
        { text: provider.name },
        { text: endpoint, style: "font-family: monospace; font-size: 11px;" },
        { text: result.outcome },
        { text: result.status || "—" },
        {
          html: `<span class="verdict-badge verdict-${result.verdict.toLowerCase()}">${result.verdict}</span>`,
        },
        { text: result.latency ? `${result.latency}ms` : "—" },
      ];

      cells.forEach((cell) => {
        const td = document.createElement("td");
        if (cell.html) {
          td.innerHTML = cell.html;
        } else {
          td.textContent = cell.text;
        }
        if (cell.style) {
          td.style.cssText = cell.style;
        }
        row.appendChild(td);
      });

      resultsBody.appendChild(row);
    }

    runBtn.disabled = false;
    runBtn.textContent = "Run Tests";
  }

  /**
   * Test a single provider's connectivity.
   *
   * @param {object} providers - AitherProviders module
   * @param {string} id - Provider ID
   * @param {object} cfg - { key, baseUrl }
   * @returns {object} { outcome, status, verdict, latency }
   */
  async function testProvider(providers, id, cfg) {
    const startTime = performance.now();

    try {
      const provider = providers.getProvider(id);
      if (!provider) {
        return {
          outcome: "Unknown provider",
          status: null,
          verdict: "ERROR",
          latency: 0,
        };
      }

      // Build test request
      const testReq = buildTestRequest(providers, id, cfg);
      if (testReq.error) {
        return {
          outcome: testReq.error,
          status: null,
          verdict: "ERROR",
          latency: 0,
        };
      }

      // Fetch with 10s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(testReq.url, {
        method: "POST",
        headers: testReq.headers,
        body: testReq.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);

      let outcome;
      let verdict = "PASS"; // Any HTTP response = CORS open

      if (response.status === 401) {
        outcome = "401 Unauthorized (expected with invalid key)";
      } else if (response.status === 403) {
        outcome = "403 Forbidden";
      } else if (response.status >= 500) {
        outcome = `${response.status} Server Error`;
      } else {
        outcome = `${response.status} HTTP Response`;
      }

      return {
        outcome,
        status: response.status,
        verdict,
        latency,
      };
    } catch (err) {
      const latency = Math.round(performance.now() - startTime);

      let outcome = err.message;
      let verdict = "BLOCKED";

      if (err.name === "AbortError") {
        outcome = "Timeout (>10s)";
        verdict = "ERROR";
      } else if (err.message.includes("Failed to fetch")) {
        outcome = "Failed to fetch (CORS blocked or network error)";
        verdict = "BLOCKED";
      } else if (err.message.includes("ERR_NAME_NOT_RESOLVED")) {
        outcome = "DNS resolution failed";
        verdict = "ERROR";
      }

      return {
        outcome,
        status: null,
        verdict,
        latency,
      };
    }
  }

  /**
   * Build a test request using providers.buildTestRequest or manual construction.
   */
  function buildTestRequest(providers, id, cfg) {
    try {
      if (providers.buildTestRequest) {
        return providers.buildTestRequest(id, {
          apiKey: cfg.key,
          baseUrlOverride: cfg.baseUrl,
        });
      }
    } catch (e) {
      // Fall back to manual construction if buildTestRequest fails
    }

    // Manual construction fallback
    const provider = providers.getProvider(id);
    const headers = new Headers({
      "Content-Type": "application/json",
    });

    if (provider.authStyle === "bearer" && cfg.key) {
      headers.set("Authorization", `Bearer ${cfg.key}`);
    } else if (cfg.key && provider.authStyle !== "none") {
      // Anthropic uses x-api-key
      const authHeader = id === "anthropic" ? "x-api-key" : "Authorization";
      headers.set(authHeader, cfg.key);
    }

    // Add extra headers (e.g., for Anthropic browser access)
    if (provider.extraHeaders) {
      Object.entries(provider.extraHeaders).forEach(([k, v]) => {
        headers.set(k, v);
      });
    }

    const body = JSON.stringify({
      model: provider.defaultModel || (provider.models && provider.models[0]) || "test",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 100,
    });

    return {
      url: (cfg.baseUrl || provider.baseUrl) + (provider.chatPath || ""),
      headers,
      body,
    };
  }

  /**
   * Clear all results from the table.
   */
  function clearResults() {
    const resultsBody = document.getElementById("resultsBody");
    resultsBody.innerHTML =
      '<tr><td colspan="6" class="status-pending" style="text-align: center;">Run tests to see results</td></tr>';
    Object.keys(results).forEach((key) => delete results[key]);
  }

  /**
   * Generate markdown table from results.
   */
  function generateMarkdown() {
    const providers = Object.keys(results).sort();

    let md = "| Provider | Enabled | Result | Verdict | Latency (ms) | Date | Notes |\n";
    md += "|----------|---------|--------|---------|--------------|------|-------|\n";

    providers.forEach((id) => {
      const r = results[id];
      const provider = document.querySelector(`[data-provider="${id}"]`);
      const enabled = provider ? provider.checked : false;
      const date = new Date().toISOString().split("T")[0];

      md += `| ${id} | ${enabled ? "Yes" : "No"} | ${r.outcome} | ${r.verdict} | ${r.latency || "—"} | ${date} | |\n`;
    });

    return md;
  }

  /**
   * Copy results as markdown to clipboard.
   */
  async function copyMarkdown() {
    const md = generateMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      const feedback = document.getElementById("copyFeedback");
      feedback.textContent = "✓ Copied to clipboard!";
      feedback.style.display = "block";
      setTimeout(() => {
        feedback.style.display = "none";
      }, 2000);
    } catch (err) {
      alert("Failed to copy: " + err.message);
    }
  }

  /**
   * Initialize event listeners and UI.
   */
  async function init() {
    await initProviders();

    document.getElementById("runBtn").addEventListener("click", runTests);
    document.getElementById("clearBtn").addEventListener("click", clearResults);
    document.getElementById("copyBtn").addEventListener("click", copyMarkdown);
  }

  // Start when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
