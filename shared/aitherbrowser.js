/**
 * AitherBrowser bridge helpers
 * ====================================
 * The logic that sits between Awconnect and the AitherBrowser service:
 * how a request payload is built, how an error response is read, and how a
 * crawl is folded into the knowledge base.
 *
 * WHY THIS FILE EXISTS: all of this used to live inside `background.js`, an MV3
 * service worker. A worker is not an ES module and cannot be imported by
 * `tests/run-tests.mjs`, so it was covered ONLY by `node --check` — syntax, not
 * behaviour. Nothing asserted that a robots 403 actually sets `robotsBlocked`,
 * or that a partial ingest failure reports the right counts. That is the same
 * shape as a problem already solved on the platform's Python side by extracting
 * the robots policy out of the service into its own testable module: logic you
 * cannot import is logic you cannot test.
 *
 * Loaded by the worker via importScripts(), and by the test runner via
 * `new Function(...)` — hence a plain top-level const, no import/export.
 */

const AitherBrowserBridge = {
  /** Hard ceiling on a single crawl, regardless of what the caller asks for. */
  MAX_CRAWL_PAGES: 25,

  /**
   * Read an AitherBrowser error response.
   *
   * AitherBrowser returns FastAPI-shaped `{"detail": "..."}`. Reporting only the
   * status code threw away the one thing the user needs — and since the
   * robots gate landed, a 403 is almost always "robots.txt disallows this URL",
   * which is actionable (the service accepts a documented override).
   */
  async readError(resp) {
    let detail = "";
    try {
      const body = await resp.json();
      detail = typeof body?.detail === "string"
        ? body.detail
        : JSON.stringify(body?.detail ?? "");
    } catch { /* non-JSON body — fall back to the status alone */ }
    const robotsBlocked = resp.status === 403 && /robots\.txt/i.test(detail);
    return {
      ok: false,
      status: resp.status,
      robotsBlocked,
      error: detail || `AitherBrowser HTTP ${resp.status}`,
    };
  },

  /**
   * Build the /browse request body.
   *
   * `obey_robots` defaults to TRUE and only a caller that explicitly passes
   * `obeyRobots: false` turns it off — an undefined/missing field must never
   * read as "don't obey". The override reason travels with it because the
   * service logs every bypass (UNSTATED when omitted).
   */
  buildBrowsePayload(message = {}) {
    return {
      url: message.url,
      extract_text: true,
      screenshot: !!message.screenshot,
      wait_time: message.waitTime || 2000,
      obey_robots: message.obeyRobots !== false,
      robots_override_reason: message.robotsOverrideReason || "",
    };
  },

  /** Build the /crawl request body, clamping the page count. */
  buildCrawlPayload(message = {}) {
    return {
      url: message.url,
      max_pages: Math.min(message.maxPages || 5, AitherBrowserBridge.MAX_CRAWL_PAGES),
      same_domain: true,
      extract_html: false,
      obey_robots: message.obeyRobots !== false,
      robots_override_reason: message.robotsOverrideReason || "",
    };
  },

  /**
   * Ingest crawled pages into the knowledge base, one entry per page.
   *
   * Per-page rather than one blob so search returns the page that matched, not
   * a 25-page concatenation. One bad page must not sink the whole crawl, so
   * failures are counted and reported rather than thrown — but they ARE
   * reported: a silent partial ingest looks exactly like a complete one.
   */
  async ingestPages(pages, ingest, opts = {}) {
    let ingested = 0;
    const failures = [];
    for (const page of pages || []) {
      const text = page.text || page.content || "";
      if (!text.trim()) continue;
      try {
        await ingest({
          content: text,
          source: page.url,
          title: page.title || page.url,
          tags: ["aitherbrowser", "server-crawl"],
          collection: opts.collection || "browser",
          metadata: {
            captured_via: "aitherbrowser",
            crawl_seed: opts.seed || "",
            crawl_depth_url: page.url,
          },
        });
        ingested += 1;
      } catch (e) {
        failures.push({ url: page.url, error: String(e?.message || e) });
      }
    }
    return {
      ingested,
      ingestFailures: failures.length,
      ingestFailureDetail: failures.slice(0, 5),
    };
  },
};
