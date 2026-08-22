/**
 * Awconnect — HAR sealing (service-worker world).
 *
 * The "Send to Aitherium (encrypted)" capture destination seals the HAR to an
 * Aitherium-held Curve25519 public key using NaCl (TweetNaCl, already imported
 * in the service worker). Only the matching PRIVATE key — held server-side in
 * AitherSecrets, never in the extension — can open it. This is end-to-end from
 * the customer's browser: even Aitherium storage/staff cannot read a sealed HAR
 * at rest; only the platform owner, decrypting with the vault key, can.
 *
 * TweetNaCl has no crypto_box_seal, so we implement the sealed-box pattern
 * manually: generate an EPHEMERAL keypair per message, box() to the recipient
 * with a random nonce, and ship {v, epk, nonce, ct} (all base64). The server
 * opens with box.open(ct, nonce, epk, recipientSecret).
 *
 * The recipient public key is FETCHED from the portal's public config route
 * (`/api/config/har-intake-key`) so it can be rotated without re-releasing the
 * extension. A public key is safe to serve unauthenticated. If the route is
 * unreachable or unconfigured, sealing fails CLOSED and the caller must fall
 * back to a plain authenticated workspace upload.
 */

const HAR_INTAKE_KEY_PATH = "/api/config/har-intake-key";
let _cachedIntakeKey = null; // { portal: string, key: Uint8Array, fetched_at: number }
const INTAKE_KEY_TTL_MS = 60 * 60 * 1000; // 1h

function _b64encode(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function _b64decode(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Fetch (and cache) the Aitherium HAR-intake public key from the portal.
 * @param {string} portalUrl - e.g. https://portal.aitherium.com
 * @returns {Promise<Uint8Array>} 32-byte Curve25519 public key
 */
async function getIntakeKey(portalUrl) {
  const now = Date.now();
  const base = String(portalUrl || "").replace(/\/+$/, "");
  // Cache PER PORTAL. This used to be a single global entry with no record of
  // which host it came from, so within the TTL a capture was sealed to whichever
  // portal happened to be configured FIRST. That is wrong in exactly the case
  // this feature exists for: a customer running their own AitherSecrets switches
  // the extension to their host, and their HAR is sealed to OUR public key —
  // travelling to a host that cannot open it, encrypted to a party that was not
  // chosen. Sealing to the wrong recipient is not a cache miss, it is a
  // disclosure decision made by a stale variable.
  if (
    _cachedIntakeKey &&
    _cachedIntakeKey.portal === base &&
    now - _cachedIntakeKey.fetched_at < INTAKE_KEY_TTL_MS
  ) {
    return _cachedIntakeKey.key;
  }
  const url = base + HAR_INTAKE_KEY_PATH;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`HAR intake key unavailable (${res.status})`);
  }
  const payload = await res.json();
  const b64 = payload && payload.public_key;
  if (!b64) throw new Error("HAR intake key not configured on server");
  const key = _b64decode(b64);
  if (key.length !== 32) throw new Error(`intake key wrong length (${key.length}, want 32)`);
  _cachedIntakeKey = { portal: base, key, fetched_at: now };
  return key;
}

/**
 * Seal a HAR log object to the Aitherium intake key.
 * @param {object} harLog - the full HAR document (will be JSON-stringified)
 * @param {string} portalUrl
 * @returns {Promise<{blob: Blob, filename: string, sealed: true, key_id: string}>}
 */
async function sealHar(harLog, portalUrl) {
  if (!self.nacl || !self.nacl.box) {
    throw new Error("NaCl unavailable — cannot seal HAR");
  }
  const recipientPub = await getIntakeKey(portalUrl);
  const message = new TextEncoder().encode(JSON.stringify(harLog));
  const ephemeral = self.nacl.box.keyPair();
  const nonce = self.nacl.randomBytes(self.nacl.box.nonceLength); // 24 bytes
  const ct = self.nacl.box(message, nonce, recipientPub, ephemeral.secretKey);
  if (!ct) throw new Error("seal failed (box returned null)");

  const envelope = {
    v: 1,
    alg: "nacl-box/curve25519-xsalsa20-poly1305",
    epk: _b64encode(ephemeral.publicKey),
    nonce: _b64encode(nonce),
    ct: _b64encode(ct),
    // key fingerprint so the server picks the right private key if rotated
    key_id: _b64encode(recipientPub).slice(0, 12),
    created_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(envelope)], { type: "application/vnd.aither.har+sealed" });
  return { blob, filename: "session.har.sealed", sealed: true, key_id: envelope.key_id };
}

self.AitherHarCrypto = { getIntakeKey, sealHar, _b64encode, _b64decode };
