/**
 * AitherConnect Agent Extractor
 * ==============================
 *
 * Extracts structured, agent-friendly content from any web page.
 * Instead of scraping raw text like a human reads, this pulls the
 * machine-readable layer that's already on most pages but gets ignored:
 *
 *   - JSON-LD / Schema.org structured data
 *   - OpenGraph and Twitter Card metadata
 *   - Microdata attributes
 *   - Link relations (canonical, API, feeds, manifests)
 *   - Form actions and input schemas
 *   - Semantic page structure (headings, nav, main, article)
 *   - Well-known endpoints and API hints
 *
 * This is the "agent-friendly content" layer — the data websites already
 * serve but that no AI agent currently reads.
 */

(() => {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════════
  // EXTRACTION ENGINE
  // ═══════════════════════════════════════════════════════════════════════

  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const results = [];
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        results.push(data);
      } catch { /* malformed JSON-LD, skip */ }
    }
    return results;
  }

  function extractOpenGraph() {
    const og = {};
    const metas = document.querySelectorAll('meta[property^="og:"], meta[property^="article:"]');
    for (const meta of metas) {
      const key = meta.getAttribute("property");
      const val = meta.getAttribute("content");
      if (key && val) og[key] = val;
    }
    return Object.keys(og).length > 0 ? og : null;
  }

  function extractTwitterCards() {
    const tc = {};
    const metas = document.querySelectorAll('meta[name^="twitter:"]');
    for (const meta of metas) {
      const key = meta.getAttribute("name");
      const val = meta.getAttribute("content");
      if (key && val) tc[key] = val;
    }
    return Object.keys(tc).length > 0 ? tc : null;
  }

  function extractMicrodata() {
    const items = document.querySelectorAll("[itemscope]");
    if (items.length === 0) return null;

    const results = [];
    for (const item of Array.from(items).slice(0, 20)) {
      const type = item.getAttribute("itemtype") || "unknown";
      const props = {};
      const propEls = item.querySelectorAll("[itemprop]");
      for (const el of propEls) {
        const name = el.getAttribute("itemprop");
        const value = el.getAttribute("content") || el.getAttribute("href") ||
                      el.getAttribute("src") || el.textContent?.trim().slice(0, 500);
        if (name && value) props[name] = value;
      }
      if (Object.keys(props).length > 0) {
        results.push({ type, properties: props });
      }
    }
    return results.length > 0 ? results : null;
  }

  function extractLinkRelations() {
    const links = {};
    const els = document.querySelectorAll("link[rel]");
    for (const el of els) {
      const rel = el.getAttribute("rel");
      const href = el.getAttribute("href");
      const type = el.getAttribute("type");
      if (!rel || !href) continue;

      if (!links[rel]) links[rel] = [];
      const entry = { href };
      if (type) entry.type = type;

      const title = el.getAttribute("title");
      if (title) entry.title = title;

      links[rel].push(entry);
    }
    return Object.keys(links).length > 0 ? links : null;
  }

  function extractFeeds() {
    const feeds = [];
    const selectors = [
      'link[type="application/rss+xml"]',
      'link[type="application/atom+xml"]',
      'link[type="application/feed+json"]',
      'link[type="application/json"][rel="alternate"]',
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        feeds.push({
          type: el.getAttribute("type"),
          href: el.getAttribute("href"),
          title: el.getAttribute("title") || null,
        });
      }
    }
    return feeds.length > 0 ? feeds : null;
  }

  function extractApiHints() {
    const hints = [];

    // Link header-style API endpoints
    for (const el of document.querySelectorAll('link[rel="api"], link[rel="service"]')) {
      hints.push({ rel: el.getAttribute("rel"), href: el.getAttribute("href") });
    }

    // Meta tags that hint at APIs
    for (const el of document.querySelectorAll('meta[name="api-url"], meta[name="api-base"], meta[name="api-endpoint"]')) {
      hints.push({ name: el.getAttribute("name"), content: el.getAttribute("content") });
    }

    // OpenAPI / Swagger links
    for (const el of document.querySelectorAll('link[rel="describedby"], link[rel="service-desc"]')) {
      hints.push({ rel: el.getAttribute("rel"), href: el.getAttribute("href"), type: el.getAttribute("type") });
    }

    // data-api-* attributes on the body or root element
    const body = document.body;
    if (body) {
      for (const attr of body.attributes) {
        if (attr.name.startsWith("data-api")) {
          hints.push({ attr: attr.name, value: attr.value });
        }
      }
    }

    return hints.length > 0 ? hints : null;
  }

  function extractForms() {
    const forms = [];
    for (const form of Array.from(document.forms).slice(0, 10)) {
      const action = form.getAttribute("action") || "";
      const method = (form.getAttribute("method") || "GET").toUpperCase();
      const inputs = [];

      for (const input of form.querySelectorAll("input, select, textarea")) {
        const name = input.getAttribute("name");
        if (!name) continue;
        inputs.push({
          name,
          type: input.getAttribute("type") || input.tagName.toLowerCase(),
          required: input.hasAttribute("required"),
          placeholder: input.getAttribute("placeholder") || null,
          label: document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() || null,
        });
      }

      if (inputs.length > 0) {
        forms.push({ action, method, inputs });
      }
    }
    return forms.length > 0 ? forms : null;
  }

  function extractSemanticStructure() {
    const structure = {};

    // Heading hierarchy
    const headings = [];
    for (const h of document.querySelectorAll("h1, h2, h3")) {
      const text = h.textContent?.trim().slice(0, 200);
      if (text) headings.push({ level: parseInt(h.tagName[1]), text });
    }
    if (headings.length > 0) structure.headings = headings.slice(0, 30);

    // Navigation links
    const navLinks = [];
    for (const nav of document.querySelectorAll("nav")) {
      for (const a of nav.querySelectorAll("a[href]")) {
        const text = a.textContent?.trim().slice(0, 100);
        if (text) navLinks.push({ text, href: a.href });
      }
    }
    if (navLinks.length > 0) structure.navigation = navLinks.slice(0, 30);

    // Main content signal
    const main = document.querySelector("main, [role='main'], article");
    if (main) {
      structure.main_content = {
        tag: main.tagName.toLowerCase(),
        text_length: main.textContent?.length || 0,
        text_preview: main.textContent?.trim().slice(0, 1000) || "",
      };
    }

    // Landmark roles
    const landmarks = [];
    for (const el of document.querySelectorAll("[role]")) {
      const role = el.getAttribute("role");
      if (["banner", "navigation", "main", "complementary", "contentinfo", "search", "form"].includes(role)) {
        landmarks.push({ role, tag: el.tagName.toLowerCase() });
      }
    }
    if (landmarks.length > 0) structure.landmarks = landmarks;

    return Object.keys(structure).length > 0 ? structure : null;
  }

  function extractMetaTags() {
    const meta = {};
    const important = [
      "description", "author", "keywords", "robots", "generator",
      "application-name", "theme-color", "viewport",
    ];
    for (const name of important) {
      const el = document.querySelector(`meta[name="${name}"]`);
      if (el) {
        const content = el.getAttribute("content");
        if (content) meta[name] = content;
      }
    }
    return Object.keys(meta).length > 0 ? meta : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONSUMER ADVOCACY EXTRACTION (Themis Integration)
  // ═══════════════════════════════════════════════════════════════════════

  function extractConsumerSignals() {
    const signals = {};

    // ── Price elements ─────────────────────────────────────────────
    const prices = [];
    const priceSelectors = [
      "[class*='price']", "[data-price]", "[itemprop='price']",
      "[class*='cost']", "[class*='amount']", ".product-price",
      ".sale-price", ".original-price", ".compare-price",
      "[class*='Price']", "[data-testid*='price']",
    ];
    for (const sel of priceSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.textContent?.trim().slice(0, 100);
        if (!text || !/\$|€|£|¥|\d+\.\d{2}/.test(text)) continue;
        const cls = el.className || "";
        let type = "current";
        if (/original|was|compare|strikethrough|line-through/i.test(cls) ||
            window.getComputedStyle(el).textDecoration.includes("line-through")) {
          type = "original";
        } else if (/sale|discount|new|special/i.test(cls)) {
          type = "sale";
        }
        prices.push({ text, type, element: el.tagName.toLowerCase() });
        if (prices.length >= 15) break;
      }
      if (prices.length >= 15) break;
    }
    if (prices.length > 0) signals.prices = prices;

    // ── Hidden fees ────────────────────────────────────────────────
    const hiddenFees = [];
    const feePatterns = /service fee|handling fee|convenience fee|processing fee|admin fee|platform fee|booking fee|resort fee|delivery fee|surcharge/gi;
    const allText = document.body?.innerText || "";
    let feeMatch;
    while ((feeMatch = feePatterns.exec(allText)) !== null && hiddenFees.length < 8) {
      const start = Math.max(0, feeMatch.index - 30);
      const end = Math.min(allText.length, feeMatch.index + feeMatch[0].length + 50);
      hiddenFees.push({
        text: feeMatch[0],
        context: allText.slice(start, end).trim(),
      });
    }
    if (hiddenFees.length > 0) signals.hidden_fees = hiddenFees;

    // ── Dark pattern UI indicators ─────────────────────────────────
    const darkPatterns = [];

    // Confirmshaming: buttons/links with guilt-trip text
    for (const el of document.querySelectorAll("a, button, span, p")) {
      const t = el.textContent?.trim().toLowerCase() || "";
      if (t.length > 5 && t.length < 100) {
        if (/no.?thanks|i('ll| will) pass|i don'?t want|i prefer to pay|no.?i('m| am)|i hate saving/i.test(t)) {
          darkPatterns.push({ type: "confirmshaming", text: t.slice(0, 80), tag: el.tagName });
        }
      }
    }

    // Fake urgency: countdown timers, "only X left"
    for (const el of document.querySelectorAll("[class*='countdown'], [class*='timer'], [class*='urgency'], [class*='scarcity']")) {
      darkPatterns.push({
        type: "fake_urgency",
        text: el.textContent?.trim().slice(0, 80) || "countdown element",
        tag: el.tagName,
      });
    }
    // Text-based urgency
    const urgencyText = allText.slice(0, 10000);
    if (/only \d+ left|selling fast|almost gone|limited stock/i.test(urgencyText)) {
      darkPatterns.push({ type: "fake_urgency", text: "Scarcity messaging detected" });
    }

    // Social proof pressure
    if (/\d+ people (are )?viewing|bought in the last \d+|in \d+ carts/i.test(urgencyText)) {
      darkPatterns.push({ type: "social_proof_pressure", text: "Real-time social proof indicators" });
    }

    if (darkPatterns.length > 0) signals.dark_patterns = darkPatterns.slice(0, 10);

    // ── Cookie consent analysis ────────────────────────────────────
    const consentEl = document.querySelector(
      "[class*='cookie'], [class*='consent'], [id*='cookie'], [id*='consent'], " +
      "[class*='gdpr'], [id*='gdpr'], [class*='privacy-banner'], [id*='privacy-banner']"
    );
    if (consentEl) {
      const consent = {
        present: true,
        text: consentEl.textContent?.trim().slice(0, 300) || "",
      };
      // Check if reject is harder to find than accept
      const acceptBtn = consentEl.querySelector("[class*='accept'], [class*='agree'], [id*='accept']");
      const rejectBtn = consentEl.querySelector("[class*='reject'], [class*='decline'], [class*='deny'], [id*='reject']");
      if (acceptBtn && !rejectBtn) {
        consent.reject_difficulty = "hard";
        consent.note = "No visible reject button — only accept";
      } else if (acceptBtn && rejectBtn) {
        // Compare visual prominence
        const acceptRect = acceptBtn.getBoundingClientRect();
        const rejectRect = rejectBtn.getBoundingClientRect();
        if (acceptRect.width > rejectRect.width * 1.5 || acceptRect.height > rejectRect.height * 1.3) {
          consent.reject_difficulty = "medium";
          consent.note = "Accept button is visually larger/more prominent than reject";
        } else {
          consent.reject_difficulty = "easy";
        }
      }
      // Check for pre-checked categories
      const checkboxes = consentEl.querySelectorAll("input[type='checkbox']:checked");
      if (checkboxes.length > 1) {
        consent.pre_checked_categories = Array.from(checkboxes)
          .map(cb => cb.closest("label")?.textContent?.trim().slice(0, 40) || cb.name || "category")
          .slice(0, 5);
      }
      signals.cookie_consent = consent;
    }

    // ── Tracking scripts ───────────────────────────────────────────
    const trackers = [];
    const trackerDomains = [
      "google-analytics.com", "googletagmanager.com", "facebook.net",
      "doubleclick.net", "amazon-adsystem.com", "criteo.com",
      "hotjar.com", "mixpanel.com", "segment.com", "amplitude.com",
      "sentry.io", "fullstory.com", "mouseflow.com", "clarity.ms",
    ];
    for (const script of document.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src") || "";
      for (const domain of trackerDomains) {
        if (src.includes(domain)) {
          trackers.push({ type: domain.split(".")[0], src: src.slice(0, 150) });
          break;
        }
      }
    }
    if (trackers.length > 0) signals.tracking = trackers;

    // ── Page category hint (shopping, finance, news, etc.) ─────────
    const pageText = allText.slice(0, 5000).toLowerCase();
    if (/add to cart|buy now|checkout|shopping cart|add to bag/i.test(pageText)) {
      signals.page_type = "shopping";
    } else if (/account balance|transaction|bank|credit score|loan|mortgage/i.test(pageText)) {
      signals.page_type = "finance";
    } else if (/subscribe|premium|pro plan|pricing|tier/i.test(pageText)) {
      signals.page_type = "subscription";
    } else if (/terms of service|privacy policy|user agreement/i.test(pageText)) {
      signals.page_type = "legal";
    }

    return Object.keys(signals).length > 0 ? signals : null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECURITY SIGNALS — Malicious script/ad/content detection
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extract security-relevant signals from the current page for
   * AitherSentry/Bastion/Sentinel analysis. Detects:
   *   - Crypto miners (WebSocket/WASM miners)
   *   - Malicious ad networks and suspicious iframes
   *   - Phishing indicators (fake login forms, homoglyph domains)
   *   - Suspicious external scripts (obfuscated, data-exfil)
   *   - Drive-by download attempts
   *   - Clipboard hijacking / keylogger patterns
   *   - Redirect chains / pop-under scripts
   */
  function extractSecuritySignals() {
    const signals = {
      url: window.location.href,
      origin: window.location.origin,
      protocol: window.location.protocol,
      timestamp: new Date().toISOString(),
    };

    const threats = [];
    const scripts = [];
    const iframes = [];
    const externalResources = [];

    // ── Crypto miner detection ────────────────────────────────────
    const minerDomains = [
      "coinhive.com", "coin-hive.com", "jsecoin.com", "crypto-loot.com",
      "cryptaloot.pro", "ppoi.org", "minero.cc", "monerominer.rocks",
      "webminepool.com", "authedmine.com", "minr.pw", "inwemo.com",
      "2giga.link", "coinerra.com", "coinnebula.com",
    ];
    // Check for WebAssembly miner patterns
    const allScriptContent = Array.from(document.querySelectorAll("script:not([src])"))
      .map(s => s.textContent || "")
      .join("\n");

    if (/CoinHive|coinhive|Coinimp|JSEcoin/i.test(allScriptContent)) {
      threats.push({ type: "cryptominer", severity: "critical", detail: "Crypto mining script detected in inline code" });
    }
    if (/WebAssembly\.instantiate|wasm.*miner|cryptonight/i.test(allScriptContent)) {
      threats.push({ type: "cryptominer", severity: "high", detail: "WebAssembly crypto-mining pattern detected" });
    }

    for (const script of document.querySelectorAll("script[src]")) {
      const src = (script.getAttribute("src") || "").toLowerCase();
      for (const domain of minerDomains) {
        if (src.includes(domain)) {
          threats.push({ type: "cryptominer", severity: "critical", detail: `Mining script loaded from ${domain}`, src });
          break;
        }
      }
    }

    // ── Malicious ad network detection ────────────────────────────
    const malAdDomains = [
      "popads.net", "popcash.net", "propellerads.com", "adcash.com",
      "trafficjunky.net", "exoclick.com", "juicyads.com", "clickadu.com",
      "hilltopads.net", "adsterra.com", "richpush.co", "pushprofit.net",
      "zeroredirect.com", "onclickmax.com", "pushnami.com",
      "adf.ly", "bc.vc", "ouo.io", "shorte.st",  // URL shortener adware
    ];

    const adIframes = [];
    for (const iframe of document.querySelectorAll("iframe")) {
      const src = (iframe.getAttribute("src") || "").toLowerCase();
      const width = iframe.width || iframe.getAttribute("width") || "";
      const height = iframe.height || iframe.getAttribute("height") || "";

      // Hidden iframes (1x1, 0x0, display:none) are suspicious
      const isHidden = (
        (width === "0" || width === "1") && (height === "0" || height === "1") ||
        iframe.style.display === "none" ||
        iframe.style.visibility === "hidden" ||
        iframe.style.opacity === "0"
      );

      if (isHidden && src) {
        threats.push({ type: "hidden_iframe", severity: "high", detail: `Hidden iframe: ${src.slice(0, 120)}`, src });
      }

      for (const domain of malAdDomains) {
        if (src.includes(domain)) {
          threats.push({ type: "malicious_ad", severity: "high", detail: `Malicious ad network: ${domain}`, src });
          break;
        }
      }

      if (src) {
        iframes.push({
          src: src.slice(0, 200),
          hidden: isHidden,
          sandbox: iframe.hasAttribute("sandbox"),
          allow: iframe.getAttribute("allow") || "",
        });
      }
    }

    // ── Phishing indicators ──────────────────────────────────────
    const phishingSignals = [];

    // Non-HTTPS login form
    const loginForms = document.querySelectorAll('form[action*="login"], form[action*="signin"], form[action*="auth"]');
    for (const form of loginForms) {
      const action = (form.getAttribute("action") || "").toLowerCase();
      if (action.startsWith("http:")) {
        phishingSignals.push({ type: "insecure_login", detail: `Login form submits over HTTP: ${action.slice(0, 100)}` });
      }
    }

    // Password fields on HTTP pages
    if (window.location.protocol === "http:" && document.querySelector('input[type="password"]')) {
      phishingSignals.push({ type: "insecure_password", detail: "Password field on non-HTTPS page" });
    }

    // Cross-origin form submissions (login forms posting to different domain)
    for (const form of document.querySelectorAll("form")) {
      const action = form.getAttribute("action") || "";
      if (action && !action.startsWith("/") && !action.startsWith("#")) {
        try {
          const actionUrl = new URL(action, window.location.href);
          if (actionUrl.origin !== window.location.origin) {
            const hasPassword = form.querySelector('input[type="password"]');
            const hasEmail = form.querySelector('input[type="email"], input[name*="email"], input[name*="user"]');
            if (hasPassword || hasEmail) {
              phishingSignals.push({
                type: "cross_origin_credentials",
                detail: `Credential form posts to different domain: ${actionUrl.origin}`,
                severity: "critical",
              });
            }
          }
        } catch { /* invalid URL */ }
      }
    }

    // Homoglyph domain detection (unicode lookalike characters)
    const hostname = window.location.hostname;
    if (/xn--/.test(hostname)) {
      phishingSignals.push({ type: "punycode_domain", detail: `Internationalized domain (punycode): ${hostname}` });
    }

    // Suspicious title mimicry (page title contains brand names but domain doesn't match)
    const brandMimicry = [
      { brand: "paypal", domains: ["paypal.com"] },
      { brand: "google", domains: ["google.com", "googleapis.com"] },
      { brand: "apple", domains: ["apple.com", "icloud.com"] },
      { brand: "microsoft", domains: ["microsoft.com", "live.com", "outlook.com"] },
      { brand: "amazon", domains: ["amazon.com", "amazon.co"] },
      { brand: "facebook", domains: ["facebook.com", "meta.com"] },
      { brand: "netflix", domains: ["netflix.com"] },
      { brand: "bank of america", domains: ["bankofamerica.com"] },
      { brand: "chase", domains: ["chase.com"] },
      { brand: "wells fargo", domains: ["wellsfargo.com"] },
    ];

    const titleLower = document.title.toLowerCase();
    for (const { brand, domains } of brandMimicry) {
      if (titleLower.includes(brand) && !domains.some(d => hostname.includes(d.split(".")[0]))) {
        phishingSignals.push({
          type: "brand_impersonation",
          detail: `Page title mentions "${brand}" but domain is ${hostname}`,
          severity: "high",
        });
      }
    }

    if (phishingSignals.length > 0) {
      threats.push(...phishingSignals.map(p => ({
        type: "phishing",
        severity: p.severity || "high",
        detail: p.detail,
        subtype: p.type,
      })));
    }

    // ── Suspicious script analysis ───────────────────────────────
    const suspiciousPatterns = [
      { pattern: /eval\s*\(\s*atob\s*\(/, name: "obfuscated_eval", severity: "high" },
      { pattern: /document\.write\s*\(\s*unescape/, name: "unescape_write", severity: "high" },
      { pattern: /String\.fromCharCode\s*\([^)]{50,}/, name: "charcode_obfuscation", severity: "medium" },
      { pattern: /window\.location\s*=\s*['"]data:/, name: "data_uri_redirect", severity: "critical" },
      { pattern: /navigator\.clipboard\.writeText/i, name: "clipboard_hijack", severity: "high" },
      { pattern: /document\.addEventListener\s*\(\s*['"]keydown/, name: "keylogger_pattern", severity: "medium" },
      { pattern: /new\s+WebSocket\s*\(\s*['"]wss?:\/\/(?!localhost)/, name: "external_websocket", severity: "medium" },
      { pattern: /\.attachShadow\s*\(\s*{.*mode:\s*['"]closed/, name: "closed_shadow_dom", severity: "low" },
    ];

    for (const script of document.querySelectorAll("script:not([src])")) {
      const content = script.textContent || "";
      if (content.length < 10) continue;

      for (const { pattern, name, severity } of suspiciousPatterns) {
        if (pattern.test(content)) {
          threats.push({
            type: "suspicious_script",
            severity,
            detail: `Inline script matches pattern: ${name}`,
            subtype: name,
            excerpt: content.slice(0, 80),
          });
        }
      }
    }

    // Suspicious external scripts (non-CDN, non-known)
    const knownCDNs = [
      "cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com",
      "ajax.googleapis.com", "code.jquery.com", "stackpath.bootstrapcdn.com",
      "maxcdn.bootstrapcdn.com", "fonts.googleapis.com", "use.fontawesome.com",
      "cdn.tailwindcss.com", "cdn.shopify.com",
    ];
    const knownAnalytics = [
      "google-analytics.com", "googletagmanager.com", "facebook.net",
      "connect.facebook.net", "platform.twitter.com", "cdn.segment.com",
    ];

    for (const script of document.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src") || "";
      if (!src || src.startsWith("/") || src.startsWith("data:")) continue;

      try {
        const scriptUrl = new URL(src, window.location.href);
        if (scriptUrl.origin === window.location.origin) continue;

        const scriptHost = scriptUrl.hostname;
        const isKnown = [...knownCDNs, ...knownAnalytics].some(d => scriptHost.includes(d));

        scripts.push({
          src: src.slice(0, 200),
          host: scriptHost,
          known: isKnown,
          async: script.hasAttribute("async"),
          defer: script.hasAttribute("defer"),
          crossorigin: script.getAttribute("crossorigin") || null,
          integrity: script.hasAttribute("integrity"),
        });

        if (!isKnown) {
          externalResources.push({ type: "script", host: scriptHost, src: src.slice(0, 200) });
        }
      } catch { /* invalid URL */ }
    }

    // ── Drive-by download detection ──────────────────────────────
    const downloadLinks = document.querySelectorAll('a[href$=".exe"], a[href$=".msi"], a[href$=".bat"], a[href$=".scr"], a[href$=".ps1"], a[href$=".vbs"]');
    if (downloadLinks.length > 0) {
      const autoDownload = allScriptContent.includes("click()") && allScriptContent.includes(".exe");
      threats.push({
        type: "download_risk",
        severity: autoDownload ? "critical" : "medium",
        detail: `${downloadLinks.length} executable download link(s)${autoDownload ? " with auto-click trigger" : ""}`,
        count: downloadLinks.length,
      });
    }

    // ── Page security posture ────────────────────────────────────
    const securityPosture = {
      https: window.location.protocol === "https:",
      csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      srcdoc_iframes: document.querySelectorAll("iframe[srcdoc]").length,
      total_scripts: document.querySelectorAll("script").length,
      external_scripts: scripts.length,
      unknown_external_scripts: externalResources.filter(r => r.type === "script").length,
      total_iframes: iframes.length,
      hidden_iframes: iframes.filter(f => f.hidden).length,
      password_fields: document.querySelectorAll('input[type="password"]').length,
      forms_count: document.querySelectorAll("form").length,
    };

    // Build final output
    if (threats.length > 0) signals.threats = threats;
    if (scripts.length > 0) signals.external_scripts = scripts.slice(0, 30);
    if (iframes.length > 0) signals.iframes = iframes.slice(0, 20);
    if (externalResources.length > 0) signals.unknown_resources = externalResources.slice(0, 15);
    signals.security_posture = securityPosture;

    // Risk score (0-100)
    let riskScore = 0;
    for (const t of threats) {
      if (t.severity === "critical") riskScore += 25;
      else if (t.severity === "high") riskScore += 15;
      else if (t.severity === "medium") riskScore += 8;
      else riskScore += 3;
    }
    if (!securityPosture.https) riskScore += 10;
    if (securityPosture.hidden_iframes > 0) riskScore += 10;
    if (securityPosture.unknown_external_scripts > 5) riskScore += 10;
    signals.risk_score = Math.min(riskScore, 100);

    // Overall threat level
    if (riskScore >= 60) signals.threat_level = "critical";
    else if (riskScore >= 35) signals.threat_level = "high";
    else if (riskScore >= 15) signals.threat_level = "medium";
    else if (riskScore > 0) signals.threat_level = "low";
    else signals.threat_level = "safe";

    return signals;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════

  function extractAgentContext(options = {}) {
    const ctx = {
      url: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      title: document.title,
      timestamp: new Date().toISOString(),
      content_type: document.contentType || "text/html",
      lang: document.documentElement.lang || null,
    };

    // Structured data layer — what sites already serve for machines
    const jsonLd = extractJsonLd();
    if (jsonLd.length > 0) ctx.json_ld = jsonLd;

    const og = extractOpenGraph();
    if (og) ctx.opengraph = og;

    const tc = extractTwitterCards();
    if (tc) ctx.twitter_cards = tc;

    const microdata = extractMicrodata();
    if (microdata) ctx.microdata = microdata;

    // Discovery layer — how agents find what's available
    const links = extractLinkRelations();
    if (links) ctx.link_relations = links;

    const feeds = extractFeeds();
    if (feeds) ctx.feeds = feeds;

    const apiHints = extractApiHints();
    if (apiHints) ctx.api_hints = apiHints;

    // Interaction layer — what agents can do on this page
    const forms = extractForms();
    if (forms) ctx.forms = forms;

    // Semantic structure — page organization for agent navigation
    const structure = extractSemanticStructure();
    if (structure) ctx.structure = structure;

    // Standard metadata
    const meta = extractMetaTags();
    if (meta) ctx.meta = meta;

    // Consumer advocacy signals (for Themis integration)
    if (options.include_consumer_signals !== false) {
      const consumer = extractConsumerSignals();
      if (consumer) ctx.consumer_signals = consumer;
    }

    // Optional: include main text content (only if requested)
    if (options.include_text) {
      const main = document.querySelector("main, [role='main'], article");
      const source = main || document.body;
      ctx.text_content = source?.innerText?.slice(0, options.max_text || 30000) || "";
    }

    // Richness score — how much structured data this page provides
    let score = 0;
    if (jsonLd.length > 0) score += 3;
    if (og) score += 2;
    if (microdata) score += 2;
    if (feeds) score += 2;
    if (apiHints) score += 3;
    if (forms) score += 1;
    if (structure) score += 1;
    if (meta) score += 1;
    ctx.agent_richness_score = score;

    return ctx;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLER
  // ═══════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
      sendResponse({ ok: true });
      return true;
    }

    if (request.action === "extract-agent-context") {
      try {
        const ctx = extractAgentContext(request.options || {});
        sendResponse({ success: true, context: ctx });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (request.action === "extract-json-ld") {
      sendResponse({ success: true, data: extractJsonLd() });
      return true;
    }

    if (request.action === "extract-forms") {
      sendResponse({ success: true, data: extractForms() });
      return true;
    }

    if (request.action === "extract-feeds") {
      sendResponse({ success: true, data: extractFeeds() });
      return true;
    }

    if (request.action === "extract-consumer-signals") {
      try {
        const signals = extractConsumerSignals();
        sendResponse({ success: true, signals: signals || {} });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (request.action === "extract-themis-context") {
      // Full extraction optimized for Themis page analysis
      try {
        const ctx = extractAgentContext({
          include_text: true,
          max_text: 15000,
          include_consumer_signals: true,
        });
        sendResponse({ success: true, context: ctx });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (request.action === "extract-security-signals") {
      try {
        const signals = extractSecuritySignals();
        sendResponse({ success: true, signals });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (request.action === "extract-shield-context") {
      // Full extraction optimized for security analysis (Sentry + Bastion)
      try {
        const ctx = extractAgentContext({
          include_text: true,
          max_text: 8000,
          include_consumer_signals: false,
        });
        ctx.security_signals = extractSecuritySignals();
        sendResponse({ success: true, context: ctx });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
  });

})();
