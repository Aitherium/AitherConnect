/**
 * Feature-hash embeddings — zero-dependency deterministic embedding fallback.
 *
 * Ported from adk/graph_memory._fallback_embed:
 * - FNV-1a 32-bit hash per word (word → vector[hash % dim] += 1.0)
 * - 3-char prefix buckets weighted 0.5 (context)
 * - L2 normalization
 * - Deterministic, works offline
 */

(function() {
  'use strict';

  const _EMBED_DIM = 384;  // Match nomic-embed-text small dimension

  /**
   * FNV-1a 32-bit hash (unsigned).
   * Pure JS implementation with >>> 0 to ensure unsigned.
   *
   * @param {string} str - Input string
   * @returns {number} 32-bit hash (unsigned)
   */
  function fnv1a32(str) {
    let hash = 2166136261 >>> 0;  // FNV offset basis (unsigned)
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;  // FNV prime (unsigned multiply)
    }
    return hash >>> 0;  // Ensure unsigned
  }

  /**
   * Embed text via feature hashing.
   *
   * @param {string} text - Input text
   * @param {number} [dim=384] - Embedding dimension
   * @returns {Array<number>} L2-normalized embedding vector
   */
  function embed(text, dim = _EMBED_DIM) {
    const vector = new Float32Array(dim);

    // Split into words and hash
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (!word) continue;

      // Main word hash
      const idx = fnv1a32(word) % dim;
      vector[idx] += 1.0;

      // 3-char prefix bucket (weighted 0.5) for context
      if (word.length > 3) {
        const prefix = word.slice(0, 3);
        const idx2 = fnv1a32(prefix) % dim;
        vector[idx2] += 0.5;
      }
    }

    // L2 normalize
    let magnitude = 0.0;
    for (let i = 0; i < dim; i++) {
      magnitude += vector[i] * vector[i];
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude > 0.0) {
      for (let i = 0; i < dim; i++) {
        vector[i] /= magnitude;
      }
    }

    return Array.from(vector);
  }

  /**
   * Cosine similarity between two vectors (pure Python style in JS).
   *
   * @param {Array<number>|Float32Array} a - First vector
   * @param {Array<number>|Float32Array} b - Second vector
   * @returns {number} Cosine similarity in [−1, 1] (typically [0, 1] for L2-normalized)
   */
  function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0.0;

    let dot = 0.0;
    let magA = 0.0;
    let magB = 0.0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0.0 || magB === 0.0) return 0.0;
    return dot / (magA * magB);
  }

  // Export to self
  self.AitherFeatureHash = {
    embed: embed,
    cosineSimilarity: cosineSimilarity,
  };
})();
