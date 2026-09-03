"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const rendererPath = path.join(__dirname, "render-settings.js");
const { globPatternCovers, renderSettings } = require(rendererPath);

test("renders preserved settings and projected permissions", () => {
  const rendered = renderSettings(
    JSON.stringify({ model: "existing-model", effortLevel: "xhigh" }),
    JSON.stringify({ model: "fallback", permissions: { deny: ["Bash"] } }),
    "PowerShell",
    JSON.stringify({ "git status": "allow", "git push *": "deny", "*": "ask" }),
  );

  assert.deepEqual(JSON.parse(rendered), {
    model: "existing-model",
    effortLevel: "xhigh",
    permissions: {
      deny: ["Bash", "PowerShell(git push *)"],
      allow: ["PowerShell(git status)"],
    },
  });
});

test("treats empty existing settings input as a first run", () => {
  const rendered = JSON.parse(
    renderSettings("", JSON.stringify({ agent: "build" }), "PowerShell", "{}"),
  );

  assert.equal(rendered.agent, "build");
});

test("preserves the managed default agent and hooks", () => {
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

  const rendered = JSON.parse(
    renderSettings("", JSON.stringify(managed), "PowerShell", "{}"),
  );

  assert.equal(rendered.agent, "build");
  assert.deepEqual(rendered.hooks, managed.hooks);
});

test("never emits mcpServers even when existing settings carry it", () => {
  const rendered = JSON.parse(
    renderSettings(
      JSON.stringify({
        model: "existing-model",
        mcpServers: { legacy: { type: "stdio", command: "old" } },
      }),
      JSON.stringify({}),
      "Bash",
      "{}",
    ),
  );

  assert.equal(rendered.mcpServers, undefined);
  assert.equal(rendered.model, "existing-model");
});

test("projects permissions to Bash on non-Windows targets", () => {
  const rendered = renderSettings(
    "",
    JSON.stringify({ permissions: { deny: ["PowerShell"] } }),
    "Bash",
    JSON.stringify({ ls: "allow", "*": "ask" }),
  );

  assert.deepEqual(JSON.parse(rendered).permissions, {
    deny: ["PowerShell"],
    allow: ["Bash(ls)"],
  });
});

test("resolves the shell:other placeholder to the tool not being targeted", () => {
  const renderedForWindows = renderSettings(
    "",
    JSON.stringify({ permissions: { deny: ["{shell:other}"] } }),
    "PowerShell",
    "{}",
  );
  assert.deepEqual(JSON.parse(renderedForWindows).permissions, {
    deny: ["Bash"],
  });

  const renderedForLinux = renderSettings(
    "",
    JSON.stringify({ permissions: { deny: ["{shell:other}"] } }),
    "Bash",
    "{}",
  );
  assert.deepEqual(JSON.parse(renderedForLinux).permissions, {
    deny: ["PowerShell"],
  });
});

test("CLI rejects an unsupported target tool", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "", "{}", "zsh", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported target tool: "zsh"/);
});

test("CLI rejects a wrong argument count", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "", "{}", "Bash", "{}", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: render-settings\.js/);
  assert.match(result.stderr, /<bash-rules-json>/);
  assert.doesNotMatch(result.stderr, /opencode-bash-json/);
});

test("CLI identifies malformed existing settings input by location", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "{\n  broken\n}", "{}", "PowerShell", "{}", "{}"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /render-settings\.js: existing settings input/);
  assert.match(result.stderr, /invalid JSON/);
  assert.match(result.stderr, /line 2/i);
});

test("CLI names the malformed template argument", () => {
  const result = spawnSync(
    process.execPath,
    [rendererPath, "", "{", "PowerShell", "{}", "{}"],
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
    [rendererPath, "", "{}", "PowerShell", rules, "{}"],
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

test("does not rewrite semantically unchanged settings", () => {
  const existing = `{
  "unmanaged": { "keep": 1 },
  "permissions": {
    "deny": ["Read", "Bash"],
    "allow": ["AskUserQuestion"]
  },
  "enabledPlugins": { "plugin@example": true },
  "model": "existing"
}\n`;
  const rendered = renderSettings(
    existing,
    JSON.stringify({
      model: "fallback",
      permissions: {
        deny: ["Bash", "Read"],
        allow: ["AskUserQuestion"],
      },
      enabledPlugins: { "plugin@example": true },
    }),
    "PowerShell",
    "{}",
  );

  assert.equal(rendered, existing);
});

test("edits only changed managed values", () => {
  const existing = `{
  "unmanaged": { "keep": 1 },
  "permissions": {
    "deny": ["old"],
    "allow": ["keep"]
  },
  "enabledPlugins": { "plugin@example": true }
}\n`;
  const rendered = renderSettings(
    existing,
    JSON.stringify({
      permissions: { deny: ["new"], allow: ["keep"] },
      enabledPlugins: { "plugin@example": true },
    }),
    "PowerShell",
    "{}",
  );

  assert.match(rendered, /"unmanaged": \{ "keep": 1 \}/);
  assert.match(rendered, /"deny": \[\n      "new"\n    \]/);
  assert.match(rendered, /"enabledPlugins": \{ "plugin@example": true \}/);
  assert.doesNotMatch(rendered, /"old"/);
});

test("inserts a missing root key without reformatting an inline object", () => {
  const existing = '{\n  "permissions": { "deny": ["x"] }\n}\n';
  const rendered = renderSettings(
    existing,
    JSON.stringify({ model: "m", permissions: { deny: ["x"] } }),
    "PowerShell",
    "{}",
  );

  assert.match(rendered, /"permissions": \{ "deny": \["x"\] \}/);
  assert.match(rendered, /\n  "model": "m"\n/);
});

test("excludes mcpServers from every settings input", () => {
  const rendered = JSON.parse(
    renderSettings(
      JSON.stringify({ mcpServers: { existing: {} } }),
      JSON.stringify({
        permissions: {},
        mcpServers: { managed: {} },
      }),
      "PowerShell",
      "{}",
      JSON.stringify({ mcpServers: { specific: {} } }),
    ),
  );

  assert.equal(rendered.mcpServers, undefined);
});

test("combines specific permissions and overrides specific plugins", () => {
  const rendered = JSON.parse(
    renderSettings(
      "",
      JSON.stringify({
        permissions: { allow: ["common"], deny: ["blocked"] },
        enabledPlugins: { "shared@example": true },
      }),
      "Bash",
      "{}",
      JSON.stringify({
        permissions: { allow: ["machine"], deny: ["machine-blocked"] },
        enabledPlugins: {
          "shared@example": false,
          "machine@example": true,
        },
      }),
    ),
  );

  assert.deepEqual(rendered.permissions, {
    allow: ["common", "machine"],
    deny: ["blocked", "machine-blocked"],
  });
  assert.deepEqual(rendered.enabledPlugins, {
    "shared@example": false,
    "machine@example": true,
  });
});

test("sets only missing initial values and preserves other settings", () => {
  const rendered = JSON.parse(
    renderSettings(
      JSON.stringify({
        model: "existing",
        autoUpdatesChannel: "beta",
      }),
      JSON.stringify({
        model: "fallback",
        agent: "build",
        effortLevel: "high",
        showThinkingSummaries: true,
        promptSuggestionEnabled: false,
        permissions: {},
      }),
      "PowerShell",
      "{}",
    ),
  );

  assert.equal(rendered.model, "existing");
  assert.equal(rendered.agent, "build");
  assert.equal(rendered.effortLevel, "high");
  assert.equal(rendered.showThinkingSummaries, true);
  assert.equal(rendered.promptSuggestionEnabled, false);
  assert.equal(rendered.autoUpdatesChannel, "beta");
});

test("glob coverage handles non-BMP characters as single symbols", () => {
  assert.equal(globPatternCovers("x", "x😀"), false);
  assert.equal(globPatternCovers("x*", "x😀"), true);
});
