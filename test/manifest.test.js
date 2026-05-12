const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../manifest.json");

test("manifest avoids the broad tabs permission", () => {
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.deepEqual(manifest.permissions, [
    "scripting",
    "storage"
  ]);
});

test("manifest declares bundled png icons", () => {
  assert.deepEqual(manifest.icons, {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png"
  });
});

test("generated asset script is available for ignored icons and store images", () => {
  const generator = fs.readFileSync(path.join(__dirname, "..", "scripts/generate-assets.py"), "utf8");

  assert.match(generator, /generate_icons/);
  assert.match(generator, /generate_store_images/);
});
