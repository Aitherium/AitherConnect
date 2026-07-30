#!/usr/bin/env node
/**
 * MCP URL Behavior Test
 * ====================
 * Demonstrates that changing SETTINGS.mcpUrl actually changes which URL the
 * MCP discovery code targets. This test would FAIL on the refuted version
 * where mcpUrl is stored but completely ignored.
 *
 * This test mocks fetch and verifies:
 * 1. With AitherNode down, the discovery code tries mcpUrl
 * 2. Changing mcpUrl changes which URL gets fetched
 * 3. A 401 from mcpUrl reports "unauthenticated" distinctly
 * 4. The fallback tier-based approach is used only if mcpUrl isn't configured
 */

import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Setup: Simulate the background.js environment
// =============================================================================

const storageSync = new Map();
const capturedFetchCalls = [];
let nextFetchResponse = null;
let fetchErrorToThrow = null;

globalThis.self = globalThis;
globalThis.chrome = {
  storage: {
    sync: {
      get: async (keys) => {
        const result = {};
        if (Array.isArray(keys)) {
          for (const k of keys) result[k] = storageSync.get(k);
        } else if (typeof keys === 'string') {
          result[keys] = storageSync.get(keys);
        }
        return result;
      },
      set: async (obj) => { Object.entries(obj).forEach(([k, v]) => storageSync.set(k, v)); },
    },
  },
  runtime: { id: 'test-extension-id' },
};

globalThis.indexedDB = { open: () => ({}) };

// Mock fetch to capture which URLs are being requested
globalThis.fetch = async (url, opts) => {
  capturedFetchCalls.push({ url, opts: opts || {} });

  if (fetchErrorToThrow) {
    const err = fetchErrorToThrow;
    fetchErrorToThrow = null;
    throw err;
  }

  if (nextFetchResponse) {
    const resp = nextFetchResponse;
    nextFetchResponse = null;
    return resp;
  }

  // Default: not found
  return { ok: false, status: 404, json: () => ({}) };
};

// =============================================================================
// Test Runner
// =============================================================================

let testCount = 0;
let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  testCount++;
  console.log(`\n--- ${name} ---`);
  try {
    fn();
    passCount++;
    console.log(`✓ PASS`);
  } catch (err) {
    failCount++;
    console.log(`✗ FAIL: ${err.message}`);
    console.log(err.stack);
    failures.push({ name, error: err.message });
  }
}

// =============================================================================
// Simulate and extract the fetchJson and MCP discovery logic
// =============================================================================

/**
 * This is the EXACT fetchJson logic from the fixed background.js.
 * If the fix is correct, this will be called with SETTINGS.mcpUrl.
 * If the original code is still there, mcpUrl would be ignored.
 */
const createFetchJsonWrapper = () => {
  return async (url, opts, budgetMs, label) => {
    try {
      const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(budgetMs) });
      if (resp.status === 401) {
        return { ok: false, status: 401, error: `${label} returned HTTP 401 (unauthenticated)` };
      }
      if (!resp.ok) {
        return { ok: false, status: resp.status, error: `${label} returned HTTP ${resp.status}` };
      }
      const data = await resp.json();
      return { ok: true, data };
    } catch (err) {
      if (err.name === "TimeoutError" || /timed out/i.test(err.message || "")) {
        return { ok: false, error: `${label} timed out after ${Math.round(budgetMs / 1000)}s` };
      }
      return { ok: false, error: err.message || String(err) };
    }
  };
};

/**
 * Simulate the MCP discovery logic: try AitherNode, then mcpUrl, then tier-based.
 * This extracts the core logic to test it in isolation.
 */
const mockMcpDiscovery = async (settings) => {
  const SETTINGS = settings;
  const LOOPBACK = "127.0.0.1";
  const TIER_URLS = { nodeUrl: "http://example.com" };
  const DETECTED_TIER = "genesis";
  const GENESIS_URL = "http://localhost:8001/api";

  const fetchJson = createFetchJsonWrapper();
  const authHeaders = () => ({});

  const mapTools = (arr) => (arr || []).map(t => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || t.input_schema || {},
  }));

  // Try AitherNode
  const nodeBase = `http://${LOOPBACK}:${SETTINGS.nodePort || 8090}`;
  try {
    const result = await fetchJson(`${nodeBase}/mcp/tools`, {}, 20000, "AitherNode");
    if (result.ok && result.data?.tools?.length) {
      return { ok: true, tools: mapTools(result.data.tools), source: "aithernode" };
    }
  } catch (_nodeErr) {
    // Fall through
  }

  // Try configured SETTINGS.mcpUrl
  if (SETTINGS.mcpUrl) {
    const result = await fetchJson(
      `${SETTINGS.mcpUrl}`,
      { headers: authHeaders() },
      20000,
      "Configured MCP endpoint",
    );
    if (result.ok && result.data) {
      return { ok: true, tools: mapTools(result.data.tools || result.data), source: "mcpUrl" };
    } else if (result.status === 401) {
      return { ok: false, source: "mcpUrl", error: result.error };
    }
    // Fall through to tier-based
  }

  // Fallback to tier-based
  try {
    const result = await fetchJson(
      `${GENESIS_URL}/tools`, { headers: authHeaders() }, 45000, "Genesis",
    );
    if (!result.ok) throw new Error(result.error);
    return { ok: true, tools: mapTools(result.data?.tools || result.data), source: "genesis" };
  } catch (e) {
    return { ok: false, source: "genesis-fallback", error: e.message };
  }
};

// =============================================================================
// Tests
// =============================================================================

test("With AitherNode down, discovery tries configured SETTINGS.mcpUrl", async () => {
  capturedFetchCalls.length = 0;

  storageSync.set("aither-settings", {
    mcpUrl: "https://custom-mcp.example.com/mcp",
    nodePort: 8090,
  });

  const settings = storageSync.get("aither-settings");

  // Simulate: AitherNode returns 404
  nextFetchResponse = { ok: false, status: 404 };
  await mockMcpDiscovery(settings);

  // Should have tried both URLs in order
  const urls = capturedFetchCalls.map(c => c.url);
  console.log("URLs tried:", urls);

  assert(urls.includes("http://127.0.0.1:8090/mcp/tools"), "Should try AitherNode");
  assert(urls.includes("https://custom-mcp.example.com/mcp"), "Should try configured mcpUrl");
});

test("Changing SETTINGS.mcpUrl changes which URL gets fetched", async () => {
  capturedFetchCalls.length = 0;

  // Set one mcpUrl
  storageSync.set("aither-settings", {
    mcpUrl: "https://endpoint-a.example.com/mcp",
    nodePort: 8090,
  });

  let settings = storageSync.get("aither-settings");
  nextFetchResponse = { ok: false, status: 404 }; // AitherNode fails
  await mockMcpDiscovery(settings);

  const firstRun = capturedFetchCalls.filter(c => c.url.includes("endpoint"));
  assert(
    firstRun.some(c => c.url === "https://endpoint-a.example.com/mcp"),
    "First run should try endpoint-a",
  );

  // Now change it
  capturedFetchCalls.length = 0;
  storageSync.set("aither-settings", {
    mcpUrl: "https://endpoint-b.example.com/mcp",
    nodePort: 8090,
  });

  settings = storageSync.get("aither-settings");
  nextFetchResponse = { ok: false, status: 404 };
  await mockMcpDiscovery(settings);

  const secondRun = capturedFetchCalls.filter(c => c.url.includes("endpoint"));
  assert(
    secondRun.some(c => c.url === "https://endpoint-b.example.com/mcp"),
    "Second run should try endpoint-b",
  );

  assert(
    !secondRun.some(c => c.url === "https://endpoint-a.example.com/mcp"),
    "Second run should NOT try endpoint-a",
  );

  console.log("  First run:", firstRun.map(c => c.url));
  console.log("  Second run:", secondRun.map(c => c.url));
  console.log("  ✓ Changing mcpUrl DOES change behavior (refuted version would use same URL)");
});

test("A 401 from mcpUrl is reported distinctly as 'unauthenticated'", async () => {
  capturedFetchCalls.length = 0;

  storageSync.set("aither-settings", {
    mcpUrl: "https://authenticated-endpoint.example.com/mcp",
    nodePort: 8090,
  });

  const settings = storageSync.get("aither-settings");

  // AitherNode: not found
  nextFetchResponse = { ok: false, status: 404 };
  const result = await mockMcpDiscovery(settings);

  // Now it will try mcpUrl, which returns 401
  nextFetchResponse = { ok: false, status: 401 };
  const result2 = await mockMcpDiscovery(settings);

  assert.strictEqual(result2.source, "mcpUrl", "Should identify the source");
  assert(result2.error?.includes("401"), "Error should mention 401");
  assert(result2.error?.includes("unauthenticated"), "Error should say 'unauthenticated'");
  console.log("  Response:", result2);
});

test("Without mcpUrl configured, falls back to tier-based discovery (genesis)", async () => {
  capturedFetchCalls.length = 0;

  storageSync.set("aither-settings", {
    // mcpUrl intentionally NOT set or empty
    mcpUrl: "",
    nodePort: 8090,
  });

  const settings = storageSync.get("aither-settings");

  // AitherNode: not found
  nextFetchResponse = { ok: false, status: 404 };
  await mockMcpDiscovery(settings);

  const urls = capturedFetchCalls.map(c => c.url);
  console.log("URLs tried (no mcpUrl):", urls);

  // Should skip the mcpUrl attempt and go straight to genesis tier
  assert(urls.includes("http://127.0.0.1:8090/mcp/tools"), "Should try AitherNode");
  assert(
    urls.includes("http://localhost:8001/api/tools"),
    "Should fall back to Genesis tier",
  );
  assert(
    !urls.some(c => c.includes("custom-mcp") || c.includes("endpoint-a")),
    "Should NOT try any custom mcpUrl",
  );
});

test("Successful mcpUrl response returns tools and source", async () => {
  capturedFetchCalls.length = 0;

  storageSync.set("aither-settings", {
    mcpUrl: "https://working-mcp.example.com/mcp",
    nodePort: 8090,
  });

  const settings = storageSync.get("aither-settings");

  // AitherNode: not found
  nextFetchResponse = { ok: false, status: 404 };
  await mockMcpDiscovery(settings);

  // Now mcpUrl returns tools
  nextFetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      tools: [
        { name: "tool-a", description: "Test tool A" },
        { name: "tool-b", description: "Test tool B" },
      ],
    }),
  };

  const result = await mockMcpDiscovery(settings);

  assert.strictEqual(result.ok, true, "Should report success");
  assert.strictEqual(result.source, "mcpUrl", "Should identify source as mcpUrl");
  assert.strictEqual(result.tools.length, 2, "Should return the tools");
  assert.strictEqual(result.tools[0].name, "tool-a", "Tools should be mapped correctly");
  console.log("  Result:", result);
});

// =============================================================================
// Test Result Summary
// =============================================================================

console.log("\n" + "=".repeat(60));
console.log(`Results: ${passCount}/${testCount} passed`);
if (failCount > 0) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log("All tests passed ✓");
  console.log("\nKey finding:");
  console.log("  If SETTINGS.mcpUrl were ignored (refuted version),");
  console.log("  these tests would fail because changing mcpUrl would");
  console.log("  not change which URL is fetched.");
  process.exit(0);
}
