const form = document.getElementById("settingsForm");
const defaultLanguageInput = document.getElementById("defaultLanguage");
const llmProviderSelect = document.getElementById("llmProvider");
const autoSubmitInput = document.getElementById("autoSubmit");
const translateFallbackInLlmInput = document.getElementById("translateFallbackInLlm");
const resetSettingsButton = document.getElementById("resetSettings");
const statusEl = document.getElementById("status");

document.addEventListener("DOMContentLoaded", restoreSettings);
form.addEventListener("submit", handleSaveSettings);
resetSettingsButton.addEventListener("click", handleResetSettings);

async function restoreSettings() {
  try {
    renderSettings(await YttrSettings.loadSettings());
    setStatus("");
  } catch (error) {
    setStatus(error.message || "Could not load settings.", "error");
  }
}

async function handleSaveSettings(event) {
  event.preventDefault();

  try {
    const settings = await YttrSettings.saveSettings(readSettingsForm());
    renderSettings(settings);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(error.message || "Could not save settings.", "error");
  }
}

async function handleResetSettings() {
  try {
    const settings = await YttrSettings.saveSettings(YttrSettings.DEFAULT_SETTINGS);
    renderSettings(settings);
    setStatus("Settings reset.");
  } catch (error) {
    setStatus(error.message || "Could not reset settings.", "error");
  }
}

function readSettingsForm() {
  return {
    autoSubmit: autoSubmitInput.checked,
    defaultLanguage: defaultLanguageInput.value,
    llmProvider: llmProviderSelect.value,
    translateFallbackInLlm: translateFallbackInLlmInput.checked
  };
}

function renderSettings(settings) {
  defaultLanguageInput.value = settings.defaultLanguage;
  llmProviderSelect.value = settings.llmProvider;
  autoSubmitInput.checked = settings.autoSubmit;
  translateFallbackInLlmInput.checked = settings.translateFallbackInLlm;
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = ["status", tone].filter(Boolean).join(" ");
}
