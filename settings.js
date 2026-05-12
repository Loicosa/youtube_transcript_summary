(function initYttrSettings(globalScope) {
  const DEFAULT_SETTINGS = {
    autoSubmit: false,
    defaultLanguage: "auto",
    llmProvider: "chatgpt",
    translateFallbackInLlm: false
  };

  const LLM_PROVIDERS = {
    chatgpt: {
      id: "chatgpt",
      label: "ChatGPT",
      url: "https://chatgpt.com/",
      composerSelectors: [
        "#prompt-textarea",
        '[data-testid="prompt-textarea"]',
        'textarea[placeholder*="Message"]',
        "textarea",
        'div[contenteditable="true"]'
      ],
      submitSelectors: [
        '[data-testid="send-button"]',
        'button[data-testid="send-button"]',
        'button[data-testid*="send" i]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="send" i]',
        'button[type="submit"]'
      ]
    },
    claude: {
      id: "claude",
      label: "Claude",
      url: "https://claude.ai/new",
      composerSelectors: [
        '[data-testid="chat-input"]',
        'div[contenteditable="true"]',
        "textarea"
      ],
      submitSelectors: [
        'button[data-testid*="send" i]',
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="send" i]',
        'button[type="submit"]'
      ]
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      url: "https://gemini.google.com/app",
      composerSelectors: [
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"]',
        "textarea"
      ],
      submitSelectors: [
        'button[data-testid*="send" i]',
        'button[aria-label="Send"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Submit"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="submit" i]',
        'button[type="submit"]'
      ]
    }
  };

  function normalizeSettings(settings = {}) {
    return {
      autoSubmit: settings.autoSubmit === true,
      defaultLanguage: normalizeDefaultLanguage(settings.defaultLanguage),
      llmProvider: Object.prototype.hasOwnProperty.call(LLM_PROVIDERS, settings.llmProvider)
        ? settings.llmProvider
        : DEFAULT_SETTINGS.llmProvider,
      translateFallbackInLlm: settings.translateFallbackInLlm === true
    };
  }

  function normalizeDefaultLanguage(languageCode) {
    const value = String(languageCode || "").trim();
    return value ? value : DEFAULT_SETTINGS.defaultLanguage;
  }

  function resolvePreferredLanguageCode(settings = {}, browserLanguage = "en") {
    const normalized = normalizeSettings(settings);
    if (normalized.defaultLanguage !== DEFAULT_SETTINGS.defaultLanguage) {
      return normalized.defaultLanguage;
    }

    const fallback = String(browserLanguage || "").trim();
    return fallback || "en";
  }

  function getLlmProviderConfig(providerId) {
    return LLM_PROVIDERS[providerId] || LLM_PROVIDERS[DEFAULT_SETTINGS.llmProvider];
  }

  async function loadSettings(chromeApi = globalScope.chrome) {
    const area = getStorageArea(chromeApi);
    if (!area) {
      return { ...DEFAULT_SETTINGS };
    }

    const stored = await callStorage(area, "get", DEFAULT_SETTINGS, chromeApi);
    return normalizeSettings(stored);
  }

  async function saveSettings(settings, chromeApi = globalScope.chrome) {
    const normalized = normalizeSettings(settings);
    const area = getStorageArea(chromeApi);
    if (!area) {
      return normalized;
    }

    await callStorage(area, "set", normalized, chromeApi);
    return normalized;
  }

  function getStorageArea(chromeApi) {
    return chromeApi && chromeApi.storage && chromeApi.storage.sync
      ? chromeApi.storage.sync
      : null;
  }

  function callStorage(area, methodName, payload, chromeApi) {
    return new Promise((resolve, reject) => {
      let settled = false;

      function finish(error, value) {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        resolve(value);
      }

      function callback(value) {
        const lastError = chromeApi && chromeApi.runtime && chromeApi.runtime.lastError;
        finish(lastError ? new Error(lastError.message || "Storage operation failed.") : null, value);
      }

      try {
        const maybePromise = area[methodName](payload, callback);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then((value) => finish(null, value), finish);
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  const api = {
    DEFAULT_SETTINGS,
    LLM_PROVIDERS,
    getLlmProviderConfig,
    loadSettings,
    normalizeSettings,
    resolvePreferredLanguageCode,
    saveSettings
  };

  globalScope.YttrSettings = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
