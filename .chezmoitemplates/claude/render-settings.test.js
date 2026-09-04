"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const rendererPath = path.join(__dirname, "render-settings.js");
const { globPatternCovers, renderSettings } = require(rendererPath);

function render(managed, targetTool = "PowerShell", bashRules = {}) {
  return JSON.parse(
    renderSettings(JSON.stringify(managed), targetTool, JSON.stringify(bashRules)),
  );
}

test("renders managed settings and projected permissions", () => {
  assert.deepEqual(
    render(
      { model: "sonnet", permissions: { deny: ["Bash"] } },
      "PowerShell",
      { "git status": "allow", "git push *": "deny", "*": "ask" },
    ),
    {
      model: "sonnet",
      permissions: {
        deny: ["Bash", "PowerShell(git push *)"],
        allow: ["PowerShell(git status)"],
      },
    },
  );
});

test("preserves managed hooks", () => {
  const managed = {
    agent: "build",
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: "node",
              args: ["-e", "process.stdout.write('ok')"],
              timeout: 5,
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(render(managed), { ...managed, permissions: {} });
});

test("never emits mcpServers from managed settings", () => {
  assert.deepEqual(
    render({ mcpServers: { managed: {} }, permissions: {} }),
    { permissions: {} },
  );
});

test("projects permissions to Bash on non-Windows targets", () => {
  assert.deepEqual(
    render(
      { permissions: { deny: ["PowerShell"] } },
      "Bash",
      { ls: "allow", "*": "ask" },
    ).permissions,
    {
      deny: ["PowerShell"],
      allow: ["Bash(ls)"],
    },
  );
});

test("resolves the shell:other placeholder to the other tool", () => {
  assert.deepEqual(
    render({ permissions: { deny: ["{shell:other}"] } }, "PowerShell")
      .permissions,
    { deny: ["Bash"] },
  );
  assert.deepEqual(
    render({ permissions: { deny: ["{shell:other}"] } }, "Bash").permissions,
    { deny: ["PowerShell"] },
  );
});

test("CLI rejects an unsupported target tool", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "{}", "zsh", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported target tool: "zsh"/);
});

test("CLI rejects a wrong argument count", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "{}", "Bash"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: render-settings\.js/);
  assert.match(result.stderr, /<bash-rules-json>/);
  assert.doesNotMatch(result.stderr, /existing-settings-json/);
});

test("CLI identifies malformed managed settings input", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "{", "PowerShell", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /managed settings argument contains invalid JSON/,
  );
});

test("CLI reports the conflicting permission rules", () => {
  const result = spawnSync(
    process.execPath,
    [
      rendererPath,
      "{}",
      "PowerShell",
      JSON.stringify({ "git *": "deny", "git status": "allow" }),
    ],
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
