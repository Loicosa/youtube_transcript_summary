if (typeof importScripts === "function" && typeof globalThis.YttrSettings === "undefined") {
  importScripts("settings.js");
}

if (typeof module !== "undefined" && module.exports && typeof globalThis.YttrSettings === "undefined") {
  globalThis.YttrSettings = require("./settings");
}

const OPEN_LLM_SUMMARY_MESSAGE = "YTTR_OPEN_LLM_SUMMARY";
const OPEN_OPTIONS_PAGE_MESSAGE = "YTTR_OPEN_OPTIONS_PAGE";
const CHATGPT_TAB_LOAD_TIMEOUT_MS = 15000;
const WELCOME_PAGE_PATH = "options.html?welcome=1";
const settingsApi = globalThis.YttrSettings;

const hasChromeRuntime =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage &&
  chrome.tabs &&
  chrome.scripting;

if (hasChromeRuntime) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === OPEN_OPTIONS_PAGE_MESSAGE) {
      openOptionsPage()
        .then((opened) => {
          sendResponse({ ok: opened });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error && error.message ? error.message : "Could not open settings."
          });
        });

      return true;
    }

    if (message.type !== OPEN_LLM_SUMMARY_MESSAGE) {
      return false;
    }

    openLlmSummary(message.prompt, message.settings)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          opened: false,
          error: error && error.message ? error.message : "Could not open ChatGPT."
        });
      });

    return true;
  });

  if (chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener) {
    chrome.runtime.onInstalled.addListener((details) => {
      openWelcomePageOnInstall(details).catch((error) => {
        console.error(error);
      });
    });
  }
}

async function openOptionsPage(chromeApi = chrome) {
  if (chromeApi?.runtime?.openOptionsPage) {
    await callChrome(chromeApi, chromeApi.runtime, chromeApi.runtime.openOptionsPage);
    return true;
  }

  if (!chromeApi?.tabs?.create || !chromeApi?.runtime?.getURL) {
    return false;
  }

  await callChrome(chromeApi, chromeApi.tabs, chromeApi.tabs.create, {
    active: true,
    url: chromeApi.runtime.getURL("options.html")
  });
  return true;
}

async function openWelcomePageOnInstall(details, chromeApi = chrome) {
  if (!details || details.reason !== "install" || !chromeApi?.tabs?.create || !chromeApi?.runtime?.getURL) {
    return false;
  }

  await callChrome(chromeApi, chromeApi.tabs, chromeApi.tabs.create, {
    active: true,
    url: chromeApi.runtime.getURL(WELCOME_PAGE_PATH)
  });
  return true;
}

async function openLlmSummary(prompt, settings, chromeApi = chrome) {
  const normalizedSettings = settings
    ? settingsApi.normalizeSettings(settings)
    : await settingsApi.loadSettings(chromeApi);
  const provider = settingsApi.getLlmProviderConfig(normalizedSettings.llmProvider);
  const tab = await callChrome(chromeApi, chromeApi.tabs, chromeApi.tabs.create, {
    active: true,
    url: provider.url
  });
  const tabId = tab && tab.id;

  if (!Number.isInteger(tabId)) {
    return {
      ok: false,
      opened: false,
      error: "ChatGPT tab could not be created."
    };
  }

  await waitForTabReady(chromeApi, tabId, CHATGPT_TAB_LOAD_TIMEOUT_MS);

  try {
    const results = await callChrome(chromeApi, chromeApi.scripting, chromeApi.scripting.executeScript, {
      args: [
        prompt || "",
        {
          composerSelectors: provider.composerSelectors,
          submitSelectors: provider.submitSelectors
        },
        {
          autoSubmit: normalizedSettings.autoSubmit
        }
      ],
      func: fillLlmComposer,
      target: { tabId }
    });
    const result = results && results[0] && results[0].result;

    if (result && result.ok) {
      return {
        ok: true,
        opened: true,
        provider: provider.id,
        submitted: Boolean(result.submitted)
      };
    }

    return {
      ok: false,
      opened: true,
      error: result && result.error ? result.error : "ChatGPT prompt insertion failed."
    };
  } catch (error) {
    return {
      ok: false,
      opened: true,
      error: error && error.message ? error.message : "ChatGPT prompt insertion failed."
    };
  }
}

async function openChatGptSummary(prompt, chromeApi = chrome) {
  return openLlmSummary(prompt, { llmProvider: "chatgpt" }, chromeApi);
}

function waitForTabReady(chromeApi, tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;

    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      if (chromeApi.tabs.onUpdated && chromeApi.tabs.onUpdated.removeListener) {
        chromeApi.tabs.onUpdated.removeListener(onUpdated);
      }
      resolve();
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo && changeInfo.status === "complete") {
        finish();
      }
    }

    timeoutId = setTimeout(finish, timeoutMs);

    if (chromeApi.tabs.onUpdated && chromeApi.tabs.onUpdated.addListener) {
      chromeApi.tabs.onUpdated.addListener(onUpdated);
    }

    if (chromeApi.tabs.get) {
      try {
        chromeApi.tabs.get(tabId, (tab) => {
          if (tab && tab.status === "complete") {
            finish();
          }
        });
      } catch (_error) {
        // The page-level injector has its own wait loop, so a tab lookup failure
        // should not prevent the attempted injection.
      }
    }
  });
}

function callChrome(chromeApi, context, method, ...args) {
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
      const lastError = chromeApi.runtime && chromeApi.runtime.lastError;
      finish(lastError ? new Error(lastError.message || "Chrome API call failed.") : null, value);
    }

    try {
      const maybePromise = method.call(context, ...args, callback);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((value) => finish(null, value), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

async function fillChatGptComposer(prompt, options = {}) {
  return fillLlmComposer(
    prompt,
    settingsApi.getLlmProviderConfig("chatgpt"),
    options
  );
}

async function fillLlmComposer(prompt, providerOptions = {}, options = {}) {
  const text = String(prompt || "");
  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 60;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 250;
  const submitMaxAttempts = Number.isInteger(options.submitMaxAttempts) ? options.submitMaxAttempts : 20;
  const submitDelayMs = Number.isFinite(options.submitDelayMs) ? options.submitDelayMs : 100;
  const autoSubmit = options.autoSubmit === true;
  const composerSelectors = Array.isArray(providerOptions.composerSelectors) && providerOptions.composerSelectors.length
    ? providerOptions.composerSelectors
    : ["#prompt-textarea", "textarea", 'div[contenteditable="true"]'];
  const submitSelectors = Array.isArray(providerOptions.submitSelectors)
    ? providerOptions.submitSelectors
    : [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const composer = findComposer();

    if (composer && insertTextIntoComposer(composer, text)) {
      if (!autoSubmit) {
        return {
          ok: true,
          submitted: false
        };
      }

      const submitButton = await waitForSubmitButton();
      if (submitButton) {
        submitButton.click();
        return {
          ok: true,
          submitted: true
        };
      }

      return {
        ok: true,
        submitted: false,
        submitAttempted: true,
        error: "Submit button was not found."
      };
    }

    if (attempt < maxAttempts - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }

  return {
    ok: false,
    error: "ChatGPT composer was not found."
  };

  function findComposer() {
    for (const selector of composerSelectors) {
      const element = document.querySelector(selector);
      if (isUsableComposer(element)) {
        return element;
      }
    }

    return null;
  }

  function findSubmitButton() {
    for (const selector of submitSelectors) {
      const element = document.querySelector(selector);
      if (isUsableSubmitButton(element)) {
        return element;
      }
    }

    return null;
  }

  async function waitForSubmitButton() {
    for (let attempt = 0; attempt < submitMaxAttempts; attempt += 1) {
      const submitButton = findSubmitButton();
      if (submitButton) {
        return submitButton;
      }

      if (attempt < submitMaxAttempts - 1 && submitDelayMs > 0) {
        await wait(submitDelayMs);
      }
    }

    return null;
  }

  function isUsableComposer(element) {
    if (!element || element.disabled) {
      return false;
    }

    if (typeof element.getAttribute === "function" && element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    return true;
  }

  function isUsableSubmitButton(element) {
    if (!element || element.disabled) {
      return false;
    }

    if (typeof element.getAttribute === "function") {
      const ariaDisabled = element.getAttribute("aria-disabled");
      if (ariaDisabled === "true") {
        return false;
      }
    }

    return typeof element.click === "function";
  }

  function insertTextIntoComposer(element, value) {
    if (isTextControl(element)) {
      setTextControlValue(element, value);
      element.focus();
      dispatchComposerEvent(element, "input", value);
      dispatchComposerEvent(element, "change", value);
      return true;
    }

    if (isContentEditable(element)) {
      element.focus();
      const insertedWithCommand = insertIntoContentEditable(element, value);
      if (!insertedWithCommand) {
        element.textContent = value;
      }
      dispatchComposerEvent(element, "input", value);
      dispatchComposerEvent(element, "change", value);
      return true;
    }

    return false;
  }

  function isTextControl(element) {
    const tagName = String(element.tagName || "").toUpperCase();
    return tagName === "TEXTAREA" || tagName === "INPUT";
  }

  function isContentEditable(element) {
    return Boolean(
      element.isContentEditable ||
      (typeof element.getAttribute === "function" && element.getAttribute("contenteditable") === "true")
    );
  }

  function setTextControlValue(element, value) {
    const tagName = String(element.tagName || "").toUpperCase();
    const prototype =
      tagName === "TEXTAREA" && typeof HTMLTextAreaElement !== "undefined"
        ? HTMLTextAreaElement.prototype
        : tagName === "INPUT" && typeof HTMLInputElement !== "undefined"
          ? HTMLInputElement.prototype
          : null;
    const valueSetter = prototype && Object.getOwnPropertyDescriptor(prototype, "value");

    if (valueSetter && typeof valueSetter.set === "function") {
      valueSetter.set.call(element, value);
      return;
    }

    element.value = value;
  }

  function insertIntoContentEditable(element, value) {
    if (!document || typeof document.execCommand !== "function") {
      return false;
    }

    document.execCommand("selectAll");
    return document.execCommand("insertText", false, value);
  }

  function dispatchComposerEvent(element, type, value) {
    if (typeof element.dispatchEvent !== "function") {
      return;
    }

    let event;
    if (type === "input" && typeof InputEvent === "function") {
      event = new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: value,
        inputType: "insertText"
      });
    } else if (typeof Event === "function") {
      event = new Event(type, {
        bubbles: true,
        composed: true
      });
    } else {
      event = { type };
    }

    element.dispatchEvent(event);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    fillChatGptComposer,
    fillLlmComposer,
    openOptionsPage,
    openWelcomePageOnInstall,
    openLlmSummary,
    openChatGptSummary
  };
}
