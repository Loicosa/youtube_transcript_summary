const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("popup markup exposes summary and timestamped views", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");

  assert.match(html, /id="openSummary"/);
  assert.match(html, /data-view="timed"/);
  assert.match(html, /data-view="text"/);
  assert.match(html, /id="timedTranscript"/);
});

test("popup uses timestamped transcript output by default", () => {
  const env = loadPopupTestEnvironment();

  try {
    const transcript = {
      text: "Plain transcript text.",
      segments: [
        { start: 0, duration: 1, text: "Intro text." },
        { start: 17, duration: 1, text: "Main point." }
      ]
    };

    assert.equal(env.popup.POPUP_DEFAULT_VIEW, "timed");
    assert.equal(env.popup.POPUP_AUTO_FETCH_ON_OPEN, false);
    assert.equal(
      env.popup.getPopupTranscriptOutput(transcript, "timed"),
      "[00:00] Intro text.\n\n[00:17] Main point."
    );
    assert.equal(env.popup.getPopupTranscriptOutput(transcript, "text"), "Plain transcript text.");
  } finally {
    env.restore();
  }
});

test("popup builds the same LLM summary request as the in-page panel", () => {
  const env = loadPopupTestEnvironment();

  try {
    assert.deepEqual(
      env.popup.buildPopupSummaryMessage(
        "Transcript body.",
        {
          autoSubmit: true,
          defaultLanguage: "fr",
          llmProvider: "gemini"
        }
      ),
      {
        type: "YTTR_OPEN_LLM_SUMMARY",
        prompt: "Make a summary of this text:\n\nTranscript body.",
        settings: {
          autoSubmit: true,
          defaultLanguage: "fr",
          llmProvider: "gemini",
          translateFallbackInLlm: false
        }
      }
    );
    assert.match(
      env.popup.buildPopupSummaryMessage(
        "Transcript body.",
        {
          defaultLanguage: "es",
          llmProvider: "chatgpt",
          translateFallbackInLlm: true
        },
        {
          fellBackToOriginal: true,
          requestedTrack: { name: "Spanish", languageCode: "es" },
          track: { name: "French", languageCode: "fr" }
        }
      ).prompt,
      /Write the summary in Spanish/
    );
  } finally {
    env.restore();
  }
});

test("popup asks content script to use YouTube caption language for auto language", () => {
  const env = loadPopupTestEnvironment();

  try {
    assert.equal(
      env.popup.getPreferredLanguageMessageValue({ defaultLanguage: "auto" }, "fr-FR"),
      "auto"
    );
    assert.equal(
      env.popup.getPreferredLanguageMessageValue({ defaultLanguage: "en" }, "fr-FR"),
      "en"
    );
  } finally {
    env.restore();
  }
});

test("browser action popup does not auto-fetch on open", () => {
  const env = loadPopupTestEnvironment();

  try {
    assert.equal(env.popup.shouldAutoFetchOnOpen(null), false);
    assert.equal(
      env.popup.shouldAutoFetchOnOpen({
        runtime: { sendMessage() {} },
        tabs: { query() {} }
      }),
      false
    );
  } finally {
    env.restore();
  }
});

function loadPopupTestEnvironment() {
  const popupPath = require.resolve("../popup");
  const previousDocument = global.document;
  const previousTranscriptModule = global.TranscriptModule;

  const elements = new Map();
  function createElement(id) {
    return {
      id,
      className: "",
      disabled: false,
      hidden: false,
      textContent: "",
      value: "",
      dataset: {},
      addEventListener() {},
      appendChild() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      classList: {
        toggle() {},
        add() {},
        remove() {}
      },
      setAttribute() {}
    };
  }

  global.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement(id));
      }
      return elements.get(id);
    }
  };
  global.TranscriptModule = require("../transcript");

  delete require.cache[popupPath];
  const popup = require("../popup");

  return {
    popup,
    restore() {
      delete require.cache[popupPath];
      global.document = previousDocument;
      global.TranscriptModule = previousTranscriptModule;
    }
  };
}
