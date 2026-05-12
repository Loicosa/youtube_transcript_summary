const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_SETTINGS,
  getLlmProviderConfig,
  normalizeSettings,
  resolvePreferredLanguageCode
} = require("../settings");

test("normalizeSettings returns safe defaults", () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("normalizeSettings preserves valid user preferences", () => {
  assert.deepEqual(
    normalizeSettings({
      autoSubmit: true,
      defaultLanguage: " fr-FR ",
      llmProvider: "claude",
      translateFallbackInLlm: true
    }),
    {
      autoSubmit: true,
      defaultLanguage: "fr-FR",
      llmProvider: "claude",
      translateFallbackInLlm: true
    }
  );
});

test("normalizeSettings clamps invalid values", () => {
  assert.deepEqual(
    normalizeSettings({
      autoSubmit: "yes",
      defaultLanguage: "   ",
      llmProvider: "unknown",
      translateFallbackInLlm: "yes"
    }),
    DEFAULT_SETTINGS
  );
});

test("resolvePreferredLanguageCode uses user language before browser fallback", () => {
  assert.equal(resolvePreferredLanguageCode({ defaultLanguage: "fr" }, "en-US"), "fr");
  assert.equal(resolvePreferredLanguageCode({ defaultLanguage: "auto" }, "en-US"), "en-US");
  assert.equal(resolvePreferredLanguageCode({ defaultLanguage: "auto" }, ""), "en");
});

test("getLlmProviderConfig returns known provider URLs", () => {
  assert.equal(getLlmProviderConfig("chatgpt").url, "https://chatgpt.com/");
  assert.equal(getLlmProviderConfig("claude").url, "https://claude.ai/new");
  assert.equal(getLlmProviderConfig("gemini").url, "https://gemini.google.com/app");
  assert.equal(getLlmProviderConfig("unknown").id, "chatgpt");
});
