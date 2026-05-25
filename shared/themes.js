/**
 * AitherConnect Theme System
 * ============================
 * Shared theme definitions for the Chrome extension (sidepanel + popup).
 * Theme IDs match AitherVeil themes so preferences stay consistent.
 *
 * Each theme overrides the CSS custom properties defined in sidepanel.html / popup.html.
 * Stored in chrome.storage.sync under key "aitherveil-theme".
 */

const AITHER_THEMES = {
  "dark-glass": {
    name: "Dark Glass",
    category: "dark",
    previewAccent: "#7c6fc4",
    vars: {
      "--bg-primary": "#030305",
      "--bg-secondary": "rgba(15, 15, 20, 0.4)",
      "--bg-tertiary": "rgba(30, 30, 40, 0.3)",
      "--bg-hover": "rgba(255, 255, 255, 0.05)",
      "--border": "rgba(255, 255, 255, 0.06)",
      "--border-bright": "rgba(255, 255, 255, 0.12)",
      "--text-primary": "#f2f2f5",
      "--text-secondary": "#94a3b8",
      "--text-muted": "#526072",
      "--accent": "#22d3ee",
      "--accent-dim": "rgba(34, 211, 238, 0.1)",
      "--accent-glow": "0 0 15px rgba(34, 211, 238, 0.25)",
      "--success": "#10b981",
      "--warning": "#f59e0b",
      "--error": "#ef4444",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)",
    ],
  },

  "midnight-ocean": {
    name: "Midnight Ocean",
    category: "cool",
    previewAccent: "#2dd4bf",
    vars: {
      "--bg-primary": "#020a12",
      "--bg-secondary": "rgba(10, 25, 40, 0.5)",
      "--bg-tertiary": "rgba(15, 35, 55, 0.35)",
      "--bg-hover": "rgba(45, 212, 191, 0.06)",
      "--border": "rgba(45, 212, 191, 0.08)",
      "--border-bright": "rgba(45, 212, 191, 0.18)",
      "--text-primary": "#e0f2f1",
      "--text-secondary": "#80cbc4",
      "--text-muted": "#4a7c7a",
      "--accent": "#2dd4bf",
      "--accent-dim": "rgba(45, 212, 191, 0.12)",
      "--accent-glow": "0 0 15px rgba(45, 212, 191, 0.25)",
      "--success": "#34d399",
      "--warning": "#fbbf24",
      "--error": "#f87171",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(45, 212, 191, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(34, 211, 238, 0.06) 0%, transparent 50%)",
    ],
  },

  "neon-cyberpunk": {
    name: "Neon Cyberpunk",
    category: "vibrant",
    previewAccent: "#e879f9",
    vars: {
      "--bg-primary": "#0a0212",
      "--bg-secondary": "rgba(25, 8, 38, 0.5)",
      "--bg-tertiary": "rgba(40, 15, 55, 0.35)",
      "--bg-hover": "rgba(232, 121, 249, 0.06)",
      "--border": "rgba(232, 121, 249, 0.10)",
      "--border-bright": "rgba(232, 121, 249, 0.22)",
      "--text-primary": "#faf5ff",
      "--text-secondary": "#d8b4fe",
      "--text-muted": "#7c3aed",
      "--accent": "#e879f9",
      "--accent-dim": "rgba(232, 121, 249, 0.12)",
      "--accent-glow": "0 0 18px rgba(232, 121, 249, 0.30)",
      "--success": "#4ade80",
      "--warning": "#facc15",
      "--error": "#fb7185",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(232, 121, 249, 0.10) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(139, 92, 246, 0.08) 0%, transparent 50%)",
    ],
  },

  "forest-depth": {
    name: "Forest Depth",
    category: "cool",
    previewAccent: "#4ade80",
    vars: {
      "--bg-primary": "#020d06",
      "--bg-secondary": "rgba(8, 28, 14, 0.5)",
      "--bg-tertiary": "rgba(15, 40, 22, 0.35)",
      "--bg-hover": "rgba(74, 222, 128, 0.06)",
      "--border": "rgba(74, 222, 128, 0.08)",
      "--border-bright": "rgba(74, 222, 128, 0.18)",
      "--text-primary": "#ecfdf5",
      "--text-secondary": "#86efac",
      "--text-muted": "#3d7a52",
      "--accent": "#4ade80",
      "--accent-dim": "rgba(74, 222, 128, 0.12)",
      "--accent-glow": "0 0 15px rgba(74, 222, 128, 0.25)",
      "--success": "#34d399",
      "--warning": "#fbbf24",
      "--error": "#f87171",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(74, 222, 128, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(52, 211, 153, 0.06) 0%, transparent 50%)",
    ],
  },

  "sunset-horizon": {
    name: "Sunset Horizon",
    category: "warm",
    previewAccent: "#fb923c",
    vars: {
      "--bg-primary": "#0d0504",
      "--bg-secondary": "rgba(35, 14, 10, 0.5)",
      "--bg-tertiary": "rgba(50, 22, 15, 0.35)",
      "--bg-hover": "rgba(251, 146, 60, 0.06)",
      "--border": "rgba(251, 146, 60, 0.10)",
      "--border-bright": "rgba(251, 146, 60, 0.20)",
      "--text-primary": "#fff7ed",
      "--text-secondary": "#fdba74",
      "--text-muted": "#9a4a20",
      "--accent": "#fb923c",
      "--accent-dim": "rgba(251, 146, 60, 0.12)",
      "--accent-glow": "0 0 15px rgba(251, 146, 60, 0.25)",
      "--success": "#4ade80",
      "--warning": "#fbbf24",
      "--error": "#fb7185",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(251, 146, 60, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(244, 63, 94, 0.06) 0%, transparent 50%)",
    ],
  },

  "arctic-nord": {
    name: "Arctic Nord",
    category: "cool",
    previewAccent: "#88c0d0",
    vars: {
      "--bg-primary": "#1a2028",
      "--bg-secondary": "rgba(35, 45, 58, 0.5)",
      "--bg-tertiary": "rgba(48, 60, 75, 0.35)",
      "--bg-hover": "rgba(136, 192, 208, 0.06)",
      "--border": "rgba(136, 192, 208, 0.10)",
      "--border-bright": "rgba(136, 192, 208, 0.20)",
      "--text-primary": "#eceff4",
      "--text-secondary": "#88c0d0",
      "--text-muted": "#5a7a88",
      "--accent": "#88c0d0",
      "--accent-dim": "rgba(136, 192, 208, 0.12)",
      "--accent-glow": "0 0 12px rgba(136, 192, 208, 0.20)",
      "--success": "#a3be8c",
      "--warning": "#ebcb8b",
      "--error": "#bf616a",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(136, 192, 208, 0.06) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(94, 129, 172, 0.05) 0%, transparent 50%)",
    ],
  },

  "monokai-pro": {
    name: "Monokai Pro",
    category: "classic",
    previewAccent: "#ffd866",
    vars: {
      "--bg-primary": "#1e1c1a",
      "--bg-secondary": "rgba(40, 38, 35, 0.5)",
      "--bg-tertiary": "rgba(55, 52, 48, 0.35)",
      "--bg-hover": "rgba(255, 216, 102, 0.06)",
      "--border": "rgba(255, 216, 102, 0.10)",
      "--border-bright": "rgba(255, 216, 102, 0.20)",
      "--text-primary": "#fcfcfa",
      "--text-secondary": "#c1c0c0",
      "--text-muted": "#727072",
      "--accent": "#ffd866",
      "--accent-dim": "rgba(255, 216, 102, 0.12)",
      "--accent-glow": "0 0 12px rgba(255, 216, 102, 0.20)",
      "--success": "#a9dc76",
      "--warning": "#ffd866",
      "--error": "#ff6188",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(255, 216, 102, 0.05) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(171, 157, 242, 0.04) 0%, transparent 50%)",
    ],
  },

  "rose-gold": {
    name: "Rosé Gold",
    category: "warm",
    previewAccent: "#f9a8d4",
    vars: {
      "--bg-primary": "#0d0408",
      "--bg-secondary": "rgba(32, 12, 20, 0.5)",
      "--bg-tertiary": "rgba(48, 18, 30, 0.35)",
      "--bg-hover": "rgba(249, 168, 212, 0.06)",
      "--border": "rgba(249, 168, 212, 0.10)",
      "--border-bright": "rgba(249, 168, 212, 0.20)",
      "--text-primary": "#fdf2f8",
      "--text-secondary": "#f9a8d4",
      "--text-muted": "#9f4d78",
      "--accent": "#f9a8d4",
      "--accent-dim": "rgba(249, 168, 212, 0.12)",
      "--accent-glow": "0 0 15px rgba(249, 168, 212, 0.25)",
      "--success": "#4ade80",
      "--warning": "#fbbf24",
      "--error": "#fb7185",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(249, 168, 212, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(217, 119, 6, 0.05) 0%, transparent 50%)",
    ],
  },

  "crimson-night": {
    name: "Crimson Night",
    category: "dark",
    previewAccent: "#f87171",
    vars: {
      "--bg-primary": "#0a0304",
      "--bg-secondary": "rgba(28, 10, 12, 0.5)",
      "--bg-tertiary": "rgba(42, 15, 18, 0.35)",
      "--bg-hover": "rgba(248, 113, 113, 0.06)",
      "--border": "rgba(248, 113, 113, 0.10)",
      "--border-bright": "rgba(248, 113, 113, 0.20)",
      "--text-primary": "#fef2f2",
      "--text-secondary": "#fca5a5",
      "--text-muted": "#853434",
      "--accent": "#f87171",
      "--accent-dim": "rgba(248, 113, 113, 0.12)",
      "--accent-glow": "0 0 15px rgba(248, 113, 113, 0.25)",
      "--success": "#4ade80",
      "--warning": "#fbbf24",
      "--error": "#ef4444",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(248, 113, 113, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(244, 63, 94, 0.06) 0%, transparent 50%)",
    ],
  },

  "solar-flare": {
    name: "Solar Flare",
    category: "vibrant",
    previewAccent: "#fbbf24",
    vars: {
      "--bg-primary": "#0d0802",
      "--bg-secondary": "rgba(30, 18, 6, 0.5)",
      "--bg-tertiary": "rgba(45, 28, 10, 0.35)",
      "--bg-hover": "rgba(251, 191, 36, 0.06)",
      "--border": "rgba(251, 191, 36, 0.10)",
      "--border-bright": "rgba(251, 191, 36, 0.20)",
      "--text-primary": "#fffbeb",
      "--text-secondary": "#fcd34d",
      "--text-muted": "#92600a",
      "--accent": "#fbbf24",
      "--accent-dim": "rgba(251, 191, 36, 0.12)",
      "--accent-glow": "0 0 15px rgba(251, 191, 36, 0.25)",
      "--success": "#4ade80",
      "--warning": "#fbbf24",
      "--error": "#f87171",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(251, 191, 36, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(245, 158, 11, 0.06) 0%, transparent 50%)",
    ],
  },

  "matrix-green": {
    name: "Matrix",
    category: "classic",
    previewAccent: "#22c55e",
    vars: {
      "--bg-primary": "#000a02",
      "--bg-secondary": "rgba(4, 22, 8, 0.5)",
      "--bg-tertiary": "rgba(8, 35, 14, 0.35)",
      "--bg-hover": "rgba(34, 197, 94, 0.06)",
      "--border": "rgba(34, 197, 94, 0.10)",
      "--border-bright": "rgba(34, 197, 94, 0.20)",
      "--text-primary": "#bbf7d0",
      "--text-secondary": "#4ade80",
      "--text-muted": "#166534",
      "--accent": "#22c55e",
      "--accent-dim": "rgba(34, 197, 94, 0.12)",
      "--accent-glow": "0 0 15px rgba(34, 197, 94, 0.25)",
      "--success": "#22c55e",
      "--warning": "#a3e635",
      "--error": "#ef4444",
    },
    ambient: [
      "radial-gradient(circle at 0% 0%, rgba(34, 197, 94, 0.08) 0%, transparent 50%)",
      "radial-gradient(circle at 100% 100%, rgba(22, 163, 74, 0.05) 0%, transparent 50%)",
    ],
  },
};

const THEME_STORAGE_KEY = "aitherveil-theme";
const DEFAULT_THEME_ID = "dark-glass";

/**
 * Apply a theme's CSS variables to the document root.
 * @param {string} themeId
 */
function applyTheme(themeId) {
  const theme = AITHER_THEMES[themeId] || AITHER_THEMES[DEFAULT_THEME_ID];
  const root = document.documentElement;

  // Apply CSS variables
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }

  // Apply ambient background
  if (theme.ambient) {
    document.body.style.backgroundImage = theme.ambient.join(", ");
  }

  // Store attribute for CSS selectors
  root.setAttribute("data-theme", themeId);
}

/**
 * Load the saved theme from chrome.storage.sync (or localStorage fallback)
 * and apply it. Returns the resolved theme ID.
 * @returns {Promise<string>}
 */
async function loadAndApplyTheme() {
  let themeId = DEFAULT_THEME_ID;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      const result = await chrome.storage.sync.get(THEME_STORAGE_KEY);
      if (result[THEME_STORAGE_KEY] && AITHER_THEMES[result[THEME_STORAGE_KEY]]) {
        themeId = result[THEME_STORAGE_KEY];
      }
    } else if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored && AITHER_THEMES[stored]) {
        themeId = stored;
      }
    }
  } catch { /* use default */ }

  applyTheme(themeId);
  return themeId;
}

/**
 * Save theme choice to chrome.storage.sync (and localStorage fallback).
 * @param {string} themeId
 */
async function saveTheme(themeId) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      await chrome.storage.sync.set({ [THEME_STORAGE_KEY]: themeId });
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    }
  } catch { /* silently fail */ }
}

/**
 * Render a theme picker UI into the given container element.
 * @param {HTMLElement} container
 * @param {string} currentThemeId
 * @param {function(string):void} onSelect - callback when a theme is chosen
 */
function renderThemePicker(container, currentThemeId, onSelect) {
  container.innerHTML = "";

  const categories = [
    { id: "dark", label: "🌑 Dark" },
    { id: "vibrant", label: "⚡ Vibrant" },
    { id: "warm", label: "🔥 Warm" },
    { id: "cool", label: "❄️ Cool" },
    { id: "classic", label: "🎨 Classic" },
  ];

  for (const cat of categories) {
    const themes = Object.entries(AITHER_THEMES).filter(([, t]) => t.category === cat.id);
    if (themes.length === 0) continue;

    const catLabel = document.createElement("div");
    catLabel.style.cssText =
      "font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; " +
      "color: var(--text-muted); padding: 10px 4px 4px;";
    catLabel.textContent = cat.label;
    container.appendChild(catLabel);

    const grid = document.createElement("div");
    grid.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 6px;";

    for (const [id, theme] of themes) {
      const card = document.createElement("button");
      const isActive = id === currentThemeId;
      card.style.cssText =
        "all: unset; cursor: pointer; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; " +
        `border: 2px solid ${isActive ? theme.previewAccent + "88" : "var(--border)"}; ` +
        "transition: all 0.15s ease;";
      card.title = theme.name;

      // Preview bar
      const preview = document.createElement("div");
      preview.style.cssText =
        `height: 28px; background: ${theme.vars["--bg-primary"]}; position: relative; ` +
        "display: flex; align-items: center; justify-content: flex-end; padding: 0 6px;";

      const dot = document.createElement("div");
      dot.style.cssText =
        `width: 8px; height: 8px; border-radius: 50%; background: ${theme.previewAccent};`;
      preview.appendChild(dot);

      // Label area
      const label = document.createElement("div");
      label.style.cssText =
        "padding: 4px 6px; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px; " +
        "background: rgba(0,0,0,0.25); color: var(--text-primary);";
      label.textContent = theme.name;
      if (isActive) {
        const check = document.createElement("span");
        check.textContent = " ✓";
        check.style.cssText = `color: ${theme.previewAccent}; margin-left: auto; font-size: 12px;`;
        label.appendChild(check);
      }

      card.appendChild(preview);
      card.appendChild(label);
      card.addEventListener("click", () => onSelect(id));
      grid.appendChild(card);
    }

    container.appendChild(grid);
  }
}
