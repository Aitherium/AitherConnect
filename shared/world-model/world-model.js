/**
 * ArcWorldModel — in-browser tabular world model.
 *
 * A faithful port of the service-side WorldModel (lib/cognitive/UnifiedMCTS.py,
 * WorldModel class) so a player's ARC-AGI-3 games can be learned LIVE in the
 * browser tab: (state_hash, action) -> [TransitionRecord...] with a
 * deterministic 64-bit hash (so observations survive page reloads), running
 * average on repeated transitions, exponential decay on old observations, and
 * JSONL persistence — the same shape WorldModel.save() writes server-side.
 *
 * Deliberate divergences from the Python original (each is a documented choice,
 * not a shortcut):
 *   1. Hashes are stored as 16-char hex STRINGS, not ints. The value is the
 *      same 64-bit integer (int(hex,16)); JS numbers cannot hold it exactly
 *      (>= 2^53) and JSON cannot hold BigInt. To compare/dedup across the
 *      browser<->service boundary, convert: BigInt("0x" + hex).
 *   2. pyStr() stringifies objects as deterministic JSON. Python used the
 *      salted builtin hash() / repr — non-deterministic across processes, which
 *      is exactly what _stable_hash exists to avoid. ARC actions are strings;
 *      objects never reach the hash in practice.
 *   3. Float edge cases differ (e.g. 1e16 -> Python "1e+16", JS "10000000000000000";
 *      NaN -> "nan" vs "NaN"). ARC state/action parts are strings; when a float
 *      participates, use one that JS and Python stringify alike (0.5, 0.95, ...).
 *   4. Rewards and state-values are written in Python's float form ("1.0", not
 *      "1") with compact JSON separators. Value-identical to json.dumps; the
 *      ".0" form lets a Python WorldModel.load() reconstruct the same floats.
 *      Asserted byte-for-byte by world-model.parity.py against the real
 *      WorldModel.save().
 *
 * No chrome.* / DOM / WebCrypto dependencies. Runs as a plain script (attaches
 * self.ArcWorldModel) or under node (module.exports) for tests.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ArcWorldModel = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // SHA-256 (synchronous, self-contained). Must match hashlib.sha256 exactly —
  // that is what the service's _stable_hash uses, and cross-language parity is
  // asserted by the test. (crypto.subtle is async and secure-context-only; a
  // sync port keeps record()/predict() synchronous and testable in node.)
  // ---------------------------------------------------------------------------

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  /**
   * SHA-256 of a Uint8Array, hex-encoded (64 chars). Matches hashlib.sha256.
   */
  function sha256Bytes(bytes) {
    const bitLenHi = Math.floor(bytes.length / 536870912); // (len*8) / 2^32
    const bitLenLo = (bytes.length << 3) >>> 0;
    const paddedLen = ((bytes.length + 8 + 64) >> 6) << 6; // >= len + 1 (0x80) + 8 (len)
    const msg = new Uint8Array(paddedLen);
    msg.set(bytes);
    msg[bytes.length] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(paddedLen - 8, bitLenHi);
    dv.setUint32(paddedLen - 4, bitLenLo);

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64);

    for (let i = 0; i < paddedLen; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3];
      let e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA256_K[t] + W[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    let out = "";
    for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }

  // ---------------------------------------------------------------------------
  // Python-compatible str() for hash parts
  // ---------------------------------------------------------------------------

  /**
   * str(v) as Python would produce it for the primitive types _stable_hash sees.
   * Booleans and null are the traps: Python says "True"/"False"/"None", JS
   * String() says "true"/"false"/"null". Matching Python keeps the hash
   * identical across languages for the same parts.
   */
  function pyStr(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return "(" + v.map(pyStr).join(", ") + ")";
    return JSON.stringify(v); // deterministic fallback (divergence #2)
  }

  /**
   * Python-compatible float rendering for JSON output. Python's
   * json.dumps(1.0) writes "1.0"; JS JSON.stringify(1.0) writes "1". Since JS
   * has one number type, always emit the float form (".0" suffix) so
   * integer-valued rewards round-trip through a Python WorldModel.load() as the
   * same type the service writes.
   */
  function pyFloat(v) {
    if (Number.isInteger(v)) {
      if (Object.is(v, -0)) return "-0.0"; // Python str(-0.0) == "-0.0"
      return v + ".0";
    }
    return String(v);
  }

  /**
   * Deterministic 64-bit state hash, matching the service's _stable_hash:
   *   raw = "\x1f".join(str(part) for part in parts)
   *   return int(sha256(raw.encode("utf-8")).hexdigest()[:16], 16)
   * Returned as the 16-hex-char string (divergence #1).
   */
  function stableHash(...parts) {
    const raw = parts.map(pyStr).join("\x1f");
    return sha256Bytes(new TextEncoder().encode(raw)).slice(0, 16);
  }

  // ---------------------------------------------------------------------------
  // WorldModel — the tabular engine (port of UnifiedMCTS.WorldModel)
  // ---------------------------------------------------------------------------

  function transitionKey(stateHash, action) {
    return stateHash + "\x1f" + pyStr(action);
  }

  class WorldModel {
    constructor() {
      // "stateHash\x1factionKey" -> Array<{nextStateHash, reward, done, count, resultType}>
      this._transitions = new Map();
      // stateHash -> heuristic value
      this._stateValues = new Map();
    }

    /** Record an observed transition (state/action already hashed). */
    record(stateHash, action, nextStateHash, reward, done, resultType = "SUCCESS") {
      const key = transitionKey(stateHash, action);
      let records = this._transitions.get(key);
      if (!records) {
        records = [];
        this._transitions.set(key, records);
      }
      for (const rec of records) {
        if (rec.nextStateHash === nextStateHash) {
          // Running average — same update order as the Python original.
          rec.reward = (rec.reward * rec.count + reward) / (rec.count + 1);
          rec.count += 1;
          rec.resultType = resultType;
          return;
        }
      }
      records.push({ nextStateHash, reward, done, count: 1, resultType });
    }

    /** Convenience: hash raw states, then record. This is what game play calls. */
    observe(state, action, nextState, reward, done, resultType = "SUCCESS") {
      this.record(stableHash(state), action, stableHash(nextState), reward, done, resultType);
    }

    /**
     * Predict outcome of (state, action): the most-observed transition.
     * Returns {nextStateHash, reward, done} or null when unseen.
     */
    predict(stateHash, action) {
      const records = this._transitions.get(transitionKey(stateHash, action));
      if (!records || records.length === 0) return null;
      let best = records[0];
      for (const rec of records) if (rec.count > best.count) best = rec;
      return { nextStateHash: best.nextStateHash, reward: best.reward, done: best.done };
    }

    hasPrediction(stateHash, action) {
      return this._transitions.has(transitionKey(stateHash, action));
    }

    /** Actions we have never observed from this state. */
    getNovelActions(stateHash, actions) {
      return actions.filter((a) => !this._transitions.has(transitionKey(stateHash, a)));
    }

    /** EMA heuristic value: 0.7 * old + 0.3 * new (mirrors the Python). */
    recordStateValue(stateHash, value) {
      const old = this._stateValues.get(stateHash);
      this._stateValues.set(stateHash, old === undefined ? value : 0.7 * old + 0.3 * value);
    }

    getStateValue(stateHash) {
      return this._stateValues.get(stateHash);
    }

    getTransitionCount() {
      let n = 0;
      for (const records of this._transitions.values()) n += records.length;
      return n;
    }

    /** Most-likely result type for (state, action), or null. */
    predictResultType(stateHash, action) {
      const records = this._transitions.get(transitionKey(stateHash, action));
      if (!records || records.length === 0) return null;
      let best = records[0];
      for (const rec of records) if (rec.count > best.count) best = rec;
      return best.resultType;
    }

    /** Observation count of the most-observed transition for (state, action);
     *  0 when unseen. Feeds the surprise metric: surprise = 1/(1+count). */
    predictCount(stateHash, action) {
      const records = this._transitions.get(transitionKey(stateHash, action));
      if (!records || records.length === 0) return 0;
      let best = records[0];
      for (const rec of records) if (rec.count > best.count) best = rec;
      return best.count;
    }

    /** Exponential decay on old observation weights (default 0.95). */
    decay(factor = 0.95) {
      for (const records of this._transitions.values()) {
        for (const rec of records) rec.reward *= factor;
      }
      for (const [sh, val] of this._stateValues) this._stateValues.set(sh, val * factor);
    }

    /**
     * JSONL serialization — the same schema WorldModel.save() writes, one
     * object per line: {type:"transition",...} then {type:"state_value",...}.
     */
    serialize() {
      const lines = [];
      for (const [key, records] of this._transitions) {
        const sep = key.indexOf("\x1f");
        const stateHash = key.slice(0, sep);
        const actionKey = key.slice(sep + 1);
        for (const rec of records) {
          // Hand-built so a float reward stays a float on the wire: JS
          // JSON.stringify(1.0) emits 1, but Python json.dumps(1.0) emits 1.0.
          // pyFloat preserves the float form the service writes.
          lines.push(
            '{"type":"transition","state_hash":' + JSON.stringify(stateHash) +
            ',"action_key":' + JSON.stringify(actionKey) +
            ',"next_state_hash":' + JSON.stringify(rec.nextStateHash) +
            ',"reward":' + pyFloat(rec.reward) +
            ',"done":' + (rec.done ? "true" : "false") +
            ',"count":' + rec.count +
            ',"result_type":' + JSON.stringify(rec.resultType) + '}'
          );
        }
      }
      for (const [sh, val] of this._stateValues) {
        lines.push(
          '{"type":"state_value","state_hash":' + JSON.stringify(sh) +
          ',"value":' + pyFloat(val) + '}'
        );
      }
      return lines.join("\n");
    }

    /** Rebuild a WorldModel from a JSONL string (tolerant of bad lines). */
    static fromJsonl(text) {
      const wm = new WorldModel();
      if (!text) return wm;
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let data;
        try {
          data = JSON.parse(t);
        } catch {
          continue;
        }
        if (data.type === "transition") {
          const key = String(data.state_hash) + "\x1f" + String(data.action_key);
          const records = wm._transitions.get(key) || [];
          records.push({
            nextStateHash: data.next_state_hash,
            reward: data.reward,
            done: data.done,
            count: data.count == null ? 1 : data.count,
            resultType: data.result_type || "SUCCESS",
          });
          wm._transitions.set(key, records);
        } else if (data.type === "state_value") {
          wm._stateValues.set(String(data.state_hash), data.value);
        }
      }
      return wm;
    }
  }

  // ---------------------------------------------------------------------------
  // Journal — localStorage durability with a save throttle.
  // Mirrors _mark_worldmodel_dirty / save_worldmodel: persist every SAVE_EVERY
  // recorded transitions, and on demand.
  // ---------------------------------------------------------------------------

  const WORLDMODEL_SAVE_EVERY = 50; // matches AITHER_WORLDMODEL_SAVE_EVERY default

  /**
   * Wrap a WorldModel with a localStorage-backed save throttle.
   * storage: a {getItem, setItem} object (window.localStorage in the tab).
   * key: storage key for the JSONL journal.
   * saveEvery: auto-persist cadence (default 50 transitions).
   */
  function createJournal(wm, storage, key, saveEvery = WORLDMODEL_SAVE_EVERY) {
    let dirty = 0;
    return {
      /** Record a transition and count toward the auto-save throttle. */
      record(stateHash, action, nextStateHash, reward, done, resultType) {
        wm.record(stateHash, action, nextStateHash, reward, done, resultType);
        dirty += 1;
        if (dirty >= saveEvery) {
          dirty = 0;
          this.save();
        }
      },

      /** Persist now. Returns true on success; never throws (quota/full is
       *  silently kept — the in-memory model stays authoritative). */
      save() {
        dirty = 0;
        try {
          storage.setItem(key, wm.serialize());
          return true;
        } catch {
          return false;
        }
      },

      getWorldModel() {
        return wm;
      },
    };
  }

  /** Load a persisted journal into a fresh WorldModel (empty if none/empty). */
  function loadWorldModel(storage, key) {
    let text = null;
    try {
      text = storage.getItem(key);
    } catch {
      text = null;
    }
    return WorldModel.fromJsonl(text || "");
  }

  return {
    sha256Bytes,
    pyStr,
    pyFloat,
    stableHash,
    WorldModel,
    createJournal,
    loadWorldModel,
    WORLDMODEL_SAVE_EVERY,
  };
});
