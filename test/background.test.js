const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fillChatGptComposer,
  fillLlmComposer,
  openOptionsPage,
  openWelcomePageOnInstall
} = require("../background");

test("fillChatGptComposer inserts text into a contenteditable composer", async () => {
  const env = installDomTestEnvironment();
  const events = [];
  const commands = [];
  const composer = {
    tagName: "DIV",
    isContentEditable: true,
    disabled: false,
    textContent: "",
    getAttribute(name) {
      return name === "contenteditable" ? "true" : null;
    },
    focus() {
      events.push("focus");
    },
    dispatchEvent(event) {
      events.push(event.type);
    }
  };

  global.document = {
    querySelector(selector) {
      return selector === "#prompt-textarea" ? composer : null;
    },
    execCommand(command, _showDefaultUi, value) {
      commands.push([command, value]);
      if (command === "insertText") {
        composer.textContent = value;
        return true;
      }
      return true;
    }
  };

  try {
    const result = await fillChatGptComposer("Make a summary of this text:\n\nHello.", {
      maxAttempts: 1,
      delayMs: 0
    });

    assert.deepEqual(result, {
      ok: true,
      submitted: false
    });
    assert.equal(composer.textContent, "Make a summary of this text:\n\nHello.");
    assert.deepEqual(commands, [
      ["selectAll", undefined],
      ["insertText", "Make a summary of this text:\n\nHello."]
    ]);
    assert.deepEqual(events, ["focus", "input", "change"]);
  } finally {
    env.restore();
  }
});

test("fillChatGptComposer inserts text into a textarea composer", async () => {
  const env = installDomTestEnvironment();
  const events = [];
  const textarea = {
    tagName: "TEXTAREA",
    value: "",
    disabled: false,
    focus() {
      events.push("focus");
    },
    dispatchEvent(event) {
      events.push(event.type);
    }
  };

  global.document = {
    querySelector(selector) {
      return selector === "#prompt-textarea" ? textarea : null;
    }
  };

  try {
    const result = await fillChatGptComposer("Prompt body", {
      maxAttempts: 1,
      delayMs: 0
    });

    assert.deepEqual(result, {
      ok: true,
      submitted: false
    });
    assert.equal(textarea.value, "Prompt body");
    assert.deepEqual(events, ["focus", "input", "change"]);
  } finally {
    env.restore();
  }
});

test("fillLlmComposer clicks submit when auto submit is enabled", async () => {
  const env = installDomTestEnvironment();
  const events = [];
  const textarea = {
    tagName: "TEXTAREA",
    value: "",
    disabled: false,
    focus() {
      events.push("focus");
    },
    dispatchEvent(event) {
      events.push(event.type);
    }
  };
  const submitButton = {
    disabled: false,
    click() {
      events.push("submit-click");
    },
    getAttribute() {
      return null;
    }
  };

  global.document = {
    querySelector(selector) {
      if (selector === "#prompt-textarea") {
        return textarea;
      }
      if (selector === 'button[type="submit"]') {
        return submitButton;
      }
      return null;
    }
  };

  try {
    const result = await fillLlmComposer(
      "Prompt body",
      {
        composerSelectors: ["#prompt-textarea"],
        submitSelectors: ['button[type="submit"]']
      },
      {
        autoSubmit: true,
        maxAttempts: 1,
        delayMs: 0
      }
    );

    assert.deepEqual(result, {
      ok: true,
      submitted: true
    });
    assert.equal(textarea.value, "Prompt body");
    assert.deepEqual(events, ["focus", "input", "change", "submit-click"]);
  } finally {
    env.restore();
  }
});

test("fillLlmComposer waits for the submit button to become enabled", async () => {
  const env = installDomTestEnvironment();
  const events = [];
  const textarea = {
    tagName: "TEXTAREA",
    value: "",
    disabled: false,
    focus() {
      events.push("focus");
    },
    dispatchEvent(event) {
      events.push(event.type);
      if (event.type === "input") {
        setTimeout(() => {
          submitButton.disabled = false;
        }, 0);
      }
    }
  };
  const submitButton = {
    disabled: true,
    click() {
      events.push("submit-click");
    },
    getAttribute() {
      return null;
    }
  };

  global.document = {
    querySelector(selector) {
      if (selector === "#prompt-textarea") {
        return textarea;
      }
      if (selector === 'button[type="submit"]') {
        return submitButton;
      }
      return null;
    }
  };

  try {
    const result = await fillLlmComposer(
      "Prompt body",
      {
        composerSelectors: ["#prompt-textarea"],
        submitSelectors: ['button[type="submit"]']
      },
      {
        autoSubmit: true,
        maxAttempts: 1,
        delayMs: 0,
        submitDelayMs: 1,
        submitMaxAttempts: 3
      }
    );

    assert.deepEqual(result, {
      ok: true,
      submitted: true
    });
    assert.deepEqual(events, ["focus", "input", "change", "submit-click"]);
  } finally {
    env.restore();
  }
});

test("fillChatGptComposer reports when the composer is unavailable", async () => {
  const env = installDomTestEnvironment();

  global.document = {
    querySelector() {
      return null;
    }
  };

  try {
    const result = await fillChatGptComposer("Prompt body", {
      maxAttempts: 1,
      delayMs: 0
    });

    assert.deepEqual(result, {
      ok: false,
      error: "ChatGPT composer was not found."
    });
  } finally {
    env.restore();
  }
});

test("openWelcomePageOnInstall opens options on first install only", async () => {
  const createdTabs = [];
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://id/${path}`;
      }
    },
    tabs: {
      create(payload, callback) {
        createdTabs.push(payload);
        callback({ id: 42 });
      }
    }
  };

  assert.equal(await openWelcomePageOnInstall({ reason: "update" }, chromeApi), false);
  assert.deepEqual(createdTabs, []);

  assert.equal(await openWelcomePageOnInstall({ reason: "install" }, chromeApi), true);
  assert.deepEqual(createdTabs, [
    {
      active: true,
      url: "chrome-extension://id/options.html?welcome=1"
    }
  ]);
});

test("openOptionsPage asks Chrome to open the extension options page", async () => {
  let opened = false;
  const chromeApi = {
    runtime: {
      openOptionsPage(callback) {
        opened = true;
        callback();
      }
    }
  };

  assert.equal(await openOptionsPage(chromeApi), true);
  assert.equal(opened, true);
});

test("openOptionsPage falls back to creating an options tab", async () => {
  const createdTabs = [];
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://id/${path}`;
      }
    },
    tabs: {
      create(payload, callback) {
        createdTabs.push(payload);
        callback({ id: 7 });
      }
    }
  };

  assert.equal(await openOptionsPage(chromeApi), true);
  assert.deepEqual(createdTabs, [
    {
      active: true,
      url: "chrome-extension://id/options.html"
    }
  ]);
});

function installDomTestEnvironment() {
  const previousDocument = global.document;
  const previousEvent = global.Event;
  const previousInputEvent = global.InputEvent;

  global.Event = function Event(type) {
    this.type = type;
  };
  global.InputEvent = function InputEvent(type) {
    this.type = type;
  };

  return {
    restore() {
      global.document = previousDocument;
      global.Event = previousEvent;
      global.InputEvent = previousInputEvent;
    }
  };
}
