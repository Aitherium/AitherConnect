/**
 * Embeddings orchestration — provider-agnostic text embedding with
 * feature-hash fallback.
 *
 * Requires (loaded first): shared/feature-hash-embed.js, shared/providers.js
 *
 * Contract:
 *   embedText(text, providerCfg)  → {vector, embedderId}
 *   embedBatch(texts, providerCfg, {concurrency=3, batchSize=16})
 *                                 → {vectors, embedderId}
 *
 * providerCfg = chrome.storage.local "aither-provider" object or null:
 *   { id, apiKey, model, baseUrl?, embeddingModel? }
 *
 * Fallback rules: null config, provider without an embeddings endpoint
 * (Anthropic, OpenRouter), or ANY network/parse error → feature-hash. A
 * batch falls back AS A WHOLE so every chunk in one ingest shares one
 * embedderId (vectors from different embedders must never be compared).
 */

(function () {
  "use strict";

  const FALLBACK_DIM = 384;
  const FALLBACK_ID = "feature-hash:384";

  function hashFallback(texts) {
    return texts.map((t) => self.AitherFeatureHash.embed(t, FALLBACK_DIM));
  }

  /** True when the config can plausibly reach a provider embeddings API. */
  function providerUsable(providerCfg) {
    return !!(
      providerCfg &&
      self.AitherProviders &&
      (providerCfg.apiKey || providerCfg.id === "ollama")
    );
  }

  function resolveModel(providerCfg) {
    if (providerCfg.embeddingModel) return providerCfg.embeddingModel;
    const def = self.AitherProviders.getProvider(providerCfg.id);
    return (def && def.defaultEmbeddingModel) || null;
  }

  /**
   * One embeddings API call for an array of inputs.
   * Throws on any failure — callers decide the fallback.
   */
  async function fetchEmbeddings(providerCfg, inputs) {
    const model = resolveModel(providerCfg);
    if (!model) throw new Error(`no embedding model for provider '${providerCfg.id}'`);

    const req = self.AitherProviders.buildEmbeddingsRequest(providerCfg.id, {
      input: inputs,
      model,
      apiKey: providerCfg.apiKey,
      baseUrlOverride: providerCfg.baseUrl,
    });
    if (!req) throw new Error(`provider '${providerCfg.id}' has no embeddings API`);
    if (req.error) throw new Error(req.error);

    const resp = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`embeddings HTTP ${resp.status}`);

    const json = await resp.json();
    const vectors = req.parseResponse(json);
    if (
      !Array.isArray(vectors) ||
      vectors.length !== inputs.length ||
      !Array.isArray(vectors[0])
    ) {
      throw new Error("invalid embeddings response shape");
    }
    return { vectors, embedderId: `${providerCfg.id}:${model}` };
  }

  /**
   * Embed one text. Never throws — falls back to feature-hash.
   * @returns {Promise<{vector: number[], embedderId: string}>}
   */
  async function embedText(text, providerCfg) {
    if (providerUsable(providerCfg)) {
      try {
        const { vectors, embedderId } = await fetchEmbeddings(providerCfg, [text]);
        return { vector: vectors[0], embedderId };
      } catch (err) {
        console.debug(`[AitherEmbeddings] ${err.message} — using feature-hash`);
      }
    }
    return {
      vector: self.AitherFeatureHash.embed(text, FALLBACK_DIM),
      embedderId: FALLBACK_ID,
    };
  }

  /**
   * Embed many texts: request-level batching + bounded concurrency.
   * Never throws — any failure falls the WHOLE batch back to feature-hash.
   * @returns {Promise<{vectors: number[][], embedderId: string}>}
   */
  async function embedBatch(texts, providerCfg, options = {}) {
    const concurrency = options.concurrency || 3;
    const batchSize = options.batchSize || 16;

    if (!texts || !texts.length) {
      return { vectors: [], embedderId: FALLBACK_ID };
    }

    if (providerUsable(providerCfg)) {
      try {
        const batches = [];
        for (let i = 0; i < texts.length; i += batchSize) {
          batches.push({ start: i, inputs: texts.slice(i, i + batchSize) });
        }
        const out = new Array(texts.length);
        let embedderId = null;
        let next = 0;

        async function worker() {
          while (next < batches.length) {
            const b = batches[next++];
            const r = await fetchEmbeddings(providerCfg, b.inputs);
            embedderId = r.embedderId;
            for (let j = 0; j < r.vectors.length; j++) out[b.start + j] = r.vectors[j];
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(concurrency, batches.length) }, worker),
        );
        return { vectors: out, embedderId };
      } catch (err) {
        console.debug(`[AitherEmbeddings] batch: ${err.message} — using feature-hash for whole batch`);
      }
    }
    return { vectors: hashFallback(texts), embedderId: FALLBACK_ID };
  }

  self.AitherEmbeddings = { embedText, embedBatch };
})();
