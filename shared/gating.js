/**
 * Feature gating and quota enforcement for AitherConnect tiers.
 *
 * Defines free vs pro/trial feature availability and knowledge base quotas.
 * Storage:
 *   Uses AitherLicense.getStoredLicense() for tier verification
 *   In-memory cache: tier results cached for 60s to reduce storage queries
 */

const KB_DOC_LIMIT_FREE = 200;

const FEATURES = {
  auto_harvest: ["pro", "trial"],
  kb_unlimited: ["pro", "trial"],
  kb_export: ["pro", "trial"],
  kb_import: ["pro", "trial"],
  site_packs: ["pro", "trial"],
  multi_provider_profiles: ["pro", "trial"],
};

// In-memory tier cache: {tier, timestamp}
let cachedTier = null;
const TIER_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Get the current tier, with in-memory caching.
 *
 * @returns {Promise<string>} 'free', 'pro', or 'trial'
 */
async function getTier() {
  const now = Date.now();

  // Check cache
  if (cachedTier && now - cachedTier.timestamp < TIER_CACHE_TTL_MS) {
    return cachedTier.tier;
  }

  try {
    const result = await self.AitherLicense.getStoredLicense();
    const tier = result.tier || "free";

    // Update cache
    cachedTier = { tier, timestamp: now };

    return tier;
  } catch (e) {
    console.error("getTier error:", e);
    return "free";
  }
}

/**
 * Check if a feature is allowed for the current tier.
 *
 * @param {string} feature - feature name (e.g., 'auto_harvest')
 * @returns {Promise<Object>} {allowed, tier, reason}
 */
async function checkGate(feature) {
  const tier = await getTier();

  // Unknown features are allowed by default
  if (!FEATURES[feature]) {
    return { allowed: true, tier, reason: "unknown feature" };
  }

  const allowedTiers = FEATURES[feature];
  const allowed = allowedTiers.includes(tier);

  return {
    allowed,
    tier,
    reason: allowed
      ? `${feature} available on ${tier}`
      : `${feature} requires pro/trial`,
  };
}

/**
 * Check knowledge base quota.
 *
 * @param {number} currentDocCount - current number of documents in KB
 * @returns {Promise<Object>} {allowed, limit, remaining, tier}
 */
async function checkKbQuota(currentDocCount) {
  const tier = await getTier();

  if (tier === "pro" || tier === "trial") {
    // Unlimited for pro/trial
    return {
      allowed: true,
      limit: null,
      remaining: null,
      tier,
    };
  }

  // Free tier: 200 doc limit
  const limit = KB_DOC_LIMIT_FREE;
  const allowed = currentDocCount < limit;
  const remaining = Math.max(0, limit - currentDocCount);

  return {
    allowed,
    limit,
    remaining,
    tier,
  };
}

/**
 * Get upsell copy for a feature.
 *
 * @param {string} feature - feature name
 * @returns {string} short human-readable upsell message
 */
function upsellCopy(feature) {
  const messages = {
    auto_harvest: "Upgrade to Pro to enable automatic harvesting",
    kb_unlimited: "Upgrade to Pro for unlimited knowledge base storage",
    kb_export: "Upgrade to Pro to export your knowledge base",
    kb_import: "Upgrade to Pro to import knowledge bases",
    site_packs: "Upgrade to Pro to create site packs",
    multi_provider_profiles:
      "Upgrade to Pro to save multiple provider profiles",
  };

  return messages[feature] || "Upgrade to Pro to unlock this feature";
}

// Export
self.AitherGating = {
  KB_DOC_LIMIT_FREE,
  FEATURES,
  getTier,
  checkGate,
  checkKbQuota,
  upsellCopy,
};
