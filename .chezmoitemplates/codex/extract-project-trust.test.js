"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const extractorPath = path.join(__dirname, "extract-project-trust.js");
const { extractProjectTrust } = require(extractorPath);

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

test("CLI treats empty existing config input as a first run", () => {
  const result = spawnSync(process.execPath, [extractorPath, ""], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("CLI extracts project trust from existing config input", () => {
  const result = spawnSync(
    process.execPath,
    [extractorPath, '[projects."C:\\\\work"]\ntrust_level = "trusted"\n'],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    '[projects."C:\\\\work"]\ntrust_level = "trusted"\n',
  );
  assert.equal(result.stderr, "");
});

test("CLI reports incorrect arguments", () => {
  const result = spawnSync(process.execPath, [extractorPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: extract-project-trust\.js/);
});
