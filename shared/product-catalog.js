/**
 * The Aitherium desktop products as awconnect's add-on catalog: Deep Research
 * Studio, Saga, Agent Home (local, license-gated by awdk packs) and Iris (hosted).
 *
 * The extension cannot see the disk, so install + license state comes from the
 * host's native launcher (AitherDesktop launcher.py, :8299) at GET /products,
 * which answers with awdk's LicenseManager.is_pack_available(<pack>) per product.
 * When the launcher is not running every local product is "unknown" and its card
 * opens the shop page -- never a guessed "licensed".
 *
 * The catalog mirrors AitherDesktop's core/products.py; its parity test reads
 * this file, so an id/pack/shop-slug drift fails there.
 *
 * Loaded by background.js (importScripts) and sidepanel.html (<script>); exposes
 * self.AitherProductCatalog. Pure: no chrome.*, no fetch.
 */
(function initProductCatalog(global) {
  "use strict";

  const SHOP_BASE = "https://aitherium.com/shop";

  const PRODUCTS = Object.freeze([
    Object.freeze({ id: "deep-research", name: "Deep Research Studio", icon: "🔬", kind: "local",
      pack: "deep-research", category: "agents",
      blurb: "Multi-source, fact-checked research reports on your own machine." }),
    Object.freeze({ id: "saga", name: "Saga", icon: "🎲", kind: "local", pack: "saga", category: "creative",
      blurb: "An AI game master for solo tabletop RPGs, running on your PC." }),
    Object.freeze({ id: "agent-home", name: "Agent Home", icon: "🏠", kind: "local", pack: "agent-home",
      category: "agents", blurb: "A self-hosted agent kit: your own agent, memory and tools at home." }),
    Object.freeze({ id: "iris", name: "Iris", icon: "🎨", kind: "hosted", pack: null, category: "creative",
      webUrl: "https://aitherium.com/iris",
      blurb: "Hosted image and scene art studio (credits or Iris Pro)." }),
  ]);

  function byId(id) {
    return PRODUCTS.find((p) => p.id === String(id || "").trim().toLowerCase()) || null;
  }

  function shopUrl(product) {
    return `${SHOP_BASE}/${product.id}`;
  }

  function isHttps(url) {
    return /^https:\/\//i.test(String(url || ""));
  }

  /** The row for one product when the launcher gave nothing: hosted opens, local shops. */
  function offlineRow(product) {
    return {
      id: product.id, kind: product.kind, pack: product.pack,
      installed: false, licensed: null,
      action: product.kind === "hosted" ? "open" : "shop",
      url: product.kind === "hosted" ? product.webUrl : shopUrl(product),
    };
  }

  /**
   * Merge the launcher's GET /products rows (or null when it is down) onto the
   * catalog. Unknown ids from the launcher are dropped; a non-https url from the
   * launcher is replaced by the shop page (the card opens it in a tab).
   */
  function mergeStatus(launcherRows) {
    const rows = Array.isArray(launcherRows) ? launcherRows : [];
    return PRODUCTS.map((product) => {
      const live = rows.find((r) => r && r.id === product.id);
      const base = offlineRow(product);
      if (!live) return { ...base, source: "catalog" };
      const action = ["launch", "open", "install", "shop"].includes(live.action) ? live.action : base.action;
      let url = live.url || base.url;
      if (action !== "launch" && !isHttps(url)) url = product.kind === "hosted" ? product.webUrl : shopUrl(product);
      return {
        ...base,
        installed: !!live.installed,
        licensed: typeof live.licensed === "boolean" ? live.licensed : null,
        action, url: action === "launch" ? null : url, source: "launcher",
      };
    });
  }

  const BADGE = { launch: "Installed", open: "Web", install: "Licensed · download", shop: "Get it" };

  /** Apps-grid cards (sidepanel renderApps shape) for the merged rows. */
  function appCards(merged) {
    return merged.map((row) => {
      const product = byId(row.id);
      const lic = row.licensed === true ? "licensed" : row.licensed === false ? "not licensed" : "license unknown";
      const state = product.kind === "hosted" ? "hosted" : `${row.installed ? "installed" : "not installed"} · ${lic}`;
      return {
        id: `product-${product.id}`,
        name: product.name,
        icon: product.icon,
        category: product.category,
        desc: `${product.blurb} (${state})`,
        status: "stable",
        installed: true, // the catalog entry always renders; the action decides what a click does
        route: row.action === "launch" ? `product:${product.id}` : row.url,
        product: product.id,
        productAction: row.action,
        productBadge: BADGE[row.action] || "",
      };
    });
  }

  const api = { SHOP_BASE, PRODUCTS, byId, shopUrl, offlineRow, mergeStatus, appCards };
  global.AitherProductCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
