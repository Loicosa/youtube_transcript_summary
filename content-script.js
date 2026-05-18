const INLINE_ROOT_ID = "yttr-inline-root";
const INLINE_STYLE_ID = "yttr-inline-style";
const OPEN_LLM_SUMMARY_MESSAGE = "YTTR_OPEN_LLM_SUMMARY";
const OPEN_OPTIONS_PAGE_MESSAGE = "YTTR_OPEN_OPTIONS_PAGE";
const OPEN_BUTTON_LABEL = "Get Transcript";
const INLINE_PANEL_AUTO_FETCH = true;
const SUMMARY_PROMPT_PREFIX = "Make a summary of this text:";

if (typeof module !== "undefined" && module.exports && typeof globalThis.YttrSettings === "undefined") {
  globalThis.YttrSettings = require("./settings");
}

const settingsApi = globalThis.YttrSettings;

const hasChromeRuntime =
  typeof chrome !== "undefined" &&
  chrome.runtime &&
  chrome.runtime.onMessage &&
  typeof chrome.runtime.onMessage.addListener === "function";

if (hasChromeRuntime) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_TRANSCRIPT") {
      return false;
    }

    handleTranscriptRequest(message)
      .then((transcript) => {
        sendResponse({ ok: true, transcript });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          message: error.message || "Unknown transcript error.",
          userMessage: error.userMessage || ""
        });
      });

    return true;
  });
}

let capturedTimedTextResourceUrls = [];
const inlineState = {
  loading: false,
  transcript: null,
  timedBlocks: [],
  videoId: "",
  view: "timed",
  observer: null
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  startInlineTranscriptUi();
}

async function handleTranscriptRequest(message) {
  const module = globalThis.TranscriptModule;
  if (!module) {
    throw new Error("Transcript module is not available in the YouTube content script.");
  }

  await ensureCaptionsAreRequested();

  const extraCaptionUrls = getTimedTextUrlsForVideo(module, message.videoId);
  const preferredLanguageCode = resolveTranscriptRequestLanguage(message, extraCaptionUrls);

  return module.fetchTranscriptForVideo(
    message.videoId,
    fetch.bind(globalThis),
    preferredLanguageCode,
    {
      extraCaptionUrls,
      clientPlaybackParams: getClientPlaybackParams()
    }
  );
}

function startInlineTranscriptUi() {
  injectInlineTranscriptStyles();
  mountInlineTranscriptUi();

  if (typeof MutationObserver !== "undefined" && !inlineState.observer) {
    inlineState.observer = new MutationObserver(() => {
      mountInlineTranscriptUi();
    });
    inlineState.observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  window.addEventListener("yt-navigate-finish", () => {
    mountInlineTranscriptUi();
  });
}

function mountInlineTranscriptUi() {
  const videoId = getCurrentVideoId();
  let root = document.getElementById(INLINE_ROOT_ID);

  if (!videoId) {
    root?.remove();
    return null;
  }

  const sidebar = findRightSidebarContainer();
  if (!sidebar) {
    return null;
  }

  if (!root) {
    root = createInlineTranscriptRoot();
  }

  if (root.parentElement !== sidebar) {
    sidebar.prepend(root);
  }

  if (root.dataset.videoId !== videoId) {
    root.dataset.videoId = videoId;
    resetInlineStateForVideo(videoId, root);
  }

  return root;
}

function createInlineTranscriptRoot() {
  const root = document.createElement("div");
  root.id = INLINE_ROOT_ID;
  root.innerHTML = `
    <button class="yttr-open-button" type="button">${OPEN_BUTTON_LABEL}</button>
    <section class="yttr-panel" hidden>
      <div class="yttr-panel-header">
        <div>
          <div class="yttr-title">Transcript</div>
          <div class="yttr-video-title" data-role="video-title" hidden></div>
        </div>
        <button class="yttr-icon-button" type="button" data-action="close" aria-label="Close transcript panel">X</button>
      </div>
      <div class="yttr-primary-actions">
        <button class="yttr-action-button yttr-action-button-primary" type="button" data-action="load">Get Transcript</button>
        <button class="yttr-action-button yttr-action-button-llm" type="button" data-action="summary" disabled>Send to LLM</button>
      </div>
      <div class="yttr-status" data-role="status">Ready.</div>
      <div class="yttr-controls-row">
        <div class="yttr-view-switch" role="group" aria-label="Transcript view">
          <button class="yttr-view-button active" type="button" data-view="timed" aria-pressed="true">Timed</button>
          <button class="yttr-view-button" type="button" data-view="text" aria-pressed="false">Text</button>
        </div>
        <div class="yttr-actions">
          <button class="yttr-action-button" type="button" data-action="copy" disabled>Copy</button>
          <button class="yttr-action-button" type="button" data-action="download" disabled>Download</button>
        </div>
      </div>
      <div class="yttr-content">
        <div class="yttr-timed-list" data-role="timed-list"></div>
        <textarea class="yttr-text" data-role="text" readonly hidden placeholder="Transcript text will appear here."></textarea>
      </div>
      <div class="yttr-panel-footer">
        <button class="yttr-settings-button" type="button" data-action="settings">Settings</button>
      </div>
    </section>
  `;

  root.querySelector(".yttr-open-button").addEventListener("click", () => {
    openInlineTranscriptPanel(root);
    if (INLINE_PANEL_AUTO_FETCH && !inlineState.transcript && !inlineState.loading) {
      loadInlineTranscript(root);
    }
  });
  root.querySelector('[data-action="close"]').addEventListener("click", () => {
    root.querySelector(".yttr-panel").hidden = true;
  });
  root.querySelector('[data-action="settings"]').addEventListener("click", () => {
    openInlineSettings(root);
  });
  root.querySelector('[data-action="load"]').addEventListener("click", () => {
    loadInlineTranscript(root);
  });
  root.querySelector('[data-action="copy"]').addEventListener("click", () => {
    copyInlineTranscript(root);
  });
  root.querySelector('[data-action="download"]').addEventListener("click", () => {
    downloadInlineTranscript(root);
  });
  root.querySelector('[data-action="summary"]').addEventListener("click", () => {
    openSummaryInConfiguredLlm(root);
  });
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setInlineView(root, button.dataset.view);
    });
  });
  root.querySelector('[data-role="timed-list"]').addEventListener("click", (event) => {
    handleTimedListClick(root, event);
  });

  return root;
}

function resetInlineStateForVideo(videoId, root) {
  inlineState.loading = false;
  inlineState.transcript = null;
  inlineState.timedBlocks = [];
  inlineState.videoId = videoId;
  inlineState.view = "timed";
  setInlineStatus(root, "Ready.");
  setInlineTranscript(root, null);
  setInlineView(root, "timed");
}

async function openInlineTranscriptPanel(root) {
  const panel = root.querySelector(".yttr-panel");
  panel.hidden = false;

  const videoId = getCurrentVideoId();
  if (!videoId) {
    setInlineStatus(root, "Open a YouTube video page first.", "error");
    return;
  }

  if (inlineState.transcript && inlineState.videoId === videoId) {
    setInlineTranscript(root, inlineState.transcript);
    setInlineStatus(root, getLoadedStatusMessage(inlineState.transcript), "success");
    return;
  }

  setInlineStatus(root, "Click Get Transcript to load captions.");
}

async function openInlineSettings(root) {
  try {
    const response = await sendChromeRuntimeMessage({ type: OPEN_OPTIONS_PAGE_MESSAGE });
    if (!response || !response.ok) {
      setInlineStatus(root, "Could not open settings from this page.", "error");
    }
  } catch (_error) {
    setInlineStatus(root, "Could not open settings from this page.", "error");
  }
}

async function loadInlineTranscript(root) {
  const videoId = getCurrentVideoId();
  if (!videoId) {
    setInlineStatus(root, "Open a YouTube video page first.", "error");
    return;
  }

  if (inlineState.loading) {
    return;
  }

  inlineState.loading = true;
  setInlineLoading(root, true);
  setInlineStatus(root, "Getting transcript...");
  setInlineTranscript(root, null);

  try {
    const settings = await loadExtensionSettings();
    const transcript = await handleTranscriptRequest({
      type: "GET_TRANSCRIPT",
      videoId,
      preferredLanguageCode: getPreferredLanguageMessageValue(settings, getBrowserLanguage()),
      browserLanguageCode: getBrowserLanguage(),
      useYouTubeCaptionLanguage: settings.defaultLanguage === "auto"
    });
    inlineState.transcript = transcript;
    inlineState.videoId = videoId;
    setInlineTranscript(root, transcript);
    setInlineStatus(root, getLoadedStatusMessage(transcript), "success");
  } catch (error) {
    logUnexpectedError(error);
    setInlineStatus(root, error.userMessage || error.message || "Could not retrieve the transcript.", "error");
  } finally {
    inlineState.loading = false;
    setInlineLoading(root, false);
  }
}

function logUnexpectedError(error) {
  if (globalThis.TranscriptModule?.isExpectedTranscriptError?.(error)) {
    return;
  }

  console.error(error);
}

function setInlineLoading(root, isLoading) {
  const openButton = root.querySelector(".yttr-open-button");
  const loadButton = root.querySelector('[data-action="load"]');
  openButton.disabled = isLoading;
  openButton.textContent = isLoading ? "Loading..." : OPEN_BUTTON_LABEL;
  if (loadButton) {
    loadButton.disabled = isLoading;
    loadButton.textContent = isLoading ? "Loading..." : OPEN_BUTTON_LABEL;
  }
  setInlineActionState(root, Boolean(inlineState.transcript) && !isLoading);
}

function setInlineTranscript(root, transcript) {
  const textArea = root.querySelector('[data-role="text"]');
  const timedList = root.querySelector('[data-role="timed-list"]');
  const title = root.querySelector('[data-role="video-title"]');

  inlineState.timedBlocks = transcript
    ? globalThis.TranscriptModule.groupTranscriptSegments(transcript.segments)
    : [];

  textArea.value = transcript?.text || "";
  renderTimedTranscriptBlocks(timedList, inlineState.timedBlocks);

  if (transcript?.title) {
    title.textContent = transcript.title;
    title.hidden = false;
  } else {
    title.textContent = "";
    title.hidden = true;
  }

  setInlineActionState(root, Boolean(transcript));
  setInlineView(root, inlineState.view);
}

function setInlineActionState(root, hasTranscript) {
  root.querySelector('[data-action="copy"]').disabled = !hasTranscript;
  root.querySelector('[data-action="download"]').disabled = !hasTranscript;
  root.querySelector('[data-action="summary"]').disabled = !hasTranscript;
}

function setInlineStatus(root, message, tone = "") {
  const status = root.querySelector('[data-role="status"]');
  status.textContent = message;
  status.className = ["yttr-status", tone].filter(Boolean).join(" ");
}

function getLoadedStatusMessage(transcript) {
  const trackName = transcript?.track?.name || transcript?.track?.languageCode || "caption track";
  const blockCount = inlineState.timedBlocks.length;
  if (transcript?.fellBackToOriginal) {
    const requestedLanguage = getTrackLanguageLabel(transcript.requestedTrack);
    const fallbackLanguage = getTrackLanguageLabel(transcript.track);
    return `Preferred ${requestedLanguage} captions unavailable. Loaded original ${fallbackLanguage} captions${blockCount ? ` - ${blockCount} blocks` : ""}.`;
  }

  return `Loaded from ${trackName}${blockCount ? ` - ${blockCount} blocks` : ""}.`;
}

function getTrackLanguageLabel(track) {
  return track?.name || track?.languageCode || "preferred language";
}

async function copyInlineTranscript(root) {
  if (!inlineState.transcript) {
    return;
  }

  try {
    await navigator.clipboard.writeText(getInlineTranscriptOutput());
    setInlineStatus(root, "Copied.", "success");
  } catch (_error) {
    setInlineStatus(root, "Clipboard copy failed.", "error");
  }
}

function downloadInlineTranscript(root) {
  if (!inlineState.transcript) {
    return;
  }

  const blob = new Blob([getInlineTranscriptOutput()], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = inlineState.transcript.filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
  setInlineStatus(root, "Downloaded.", "success");
}

function setInlineView(root, view) {
  inlineState.view = view === "text" ? "text" : "timed";

  const isTimed = inlineState.view === "timed";
  root.querySelector('[data-role="timed-list"]').hidden = !isTimed;
  root.querySelector('[data-role="text"]').hidden = isTimed;
  root.querySelectorAll("[data-view]").forEach((button) => {
    const isActive = button.dataset.view === inlineState.view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderTimedTranscriptBlocks(container, blocks) {
  if (!blocks.length) {
    container.innerHTML = '<div class="yttr-empty">Transcript blocks will appear here.</div>';
    return;
  }

  container.innerHTML = blocks
    .map((block, index) => `
      <div class="yttr-transcript-row" data-block-index="${index}">
        <button class="yttr-timecode" type="button" data-seconds="${block.start}" aria-label="Jump to ${block.timestamp}">
          ${block.timestamp}
        </button>
        <div class="yttr-block-text">
          <p>${escapeHtml(block.text)}</p>
          <button class="yttr-block-copy" type="button" data-block-copy="${index}">Copy block</button>
        </div>
      </div>
    `)
    .join("");
}

function handleTimedListClick(root, event) {
  const blockCopy = event.target.closest("[data-block-copy]");
  if (blockCopy) {
    copyTranscriptBlock(root, Number(blockCopy.dataset.blockCopy));
    return;
  }

  const timecode = event.target.closest("[data-seconds]");
  if (!timecode) {
    return;
  }

  seekVideoTo(Number(timecode.dataset.seconds));
  highlightTranscriptRow(timecode.closest(".yttr-transcript-row"));
}

async function copyTranscriptBlock(root, blockIndex) {
  const block = inlineState.timedBlocks[blockIndex];
  if (!block) {
    return;
  }

  try {
    await navigator.clipboard.writeText(`[${block.timestamp}] ${block.text}`);
    setInlineStatus(root, "Block copied.", "success");
  } catch (_error) {
    setInlineStatus(root, "Clipboard copy failed.", "error");
  }
}

function getInlineTranscriptOutput() {
  if (!inlineState.transcript) {
    return "";
  }

  if (inlineState.view === "text") {
    return inlineState.transcript.text;
  }

  return globalThis.TranscriptModule.formatTimedTranscript(inlineState.timedBlocks);
}

async function openSummaryInConfiguredLlm(root) {
  if (!inlineState.transcript) {
    return;
  }

  const settings = await loadExtensionSettings();
  const prompt = buildSummaryPrompt(getInlineTranscriptOutput(), inlineState.transcript, settings);
  setInlineStatus(root, `Opening ${getConfiguredProviderLabel(settings)} summary prompt...`);

  let response;
  try {
    response = await sendChromeRuntimeMessage(buildLlmSummaryMessage(prompt, settings));
  } catch (_error) {
    await copySummaryPromptFallback(root, prompt, false, settings);
    return;
  }

  if (response && response.ok) {
    const action = response.submitted ? "and submitted it" : "with the summary prompt";
    setInlineStatus(root, `Opened ${getConfiguredProviderLabel(settings)} ${action}.`, "success");
    return;
  }

  await copySummaryPromptFallback(root, prompt, Boolean(response && response.opened), settings);
}

async function copySummaryPromptFallback(root, prompt, alreadyOpened, settings) {
  const providerLabel = getConfiguredProviderLabel(settings);
  if (!alreadyOpened) {
    window.open(getConfiguredProviderUrl(settings), "_blank", "noopener,noreferrer");
  }

  try {
    await navigator.clipboard.writeText(prompt);
    setInlineStatus(root, `Opened ${providerLabel}. Prompt copied; paste it if the box is empty.`, "success");
  } catch (_error) {
    setInlineStatus(root, `Opened ${providerLabel}, but automatic insert and clipboard copy failed.`, "error");
  }
}

function buildSummaryPrompt(transcriptText, transcript = null, settings = {}) {
  if (settings.translateFallbackInLlm && transcript?.fellBackToOriginal) {
    const requestedLanguage = getTrackLanguageLabel(transcript.requestedTrack);
    const fallbackLanguage = getTrackLanguageLabel(transcript.track);
    return `${SUMMARY_PROMPT_PREFIX} The requested caption language was ${requestedLanguage}, but only ${fallbackLanguage} captions were available. Write the summary in ${requestedLanguage}.\n\n${transcriptText || ""}`;
  }

  return `${SUMMARY_PROMPT_PREFIX}\n\n${transcriptText || ""}`;
}

function buildLlmSummaryMessage(prompt, settings) {
  return {
    type: OPEN_LLM_SUMMARY_MESSAGE,
    prompt: prompt || "",
    settings: settingsApi.normalizeSettings(settings)
  };
}

async function loadExtensionSettings() {
  if (!settingsApi || typeof settingsApi.loadSettings !== "function") {
    return {
      autoSubmit: false,
      defaultLanguage: "auto",
      llmProvider: "chatgpt"
    };
  }

  return settingsApi.loadSettings();
}

function getConfiguredProviderLabel(settings) {
  if (!settingsApi || typeof settingsApi.getLlmProviderConfig !== "function") {
    return "ChatGPT";
  }

  return settingsApi.getLlmProviderConfig(settings?.llmProvider).label;
}

function getConfiguredProviderUrl(settings) {
  if (!settingsApi || typeof settingsApi.getLlmProviderConfig !== "function") {
    return "https://chatgpt.com/";
  }

  return settingsApi.getLlmProviderConfig(settings?.llmProvider).url;
}

function getBrowserLanguage() {
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en";
}

function sendChromeRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime || !chrome.runtime.sendMessage) {
      reject(new Error("Runtime messaging is unavailable."));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message || "Runtime messaging failed."));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function seekVideoTo(seconds) {
  const video = document.querySelector("#movie_player video") ||
    document.querySelector("video.html5-main-video") ||
    document.querySelector("video");
  if (!video || !Number.isFinite(seconds)) {
    return;
  }

  video.currentTime = seconds;
  const playResult = video.play?.();
  if (playResult?.catch) {
    playResult.catch(() => {});
  }
}

function highlightTranscriptRow(row) {
  if (!row) {
    return;
  }

  row.classList.add("active");
  setTimeout(() => {
    row.classList.remove("active");
  }, 1200);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCurrentVideoId() {
  const module = globalThis.TranscriptModule;
  return module?.extractVideoId ? module.extractVideoId(window.location.href) : "";
}

function findRightSidebarContainer() {
  return (
    document.querySelector("ytd-watch-flexy #secondary-inner") ||
    document.querySelector("ytd-watch-flexy #secondary") ||
    document.querySelector("#secondary-inner") ||
    document.querySelector("#secondary")
  );
}

function injectInlineTranscriptStyles() {
  if (document.getElementById(INLINE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = INLINE_STYLE_ID;
  style.textContent = `
    #${INLINE_ROOT_ID} {
      box-sizing: border-box;
      width: 100%;
      margin: 0 0 12px;
      font-family: Roboto, Arial, sans-serif;
      color: #f1f1f1;
      --yttr-button-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 32'%3E%3Crect x='7' y='4' width='25' height='24' rx='6' fill='white'/%3E%3Cpath d='M25 4v8h7' fill='%23dbeafe'/%3E%3Cpath d='M14 14h10M14 19h8' stroke='%2360a5fa' stroke-width='2.5' stroke-linecap='round'/%3E%3Cpath d='M18 25v-8l7 4z' fill='%23312ebf'/%3E%3C/svg%3E");
    }

    #${INLINE_ROOT_ID} * {
      box-sizing: border-box;
      font-family: inherit;
    }

    #${INLINE_ROOT_ID} .yttr-open-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      min-height: 46px;
      border: 1px solid rgba(164, 196, 255, .7);
      border-radius: 10px;
      background: linear-gradient(180deg, #5969ff 0%, #353ee8 100%);
      color: #fff;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0;
      box-shadow: 0 10px 24px rgba(53, 62, 232, .28), inset 0 1px 0 rgba(255, 255, 255, .28);
      cursor: pointer;
      transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
    }

    #${INLINE_ROOT_ID} .yttr-open-button::before {
      content: "";
      width: 24px;
      height: 20px;
      background-image: var(--yttr-button-icon);
      background-position: center;
      background-repeat: no-repeat;
      background-size: contain;
      flex: 0 0 auto;
    }

    #${INLINE_ROOT_ID} .yttr-open-button:hover:not(:disabled) {
      border-color: rgba(219, 234, 254, .88);
      background: linear-gradient(180deg, #6676ff 0%, #2930d3 100%);
      box-shadow: 0 12px 28px rgba(53, 62, 232, .36), inset 0 1px 0 rgba(255, 255, 255, .32);
      transform: translateY(-1px);
    }

    #${INLINE_ROOT_ID} .yttr-open-button:disabled {
      color: rgba(255, 255, 255, .78);
      opacity: .72;
      cursor: progress;
      transform: none;
    }

    #${INLINE_ROOT_ID} .yttr-panel {
      position: fixed;
      top: 72px;
      right: max(44px, env(safe-area-inset-right));
      z-index: 2147483646;
      width: min(420px, calc(100vw - 48px));
      max-height: calc(100vh - 96px);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 8px;
      background: #181818;
      box-shadow: 0 18px 60px rgba(0, 0, 0, .45);
    }

    #${INLINE_ROOT_ID} .yttr-panel[hidden] {
      display: none;
    }

    #${INLINE_ROOT_ID} .yttr-panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    #${INLINE_ROOT_ID} .yttr-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
    }

    #${INLINE_ROOT_ID} .yttr-video-title {
      max-width: 330px;
      margin-top: 3px;
      color: #aaa;
      font-size: 12px;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${INLINE_ROOT_ID} .yttr-settings-button {
      min-height: 28px;
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 999px;
      background: #272727;
      color: #dbeafe;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    #${INLINE_ROOT_ID} .yttr-settings-button:hover {
      border-color: rgba(96, 165, 250, .5);
      background: #303030;
      color: #fff;
    }

    #${INLINE_ROOT_ID} .yttr-icon-button {
      width: 30px;
      height: 30px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 50%;
      background: #272727;
      color: #f1f1f1;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    #${INLINE_ROOT_ID} .yttr-status {
      min-height: 18px;
      color: #aaa;
      font-size: 12px;
      line-height: 1.4;
    }

    #${INLINE_ROOT_ID} .yttr-status.success {
      color: #3ea6ff;
    }

    #${INLINE_ROOT_ID} .yttr-status.error {
      color: #ff8983;
    }

    #${INLINE_ROOT_ID} .yttr-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    #${INLINE_ROOT_ID} .yttr-view-switch {
      display: inline-flex;
      flex: 0 0 auto;
      width: fit-content;
      padding: 2px;
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 8px;
      background: #0f0f0f;
    }

    #${INLINE_ROOT_ID} .yttr-view-button {
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #aaa;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    #${INLINE_ROOT_ID} .yttr-view-button.active {
      background: #f1f1f1;
      color: #0f0f0f;
    }

    #${INLINE_ROOT_ID} .yttr-content {
      min-height: 320px;
      max-height: 52vh;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 8px;
      background: #0f0f0f;
      overflow: hidden;
    }

    #${INLINE_ROOT_ID} .yttr-panel-footer {
      display: flex;
      justify-content: flex-end;
    }

    #${INLINE_ROOT_ID} .yttr-timed-list {
      height: 100%;
      max-height: 52vh;
      overflow-y: auto;
      padding: 10px 10px 4px;
    }

    #${INLINE_ROOT_ID} .yttr-timed-list[hidden],
    #${INLINE_ROOT_ID} .yttr-text[hidden] {
      display: none;
    }

    #${INLINE_ROOT_ID} .yttr-transcript-row {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 10px;
      padding: 7px 4px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, .07);
    }

    #${INLINE_ROOT_ID} .yttr-transcript-row:last-child {
      border-bottom: 0;
    }

    #${INLINE_ROOT_ID} .yttr-transcript-row.active {
      background: rgba(62, 166, 255, .12);
      border-radius: 6px;
    }

    #${INLINE_ROOT_ID} .yttr-timecode {
      align-self: start;
      border: 0;
      background: transparent;
      color: #3ea6ff;
      padding: 1px 0;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.45;
      text-align: left;
      cursor: pointer;
    }

    #${INLINE_ROOT_ID} .yttr-timecode:hover {
      text-decoration: underline;
    }

    #${INLINE_ROOT_ID} .yttr-block-text {
      min-width: 0;
      color: #f1f1f1;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.48;
      overflow-wrap: anywhere;
    }

    #${INLINE_ROOT_ID} .yttr-block-text p {
      margin: 0;
    }

    #${INLINE_ROOT_ID} .yttr-block-copy {
      margin-top: 7px;
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 6px;
      background: #272727;
      color: #aaa;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      opacity: 0;
    }

    #${INLINE_ROOT_ID} .yttr-transcript-row:hover .yttr-block-copy,
    #${INLINE_ROOT_ID} .yttr-block-copy:focus {
      opacity: 1;
    }

    #${INLINE_ROOT_ID} .yttr-empty {
      color: #777;
      padding: 12px;
      font-size: 13px;
    }

    #${INLINE_ROOT_ID} .yttr-text {
      width: 100%;
      height: 100%;
      min-height: 320px;
      max-height: 52vh;
      resize: vertical;
      border: 0;
      background: #0f0f0f;
      color: #f1f1f1;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
    }

    #${INLINE_ROOT_ID} .yttr-primary-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #${INLINE_ROOT_ID} .yttr-actions {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: nowrap;
      gap: 6px;
      align-items: center;
      justify-content: flex-end;
      min-width: 0;
    }

    #${INLINE_ROOT_ID} .yttr-action-button {
      height: 34px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 8px;
      background: #272727;
      color: #f1f1f1;
      font-size: 13px;
    }

    #${INLINE_ROOT_ID} .yttr-action-button-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-color: rgba(164, 196, 255, .62);
      color: #fff;
      background: linear-gradient(180deg, #5969ff 0%, #353ee8 100%);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22);
    }

    #${INLINE_ROOT_ID} .yttr-action-button-primary::before {
      content: "";
      width: 20px;
      height: 16px;
      background-image: var(--yttr-button-icon);
      background-position: center;
      background-repeat: no-repeat;
      background-size: contain;
      flex: 0 0 auto;
    }

    #${INLINE_ROOT_ID} .yttr-action-button-llm {
      border-color: rgba(45, 212, 191, .46);
      color: #ecfeff;
      background: #155e63;
    }

    #${INLINE_ROOT_ID} .yttr-action-button-llm:hover:not(:disabled) {
      border-color: rgba(94, 234, 212, .72);
      background: #0f766e;
    }

    #${INLINE_ROOT_ID} .yttr-action-button {
      padding: 0 12px;
      font-weight: 700;
      cursor: pointer;
    }

    #${INLINE_ROOT_ID} .yttr-action-button:hover:not(:disabled) {
      background: #333;
    }

    #${INLINE_ROOT_ID} .yttr-action-button.yttr-action-button-primary:hover:not(:disabled) {
      background: linear-gradient(180deg, #6676ff 0%, #2930d3 100%);
    }

    #${INLINE_ROOT_ID} .yttr-action-button:disabled {
      color: #777;
      cursor: not-allowed;
    }

    @media (max-width: 700px) {
      #${INLINE_ROOT_ID} .yttr-panel {
        top: 56px;
        right: 12px;
        left: 12px;
        width: auto;
      }

      #${INLINE_ROOT_ID} .yttr-content,
      #${INLINE_ROOT_ID} .yttr-text {
        min-height: 260px;
      }

      #${INLINE_ROOT_ID} .yttr-transcript-row {
        grid-template-columns: 44px minmax(0, 1fr);
        gap: 8px;
      }

      #${INLINE_ROOT_ID} .yttr-controls-row {
        align-items: flex-start;
        flex-direction: column;
      }

      #${INLINE_ROOT_ID} .yttr-actions {
        justify-content: flex-start;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

async function ensureCaptionsAreRequested() {
  const requestObserved = await requestTimedTextWithCaptionsButton();
  if (requestObserved) {
    return;
  }

  const beforeCount = getTimedTextResourceUrls().length;
  activateCaptions();
  await waitForTimedTextRequestAfter(beforeCount, 2500);
}

async function requestTimedTextWithCaptionsButton() {
  const captionsButton = findCaptionsButton();
  if (!captionsButton || captionsButton.disabled || captionsButton.getAttribute("aria-disabled") === "true") {
    return false;
  }

  const fallbackUrls = getTimedTextResourceUrls();
  const canClearResourceTimings = typeof performance.clearResourceTimings === "function";
  if (canClearResourceTimings) {
    performance.clearResourceTimings();
  }

  const beforeCount = canClearResourceTimings ? 0 : fallbackUrls.length;

  captionsButton.click();
  captionsButton.click();

  const requestObserved = await waitForTimedTextRequestAfter(beforeCount, 900);
  const freshUrls = getTimedTextResourceUrls();
  capturedTimedTextResourceUrls = freshUrls.length ? freshUrls : fallbackUrls;

  return requestObserved;
}

function activateCaptions() {
  const player = document.getElementById("movie_player");
  if (player?.getOption && player?.setOption) {
    const tracklist = player.getOption("captions", "tracklist");
    const firstTrack = Array.isArray(tracklist) ? tracklist[0] : null;
    if (firstTrack) {
      player.setOption("captions", "track", firstTrack);
      return true;
    }
  }

  const captionsButton = findCaptionsButton();
  if (captionsButton && captionsButton.getAttribute("aria-pressed") !== "true") {
    captionsButton.click();
    return true;
  }

  return false;
}

function findCaptionsButton() {
  return (
    document.querySelector("#movie_player button.ytp-subtitles-button") ||
    document.querySelector(".ytp-subtitles-button")
  );
}

function waitForTimedTextRequestAfter(previousCount, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const urls = getTimedTextResourceUrls();
      if (urls.length > previousCount) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

function getTimedTextUrlsForVideo(module, videoId) {
  return module.extractTimedTextUrls(
    [...capturedTimedTextResourceUrls, ...getTimedTextResourceUrls()],
    videoId
  );
}

function getPreferredLanguageMessageValue(settings, browserLanguage) {
  return settings.defaultLanguage === "auto"
    ? "auto"
    : settingsApi.resolvePreferredLanguageCode(settings, browserLanguage);
}

function resolveTranscriptRequestLanguage(message, extraCaptionUrls) {
  if (message.useYouTubeCaptionLanguage || message.preferredLanguageCode === "auto") {
    return readFirstCaptionUrlLanguage(extraCaptionUrls) || message.browserLanguageCode || getBrowserLanguage();
  }

  return message.preferredLanguageCode || getBrowserLanguage();
}

function readFirstCaptionUrlLanguage(urls) {
  for (const rawUrl of urls || []) {
    try {
      const params = new URL(rawUrl).searchParams;
      const language = params.get("tlang") || params.get("lang");
      if (language) {
        return language;
      }
    } catch (_error) {
      // Ignore malformed browser performance entries.
    }
  }

  return "";
}

function getTimedTextResourceUrls() {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => url.includes("/api/timedtext"));
}

function getClientPlaybackParams() {
  const userAgent = navigator.userAgent || "";
  const chromeVersion = userAgent.match(/(?:Chrome|Chromium|CriOS)\/([0-9.]+)/)?.[1] || "";
  const windowsVersion = userAgent.match(/Windows NT ([0-9.]+)/)?.[1] || "";

  return {
    cbr: "Chrome",
    cbrver: chromeVersion,
    c: "WEB",
    cplayer: "UNIPLAYER",
    cos: getOperatingSystemName(userAgent),
    cosver: windowsVersion,
    cplatform: "DESKTOP",
    pot: findProofOfOriginToken()
  };
}

function findProofOfOriginToken() {
  const resourceUrls = getTimedTextResourceUrls();
  for (let index = resourceUrls.length - 1; index >= 0; index -= 1) {
    try {
      const resourceUrl = resourceUrls[index];
      const url = new URL(resourceUrl);
      const pot = url.searchParams.get("pot");
      if (pot) {
        return pot;
      }
    } catch (_error) {
      continue;
    }
  }

  return "";
}

function getOperatingSystemName(userAgent) {
  if (/Windows/i.test(userAgent)) {
    return "Windows";
  }
  if (/Mac OS X/i.test(userAgent)) {
    return "Macintosh";
  }
  if (/Linux/i.test(userAgent)) {
    return "Linux";
  }

  return "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    INLINE_PANEL_AUTO_FETCH,
    OPEN_BUTTON_LABEL,
    buildLlmSummaryMessage,
    buildSummaryPrompt,
    findRightSidebarContainer,
    getPreferredLanguageMessageValue,
    requestTimedTextWithCaptionsButton
  };
}
