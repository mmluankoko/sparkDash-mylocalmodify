import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("defaultLanguage round-trips through disk and preserves existing settings", async () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), ".settings-language-test-"));
  const file = path.join(directory, "settings.json");
  const previous = process.env.SETTINGS_JSON_PATH;
  process.env.SETTINGS_JSON_PATH = file;
  try {
    fs.writeFileSync(file, JSON.stringify({ pollIntervalMs: 5000, hideWorkers: true }));
    const settings = await import("../../settings.js?language-test=" + Date.now());
    assert.equal(settings.loadSettings().defaultLanguage, "zh-CN");
    settings.updateSettings({ defaultLanguage: "en" });
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).defaultLanguage, "en");
    assert.equal(settings.loadSettings().defaultLanguage, "en");
    assert.equal(settings.getSettings().pollIntervalMs, 5000);
    assert.equal(settings.getSettings().hideWorkers, true);
    settings.updateSettings({ defaultLanguage: "unsupported" });
    assert.equal(settings.loadSettings().defaultLanguage, "zh-CN");
    assert.equal(settings.getSettings().pollIntervalMs, 5000);
  } finally {
    if (previous === undefined) delete process.env.SETTINGS_JSON_PATH;
    else process.env.SETTINGS_JSON_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
