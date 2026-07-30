/**
 * Knowledge base IndexedDB storage — pure async wrapper, no external deps.
 *
 * Database: 'aitherconnect_kb', version 1
 * Stores: 'documents' (keyPath: 'id'), 'chunks' (keyPath: 'id', index 'docId')
 *
 * Requires: self.AitherFeatureHash.cosineSimilarity, self.AitherEmbeddings
 */

(function() {
  'use strict';

  const DB_NAME = 'aitherconnect_kb';
  const DB_VERSION = 1;
  const STORE_DOCUMENTS = 'documents';
  const STORE_CHUNKS = 'chunks';

  let dbConnection = null;

  /**
   * Promisify an IndexedDB request.
   * @private
   */
  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onerror = () => reject(new Error(req.error?.message || 'IndexedDB error'));
      req.onsuccess = () => resolve(req.result);
    });
  }

  /**
   * Get or create the database connection.
   * @private
   */
  async function getDb() {
    if (dbConnection) return dbConnection;

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;

      // Documents store
      if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
        db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
      }

      // Chunks store with docId index
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunksStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
        chunksStore.createIndex('docId', 'docId', { unique: false });
      }
    };

    dbConnection = await reqToPromise(req);
    return dbConnection;
  }

  /**
   * Add a document to the KB.
   *
   * @param {Object} doc - {id?, title, url, source, tags=[], charCount, chunkCount, createdAt?}
   * @returns {Promise<Object>} Document with id set
   */
  async function addDocument(doc) {
    const db = await getDb();
    const docRecord = {
      id: doc.id || crypto.randomUUID(),
      title: doc.title,
      url: doc.url,
      source: doc.source,
      tags: doc.tags || [],
      charCount: doc.charCount || 0,
      chunkCount: doc.chunkCount || 0,
      createdAt: doc.createdAt || Date.now(),
    };

    const tx = db.transaction([STORE_DOCUMENTS], 'readwrite');
    const store = tx.objectStore(STORE_DOCUMENTS);
    await reqToPromise(store.add(docRecord));

    return docRecord;
  }

  /**
   * Add multiple chunks to the KB.
   *
   * @param {Array} chunks - [{id?, docId, chunkIndex, text, embedderId, vector}]
   * @returns {Promise<number>} Number of chunks added
   */
  async function addChunks(chunks) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS], 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);

    for (const chunk of chunks) {
      const chunkRecord = {
        id: chunk.id || crypto.randomUUID(),
        docId: chunk.docId,
        chunkIndex: chunk.chunkIndex || 0,
        text: chunk.text,
        embedderId: chunk.embedderId,
        vector: chunk.vector,  // Array<number>
      };
      await reqToPromise(store.add(chunkRecord));
    }

    return chunks.length;
  }

  /**
   * List documents with optional filtering and pagination.
   *
   * @param {Object} options - {source?, tag?, query?, limit=200, offset=0}
   * @returns {Promise<Array>} Documents sorted by createdAt desc
   */
  async function listDocuments(options = {}) {
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS], 'readonly');
    const store = tx.objectStore(STORE_DOCUMENTS);

    const allDocs = await reqToPromise(store.getAll());

    // Filter
    let results = allDocs;
    if (options.source) {
      results = results.filter(d => d.source === options.source);
    }
    if (options.tag) {
      results = results.filter(d => d.tags && d.tags.includes(options.tag));
    }
    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(d =>
        (d.title && d.title.toLowerCase().includes(q)) ||
        (d.url && d.url.toLowerCase().includes(q))
      );
    }

    // Sort by createdAt desc
    results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Paginate
    const limit = options.limit || 200;
    const offset = options.offset || 0;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get a single document by id.
   *
   * @param {string} id - Document id
   * @returns {Promise<Object|undefined>}
   */
  async function getDocument(id) {
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS], 'readonly');
    const store = tx.objectStore(STORE_DOCUMENTS);
    return await reqToPromise(store.get(id));
  }

  /**
   * Get all chunks for a document.
   *
   * @param {string} docId - Document id
   * @returns {Promise<Array>} Chunks sorted by chunkIndex
   */
  async function getChunks(docId) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS], 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);
    const index = store.index('docId');

    const chunks = await reqToPromise(index.getAll(docId));
    chunks.sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
    return chunks;
  }

  /**
   * Update a document (patch).
   *
   * @param {string} id - Document id
   * @param {Object} patch - Partial update
   * @returns {Promise<Object>} Updated document
   */
  async function updateDocument(id, patch) {
    const doc = await getDocument(id);
    if (!doc) throw new Error(`Document ${id} not found`);

    const updated = { ...doc, ...patch };
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS], 'readwrite');
    const store = tx.objectStore(STORE_DOCUMENTS);

    await reqToPromise(store.put(updated));
    return updated;
  }

  /**
   * Delete a document and cascade-delete its chunks.
   *
   * @param {string} id - Document id
   * @returns {Promise<void>}
   */
  async function deleteDocument(id) {
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS, STORE_CHUNKS], 'readwrite');

    // Delete document
    await reqToPromise(tx.objectStore(STORE_DOCUMENTS).delete(id));

    // Delete all chunks for this doc
    const index = tx.objectStore(STORE_CHUNKS).index('docId');
    const chunks = await reqToPromise(index.getAll(id));
    const chunksStore = tx.objectStore(STORE_CHUNKS);
    for (const chunk of chunks) {
      await reqToPromise(chunksStore.delete(chunk.id));
    }
  }

  /**
   * Delete a single chunk.
   *
   * @param {string} id - Chunk id
   * @returns {Promise<void>}
   */
  async function deleteChunk(id) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS], 'readwrite');
    await reqToPromise(tx.objectStore(STORE_CHUNKS).delete(id));
  }

  /**
   * Update a chunk (patch).
   *
   * @param {string} id - Chunk id
   * @param {Object} patch - Partial update
   * @returns {Promise<Object>} Updated chunk
   */
  async function updateChunk(id, patch) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS], 'readonly');
    const chunk = await reqToPromise(tx.objectStore(STORE_CHUNKS).get(id));
    if (!chunk) throw new Error(`Chunk ${id} not found`);

    const updated = { ...chunk, ...patch };
    const rwTx = db.transaction([STORE_CHUNKS], 'readwrite');
    await reqToPromise(rwTx.objectStore(STORE_CHUNKS).put(updated));
    return updated;
  }

  /**
   * Search by vector (semantic search).
   * Scores all chunks with same embedderId, returns top-K with docs joined.
   *
   * @param {Array<number>} queryVector - Query embedding
   * @param {string} embedderId - Embedding model id (filter)
   * @param {number} topK - Max results
   * @returns {Promise<Array<{chunk, doc, score}>>}
   */
  async function searchByVector(queryVector, embedderId, topK = 5) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS, STORE_DOCUMENTS], 'readonly');

    // Scan all chunks with same embedderId
    const allChunks = await reqToPromise(tx.objectStore(STORE_CHUNKS).getAll());
    const candidates = allChunks.filter(c => c.embedderId === embedderId && c.vector);

    // Score and sort
    const scored = candidates.map(chunk => ({
      chunk: chunk,
      score: self.AitherFeatureHash.cosineSimilarity(queryVector, chunk.vector),
    })).sort((a, b) => b.score - a.score).slice(0, topK);

    // Join with documents
    const results = [];
    for (const item of scored) {
      const doc = await getDocument(item.chunk.docId);
      if (doc) {
        results.push({
          chunk: item.chunk,
          doc: doc,
          score: item.score,
        });
      }
    }

    return results;
  }

  /**
   * Search by keyword (exact/substring matching).
   *
   * @param {string} query - Search query
   * @param {number} topK - Max results
   * @returns {Promise<Array<{chunk, doc, score}>>}
   */
  async function searchByKeyword(query, topK = 5) {
    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS, STORE_DOCUMENTS], 'readonly');

    // Tokenize query
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

    // Scan all chunks
    const allChunks = await reqToPromise(tx.objectStore(STORE_CHUNKS).getAll());

    // Score by matched term count
    const scored = [];
    for (const chunk of allChunks) {
      const text = chunk.text.toLowerCase();
      let matchCount = 0;
      for (const term of queryTerms) {
        if (text.includes(term)) matchCount++;
      }
      if (matchCount > 0) {
        const score = matchCount / Math.max(queryTerms.length, 1);
        scored.push({ chunk, score });
      }
    }

    // Sort and take top-K
    scored.sort((a, b) => b.score - a.score);
    const results = [];
    for (const item of scored.slice(0, topK)) {
      const doc = await getDocument(item.chunk.docId);
      if (doc) {
        results.push({
          chunk: item.chunk,
          doc: doc,
          score: item.score,
        });
      }
    }

    return results;
  }

  /**
   * Hybrid search: semantic + keyword.
   *
   * @param {string} query - Search query
   * @param {Object|null} providerCfg - Provider config for embeddings
   * @param {number} topK - Max results
   * @returns {Promise<Array<{chunk, doc, score}>>}
   */
  async function search(query, providerCfg, topK = 5) {
    // Embed query
    const { vector, embedderId } = await self.AitherEmbeddings.embedText(query, providerCfg);

    // Semantic search
    const semanticResults = await searchByVector(vector, embedderId, topK);

    // Keyword search
    const keywordResults = await searchByKeyword(query, topK);

    // Merge: dedupe by chunk id, keyword scores scaled *0.5
    const seen = new Set();
    const merged = [];

    for (const item of semanticResults) {
      seen.add(item.chunk.id);
      merged.push(item);
    }

    for (const item of keywordResults) {
      if (!seen.has(item.chunk.id)) {
        // Scale keyword score by 0.5
        merged.push({
          chunk: item.chunk,
          doc: item.doc,
          score: item.score * 0.5,
        });
        seen.add(item.chunk.id);
      }
    }

    // Re-sort merged results
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
  }

  /**
   * Get KB statistics.
   *
   * @returns {Promise<{docCount, chunkCount, charCount}>}
   */
  async function stats() {
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS, STORE_CHUNKS], 'readonly');

    const docCount = await reqToPromise(tx.objectStore(STORE_DOCUMENTS).count());
    const chunkCount = await reqToPromise(tx.objectStore(STORE_CHUNKS).count());

    // Sum charCount from all docs
    const allDocs = await reqToPromise(tx.objectStore(STORE_DOCUMENTS).getAll());
    const charCount = allDocs.reduce((sum, doc) => sum + (doc.charCount || 0), 0);

    return {
      docCount,
      chunkCount,
      charCount,
    };
  }

  /**
   * Estimate storage usage via navigator.storage.estimate().
   *
   * @returns {Promise<{usage, quota, fraction}>}
   */
  async function estimateUsage() {
    if (!navigator.storage || !navigator.storage.estimate) {
      return { usage: 0, quota: 0, fraction: 0 };
    }
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
      fraction: estimate.quota ? (estimate.usage / estimate.quota) : 0,
    };
  }

  /**
   * Export all data (documents + chunks).
   *
   * @returns {Promise<{version, exportedAt, documents, chunks}>}
   */
  async function exportAll() {
    const db = await getDb();
    const tx = db.transaction([STORE_DOCUMENTS, STORE_CHUNKS], 'readonly');

    const documents = await reqToPromise(tx.objectStore(STORE_DOCUMENTS).getAll());
    const chunks = await reqToPromise(tx.objectStore(STORE_CHUNKS).getAll());

    return {
      version: 1,
      exportedAt: Date.now(),
      documents,
      chunks,
    };
  }

  /**
   * Import data (documents + chunks).
   * Validates shape; optionally merges (skips existing ids on merge=true).
   *
   * @param {Object} data - {version, documents, chunks, ...}
   * @param {Object} options - {merge=true}
   * @returns {Promise<{docsAdded, chunksAdded}>}
   */
  async function importAll(data, options = {}) {
    const merge = options.merge !== false;
    const documents = data.documents || [];
    const chunks = data.chunks || [];

    const db = await getDb();
    const docTx = db.transaction([STORE_DOCUMENTS], merge ? 'readonly' : 'readwrite');
    const chunkTx = db.transaction([STORE_CHUNKS], merge ? 'readonly' : 'readwrite');

    let docsAdded = 0;
    let chunksAdded = 0;

    if (merge) {
      // Get existing ids
      const existingDocs = await reqToPromise(docTx.objectStore(STORE_DOCUMENTS).getAll());
      const existingDocIds = new Set(existingDocs.map(d => d.id));

      const existingChunks = await reqToPromise(chunkTx.objectStore(STORE_CHUNKS).getAll());
      const existingChunkIds = new Set(existingChunks.map(c => c.id));

      // Add new docs
      const rwDocTx = db.transaction([STORE_DOCUMENTS], 'readwrite');
      for (const doc of documents) {
        if (!existingDocIds.has(doc.id)) {
          await reqToPromise(rwDocTx.objectStore(STORE_DOCUMENTS).add(doc));
          docsAdded++;
        }
      }

      // Add new chunks
      const rwChunkTx = db.transaction([STORE_CHUNKS], 'readwrite');
      for (const chunk of chunks) {
        if (!existingChunkIds.has(chunk.id)) {
          await reqToPromise(rwChunkTx.objectStore(STORE_CHUNKS).add(chunk));
          chunksAdded++;
        }
      }
    } else {
      // Overwrite mode
      const rwDocTx = db.transaction([STORE_DOCUMENTS], 'readwrite');
      const rwChunkTx = db.transaction([STORE_CHUNKS], 'readwrite');

      // Clear and add docs
      await reqToPromise(rwDocTx.objectStore(STORE_DOCUMENTS).clear());
      for (const doc of documents) {
        await reqToPromise(rwDocTx.objectStore(STORE_DOCUMENTS).add(doc));
        docsAdded++;
      }

      // Clear and add chunks
      await reqToPromise(rwChunkTx.objectStore(STORE_CHUNKS).clear());
      for (const chunk of chunks) {
        await reqToPromise(rwChunkTx.objectStore(STORE_CHUNKS).add(chunk));
        chunksAdded++;
      }
    }

    return { docsAdded, chunksAdded };
  }

  /**
   * Find near-duplicate chunks via cosine similarity (same embedderId).
   * Caps pairwise comparisons at ~250k ops (samples if larger).
   *
   * @param {Object} options - {threshold=0.95, maxPairs=50}
   * @returns {Promise<Array<{a, b, score}>>}
   */
  async function findNearDuplicates(options = {}) {
    const threshold = options.threshold || 0.95;
    const maxPairs = options.maxPairs || 50;

    const db = await getDb();
    const tx = db.transaction([STORE_CHUNKS], 'readonly');
    const allChunks = await reqToPromise(tx.objectStore(STORE_CHUNKS).getAll());

    // Group by embedderId
    const byEmbedderId = {};
    for (const chunk of allChunks) {
      if (!byEmbedderId[chunk.embedderId]) {
        byEmbedderId[chunk.embedderId] = [];
      }
      byEmbedderId[chunk.embedderId].push(chunk);
    }

    const results = [];
    const opsBudget = 250000;

    for (const embedderId in byEmbedderId) {
      const chunks = byEmbedderId[embedderId].filter(c => c.vector);
      const n = chunks.length;
      let opsUsed = 0;

      // Pairwise compare (with sampling if needed)
      for (let i = 0; i < n && results.length < maxPairs; i++) {
        for (let j = i + 1; j < n && results.length < maxPairs; j++) {
          opsUsed++;
          if (opsUsed > opsBudget) break;

          const score = self.AitherFeatureHash.cosineSimilarity(
            chunks[i].vector,
            chunks[j].vector
          );
          if (score >= threshold) {
            results.push({
              a: { chunk: chunks[i] },
              b: { chunk: chunks[j] },
              score: score,
            });
          }
        }
        if (opsUsed > opsBudget) break;
      }
    }

    return results;
  }

  // Export to self
  self.AitherKbDb = {
    addDocument,
    addChunks,
    listDocuments,
    getDocument,
    getChunks,
    updateDocument,
    deleteDocument,
    deleteChunk,
    updateChunk,
    searchByVector,
    searchByKeyword,
    search,
    stats,
    estimateUsage,
    exportAll,
    importAll,
    findNearDuplicates,
  };
})();
