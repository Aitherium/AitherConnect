/**
 * License verification and management.
 *
 * Handles Ed25519-signed license envelopes with offline caching.
 * License envelope format: base64url({p, s}) where:
 *   p = base64url(JSON stringified payload)
 *   s = base64url(64-byte Ed25519 signature over the UTF-8 payload)
 *
 * Payload schema: {v, product, tier, email, iat, exp, license_id, install_id}
 *
 * Storage:
 *   chrome.storage.sync.aither-license     → base64url-wrapped envelope
 *   chrome.storage.local.aither-license-cache → {tier, email, expiresAt, verifiedAt}
 */

// Dev public key (32 bytes, base64url). Prod swaps this at build time.
const CONNECT_LICENSE_PUBLIC_KEY_B64 = "6T7Pgck37+FUKVaPTXJK9wfl2xD3GsPjtomi+G1ouPI=";

// Cache validity: 30 days
const CACHE_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;

// Grace period after expiry: 7 days
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Base64url encode without padding.
 */
function base64urlEncode(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Base64url decode with padding normalization.
 */
function base64urlDecode(str) {
  // Add padding
  let padded = str;
  const mod = str.length % 4;
  if (mod) {
    padded += "=".repeat(4 - mod);
  }
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode UTF-8 string to Uint8Array.
 */
function utf8Encode(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Verify a license envelope.
 *
 * @param {string} envelope - base64url({p,s}) or raw JSON {p,s}, or raw JSON payload
 * @param {Object} options - optional {publicKeyB64, now}
 * @returns {Object} {ok, tier, email, expiresAt, grace, reason, payload}
 */
async function verifyLicense(envelope, options = {}) {
  const publicKeyB64 = options.publicKeyB64 || CONNECT_LICENSE_PUBLIC_KEY_B64;
  const now = options.now !== undefined ? options.now : Date.now();

  try {
    if (!self.nacl || !self.nacl.sign || !self.nacl.sign.detached) {
      throw new Error("nacl library not loaded");
    }

    let p, s, payload;

    // Try parsing as envelope object or raw payload
    if (envelope && typeof envelope === "string" && envelope.startsWith("{")) {
      const obj = JSON.parse(envelope);
      if (obj.p && obj.s) {
        // {p, s} envelope
        p = obj.p;
        s = obj.s;
      } else if (obj.v && obj.product) {
        // Raw payload
        payload = obj;
      } else {
        return {
          ok: false,
          tier: "free",
          reason: "invalid envelope format",
        };
      }
    } else if (typeof envelope === "string") {
      // Try base64url-wrapped {p,s}
      try {
        const decoded = base64urlDecode(envelope);
        const str = new TextDecoder().decode(decoded);
        const obj = JSON.parse(str);
        if (obj.p && obj.s) {
          p = obj.p;
          s = obj.s;
        } else {
          return {
            ok: false,
            tier: "free",
            reason: "invalid envelope format",
          };
        }
      } catch (e) {
        return {
          ok: false,
          tier: "free",
          reason: "envelope decode error: " + e.message,
        };
      }
    } else {
      return {
        ok: false,
        tier: "free",
        reason: "envelope must be a string",
      };
    }

    // If no raw payload, extract from signature envelope
    if (!payload) {
      if (!p || !s) {
        return {
          ok: false,
          tier: "free",
          reason: "envelope missing p or s",
        };
      }

      let payloadStr;
      try {
        const pBytes = base64urlDecode(p);
        payloadStr = new TextDecoder().decode(pBytes);
        payload = JSON.parse(payloadStr);
      } catch (e) {
        return {
          ok: false,
          tier: "free",
          reason: "payload decode error: " + e.message,
        };
      }

      // Verify signature
      try {
        const payloadBytes = utf8Encode(payloadStr);
        const sigBytes = base64urlDecode(s);
        const pubKeyBytes = base64urlDecode(publicKeyB64);

        if (pubKeyBytes.length !== 32) {
          return {
            ok: false,
            tier: "free",
            reason: "public key invalid length",
          };
        }

        if (sigBytes.length !== 64) {
          return {
            ok: false,
            tier: "free",
            reason: "signature invalid length",
          };
        }

        const valid = self.nacl.sign.detached.verify(
          payloadBytes,
          sigBytes,
          pubKeyBytes,
        );
        if (!valid) {
          return {
            ok: false,
            tier: "free",
            reason: "signature verification failed",
          };
        }
      } catch (e) {
        return {
          ok: false,
          tier: "free",
          reason: "signature check error: " + e.message,
        };
      }
    }

    // Validate payload schema
    if (!payload.v || payload.v !== 1) {
      return {
        ok: false,
        tier: "free",
        reason: "unsupported license version",
      };
    }

    if (payload.product !== "awconnect") {
      return {
        ok: false,
        tier: "free",
        reason: "license not for aitherconnect",
      };
    }

    const tier = payload.tier;
    if (!["pro", "trial", "free"].includes(tier)) {
      return {
        ok: false,
        tier: "free",
        reason: "invalid tier: " + tier,
      };
    }

    // Check expiry
    const expiresAt = payload.exp ? payload.exp * 1000 : null; // convert epoch seconds to ms
    let grace = false;

    if (expiresAt !== null) {
      const nowSeconds = Math.floor(now / 1000);
      if (nowSeconds > payload.exp) {
        // Expired
        const graceUntil = expiresAt + GRACE_PERIOD_MS;
        if (now < graceUntil) {
          // In grace period
          grace = true;
        } else {
          // Past grace
          return {
            ok: false,
            tier: "free",
            email: payload.email,
            expiresAt,
            reason: "license expired",
          };
        }
      }
    }

    return {
      ok: true,
      tier,
      email: payload.email,
      expiresAt,
      grace,
      reason: grace ? "in grace period" : "ok",
      payload,
    };
  } catch (e) {
    return {
      ok: false,
      tier: "free",
      reason: "verify error: " + e.message,
    };
  }
}

// Tier ordering for "prefer the higher entitlement" logic.
const TIER_RANK = { free: 0, trial: 1, pro: 2 };

/**
 * Read the cloud entitlement cache written by the background worker after
 * sign-in (derived from the authenticated subscription / ACTA plan via
 * /auth/me). This is the "pull it automatically" signal — used when no signed
 * license envelope is present or the envelope's tier is lower.
 * @returns {{tier, plan, email, source, fetchedAt}|null}
 */
async function getCloudEntitlement() {
  try {
    const { "aither-entitlement": ent } = await chrome.storage.local.get(
      "aither-entitlement",
    );
    if (ent && ent.tier && TIER_RANK[ent.tier] !== undefined) return ent;
  } catch (_) {
    /* storage unavailable */
  }
  return null;
}

/**
 * Upgrade a license result with the cloud entitlement when the authenticated
 * subscription grants a higher tier than the local envelope (or there is no
 * envelope). Never downgrades a valid local license.
 */
function _mergeEntitlement(result, ent) {
  if (!ent) return result;
  const have = TIER_RANK[result && result.tier] ?? 0;
  const cloud = TIER_RANK[ent.tier] ?? 0;
  if (cloud > have) {
    return {
      ok: true,
      tier: ent.tier,
      email: ent.email || (result && result.email),
      expiresAt: null,
      reason: "subscription",
      source: "subscription",
    };
  }
  return result;
}

/**
 * Get the effective license: the higher of the local signed envelope and the
 * authenticated cloud entitlement. Falls back to cache if verification fails
 * but cache is fresh.
 */
async function getStoredLicense() {
  const result = await _getEnvelopeLicense();
  const ent = await getCloudEntitlement();
  return _mergeEntitlement(result, ent);
}

/**
 * Local signed-envelope license only (no cloud entitlement). Verifies the
 * stored Ed25519 envelope and updates cache.
 */
async function _getEnvelopeLicense() {
  try {
    const { "aither-license": envelope } = await chrome.storage.sync.get(
      "aither-license",
    );

    if (!envelope) {
      // No license stored, check cache
      const { "aither-license-cache": cache } = await chrome.storage.local.get(
        "aither-license-cache",
      );
      if (cache && cache.verifiedAt) {
        const age = Date.now() - cache.verifiedAt;
        if (age < CACHE_VALIDITY_MS) {
          return {
            ok: true,
            tier: cache.tier || "free",
            email: cache.email,
            expiresAt: cache.expiresAt,
            reason: "cached",
          };
        }
      }
      return {
        ok: true,
        tier: "free",
        reason: "no license",
      };
    }

    // Verify the envelope
    const result = await verifyLicense(envelope);

    // Cache the result
    if (result.ok || result.grace) {
      const cacheEntry = {
        tier: result.tier,
        email: result.email,
        expiresAt: result.expiresAt,
        verifiedAt: Date.now(),
      };
      try {
        await chrome.storage.local.set({ "aither-license-cache": cacheEntry });
      } catch (_) {
        // storage full or unavailable, cache still works in memory
      }
    } else if (result.reason !== "no license") {
      // Verification failed; check for valid cache
      const { "aither-license-cache": cache } = await chrome.storage.local.get(
        "aither-license-cache",
      );
      if (cache && cache.verifiedAt) {
        const age = Date.now() - cache.verifiedAt;
        if (age < CACHE_VALIDITY_MS) {
          return {
            ok: true,
            tier: cache.tier || "free",
            email: cache.email,
            expiresAt: cache.expiresAt,
            reason: "cached",
          };
        }
      }
    }

    return result;
  } catch (e) {
    // chrome.storage unavailable; try memory cache
    const { "aither-license-cache": cache } = await chrome.storage.local
      .get("aither-license-cache")
      .catch(() => ({}));
    if (cache && cache.verifiedAt) {
      const age = Date.now() - cache.verifiedAt;
      if (age < CACHE_VALIDITY_MS) {
        return {
          ok: true,
          tier: cache.tier || "free",
          email: cache.email,
          expiresAt: cache.expiresAt,
          reason: "cached",
        };
      }
    }
    return {
      ok: false,
      tier: "free",
      reason: "storage unavailable: " + e.message,
    };
  }
}

/**
 * Set a new license and verify it.
 */
async function setLicense(envelope) {
  const result = await verifyLicense(envelope);

  if (!result.ok && !result.grace) {
    return result;
  }

  try {
    // Store the envelope
    await chrome.storage.sync.set({ "aither-license": envelope });

    // Cache the result
    const cacheEntry = {
      tier: result.tier,
      email: result.email,
      expiresAt: result.expiresAt,
      verifiedAt: Date.now(),
    };
    await chrome.storage.local.set({ "aither-license-cache": cacheEntry });
  } catch (e) {
    return {
      ok: false,
      tier: "free",
      reason: "storage error: " + e.message,
    };
  }

  return result;
}

/**
 * Clear the stored license and cache.
 */
async function clearLicense() {
  try {
    await chrome.storage.sync.remove("aither-license");
    await chrome.storage.local.remove("aither-license-cache");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "clear error: " + e.message,
    };
  }
}

// Export
self.AitherLicense = {
  verifyLicense,
  getStoredLicense,
  getCloudEntitlement,
  setLicense,
  clearLicense,
  CACHE_VALIDITY_MS,
  GRACE_PERIOD_MS,
  TIER_RANK,
};
