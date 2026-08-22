/**
 * Provider registry for Awconnect BYOK (Bring Your Own Key) support.
 *
 * All providers speak OpenAI-compatible /chat/completions API so the
 * existing SSE parser is reused. Models, embeddings, and model listing
 * are provider-specific.
 *
 * Storage contracts:
 *   chrome.storage.local.aither-provider = { id, apiKey, model, baseUrl, embeddingModel }
 *   Keys never stored in chrome.storage.sync.
 */

(function () {
  "use strict";

  /**
   * Provider registry: static definitions for all supported providers.
   * Each provider defines baseUrl, auth style, available models, and API paths.
   */
  const PROVIDERS = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      baseUrl: "https://api.anthropic.com",
      chatPath: "/v1/chat/completions",
      authStyle: "bearer",
      embeddingsPath: null, // Anthropic has no embeddings API
      defaultEmbeddingModel: null,
      models: [
        {
          id: "claude-fable-5",
          label: "Claude Fable 5",
          context: 200000,
        },
        {
          id: "claude-opus-4-8",
          label: "Claude Opus 4.8",
          context: 200000,
        },
        {
          id: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          context: 200000,
        },
        {
          id: "claude-haiku-4-5",
          label: "Claude Haiku 4.5",
          context: 200000,
        },
      ],
      modelListPath: null,
      allowCustomModel: true,
      keyUrl: "https://console.anthropic.com/settings/keys",
      keyPlaceholder: "sk-ant-...",
      needsOriginsHelp: false,
      extraHeaders: {
        "anthropic-dangerous-direct-browser-access": "true",
      },
    },

    openai: {
      id: "openai",
      name: "OpenAI",
      baseUrl: "https://api.openai.com",
      chatPath: "/v1/chat/completions",
      authStyle: "bearer",
      embeddingsPath: "/v1/embeddings",
      defaultEmbeddingModel: "text-embedding-3-small",
      models: [
        { id: "gpt-5.1", label: "GPT-5.1", context: 128000 },
        { id: "gpt-5.1-mini", label: "GPT-5.1 Mini", context: 128000 },
        { id: "gpt-4o", label: "GPT-4o", context: 128000 },
        { id: "gpt-4o-mini", label: "GPT-4o Mini", context: 128000 },
      ],
      modelListPath: "/v1/models",
      allowCustomModel: true,
      keyUrl: "https://platform.openai.com/api-keys",
      keyPlaceholder: "sk-...",
      needsOriginsHelp: false,
      extraHeaders: {},
    },

    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai",
      chatPath: "/api/v1/chat/completions",
      authStyle: "bearer",
      embeddingsPath: null,
      defaultEmbeddingModel: null,
      models: [
        { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", context: 200000 },
        { id: "openai/gpt-5.1", label: "GPT-5.1", context: 128000 },
        { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", context: 128000 },
        { id: "deepseek/deepseek-v4", label: "DeepSeek v4", context: 128000 },
      ],
      modelListPath: "/api/v1/models",
      allowCustomModel: true,
      keyUrl: "https://openrouter.ai/keys",
      keyPlaceholder: "sk-or-...",
      needsOriginsHelp: false,
      extraHeaders: {
        "HTTP-Referer": "https://aitherium.com/connect",
        "X-Title": "Awconnect",
      },
    },

    ollama: {
      id: "ollama",
      name: "Ollama (Local)",
      baseUrl: "http://localhost:11434",
      chatPath: "/v1/chat/completions",
      authStyle: "none",
      embeddingsPath: "/api/embed",
      defaultEmbeddingModel: "nomic-embed-text",
      models: [
        { id: "neural-chat", label: "Neural Chat", context: 4096 },
        { id: "mistral", label: "Mistral", context: 8192 },
        { id: "llama2", label: "Llama 2", context: 4096 },
      ],
      modelListPath: "/api/tags",
      allowCustomModel: true,
      keyUrl: null,
      keyPlaceholder: null,
      needsOriginsHelp: true,
      extraHeaders: {},
    },

    bonsai: {
      id: "bonsai",
      name: "Bonsai-27B (Local, via awnode)",
      // awnode's OpenAI-compatible surface routes bonsai* models to the
      // local Bonsai llama.cpp server (PrismML fork). Point baseUrl straight
      // at the llama.cpp port (default 8092) to bypass the node entirely.
      baseUrl: "http://localhost:8090",
      chatPath: "/v1/chat/completions",
      authStyle: "none",
      embeddingsPath: null,
      defaultEmbeddingModel: null,
      models: [
        { id: "bonsai-27b", label: "Bonsai 27B (reasoning)", context: 4096 },
      ],
      modelListPath: "/v1/models",
      allowCustomModel: true,
      keyUrl: null,
      keyPlaceholder: null,
      needsOriginsHelp: true,
      // Bonsai is a reasoning model: it spends tokens in <think> before any
      // visible answer. Callers must budget generously or content comes back
      // empty with finish_reason=length.
      minMaxTokens: 1024,
      extraHeaders: {},
    },

    gemini: {
      id: "gemini",
      name: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com",
      chatPath: "/v1beta/openai/chat/completions",
      authStyle: "bearer",
      embeddingsPath: "/v1beta/openai/embeddings",
      defaultEmbeddingModel: "gemini-embedding-001",
      models: [
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", context: 1000000 },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", context: 1000000 },
      ],
      modelListPath: null,
      allowCustomModel: true,
      keyUrl: "https://aistudio.google.com/apikey",
      keyPlaceholder: "AIza...",
      needsOriginsHelp: false,
      extraHeaders: {},
    },

    "aither-local": {
      id: "aither-local",
      name: "On-Device (WebGPU)",
      local: true, // sentinel: background routes to the offscreen host, never fetches
      baseUrl: null,
      chatPath: null,
      authStyle: "none",
      embeddingsPath: null, // KB falls back to feature-hash:384
      defaultEmbeddingModel: null,
      // Model list mirrors portal-kit's WebML registry (models.iife.js must
      // load before this file in classic-script contexts). Non-ready rows are
      // visible "summoning soon" slots — UIs render them disabled.
      models: (self.AitherWebMLModels ? self.AitherWebMLModels.WEBML_MODELS : []).map((m) => ({
        id: m.id,
        label: `${m.label || m.id} (${
          m.approxDownloadMB >= 1024
            ? (m.approxDownloadMB / 1024).toFixed(1) + " GB"
            : m.approxDownloadMB + " MB"
        })${m.ready ? "" : " — summoning soon"}`,
        context: m.contextLength || 8192,
        ready: m.ready === true,
      })),
      modelListPath: null,
      allowCustomModel: false,
      keyUrl: null,
      keyPlaceholder: null,
      needsOriginsHelp: false,
      extraHeaders: {},
    },

    custom: {
      id: "custom",
      name: "Custom Endpoint",
      baseUrl: "", // User must provide
      chatPath: "/v1/chat/completions",
      authStyle: "bearer",
      embeddingsPath: "/v1/embeddings",
      defaultEmbeddingModel: null,
      models: [],
      modelListPath: null,
      allowCustomModel: true,
      keyUrl: null,
      keyPlaceholder: null,
      needsOriginsHelp: false,
      extraHeaders: {},
    },
  };

  /**
   * Get a provider definition by id.
   * @param {string} id - Provider id (e.g. "anthropic", "openai")
   * @returns {object|null} Provider definition or null if not found
   */
  function getProvider(id) {
    return PROVIDERS[id] || null;
  }

  /**
   * List all available provider ids.
   * @returns {string[]} Array of provider ids
   */
  function listProviders() {
    return Object.keys(PROVIDERS);
  }

  /**
   * Normalize a URL: remove trailing slashes.
   * @param {string} url
   * @returns {string}
   */
  function normalizeUrl(url) {
    return (url || "").replace(/\/+$/, "");
  }

  /**
   * Build a chat completion request for a given provider.
   * @param {string} id - Provider id
   * @param {object} cfg - Configuration:
   *   - model: string (required)
   *   - messages: array (required)
   *   - apiKey: string (required)
   *   - stream: boolean (default true)
   *   - maxTokens: number (optional)
   *   - temperature: number (optional, 0-2)
   *   - baseUrlOverride: string (optional, overrides provider.baseUrl)
   * @returns {object} { url, headers, body } or { error: string }
   */
  function buildChatRequest(id, cfg) {
    const provider = getProvider(id);
    if (!provider) {
      return { error: `Unknown provider: ${id}` };
    }
    // Defensive: local providers never build HTTP requests — background
    // dispatches them to the offscreen WebGPU host instead.
    if (provider.local) {
      return { error: `Provider '${id}' runs on-device — no HTTP request to build` };
    }

    const {
      model,
      messages,
      apiKey,
      stream = true,
      maxTokens,
      temperature,
      baseUrlOverride,
    } = cfg;

    if (!model || !messages) {
      return { error: "Missing required config: model, messages" };
    }
    // Ollama (authStyle "none") and similar local endpoints need no key
    if (provider.authStyle === "bearer" && !apiKey) {
      return { error: "Missing required config: apiKey" };
    }

    const baseUrl = baseUrlOverride ? normalizeUrl(baseUrlOverride) : normalizeUrl(provider.baseUrl);
    const url = baseUrl + provider.chatPath;

    const headers = new Headers();
    if (provider.authStyle === "bearer") {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
    headers.set("Content-Type", "application/json");

    // Add extra headers (e.g., Anthropic dangerous-direct-browser-access, OpenRouter referer)
    if (provider.extraHeaders) {
      Object.entries(provider.extraHeaders).forEach(([k, v]) => {
        headers.set(k, v);
      });
    }

    const body = {
      model,
      messages,
      stream,
    };

    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }
    // Reasoning models (Bonsai) burn budget in <think> before visible output —
    // enforce the provider's floor so answers don't come back empty.
    if (provider.minMaxTokens && (body.max_tokens === undefined || body.max_tokens < provider.minMaxTokens)) {
      body.max_tokens = provider.minMaxTokens;
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    return {
      url,
      headers: Object.fromEntries(headers),
      body,
    };
  }

  /**
   * Build an embeddings request for a given provider.
   * @param {string} id - Provider id
   * @param {object} cfg - Configuration:
   *   - input: string or string[] (required)
   *   - model: string (required)
   *   - apiKey: string (required)
   *   - baseUrlOverride: string (optional)
   * @returns {object} { url, headers, body, parseResponse } or { error: string } or null if unsupported
   */
  function buildEmbeddingsRequest(id, cfg) {
    const provider = getProvider(id);
    if (!provider) {
      return { error: `Unknown provider: ${id}` };
    }

    // Anthropic and OpenRouter don't have embeddings
    if (!provider.embeddingsPath) {
      return null;
    }

    const { input, model, apiKey, baseUrlOverride } = cfg;

    if (!input || !model) {
      return { error: "Missing required config: input, model" };
    }
    if (provider.authStyle === "bearer" && !apiKey) {
      return { error: "Missing required config: apiKey" };
    }

    const baseUrl = baseUrlOverride ? normalizeUrl(baseUrlOverride) : normalizeUrl(provider.baseUrl);
    const url = baseUrl + provider.embeddingsPath;

    const headers = new Headers();
    if (provider.authStyle === "bearer") {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
    headers.set("Content-Type", "application/json");

    if (provider.extraHeaders) {
      Object.entries(provider.extraHeaders).forEach(([k, v]) => {
        headers.set(k, v);
      });
    }

    let body;
    let parseResponse;

    if (id === "ollama") {
      // Ollama native embed API: {model, input}
      body = {
        model,
        input,
      };
      parseResponse = (json) => json.embeddings || [];
    } else {
      // OpenAI-style: {model, input}
      body = {
        model,
        input,
      };
      parseResponse = (json) => (json.data || []).map((item) => item.embedding);
    }

    return {
      url,
      headers: Object.fromEntries(headers),
      body,
      parseResponse,
    };
  }

  /**
   * Build a minimal test request to validate an API key.
   * @param {string} id - Provider id
   * @param {object} cfg - Configuration:
   *   - apiKey: string (required)
   *   - baseUrlOverride: string (optional)
   * @returns {object} { url, headers, body } or { error: string }
   */
  function buildTestRequest(id, cfg) {
    const provider = getProvider(id);
    if (!provider) {
      return { error: `Unknown provider: ${id}` };
    }

    // Prefer the user's configured model (the catalog is only a fallback —
    // e.g. Ollama catalog models are rarely the ones actually installed)
    let testModel = cfg.model || "test-model";
    if (!cfg.model && provider.models.length > 0) {
      testModel = provider.models[0].id;
    } else if (!cfg.model && id === "custom") {
      testModel = "gpt-3.5-turbo"; // Safe default for custom endpoints
    }

    return buildChatRequest(id, {
      ...cfg,
      model: testModel,
      messages: [{ role: "user", content: "1" }],
      stream: false,
      maxTokens: 1,
    });
  }

  /**
   * Build a model list request for dynamic model discovery.
   * @param {string} id - Provider id
   * @param {object} cfg - Configuration:
   *   - apiKey: string (required)
   *   - baseUrlOverride: string (optional)
   * @returns {object} { url, headers, parseResponse } or null if unsupported
   */
  function buildModelListRequest(id, cfg) {
    const provider = getProvider(id);
    if (!provider) {
      return { error: `Unknown provider: ${id}` };
    }

    if (!provider.modelListPath) {
      return null; // Provider doesn't support dynamic model listing
    }

    const { apiKey, baseUrlOverride } = cfg;

    if (provider.authStyle === "bearer" && !apiKey) {
      return { error: "Missing required config: apiKey" };
    }

    const baseUrl = baseUrlOverride ? normalizeUrl(baseUrlOverride) : normalizeUrl(provider.baseUrl);
    const url = baseUrl + provider.modelListPath;

    const headers = new Headers();
    if (provider.authStyle === "bearer") {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }

    if (provider.extraHeaders) {
      Object.entries(provider.extraHeaders).forEach(([k, v]) => {
        headers.set(k, v);
      });
    }

    let parseResponse;

    if (id === "ollama") {
      // Ollama /api/tags: {models: [{name, ...}]}
      parseResponse = (json) =>
        (json.models || []).map((m) => ({
          id: m.name,
          label: m.name,
        }));
    } else if (id === "openrouter") {
      // OpenRouter /api/v1/models: {data: [{id, ...}]}
      parseResponse = (json) =>
        (json.data || []).map((m) => ({
          id: m.id,
          label: m.name || m.id,
        }));
    } else {
      // OpenAI-style /v1/models: {data: [{id, ...}]}
      parseResponse = (json) =>
        (json.data || []).map((m) => ({
          id: m.id,
          label: m.id,
        }));
    }

    return {
      url,
      headers: Object.fromEntries(headers),
      parseResponse,
    };
  }

  /**
   * Get provider config from chrome storage.
   * @returns {Promise<object|null>} { id, apiKey, model, baseUrl, embeddingModel } or null
   */
  async function getProviderConfig() {
    const { "aither-provider": cfg } = await chrome.storage.local.get("aither-provider");
    return cfg || null;
  }

  /**
   * Save provider config to chrome storage (keys never in sync).
   * @param {object} cfg - Config object
   * @returns {Promise<void>}
   */
  async function setProviderConfig(cfg) {
    await chrome.storage.local.set({ "aither-provider": cfg });
  }

  /**
   * Clear provider config.
   * @returns {Promise<void>}
   */
  async function clearProviderConfig() {
    await chrome.storage.local.remove("aither-provider");
  }

  // Export public API
  self.AitherProviders = {
    PROVIDERS,
    getProvider,
    listProviders,
    buildChatRequest,
    buildEmbeddingsRequest,
    buildTestRequest,
    buildModelListRequest,
    getProviderConfig,
    setProviderConfig,
    clearProviderConfig,
  };
})();
