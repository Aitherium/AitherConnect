/**
 * awsync — keep this client in step with the platform.
 *
 * A faithful port of the awsync Python package into the extension's
 * service worker, per the owner's 2026-08-19 consolidation ruling: the sync
 * client and AitherConnect are one product, so there is one implementation and
 * it lives where it actually runs.
 *
 * A platform is "compatible" if it exposes:
 *   POST /api/v1/telemetry/heartbeat
 *   GET  /api/v1/packs/updates
 *   GET  /api/v1/license/validate
 * all behind `Authorization: Bearer <key>` + `X-Tenant-ID`.
 *
 * ── THE TRI-STATE IS THE ENTIRE POINT. DO NOT COLLAPSE IT. ──────────────────
 * IN_STEP (0) / DRIFTED (1) / COULD_NOT_JUDGE (2).
 *
 * The package exists because of a specific failure, in its own words: "a
 * deployment that drifts is worse than one that breaks: it is silently out of
 * sync, reporting success while the platform has moved on. Every sync daemon
 * hides this by collapsing network failures into empty results, so 'could not
 * tell' reads as 'in step'."
 *
 * So a timeout, an unreachable platform, a non-200, or a body that is not JSON
 * are all COULD_NOT_JUDGE — never IN_STEP, and never DRIFTED either, because
 * "I could not look" is not "I looked and it was wrong". Anything that reduces
 * this to a boolean has reintroduced the defect the module exists to prevent.
 */

const AWSYNC_VERSION = "1.0";

const SYNC_STATUS = Object.freeze({
  IN_STEP: 0,
  DRIFTED: 1,
  COULD_NOT_JUDGE: 2,
});

function inStep(message, details) {
  return { exitCode: SYNC_STATUS.IN_STEP, ok: true, message: message || "", details: details || {} };
}
function drifted(message, details) {
  return { exitCode: SYNC_STATUS.DRIFTED, ok: false, message: message || "", details: details || {} };
}
function couldNotJudge(message, details) {
  return { exitCode: SYNC_STATUS.COULD_NOT_JUDGE, ok: false, message: message || "", details: details || {} };
}

/**
 * What this client can honestly report about itself.
 *
 * The Python original reads cpu/memory/disk off the host via psutil. A service
 * worker has no such view and must NOT invent one: a fabricated 0% is worse
 * than an absent field, because a dashboard cannot tell a real zero from a
 * missing sensor. Report what the browser genuinely exposes, omit the rest.
 */
function collectResourceUsage() {
  const usage = {};
  try {
    if (typeof navigator !== "undefined" && typeof navigator.deviceMemory === "number") {
      usage.device_memory_gb = navigator.deviceMemory;
    }
    if (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") {
      usage.cpu_cores = navigator.hardwareConcurrency;
    }
  } catch { /* not available in this context */ }
  return usage;
}

class SyncClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.platformUrl  e.g. https://portal.aitherium.com
   * @param {string} cfg.apiKey       bearer
   * @param {string} cfg.tenantId
   * @param {string} [cfg.nodeId]
   * @param {number} [cfg.timeoutMs]
   * @param {(updates: object[]) => void} [cfg.onUpdates]
   * @param {typeof fetch} [cfg.fetchImpl]  injectable, so the tests can prove
   *        each branch instead of asserting the happy path against a live host.
   */
  constructor(cfg) {
    const c = cfg || {};
    this.platformUrl = String(c.platformUrl || "").replace(/\/+$/, "");
    this.apiKey = c.apiKey || "";
    this.tenantId = c.tenantId || "";
    this.nodeId = c.nodeId || "aitherconnect";
    this.timeoutMs = typeof c.timeoutMs === "number" ? c.timeoutMs : 15000;
    this.onUpdates = c.onUpdates || null;
    this._fetch = c.fetchImpl || function () { return fetch.apply(null, arguments); };

    /* ── PORTS: how awsync composes with the rest of the family ──────────────
     *
     * Every one is OPTIONAL and absent means "behave exactly as before". That
     * is not politeness, it is EC003: a brick's smallest useful job must not
     * require a sibling. awsync alone still heartbeats, still checks, still
     * reports honestly. Needing is not pairing — these are pairings.
     *
     *   collectServices() -> {name: status}
     *       awnode. The heartbeat's `services` map was literally `{}`, which
     *       told the platform nothing about the one thing it wants to know:
     *       is this node's local AI gateway reachable, and what does it serve.
     *
     *   report(result)
     *       awrelay. A DRIFTED or COULD_NOT_JUDGE verdict is a FINDING, and a
     *       verdict nobody reads is the "detection worked, the page died"
     *       failure this fleet has already paid for. Computing the tri-state
     *       and showing it to no one wastes the entire point of computing it.
     *
     *   snapshot(label) -> handle   /   restore(handle)
     *       awrecover. Applying a pack update mutates local state; without a
     *       snapshot a bad pack is unrecoverable. This is awrecover's own adopt
     *       line — snapshot one directory, break it, restore it.
     *
     *   fetchArtifact(pack) -> bytes|object
     *       awshare. Pack payloads are artifacts, and awshare's whole job is
     *       "fetch it back VERIFIED". Pulling a pack from a bare URL and
     *       trusting it is the supply-chain hole awshare exists to close.
     *
     *   onEvent(event)
     *       AitherStrata / AitherNexus. NOT bricks — services, so awsync speaks
     *       to them through a port rather than importing them (the awrelay
     *       lesson: ship a small client, never lift a 19k-line service). The
     *       host decides whether an event lands in a Strata namespace, is
     *       ingested into Nexus, or is dropped.
     */
    const ports = c.integrations || {};
    this.collectServices = ports.collectServices || null;
    this.report = ports.report || null;
    this.snapshot = ports.snapshot || null;
    this.restore = ports.restore || null;
    this.fetchArtifact = ports.fetchArtifact || null;
    this.onEvent = ports.onEvent || null;
  }

  _authHeaders() {
    return {
      Authorization: "Bearer " + this.apiKey,
      "User-Agent": "awsync/" + AWSYNC_VERSION,
      "X-Tenant-ID": this.tenantId,
    };
  }

  _url(path) {
    return this.platformUrl + path;
  }

  /**
   * awnode's view of this node, for the heartbeat.
   *
   * A port that THROWS must not take the heartbeat down with it: an unreachable
   * local gateway is exactly the condition worth reporting, so swallowing the
   * error and sending `{}` is right and sending nothing is not.
   */
  async _services() {
    if (!this.collectServices) return {};
    try {
      return (await this.collectServices()) || {};
    } catch {
      return {};
    }
  }

  /** Hand an event to the host (Strata namespace, Nexus ingest, or nowhere). */
  async _emit(kind, detail) {
    if (!this.onEvent) return;
    try {
      await this.onEvent({ kind: kind, node_id: this.nodeId, tenant_id: this.tenantId, at: new Date().toISOString(), detail: detail || {} });
    } catch { /* telemetry must never break the operation it describes */ }
  }

  /** fetch with a deadline. A timeout is COULD_NOT_JUDGE, never a verdict. */
  async _request(path, init) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, this.timeoutMs) : null;
    const opts = Object.assign({}, init, {
      headers: Object.assign({}, this._authHeaders(), (init && init.headers) || {}),
      signal: ctl ? ctl.signal : undefined,
    });
    try {
      return await this._fetch(this._url(path), opts);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async heartbeat(opts) {
    const o = opts || {};
    const body = {
      tenant_id: this.tenantId,
      node_id: this.nodeId,
      services: o.services || (await this._services()),
      resource_usage: o.resourceUsage || collectResourceUsage(),
      agent_count: o.agentCount || 0,
      error_count: o.errorCount || 0,
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await this._request("/api/v1/telemetry/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 200 || res.status === 201 || res.status === 202) {
        return inStep("heartbeat accepted (" + res.status + ")");
      }
      return drifted("heartbeat rejected (" + res.status + ")");
    } catch (e) {
      // AbortError, DNS failure, offline, CORS. No response ever existed, so
      // there is nothing to judge.
      return couldNotJudge("network error: " + ((e && e.name) || "Error"));
    }
  }

  async checkUpdates() {
    let res;
    try {
      res = await this._request("/api/v1/packs/updates", { method: "GET" });
    } catch (e) {
      return couldNotJudge("network error: " + ((e && e.name) || "Error"));
    }
    if (res.status !== 200) return couldNotJudge("platform returned " + res.status);
    let data;
    try {
      data = await res.json();
    } catch {
      return couldNotJudge("response not JSON");
    }
    const packs = (data && data.packs) || [];
    if (!packs.length) return inStep("no updates");

    const updates = [];
    for (const spec of packs) {
      const id = spec && (spec.id || spec.pack_id);
      if (id) {
        updates.push({
          id: id,
          kind: (spec && spec.kind) || "tool_pack",
          version: (spec && spec.version) || "",
          metadata: spec,
        });
      }
    }
    if (updates.length && this.onUpdates) {
      // A throwing consumer must not turn a successful check into a failure.
      try { this.onUpdates(updates); } catch { /* callback is best-effort */ }
    }
    if (updates.length) {
      return drifted(updates.length + " updates available", { updates: updates.length });
    }
    return inStep("updates checked");
  }

  async validateLicense() {
    let res;
    try {
      res = await this._request("/api/v1/license/validate", { method: "GET" });
    } catch (e) {
      return couldNotJudge("network error: " + ((e && e.name) || "Error"));
    }
    if (res.status !== 200) return couldNotJudge("platform returned " + res.status);
    let data;
    try {
      data = await res.json();
    } catch {
      return couldNotJudge("response not JSON");
    }
    if (data && data.valid) return inStep("license valid (" + (data.tier || "unknown") + ")");
    return drifted("license invalid: " + ((data && data.reason) || "unspecified"));
  }

  /**
   * Apply pack updates, transactionally where the host gives us the means.
   *
   * This is where awrecover and awshare stop being names in a `pairs_with` list
   * and start doing work:
   *
   *   1. SNAPSHOT first (awrecover). A pack update mutates local state, and
   *      without a snapshot a bad pack is unrecoverable. If a snapshot port is
   *      configured and it FAILS, we do not apply — refusing to change state we
   *      cannot roll back is the fail-closed choice, and "I could not snapshot"
   *      is COULD_NOT_JUDGE, not a drift verdict.
   *   2. FETCH VERIFIED (awshare). A pack pulled from a bare URL and trusted is
   *      the supply-chain hole awshare exists to close. When the port is absent
   *      we pass the pack through UNFETCHED rather than fetching it unverified:
   *      the honest degradation is to do less, not to do it insecurely.
   *   3. APPLY, and on any failure RESTORE (awrecover) — all-or-nothing, which
   *      is awrecover's stated contract. A restore that itself fails is reported
   *      loudly, because a half-applied pack with a failed rollback is the worst
   *      state this function can leave behind and it must never be silent.
   *
   * With no ports configured this is a straight apply, i.e. what a caller who
   * adopted awsync alone already gets.
   */
  async applyUpdates(updates, apply) {
    const list = updates || [];
    if (!list.length) return inStep("nothing to apply");
    if (typeof apply !== "function") return couldNotJudge("no apply function given");

    let handle = null;
    if (this.snapshot) {
      try {
        handle = await this.snapshot("awsync-pre-update-" + Date.now());
      } catch (e) {
        await this._emit("snapshot_failed", { error: String((e && e.message) || e) });
        // Deliberately NOT drifted: we learned nothing about whether we are in
        // step, only that we cannot safely find out.
        return couldNotJudge("snapshot failed, refusing to apply: " + ((e && e.message) || e));
      }
    }

    const prepared = [];
    try {
      for (const pack of list) {
        if (this.fetchArtifact) {
          const artifact = await this.fetchArtifact(pack);
          prepared.push(Object.assign({}, pack, { artifact: artifact }));
        } else {
          prepared.push(pack);
        }
      }
      await apply(prepared);
    } catch (e) {
      const failure = String((e && e.message) || e);
      if (handle && this.restore) {
        try {
          await this.restore(handle);
          await this._emit("update_rolled_back", { error: failure, packs: list.length });
          return drifted("update failed, rolled back: " + failure);
        } catch (re) {
          const restoreError = String((re && re.message) || re);
          await this._emit("rollback_failed", { error: failure, restore_error: restoreError });
          return drifted("update failed AND rollback failed: " + failure + " / " + restoreError);
        }
      }
      await this._emit("update_failed", { error: failure, rollback: "unavailable" });
      return drifted("update failed, no rollback available: " + failure);
    }

    await this._emit("updates_applied", { packs: list.length });
    return inStep(list.length + " update(s) applied");
  }

  /**
   * heartbeat -> updates -> license.
   *
   * Combination order matters and is the Python original's: DRIFTED wins over
   * COULD_NOT_JUDGE, which wins over IN_STEP. A real "we are out of step" must
   * never be masked by an unrelated timeout, and a timeout must never be
   * rounded down to "fine".
   */
  async sync(opts) {
    const results = [
      ["heartbeat", await this.heartbeat(opts)],
      ["updates", await this.checkUpdates()],
      ["license", await this.validateLicense()],
    ];
    const codes = {};
    for (const pair of results) codes[pair[0]] = pair[1].exitCode;
    const messages = results.map(function (p) { return p[1].message; }).filter(Boolean);

    let verdict;
    if (results.some(function (p) { return p[1].exitCode === SYNC_STATUS.DRIFTED; })) {
      verdict = drifted(messages.join(" | ") || "sync detected drift", { results: codes });
    } else if (results.some(function (p) { return p[1].exitCode === SYNC_STATUS.COULD_NOT_JUDGE; })) {
      verdict = couldNotJudge(messages.join(" | ") || "sync could not judge", { results: codes });
    } else {
      verdict = inStep("sync complete", { results: codes });
    }

    /* awrelay. A verdict nobody reads is the failure this fleet has already
     * paid for: on 2026-08-12 the gate probe DETECTED a fleet-wide outage
     * correctly and the page died on the way out, so a nine-hour outage was
     * noticed by a human opening a browser. Detection without delivery is not
     * detection.
     *
     * Only non-IN_STEP is reported. A heartbeat that says "fine" every fifteen
     * minutes is how a channel becomes noise, and a noisy channel is one people
     * mute -- which converts a working alarm into a silent one and is strictly
     * worse than not having it. Reporting must never change the verdict, so a
     * throwing relay is swallowed here and surfaced as its own event. */
    if (this.report && verdict.exitCode !== SYNC_STATUS.IN_STEP) {
      try {
        await this.report(verdict);
      } catch (e) {
        await this._emit("report_failed", { error: String((e && e.message) || e), verdict: verdict.exitCode });
      }
    }
    await this._emit("sync", { exit_code: verdict.exitCode, message: verdict.message, results: codes });
    return verdict;
  }
}

const AwSync = {
  SYNC_STATUS: SYNC_STATUS,
  SyncClient: SyncClient,
  collectResourceUsage: collectResourceUsage,
  inStep: inStep,
  drifted: drifted,
  couldNotJudge: couldNotJudge,
  AWSYNC_VERSION: AWSYNC_VERSION,
};

// Service worker (importScripts) and Node (tests) both, assuming neither.
if (typeof self !== "undefined") self.AwSync = AwSync;
if (typeof module !== "undefined" && module.exports) module.exports = AwSync;
