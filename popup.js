const OPEN_LLM_SUMMARY_MESSAGE = "YTTR_OPEN_LLM_SUMMARY";
const POPUP_DEFAULT_VIEW = "timed";
const POPUP_AUTO_FETCH_ON_OPEN = false;
const SUMMARY_PROMPT_PREFIX = "Make a summary of this text:";

if (typeof module !== "undefined" && module.exports && typeof globalThis.TranscriptModule === "undefined") {
  globalThis.TranscriptModule = require("./transcript");
}

if (typeof module !== "undefined" && module.exports && typeof globalThis.YttrSettings === "undefined") {
  globalThis.YttrSettings = require("./settings");
}

const transcriptApi = globalThis.TranscriptModule;
const settingsApi = globalThis.YttrSettings;

let statusEl;
let videoTitleEl;
let getTranscriptButton;
let copyTranscriptButton;
let downloadTranscriptButton;
let openSummaryButton;
let openSettingsButton;
let transcriptTextEl;
let timedTranscriptEl;
let viewButtons = [];

let currentTranscript = null;
let currentTimedBlocks = [];
let currentView = POPUP_DEFAULT_VIEW;
let currentTabId = null;

if (typeof document !== "undefined") {
  initializePopup();
}

function initializePopup() {
  statusEl = document.getElementById("status");
  videoTitleEl = document.getElementById("videoTitle");
  getTranscriptButton = document.getElementById("getTranscript");
  copyTranscriptButton = document.getElementById("copyTranscript");
  downloadTranscriptButton = document.getElementById("downloadTranscript");
  openSummaryButton = document.getElementById("openSummary");
  openSettingsButton = document.getElementById("openSettings");
  transcriptTextEl = document.getElementById("transcriptText");
  timedTranscriptEl = document.getElementById("timedTranscript");
  viewButtons = typeof document.querySelectorAll === "function" ? Array.from(document.querySelectorAll("[data-view]")) : [];

  getTranscriptButton?.addEventListener("click", handleGetTranscript);
  copyTranscriptButton?.addEventListener("click", handleCopyTranscript);
  downloadTranscriptButton?.addEventListener("click", handleDownloadTranscript);
  openSummaryButton?.addEventListener("click", handleOpenSummary);
  openSettingsButton?.addEventListener("click", handleOpenSettings);
  timedTranscriptEl?.addEventListener("click", handleTimedTranscriptClick);
  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setPopupView(button.dataset.view);
    });
  });

  setPopupView(POPUP_DEFAULT_VIEW);
  if (shouldAutoFetchOnOpen()) {
    queueMicrotask(() => {
      handleGetTranscript();
    });
  }
}

function shouldAutoFetchOnOpen(chromeApi = typeof chrome !== "undefined" ? chrome : null) {
  return Boolean(
    POPUP_AUTO_FETCH_ON_OPEN &&
      chromeApi &&
      chromeApi.tabs &&
      typeof chromeApi.tabs.query === "function" &&
      chromeApi.runtime &&
      typeof chromeApi.runtime.sendMessage === "function"
  );
}

async function handleGetTranscript() {
  setLoading(true);
  setStatus("Getting transcript...");
  setTranscript(null);

  try {
    const tab = await getActiveTab();
    currentTabId = tab?.id || null;
    const videoId = transcriptApi.extractVideoId(tab?.url || "");

    if (!videoId) {
      throw new transcriptApi.TranscriptError(
        "Active tab is not a YouTube video.",
        "Open a YouTube video page before using this extension."
      );
    }

    const transcript = await fetchTranscriptFromActiveTab(tab, videoId);
    setTranscript(transcript);
    setStatus(getLoadedStatusMessage(transcript), "success");
  } catch (error) {
    logUnexpectedError(error);
    setStatus(error.userMessage || error.message || "Could not retrieve the transcript.", "error");
  } finally {
    setLoading(false);
  }
}

function logUnexpectedError(error) {
  if (transcriptApi.isExpectedTranscriptError?.(error)) {
    return;
  }

  console.error(error);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function fetchTranscriptFromActiveTab(tab, videoId) {
  if (!tab?.id) {
    throw new transcriptApi.TranscriptError("No active tab found.", "Could not access the active YouTube tab.");
  }

  const settings = await settingsApi.loadSettings();
  const browserLanguageCode = navigator.language || "en";
  const message = {
    type: "GET_TRANSCRIPT",
    videoId,
    preferredLanguageCode: getPreferredLanguageMessageValue(settings, browserLanguageCode),
    browserLanguageCode,
    useYouTubeCaptionLanguage: settings.defaultLanguage === "auto"
  };
  let response = await sendTabMessage(tab.id, message);

  if (!response) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["settings.js", "transcript.js", "content-script.js"]
    });
    response = await sendTabMessage(tab.id, message);
  }

  if (!response?.ok) {
    throw new transcriptApi.TranscriptError(
      response?.message || "Content script transcript fetch failed.",
      response?.userMessage || response?.message || "Could not retrieve the transcript."
    );
  }

  return response.transcript;
}

function handleOpenSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
    return;
  }

  window.open(chrome.runtime.getURL("options.html"));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response);
    });
  });
}

function setLoading(isLoading) {
  getTranscriptButton.disabled = isLoading;
  getTranscriptButton.textContent = isLoading ? "Loading..." : "Get Transcript";
  setPopupActionState(Boolean(currentTranscript) && !isLoading);
}

function setTranscript(transcript) {
  currentTranscript = transcript;
  currentTimedBlocks = transcript ? transcriptApi.groupTranscriptSegments(transcript.segments) : [];
  transcriptTextEl.value = transcript?.text || "";
  renderTimedTranscript();
  setPopupActionState(Boolean(transcript));
  setPopupView(currentView);

  if (transcript?.title) {
    videoTitleEl.textContent = transcript.title;
    videoTitleEl.hidden = false;
  } else {
    videoTitleEl.textContent = "";
    videoTitleEl.hidden = true;
  }
}

function setPopupActionState(hasTranscript) {
  copyTranscriptButton.disabled = !hasTranscript;
  downloadTranscriptButton.disabled = !hasTranscript;
  openSummaryButton.disabled = !hasTranscript;
}

function setPopupView(view) {
  currentView = view === "text" ? "text" : POPUP_DEFAULT_VIEW;

  if (timedTranscriptEl) {
    timedTranscriptEl.hidden = currentView !== "timed";
  }

  if (transcriptTextEl) {
    transcriptTextEl.hidden = currentView !== "text";
  }

  viewButtons.forEach((button) => {
    const isActive = button.dataset.view === currentView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderTimedTranscript() {
  if (!timedTranscriptEl) {
    return;
  }

  if (!currentTimedBlocks.length) {
    timedTranscriptEl.innerHTML = `<div class="empty">Transcript text will appear here.</div>`;
    return;
  }

  timedTranscriptEl.innerHTML = currentTimedBlocks
    .map((block) => `
      <article class="transcript-row">
        <button class="timecode" type="button" data-seconds="${block.start}" aria-label="Jump to ${block.timestamp}">
          ${block.timestamp}
        </button>
        <p>${escapeHtml(block.text)}</p>
      </article>
    `)
    .join("");
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = ["status", tone].filter(Boolean).join(" ");
}

function getLoadedStatusMessage(transcript) {
  const trackName = transcript?.track?.name || transcript?.track?.languageCode || "caption track";
  const blockCount = currentTimedBlocks.length;
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

async function handleCopyTranscript() {
  if (!currentTranscript) {
    return;
  }

  try {
    await navigator.clipboard.writeText(getCurrentPopupTranscriptOutput());
    setStatus("Copied transcript to clipboard.", "success");
  } catch (_error) {
    setStatus("Clipboard copy failed. You can still select the text manually.", "error");
  }
}

function handleDownloadTranscript() {
  if (!currentTranscript) {
    return;
  }

  const blob = new Blob([getCurrentPopupTranscriptOutput()], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = currentTranscript.filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
  setStatus("Downloaded transcript text file.", "success");
}

async function handleOpenSummary() {
  if (!currentTranscript) {
    return;
  }

  const output = getCurrentPopupTranscriptOutput();
  const settings = await settingsApi.loadSettings();
  const providerLabel = getConfiguredProviderLabel(settings);
  const prompt = buildSummaryPrompt(output, currentTranscript, settings);
  setStatus(`Opening ${providerLabel} summary prompt...`);

  let response;
  try {
    response = await sendRuntimeMessage(buildPopupSummaryMessage(output, settings, currentTranscript));
  } catch (_error) {
    await copySummaryPromptFallback(prompt, false, settings);
    return;
  }

  if (response && response.ok) {
    const action = response.submitted ? "and submitted it" : "with the summary prompt";
    setStatus(`Opened ${providerLabel} ${action}.`, "success");
    return;
  }

  await copySummaryPromptFallback(prompt, Boolean(response && response.opened), settings);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || "Chrome runtime message failed."));
        return;
      }

      resolve(response);
    });
  });
}

async function copySummaryPromptFallback(prompt, alreadyOpened, settings) {
  const providerLabel = getConfiguredProviderLabel(settings);
  if (!alreadyOpened) {
    window.open(getConfiguredProviderUrl(settings), "_blank", "noopener,noreferrer");
  }

  try {
    await navigator.clipboard.writeText(prompt);
    setStatus(`Opened ${providerLabel}. Prompt copied; paste it if the box is empty.`, "success");
  } catch (_error) {
    setStatus(`Opened ${providerLabel}, but automatic insert and clipboard copy failed.`, "error");
  }
}

async function handleTimedTranscriptClick(event) {
  const target = event.target?.closest?.("[data-seconds]");
  if (!target || !currentTabId) {
    return;
  }

  const seconds = Number(target.dataset.seconds);
  if (!Number.isFinite(seconds)) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      args: [seconds],
      func: seekYouTubeVideoFromPopup
    });
  } catch (_error) {
    setStatus("Could not seek the YouTube video from the popup.", "error");
  }
}

function seekYouTubeVideoFromPopup(seconds) {
  const video = document.querySelector("video");
  if (!video) {
    return false;
  }

  video.currentTime = seconds;
  if (typeof video.play === "function") {
    video.play();
  }
  return true;
}

function getCurrentPopupTranscriptOutput() {
  return getPopupTranscriptOutput(currentTranscript, currentView, currentTimedBlocks);
}

function getPreferredLanguageMessageValue(settings, browserLanguage) {
  return settings.defaultLanguage === "auto"
    ? "auto"
    : settingsApi.resolvePreferredLanguageCode(settings, browserLanguage);
}

function getPopupTranscriptOutput(transcript, view = POPUP_DEFAULT_VIEW, timedBlocks = null) {
  if (!transcript) {
    return "";
  }

  if (view === "text") {
    return transcript.text || "";
  }

  const blocks = timedBlocks || transcriptApi.groupTranscriptSegments(transcript.segments || []);
  return transcriptApi.formatTimedTranscript(blocks);
}

function buildSummaryPrompt(transcriptText, transcript = null, settings = {}) {
  if (settings.translateFallbackInLlm && transcript?.fellBackToOriginal) {
    const requestedLanguage = getTrackLanguageLabel(transcript.requestedTrack);
    const fallbackLanguage = getTrackLanguageLabel(transcript.track);
    return `${SUMMARY_PROMPT_PREFIX} The requested caption language was ${requestedLanguage}, but only ${fallbackLanguage} captions were available. Write the summary in ${requestedLanguage}.\n\n${transcriptText}`;
  }

  return `${SUMMARY_PROMPT_PREFIX}\n\n${transcriptText}`;
}

function buildPopupSummaryMessage(transcriptText, settings, transcript = null) {
  return {
    type: OPEN_LLM_SUMMARY_MESSAGE,
    prompt: buildSummaryPrompt(transcriptText, transcript, settingsApi.normalizeSettings(settings)),
    settings: settingsApi.normalizeSettings(settings)
  };
}

function getConfiguredProviderLabel(settings) {
  return settingsApi.getLlmProviderConfig(settingsApi.normalizeSettings(settings).llmProvider).label;
}

function getConfiguredProviderUrl(settings) {
  return settingsApi.getLlmProviderConfig(settingsApi.normalizeSettings(settings).llmProvider).url;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    POPUP_AUTO_FETCH_ON_OPEN,
    POPUP_DEFAULT_VIEW,
    buildPopupSummaryMessage,
    buildSummaryPrompt,
    getPreferredLanguageMessageValue,
    getPopupTranscriptOutput,
    shouldAutoFetchOnOpen
  };
}
