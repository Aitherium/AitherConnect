/**
 * AitherConnect Knowledge Base Manager
 * ====================================
 *
 * Full-tab KB UI: document management, search, chunking, embeddings,
 * quota gating, import/export, dedup detection.
 *
 * Expects these to be pre-loaded in order:
 *  - self.AitherKbDb
 *  - self.AitherChunker
 *  - self.AitherEmbeddings
 *  - self.AitherGating
 */

(() => {
  "use strict";

  // ====================================================================
  // STATE
  // ====================================================================

  const state = {
    docs: [],
    selectedDocId: null,
    searchQuery: "",
    searchResults: [],
    filterSource: "",
    filterTags: [],
    textFilter: "",
    providerCfg: null,
    tier: "free",
    tags: new Set(),
    sources: new Set(),
  };

  // ====================================================================
  // DOM HELPERS
  // ====================================================================

  function qs(selector) { return document.querySelector(selector); }
  function qsa(selector) { return document.querySelectorAll(selector); }

  function on(el, event, handler) {
    if (el) el.addEventListener(event, handler);
  }

  function addClass(el, cls) { if (el) el.classList.add(cls); }
  function removeClass(el, cls) { if (el) el.classList.remove(cls); }
  function toggleClass(el, cls) { if (el) el.classList.toggle(cls); }

  function show(el) { if (el) removeClass(el, "hidden"); }
  function hide(el) { if (el) addClass(el, "hidden"); }

  function setText(el, text) { if (el) el.textContent = text; }
  function setHTML(el, html) { if (el) el.innerHTML = html; }

  // ====================================================================
  // INITIALIZATION
  // ====================================================================

  async function init() {
    // Load provider config (may be undefined)
    const { "aither-provider": cfg } = await chrome.storage.local.get("aither-provider");
    state.providerCfg = cfg;

    // Load gating tier
    try {
      const tier = await self.AitherGating.getTier();
      state.tier = tier;
      updateTierBadge();
    } catch (e) {
      console.debug("[KB] Gating tier load error:", e);
    }

    // Load documents
    await loadDocuments();

    // Update stats
    updateStats();

    // Render initial view
    renderDocsView();

    // Attach event listeners
    attachEventListeners();

    console.log("[KB] Initialized", { tier: state.tier, docCount: state.docs.length });
  }

  // ====================================================================
  // DOCUMENT MANAGEMENT
  // ====================================================================

  async function loadDocuments() {
    try {
      state.docs = await self.AitherKbDb.listDocuments({ limit: 1000 });
      state.tags.clear();
      state.sources.clear();
      state.docs.forEach(doc => {
        doc.tags?.forEach(tag => state.tags.add(tag));
        if (doc.source) state.sources.add(doc.source);
      });
      console.log("[KB] Loaded", state.docs.length, "docs");
    } catch (e) {
      console.error("[KB] Load docs failed:", e);
      showToast("Failed to load documents", "error");
    }
  }

  async function updateStats() {
    try {
      const stats = await self.AitherKbDb.stats();
      setText(qs("#stat-docs"), `${stats.docCount || 0} docs`);
      setText(qs("#stat-chunks"), `${stats.chunkCount || 0} chunks`);
      setText(qs("#stat-chars"), `${stats.charCount || 0} chars`);

      // Update storage usage
      const usage = await self.AitherKbDb.estimateUsage();
      const pct = Math.round((usage.usage / (usage.quota || 1)) * 100);
      const bar = qs("#usage-bar");
      setText(qs("#usage-pct"), `${Math.min(pct, 100)}%`);
      if (bar) {
        bar.style.width = `${Math.min(pct, 100)}%`;
        if (pct > 80) addClass(bar, "warning");
        else removeClass(bar, "warning");
      }
    } catch (e) {
      console.debug("[KB] Stats update error:", e);
    }
  }

  // ====================================================================
  // SEARCH & FILTER
  // ====================================================================

  async function handleSearch() {
    const query = qs("#search-input").value.trim();
    if (!query) {
      renderDocsView();
      return;
    }

    state.searchQuery = query;
    state.searchResults = [];

    try {
      if (!state.providerCfg) {
        showToast("Provider not configured. Configure in Settings.", "error");
        return;
      }

      state.searchResults = await self.AitherKbDb.search(query, state.providerCfg, 10);
      renderSearchResults();
    } catch (e) {
      console.error("[KB] Search failed:", e);
      showToast("Search failed: " + e.message, "error");
    }
  }

  function filterDocs() {
    let filtered = state.docs;

    if (state.filterSource) {
      filtered = filtered.filter(d => d.source === state.filterSource);
    }

    if (state.filterTags.length > 0) {
      filtered = filtered.filter(d =>
        state.filterTags.some(tag => d.tags?.includes(tag))
      );
    }

    if (state.textFilter) {
      const q = state.textFilter.toLowerCase();
      filtered = filtered.filter(d =>
        (d.title?.toLowerCase().includes(q)) ||
        (d.source?.toLowerCase().includes(q))
      );
    }

    return filtered;
  }

  // ====================================================================
  // RENDER: Documents List
  // ====================================================================

  function renderDocsView() {
    const docsList = qs("#docs-list");
    const emptyState = qs("#empty-state");
    const docsView = qs("#docs-view");
    const searchView = qs("#search-results-view");

    removeClass(searchView, "active");
    addClass(docsView, "active");

    const filtered = filterDocs();
    if (filtered.length === 0 && state.docs.length === 0) {
      show(emptyState);
      hide(docsList);
      return;
    }

    hide(emptyState);
    show(docsList);
    setHTML(docsList, "");

    filtered.forEach(doc => {
      const row = document.createElement("div");
      row.className = "doc-row";
      row.dataset.docId = doc.id;

      const favicon = document.createElement("div");
      favicon.className = "doc-favicon";
      favicon.textContent = "📄";

      const info = document.createElement("div");
      info.className = "doc-info";

      const title = document.createElement("div");
      title.className = "doc-title";
      title.textContent = doc.title || "Untitled";

      const meta = document.createElement("div");
      meta.className = "doc-meta";

      if (doc.source) {
        const source = document.createElement("span");
        source.className = "doc-meta-item";
        source.textContent = doc.source;
        meta.appendChild(source);
      }

      if (doc.chunkCount) {
        const chunks = document.createElement("span");
        chunks.className = "doc-meta-item";
        chunks.textContent = `${doc.chunkCount} chunks`;
        meta.appendChild(chunks);
      }

      if (doc.charCount) {
        const chars = document.createElement("span");
        chunks.className = "doc-meta-item";
        chunks.textContent = `${doc.charCount} chars`;
        meta.appendChild(chunks);
      }

      info.appendChild(title);
      info.appendChild(meta);

      // Tags
      if (doc.tags && doc.tags.length > 0) {
        const tagsDiv = document.createElement("div");
        tagsDiv.className = "doc-tags";
        doc.tags.forEach(tag => {
          const t = document.createElement("span");
          t.className = "doc-tag";
          t.textContent = tag;
          tagsDiv.appendChild(t);
        });
        info.appendChild(tagsDiv);
      }

      // Actions
      const actions = document.createElement("div");
      actions.className = "doc-actions";

      const viewBtn = document.createElement("button");
      viewBtn.className = "doc-action-btn";
      viewBtn.textContent = "View";
      on(viewBtn, "click", (e) => {
        e.stopPropagation();
        showDocDetail(doc.id);
      });
      actions.appendChild(viewBtn);

      const exportBtn = document.createElement("button");
      exportBtn.className = "doc-action-btn";
      exportBtn.textContent = "Export";
      on(exportBtn, "click", (e) => {
        e.stopPropagation();
        exportSingleDoc(doc);
      });
      actions.appendChild(exportBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "doc-action-btn danger";
      deleteBtn.textContent = "Delete";
      on(deleteBtn, "click", (e) => {
        e.stopPropagation();
        confirmDeleteDoc(doc);
      });
      actions.appendChild(deleteBtn);

      row.appendChild(favicon);
      row.appendChild(info);
      row.appendChild(actions);

      on(row, "click", () => showDocDetail(doc.id));
      docsList.appendChild(row);
    });
  }

  // ====================================================================
  // RENDER: Search Results
  // ====================================================================

  function renderSearchResults() {
    const resultsDiv = qs("#search-results");
    const searchView = qs("#search-results-view");
    const docsView = qs("#docs-view");

    removeClass(docsView, "active");
    addClass(searchView, "active");

    setHTML(resultsDiv, "");

    if (state.searchResults.length === 0) {
      resultsDiv.textContent = "No results found.";
      return;
    }

    state.searchResults.forEach(result => {
      const card = document.createElement("div");
      card.className = "search-result-card";

      const title = document.createElement("div");
      title.className = "result-title";
      title.textContent = result.doc.title || "Untitled";
      card.appendChild(title);

      if (result.doc.source) {
        const source = document.createElement("div");
        source.className = "result-source";
        source.textContent = result.doc.source;
        card.appendChild(source);
      }

      const snippet = document.createElement("div");
      snippet.className = "result-snippet";
      const text = result.chunk.text.substring(0, 200);
      const query = state.searchQuery;
      const re = new RegExp(`(${query})`, "gi");
      snippet.innerHTML = text.replace(re, "<em>$1</em>");
      card.appendChild(snippet);

      const score = document.createElement("div");
      score.className = "result-score";
      score.textContent = `Relevance: ${(result.score * 100).toFixed(0)}%`;
      card.appendChild(score);

      on(card, "click", () => showDocDetail(result.doc.id));
      resultsDiv.appendChild(card);
    });
  }

  // ====================================================================
  // DETAIL DRAWER
  // ====================================================================

  async function showDocDetail(docId) {
    const drawer = qs("#detail-drawer");
    const chunksDiv = qs("#detail-chunks");

    try {
      const doc = await self.AitherKbDb.getDocument(docId);
      if (!doc) return;

      state.selectedDocId = docId;
      setText(qs("#detail-title"), doc.title || "Untitled");

      // Metadata
      const meta = qs("#detail-meta");
      const metaItems = [];
      if (doc.source) metaItems.push(`Source: ${doc.source}`);
      if (doc.charCount) metaItems.push(`${doc.charCount} chars`);
      if (doc.chunkCount) metaItems.push(`${doc.chunkCount} chunks`);
      setText(meta, metaItems.join(" · "));

      // Chunks
      const chunks = await self.AitherKbDb.getChunks(docId);
      setHTML(chunksDiv, "");

      chunks.forEach((chunk, idx) => {
        const card = document.createElement("div");
        card.className = "chunk-card";
        card.dataset.chunkId = chunk.id;

        const header = document.createElement("div");
        header.className = "chunk-header";
        header.innerHTML = `<span>Chunk ${idx + 1}</span>`;
        card.appendChild(header);

        const text = document.createElement("div");
        text.className = "chunk-text";
        text.textContent = chunk.text;
        card.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "chunk-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "chunk-action-btn";
        editBtn.textContent = "Edit";
        on(editBtn, "click", () => startEditChunk(chunk.id, chunk.text));
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "chunk-action-btn danger";
        deleteBtn.textContent = "Delete";
        on(deleteBtn, "click", () => deleteChunk(chunk.id));
        actions.appendChild(deleteBtn);

        card.appendChild(actions);
        chunksDiv.appendChild(card);
      });

      addClass(drawer, "active");
    } catch (e) {
      console.error("[KB] Show detail failed:", e);
      showToast("Failed to load document", "error");
    }
  }

  function closeDrawer() {
    const drawer = qs("#detail-drawer");
    removeClass(drawer, "active");
    state.selectedDocId = null;
  }

  async function startEditChunk(chunkId, text) {
    const chunkCard = qs(`[data-chunk-id="${chunkId}"]`);
    const textEl = qs(".chunk-text", chunkCard);
    const actionsEl = qs(".chunk-actions", chunkCard);

    const form = document.createElement("div");
    form.className = "chunk-edit-form";

    const textarea = document.createElement("textarea");
    textarea.className = "chunk-edit-textarea";
    textarea.value = text;
    form.appendChild(textarea);

    const buttons = document.createElement("div");
    buttons.className = "chunk-edit-actions";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    on(saveBtn, "click", async () => {
      const newText = textarea.value;
      try {
        await self.AitherKbDb.updateChunk(chunkId, { text: newText, embedderId: "stale" });
        showToast("Chunk updated. Vector is now stale — you may want to re-embed.", "info");
        if (state.selectedDocId) showDocDetail(state.selectedDocId);
      } catch (e) {
        console.error("[KB] Update chunk failed:", e);
        showToast("Failed to update chunk", "error");
      }
    });
    buttons.appendChild(saveBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    on(cancelBtn, "click", () => {
      if (state.selectedDocId) showDocDetail(state.selectedDocId);
    });
    buttons.appendChild(cancelBtn);

    form.appendChild(buttons);
    setHTML(chunkCard, "");
    chunkCard.appendChild(form);
  }

  async function deleteChunk(chunkId) {
    try {
      await self.AitherKbDb.deleteChunk(chunkId);
      showToast("Chunk deleted", "success");
      if (state.selectedDocId) showDocDetail(state.selectedDocId);
    } catch (e) {
      console.error("[KB] Delete chunk failed:", e);
      showToast("Failed to delete chunk", "error");
    }
  }

  // ====================================================================
  // ADD TEXT/NOTE
  // ====================================================================

  function openAddTextModal() {
    show(qs("#add-text-modal"));
  }

  function closeAddTextModal() {
    hide(qs("#add-text-modal"));
    setText(qs("#add-title"), "");
    setText(qs("#add-content"), "");
    setText(qs("#add-tags"), "");
  }

  async function saveAddText() {
    const title = qs("#add-title").value.trim();
    const content = qs("#add-content").value.trim();
    const tagsStr = qs("#add-tags").value.trim();

    if (!title || !content) {
      showToast("Title and content are required", "error");
      return;
    }

    try {
      // Check quota
      const canAdd = await self.AitherGating.checkKbQuota(state.docs.length + 1);
      if (!canAdd.allowed) {
        showUpsell("KB document limit", canAdd.reason);
        return;
      }

      // Chunk the content
      const chunks = await self.AitherChunker.chunkText(content, { maxTokens: 512, overlapTokens: 64 });

      // Add document
      const doc = await self.AitherKbDb.addDocument({
        title,
        url: "",
        source: "manual",
        tags: tagsStr.split(",").map(t => t.trim()).filter(t => t),
        charCount: content.length,
        chunkCount: chunks.length,
      });

      // Embed chunks if provider configured
      let vectors = [];
      if (state.providerCfg) {
        try {
          const texts = chunks.map(c => c.text);
          const embedded = await self.AitherEmbeddings.embedBatch(texts, state.providerCfg, { concurrency: 3 });
          vectors = embedded.vectors;
        } catch (e) {
          console.warn("[KB] Embedding failed:", e);
          showToast("Chunks added but embedding failed — search may be limited", "error");
        }
      }

      // Add chunks
      const chunkObjs = chunks.map((chunk, idx) => ({
        docId: doc.id,
        chunkIndex: idx,
        text: chunk.text,
        embedderId: vectors[idx] ? "stale" : undefined,
        vector: vectors[idx],
      }));
      await self.AitherKbDb.addChunks(chunkObjs);

      showToast("Document added", "success");
      closeAddTextModal();
      await loadDocuments();
      updateStats();
      renderDocsView();
    } catch (e) {
      console.error("[KB] Add text failed:", e);
      showToast("Failed to add document: " + e.message, "error");
    }
  }

  // ====================================================================
  // UPLOAD FILE
  // ====================================================================

  function openUploadModal() {
    show(qs("#upload-modal"));
  }

  function closeUploadModal() {
    hide(qs("#upload-modal"));
    setText(qs("#upload-title"), "");
    setText(qs("#upload-tags"), "");
    qs("#file-input").value = "";
  }

  async function saveUploadFile() {
    const file = qs("#file-input").files[0];
    if (!file) {
      showToast("Please select a file", "error");
      return;
    }

    if (!["text/plain", "text/markdown"].includes(file.type) && !file.name.match(/\.(txt|md)$/i)) {
      showToast("Only .txt and .md files are supported", "error");
      return;
    }

    const title = qs("#upload-title").value.trim() || file.name.replace(/\.[^.]+$/, "");
    const tagsStr = qs("#upload-tags").value.trim();

    try {
      const content = await file.text();

      // Check quota
      const canAdd = await self.AitherGating.checkKbQuota(state.docs.length + 1);
      if (!canAdd.allowed) {
        showUpsell("KB document limit", canAdd.reason);
        return;
      }

      // Chunk
      const chunks = await self.AitherChunker.chunkText(content, { maxTokens: 512, overlapTokens: 64 });

      // Add document
      const doc = await self.AitherKbDb.addDocument({
        title,
        url: "",
        source: file.name,
        tags: tagsStr.split(",").map(t => t.trim()).filter(t => t),
        charCount: content.length,
        chunkCount: chunks.length,
      });

      // Embed if provider configured
      let vectors = [];
      if (state.providerCfg) {
        try {
          const texts = chunks.map(c => c.text);
          const embedded = await self.AitherEmbeddings.embedBatch(texts, state.providerCfg, { concurrency: 3 });
          vectors = embedded.vectors;
        } catch (e) {
          console.warn("[KB] Embedding failed:", e);
        }
      }

      // Add chunks
      const chunkObjs = chunks.map((chunk, idx) => ({
        docId: doc.id,
        chunkIndex: idx,
        text: chunk.text,
        embedderId: vectors[idx] ? "stale" : undefined,
        vector: vectors[idx],
      }));
      await self.AitherKbDb.addChunks(chunkObjs);

      showToast("File uploaded", "success");
      closeUploadModal();
      await loadDocuments();
      updateStats();
      renderDocsView();
    } catch (e) {
      console.error("[KB] Upload failed:", e);
      showToast("Upload failed: " + e.message, "error");
    }
  }

  // ====================================================================
  // EXPORT
  // ====================================================================

  async function exportAllDocs() {
    const gated = await self.AitherGating.checkGate("kb_export");
    if (!gated.allowed) {
      showUpsell("Export All", gated.reason);
      return;
    }

    try {
      const data = await self.AitherKbDb.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      downloadBlob(blob, "aither-kb-export.json");
      showToast("KB exported", "success");
    } catch (e) {
      console.error("[KB] Export failed:", e);
      showToast("Export failed: " + e.message, "error");
    }
  }

  async function exportSingleDoc(doc) {
    const gated = await self.AitherGating.checkGate("kb_export");
    if (!gated.allowed) {
      showUpsell("Export Document", gated.reason);
      return;
    }

    try {
      const chunks = await self.AitherKbDb.getChunks(doc.id);
      const md = `# ${doc.title || "Untitled"}\n\n**Source:** ${doc.source || "manual"}\n**Tags:** ${(doc.tags || []).join(", ") || "none"}\n\n---\n\n` +
        chunks.map(c => c.text).join("\n\n---\n\n");
      const blob = new Blob([md], { type: "text/markdown" });
      downloadBlob(blob, `${doc.title || "document"}.md`);
      showToast("Document exported", "success");
    } catch (e) {
      console.error("[KB] Export doc failed:", e);
      showToast("Export failed: " + e.message, "error");
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ====================================================================
  // IMPORT
  // ====================================================================

  async function importKbData() {
    const gated = await self.AitherGating.checkGate("kb_import");
    if (!gated.allowed) {
      showUpsell("Import KB Data", gated.reason);
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    on(input, "change", async () => {
      const file = input.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await self.AitherKbDb.importAll(data, { merge: true });
        showToast("Data imported", "success");
        await loadDocuments();
        updateStats();
        renderDocsView();
      } catch (e) {
        console.error("[KB] Import failed:", e);
        showToast("Import failed: " + e.message, "error");
      }
    });
    input.click();
  }

  // ====================================================================
  // DEDUPLICATION
  // ====================================================================

  async function findDuplicates() {
    try {
      const pairs = await self.AitherKbDb.findNearDuplicates({ threshold: 0.85, maxPairs: 20 });
      if (pairs.length === 0) {
        showToast("No near-duplicates found", "info");
        return;
      }

      const panel = qs("#dedup-panel");
      const resultsDiv = qs("#dedup-results");
      setHTML(resultsDiv, "");

      pairs.forEach(pair => {
        const pairEl = document.createElement("div");
        pairEl.className = "dedup-pair";

        const score = document.createElement("div");
        score.className = "dedup-score";
        score.textContent = `Match: ${(pair.score * 100).toFixed(0)}%`;
        pairEl.appendChild(score);

        const excerpts = document.createElement("div");
        excerpts.className = "dedup-excerpts";

        const aExcerpt = document.createElement("div");
        aExcerpt.className = "dedup-excerpt";
        aExcerpt.textContent = pair.a.text.substring(0, 100);
        excerpts.appendChild(aExcerpt);

        const bExcerpt = document.createElement("div");
        bExcerpt.className = "dedup-excerpt";
        bExcerpt.textContent = pair.b.text.substring(0, 100);
        excerpts.appendChild(bExcerpt);

        pairEl.appendChild(excerpts);

        const actions = document.createElement("div");
        actions.className = "dedup-actions";

        const deleteABtn = document.createElement("button");
        deleteABtn.className = "danger";
        deleteABtn.textContent = "Delete A";
        on(deleteABtn, "click", async () => {
          await deleteChunk(pair.a.id);
          await findDuplicates();
        });
        actions.appendChild(deleteABtn);

        const deleteBBtn = document.createElement("button");
        deleteBBtn.className = "danger";
        deleteBBtn.textContent = "Delete B";
        on(deleteBBtn, "click", async () => {
          await deleteChunk(pair.b.id);
          await findDuplicates();
        });
        actions.appendChild(deleteBBtn);

        pairEl.appendChild(actions);
        resultsDiv.appendChild(pairEl);
      });

      addClass(panel, "active");
    } catch (e) {
      console.error("[KB] Dedup failed:", e);
      showToast("Dedup scan failed: " + e.message, "error");
    }
  }

  // ====================================================================
  // DELETE DOCUMENT
  // ====================================================================

  function confirmDeleteDoc(doc) {
    const modal = qs("#delete-confirm-modal");
    setText(qs("#delete-confirm-text"), `Delete "${doc.title || "Untitled"}" and all its chunks?`);
    show(modal);
    state.deleteConfirmDocId = doc.id;
  }

  async function deleteDoc(docId) {
    try {
      await self.AitherKbDb.deleteDocument(docId);
      showToast("Document deleted", "success");
      closeDrawer();
      await loadDocuments();
      updateStats();
      renderDocsView();
    } catch (e) {
      console.error("[KB] Delete doc failed:", e);
      showToast("Delete failed: " + e.message, "error");
    }
  }

  // ====================================================================
  // FILTERING
  // ====================================================================

  function updateFilterSource() {
    state.filterSource = qs("#source-filter").value;
    renderDocsView();
  }

  function updateTextFilter() {
    state.textFilter = qs("#text-filter").value;
    renderDocsView();
  }

  function rebuildSourceFilter() {
    const select = qs("#source-filter");
    setHTML(select, '<option value="">All Sources</option>');
    state.sources.forEach(source => {
      const opt = document.createElement("option");
      opt.value = source;
      opt.textContent = source;
      select.appendChild(opt);
    });
  }

  function rebuildTagChips() {
    const chipsDiv = qs("#tag-chips");
    setHTML(chipsDiv, "");
    state.tags.forEach(tag => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.dataset.tag = tag;
      chip.innerHTML = `${tag} <span class="tag-chip-remove">✕</span>`;
      on(chip, "click", () => {
        const idx = state.filterTags.indexOf(tag);
        if (idx >= 0) {
          state.filterTags.splice(idx, 1);
        } else {
          state.filterTags.push(tag);
        }
        renderDocsView();
        rebuildTagChips();
      });
      chipsDiv.appendChild(chip);
    });
  }

  // ====================================================================
  // UI HELPERS
  // ====================================================================

  function updateTierBadge() {
    const badge = qs("#tier-badge");
    const tierMap = {
      free: "Free",
      trial: "Trial",
      pro: "Pro",
      enterprise: "Enterprise",
    };
    setText(badge, tierMap[state.tier] || state.tier);
  }

  function showToast(message, type = "info") {
    const toast = qs("#toast");
    setText(toast, message);
    removeClass(toast, "hidden");
    removeClass(toast, "success");
    removeClass(toast, "error");
    removeClass(toast, "info");
    addClass(toast, type);
    addClass(toast, "active");

    setTimeout(() => {
      removeClass(toast, "active");
      setTimeout(() => addClass(toast, "hidden"), 300);
    }, 3000);
  }

  function showUpsell(feature, reason) {
    const modal = qs("#upsell-modal");
    setText(qs("#upsell-text"), `${feature} is a Pro feature. ${reason || ""}`);
    addClass(modal, "active");
  }

  function closeUpsell() {
    removeClass(qs("#upsell-modal"), "active");
  }

  function closeAllModals() {
    qsa(".modal").forEach(m => removeClass(m, "active"));
    qsa(".panel").forEach(p => removeClass(p, "active"));
  }

  // ====================================================================
  // EVENT LISTENERS
  // ====================================================================

  function attachEventListeners() {
    // Search
    on(qs("#search-input"), "keydown", (e) => {
      if (e.key === "Enter") handleSearch();
    });
    on(qs("#search-input"), "input", (e) => {
      if (!e.target.value.trim()) renderDocsView();
    });

    // Modals: Add Text
    on(qs("#add-text-btn"), "click", openAddTextModal);
    on(qs("#add-text-modal .modal-close"), "click", closeAddTextModal);
    on(qs("#add-text-cancel"), "click", closeAddTextModal);
    on(qs("#add-text-save"), "click", saveAddText);

    // Modals: Upload
    on(qs("#upload-file-btn"), "click", openUploadModal);
    on(qs("#upload-modal .modal-close"), "click", closeUploadModal);
    on(qs("#upload-cancel"), "click", closeUploadModal);
    on(qs("#upload-save"), "click", saveUploadFile);

    // Modals: Delete confirm
    on(qs("#delete-confirm-modal .modal-close"), "click", () => hide(qs("#delete-confirm-modal")));
    on(qs("#delete-cancel"), "click", () => hide(qs("#delete-confirm-modal")));
    on(qs("#delete-confirm"), "click", async () => {
      if (state.deleteConfirmDocId) {
        await deleteDoc(state.deleteConfirmDocId);
        state.deleteConfirmDocId = null;
        hide(qs("#delete-confirm-modal"));
      }
    });

    // Modals: Upsell
    on(qs("#upsell-modal .modal-close"), "click", closeUpsell);
    on(qs("#upsell-close"), "click", closeUpsell);
    on(qs("#upsell-upgrade"), "click", () => {
      chrome.runtime.openOptionsPage();
      closeUpsell();
    });

    // Drawer
    on(qs("#detail-drawer .drawer-close"), "click", closeDrawer);

    // Filters
    on(qs("#source-filter"), "change", updateFilterSource);
    on(qs("#text-filter"), "input", updateTextFilter);

    // Actions
    on(qs("#find-dupes-btn"), "click", findDuplicates);
    on(qs("#export-btn"), "click", exportAllDocs);
    on(qs("#import-btn"), "click", importKbData);

    // Back button in search
    on(qs("#back-to-docs-btn"), "click", () => {
      state.searchQuery = "";
      qs("#search-input").value = "";
      renderDocsView();
    });

    // Dedup panel close
    on(qs("#dedup-close"), "click", () => {
      removeClass(qs("#dedup-panel"), "active");
    });

    // Backdrop clicks to close drawers/panels
    on(document, "keydown", (e) => {
      if (e.key === "Escape") {
        closeDrawer();
        closeAllModals();
        removeClass(qs("#dedup-panel"), "active");
      }
    });

    // Gating checks for buttons
    qsa("[data-gated]").forEach(btn => {
      on(btn, "click", async (e) => {
        const feature = btn.dataset.gated === "true" ? btn.textContent.toLowerCase() : "";
        if (btn.disabled) {
          e.preventDefault();
          return;
        }
      });
    });

    console.log("[KB] Event listeners attached");
  }

  // ====================================================================
  // STARTUP
  // ====================================================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
