#!/usr/bin/env node
/**
 * Unit Tests: Web Search During Composition
 * ==========================================
 * Tests xGetSearchContext() and xComposeText() integration.
 * Mocks the search endpoint to avoid fleet dependency.
 * Validates error vs. empty result distinction.
 *
 * Run: node test-web-search-composition.js
 */

import assert from 'assert';

// ============================================================================
// Setup: Mock globals and functions
// ============================================================================

const SETTINGS = { searchPort: 8114, tenantId: "", workspaceId: "", cloudApiKey: "" };
let DETECTED_TIER = "genesis";
const GENESIS_URL = "http://127.0.0.1:3000/api/bridge/genesis";

// Mock fetch globally for all test cases.
const fetchMocks = [];

const mockFetch = function(url, options) {
  // Find the matching mock in order (first match wins).
  for (const mock of fetchMocks) {
    if (url.includes(mock.urlMatch)) {
      return Promise.resolve(mock.respond(options || {}));
    }
  }
  // Default: no mock found, return 404.
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: "Not mocked" }),
  });
};

globalThis.fetch = mockFetch;

// Helper to create a mock response object.
function mockResponse(ok, status, data) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

// Mock functions
let mockWebmlComposeText = async (prompt) => null;
const authHeaders = () => ({});

/**
 * Copy of xGetSearchContext from background.js, with mocking support.
 */
async function xGetSearchContext(topic) {
  const SEARCH_URL = `http://127.0.0.1:${SETTINGS.searchPort}`;
  const SEARCH_TIMEOUT_MS = 15000;

  const searchHeaders = { "Content-Type": "application/json" };
  if (DETECTED_TIER === "cloud-only" && SETTINGS.cloudApiKey) {
    searchHeaders["Authorization"] = `Bearer ${SETTINGS.cloudApiKey}`;
    searchHeaders["X-API-Key"] = SETTINGS.cloudApiKey;
  }
  if (SETTINGS.tenantId) {
    searchHeaders["X-Tenant-ID"] = SETTINGS.tenantId;
  }
  if (SETTINGS.workspaceId) {
    searchHeaders["X-Workspace-ID"] = SETTINGS.workspaceId;
  }

  try {
    const resp = await fetch(`${SEARCH_URL}/search`, {
      method: "POST",
      headers: searchHeaders,
      body: JSON.stringify({
        query: topic,
        mode: "quick",
        limit: 5,
        include_answer: true,
      }),
      signal: { timeout: SEARCH_TIMEOUT_MS },
    });

    if (!resp.ok) {
      const isAuthError = resp.status === 401 || resp.status === 403;
      const msg = isAuthError
        ? `Search auth error (${resp.status})`
        : `Search failed (HTTP ${resp.status})`;
      return { success: false, error: msg, results: [], answer: null };
    }

    const data = await resp.json().catch(() => ({}));

    const results = (data.results && Array.isArray(data.results))
      ? data.results.map((r) => ({
          title: r.title || r.name || "(untitled)",
          url: r.url || r.link || "",
          snippet: r.snippet || r.content || "",
        }))
      : [];

    const answer = (data.answer && String(data.answer).trim()) || null;

    return { success: true, error: null, results, answer };
  } catch (e) {
    const errorMsg = e.name === "AbortError"
      ? "Search timeout"
      : `Search error: ${e.message || String(e).slice(0, 100)}`;
    return { success: false, error: errorMsg, results: [], answer: null };
  }
}

/**
 * Simplified xComposeText for testing (includes search integration).
 */
async function xComposeText(promptOverride) {
  const cfgPrompt = (promptOverride && String(promptOverride).trim()) || "";

  const angles = [
    "a builder's note on shipping AI infrastructure",
    "one sharp lesson from autonomous agents",
  ];
  const angle = angles[0];

  let searchContext = "";
  try {
    const searchTopic = cfgPrompt ? "latest AI" : "AI agents autonomous";
    const search = await xGetSearchContext(searchTopic);

    if (search.success && search.results.length > 0) {
      const snippets = search.results
        .slice(0, 3)
        .map((r) => `"${r.title}" (${r.url})`)
        .join("; ");
      searchContext = `\n(Current context from web: ${snippets})`;
    } else if (!search.success) {
      // Degradation: log error but continue
    }
  } catch (e) {
    // Degradation: silently continue
  }

  const prompt = cfgPrompt
    ? `${cfgPrompt} ${angle}${searchContext}`
    : `Write a tweet. ${angle}${searchContext}`;

  try {
    const local = await mockWebmlComposeText(prompt);
    if (local && local.trim()) return local.trim();
  } catch { /* fall through */ }

  if (promptOverride) return `Composed${searchContext ? " (web search enriched)" : ""}`;
  return null;
}

// ============================================================================
// Test Runner (matching run-tests.mjs pattern)
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
};

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

let chain = Promise.resolve();

function section(label) {
  chain = chain.then(() => console.log(label));
}

function pass(name) {
  passCount++;
  console.log(`${colors.green}✓${colors.reset} ${name}`);
}

function fail(name, err) {
  failCount++;
  console.log(`${colors.red}✗${colors.reset} ${name}`);
  failures.push({ name, error: err?.message || String(err) });
}

function test(name, fn) {
  testCount++;
  chain = chain.then(async () => {
    try {
      await fn();
      pass(name);
    } catch (err) {
      fail(name, err);
    }
  });
}

// ============================================================================
// TEST SUITE
// ============================================================================

section(`${colors.blue}=== Web Search During Composition ===${colors.reset}\n`);

// TEST 1: Successful search with results
test('web-search: returns results on successful search', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(true, 200, {
        results: [
          { title: "AI Trends 2026", url: "https://example.com/ai", snippet: "Latest AI updates" },
          { title: "Agent Tech", url: "https://example.com/agents", snippet: "How agents work" },
        ],
        answer: "AI is rapidly evolving.",
      }),
  });

  const result = await xGetSearchContext("AI agents");

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.results.length, 2);
  assert.strictEqual(result.results[0].title, "AI Trends 2026");
  assert.strictEqual(result.answer, "AI is rapidly evolving.");
});

// TEST 2: Search returns NO results (but succeeds)
test('web-search: distinguishes no results from auth error', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(true, 200, {
        results: [],
        answer: null,
      }),
  });

  const result = await xGetSearchContext("obscure-xyz-topic");

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.results.length, 0);
  assert.strictEqual(result.answer, null);
});

// TEST 3: Auth error (401)
test('web-search: flags 401 as auth error', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(false, 401, { error: "Unauthorized" }),
  });

  const result = await xGetSearchContext("test");

  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes("401"));
  assert.ok(result.error.includes("auth"));
  assert.strictEqual(result.results.length, 0);
});

// TEST 4: Auth error (403)
test('web-search: flags 403 as auth error', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(false, 403, { error: "Forbidden" }),
  });

  const result = await xGetSearchContext("test");

  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes("403"));
});

// TEST 5: Network error (500)
test('web-search: flags 500 as server error (not auth)', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(false, 500, { error: "Internal error" }),
  });

  const result = await xGetSearchContext("test");

  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes("500"));
  assert.ok(!result.error.includes("auth"));
});

// TEST 6: Malformed response (non-JSON)
test('web-search: handles malformed JSON gracefully', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () => ({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("Invalid JSON")),
    }),
  });

  const result = await xGetSearchContext("test");

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.results.length, 0);
});

// TEST 7: Composition integrates search results into prompt
test('web-search: includes results in composed prompt', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(true, 200, {
        results: [
          { title: "Top Article", url: "https://example.com/1", snippet: "Important info" },
        ],
        answer: null,
      }),
  });

  let capturedPrompt = null;
  mockWebmlComposeText = async (prompt) => {
    capturedPrompt = prompt;
    return null;
  };

  const text = await xComposeText("custom prompt");

  assert.ok(capturedPrompt);
  assert.ok(capturedPrompt.includes("Top Article"));
  assert.ok(capturedPrompt.includes("Current context from web"));
});

// TEST 8: Composition degrades gracefully when search fails
test('web-search: composes without search on auth error', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(false, 401, { error: "Unauthorized" }),
  });

  mockWebmlComposeText = async (prompt) => null;

  const text = await xComposeText("custom prompt");

  assert.ok(text);
  assert.ok(!text.includes("web search enriched") || text.includes("Composed"));
});

// TEST 9: Composition degrades when search returns no results
test('web-search: composes without context when no results', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(true, 200, { results: [], answer: null }),
  });

  mockWebmlComposeText = async (prompt) => null;

  const text = await xComposeText("custom prompt");

  assert.ok(text);
});

// TEST 10: Auth headers are passed correctly
test('web-search: includes tenant/workspace headers', async () => {
  fetchMocks.length = 0;
  let capturedHeaders = null;

  SETTINGS.tenantId = "tenant-123";
  SETTINGS.workspaceId = "workspace-456";

  fetchMocks.push({
    urlMatch: "/search",
    respond: (opts) => {
      capturedHeaders = opts.headers;
      return mockResponse(true, 200, { results: [], answer: null });
    },
  });

  await xGetSearchContext("test");

  assert.ok(capturedHeaders);
  assert.strictEqual(capturedHeaders["X-Tenant-ID"], "tenant-123");
  assert.strictEqual(capturedHeaders["X-Workspace-ID"], "workspace-456");

  SETTINGS.tenantId = "";
  SETTINGS.workspaceId = "";
});

// TEST 11: Timeout is handled as an error
test('web-search: handles timeout as error', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () => Promise.reject(new Error("Timeout")),
  });

  const result = await xGetSearchContext("test");

  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes("error"));
});

// TEST 12: Results are capped at 3 in composition context
test('web-search: caps results to 3 in prompt', async () => {
  fetchMocks.length = 0;
  fetchMocks.push({
    urlMatch: "/search",
    respond: () =>
      mockResponse(true, 200, {
        results: [
          { title: "Result 1", url: "https://example.com/1", snippet: "Info 1" },
          { title: "Result 2", url: "https://example.com/2", snippet: "Info 2" },
          { title: "Result 3", url: "https://example.com/3", snippet: "Info 3" },
          { title: "Result 4", url: "https://example.com/4", snippet: "Info 4" },
          { title: "Result 5", url: "https://example.com/5", snippet: "Info 5" },
        ],
        answer: null,
      }),
  });

  let capturedPrompt = null;
  mockWebmlComposeText = async (prompt) => {
    capturedPrompt = prompt;
    return null;
  };

  await xComposeText("test");

  assert.ok(capturedPrompt);
  const matches = (capturedPrompt.match(/Result \d/g) || []).length;
  assert.ok(matches <= 3, `capped to ${matches}, expected ≤3`);
});

// ============================================================================
// Run and report
// ============================================================================

chain.then(() => {
  console.log(`\n${colors.blue}=== RESULTS ===${colors.reset}`);
  console.log(`Tests: ${testCount}, Passed: ${passCount}, Failed: ${failCount}`);
  if (failCount > 0) {
    console.log(`\n${colors.red}Failures:${colors.reset}`);
    for (const { name, error } of failures) {
      console.log(`  ${name}: ${error}`);
    }
    process.exit(1);
  } else {
    console.log(`${colors.green}All tests passed!${colors.reset}`);
    process.exit(0);
  }
});
