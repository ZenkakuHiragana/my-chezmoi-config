"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const extractorPath = path.join(__dirname, "extract-project-trust.js");
const { expandHomePath, extractProjectTrust } = require(extractorPath);

test("extracts only project trust tables", () => {
  const input = [
    'model = "gpt"',
    "",
    '[projects."C:\\\\work\\\\one"]',
    'trust_level = "trusted"',
    "",
    "# project-local comment",
    "[features]",
    "multi_agent = true",
    "",
    '[projects."/work/two"]',
    'trust_level = "untrusted"',
    "",
    "[windows]",
    'sandbox = "elevated"',
  ].join("\r\n");

  assert.equal(
    extractProjectTrust(input),
    [
      '[projects."C:\\\\work\\\\one"]',
      'trust_level = "trusted"',
      "",
      "# project-local comment",
      "",
      '[projects."/work/two"]',
      'trust_level = "untrusted"',
      "",
    ].join("\n"),
  );
});

test("preserves a root projects table", () => {
  assert.equal(
    extractProjectTrust('[projects]\nfoo = { trust_level = "trusted" }\n'),
    '[projects]\nfoo = { trust_level = "trusted" }\n',
  );
});

test("expands current-user home paths like the Python CLI", () => {
  assert.equal(
    expandHomePath("~/.codex/config.toml", "/home/tester"),
    path.join("/home/tester", ".codex/config.toml"),
  );
  assert.equal(expandHomePath("~", "/home/tester"), "/home/tester");
  assert.equal(
    expandHomePath("~other/config.toml", "/home/tester"),
    "~other/config.toml",
  );
});

test("CLI treats a missing destination config as an empty first run", () => {
  const missingPath = path.join(
    os.tmpdir(),
    `missing-codex-${process.pid}.toml`,
  );
  const result = spawnSync(process.execPath, [extractorPath, missingPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("CLI reports an existing config read failure", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const result = spawnSync(process.execPath, [extractorPath, directory], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing Codex config/);
  assert.match(result.stderr, /could not be read/);
});

test("CLI rejects invalid UTF-8 with the config path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-config-"));
  const configPath = path.join(directory, "config.toml");
  fs.writeFileSync(
    configPath,
    Buffer.from([0x5b, 0x70, 0x72, 0x6f, 0x80, 0x5d]),
  );

  const result = spawnSync(process.execPath, [extractorPath, configPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /config\.toml/);
  assert.match(result.stderr, /not valid UTF-8/);
});

test("CLI reports incorrect arguments", () => {
  const result = spawnSync(process.execPath, [extractorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: extract-project-trust\.js/);
});
