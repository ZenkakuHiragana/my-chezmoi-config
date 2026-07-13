"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const rendererPath = path.join(__dirname, "render-settings.js");
const { globPatternCovers, renderSettings } = require(rendererPath);

test("renders preserved settings and projected permissions and MCP", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "render-settings-"));
  const existingPath = path.join(directory, "settings.json");
  fs.writeFileSync(
    existingPath,
    JSON.stringify({ model: "existing-model", effortLevel: "xhigh" }),
  );

  const rendered = renderSettings(
    existingPath,
    JSON.stringify({ model: "fallback", permissions: { deny: ["Bash"] } }),
    "PowerShell",
    JSON.stringify({ "git status": "allow", "git push *": "deny", "*": "ask" }),
    JSON.stringify({
      local: {
        type: "local",
        command: ["server", "--stdio"],
        env: { TOKEN: "{env:TEST_TOKEN}" },
      },
    }),
  );

  assert.deepEqual(JSON.parse(rendered), {
    model: "existing-model",
    effortLevel: "xhigh",
    permissions: {
      deny: ["Bash", "PowerShell(git push *)"],
      allow: ["PowerShell(git status)"],
    },
    mcpServers: {
      local: {
        type: "stdio",
        command: "server",
        args: ["--stdio"],
        env: { TOKEN: "${TEST_TOKEN}" },
      },
    },
  });
});

test("projects permissions to Bash on non-Windows targets", () => {
  const rendered = renderSettings(
    "missing-settings.json",
    JSON.stringify({ permissions: { deny: ["PowerShell"] } }),
    "Bash",
    JSON.stringify({ ls: "allow", "*": "ask" }),
    "{}",
  );

  assert.deepEqual(JSON.parse(rendered).permissions, {
    deny: ["PowerShell"],
    allow: ["Bash(ls)"],
  });
});

test("CLI identifies malformed existing settings by path and location", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "render-settings-"));
  const existingPath = path.join(directory, "settings.json");
  fs.writeFileSync(existingPath, "{\n  broken\n}");

  const result = spawnSync(
    process.execPath,
    [rendererPath, existingPath, "{}", "PowerShell", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /render-settings\.js: existing settings/);
  assert.match(result.stderr, /settings\.json/);
  assert.match(result.stderr, /invalid JSON/);
  assert.match(result.stderr, /line 2/i);
});

test("CLI reports an existing settings read failure", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "render-settings-"));
  const result = spawnSync(
    process.execPath,
    [rendererPath, directory, "{}", "PowerShell", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing settings/);
  assert.match(result.stderr, /could not be read/);
});

test("CLI rejects invalid UTF-8 in existing settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "render-settings-"));
  const existingPath = path.join(directory, "settings.json");
  fs.writeFileSync(
    existingPath,
    Buffer.from([
      0x7b, 0x22, 0x6d, 0x6f, 0x64, 0x65, 0x6c, 0x22, 0x3a, 0x22, 0x80, 0x22,
      0x7d,
    ]),
  );

  const result = spawnSync(
    process.execPath,
    [rendererPath, existingPath, "{}", "PowerShell", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing settings/);
  assert.match(result.stderr, /settings\.json/);
  assert.match(result.stderr, /not valid UTF-8/);
});

test("CLI names the malformed template argument", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "missing-settings.json", "{", "PowerShell", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /managed settings argument contains invalid JSON/,
  );
});

test("CLI reports the conflicting permission rules", () => {
  const rules = JSON.stringify({ "git *": "deny", "git status": "allow" });
  const result = spawnSync(
    process.execPath,
    [rendererPath, "missing-settings.json", "{}", "PowerShell", rules, "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /rule order that Claude permissions cannot represent/,
  );
  assert.match(result.stderr, /#1 "git \*" => "deny"/);
  assert.match(result.stderr, /#2 "git status" => "allow"/);
});

test("glob coverage handles non-BMP characters as single symbols", () => {
  assert.equal(globPatternCovers("x", "x😀"), false);
  assert.equal(globPatternCovers("x*", "x😀"), true);
});

test("MCP null handling remains compatible with the Python renderer", () => {
  assert.throws(
    () =>
      renderSettings(
        "missing-settings.json",
        "{}",
        "PowerShell",
        "{}",
        JSON.stringify({
          local: { type: "local", command: ["server"], env: null },
        }),
      ),
    /local env must be a JSON object/,
  );

  const rendered = renderSettings(
    "missing-settings.json",
    "{}",
    "PowerShell",
    "{}",
    JSON.stringify({
      remote: {
        type: "remote",
        url: "https://example.com",
        headers: null,
      },
    }),
  );
  assert.deepEqual(JSON.parse(rendered).mcpServers.remote, {
    type: "http",
    url: "https://example.com",
  });
});
