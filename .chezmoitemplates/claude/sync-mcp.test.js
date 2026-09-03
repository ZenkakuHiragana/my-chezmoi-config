"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const syncPath = path.join(__dirname, "sync-mcp.js");
const {
  SyncError,
  projectMcp,
  collectSecrets,
  maskSecrets,
  readRegisteredNames,
  buildAddArgs,
  syncMcp,
} = require(syncPath);

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-mcp-"));
}

function writeClaudeJson(directory, value) {
  const filePath = path.join(directory, ".claude.json");
  fs.writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

// 呼び出しを記録し、指定した名前の add だけ失敗させる runner。
function makeRunner(options = {}) {
  const { failAdd = [], missing = false } = options;
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (missing) return { missing: true };
    if (args[1] === "add") {
      const name = failAdd.find((candidate) => args.includes(candidate));
      if (name !== undefined) {
        return { status: 1, output: `boom for ${name}` };
      }
    }
    return { status: 0, output: "" };
  };
  return { runner, calls };
}

test("projects local and remote definitions and skips disabled ones", () => {
  const projected = projectMcp({
    localServer: {
      type: "local",
      command: ["npm", "exec", "--yes", "pkg"],
      env: { TOKEN: "{env:TEST_TOKEN}" },
    },
    remoteServer: {
      type: "remote",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer {env:TEST_KEY}" },
    },
    disabledServer: { type: "local", command: ["nope"], enabled: false },
  });

  assert.deepEqual(projected, {
    localServer: {
      type: "stdio",
      command: "npm",
      args: ["exec", "--yes", "pkg"],
      env: { TOKEN: "${TEST_TOKEN}" },
    },
    remoteServer: {
      type: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer ${TEST_KEY}" },
    },
  });
});

test("expands {file:} placeholders to trimmed file contents", () => {
  const directory = makeTempDir();
  const entrypoint = path.join(directory, "entrypoint.txt");
  fs.writeFileSync(entrypoint, "/opt/app/index.js\n");

  const projected = projectMcp({
    fileServer: { type: "local", command: ["node", `{file:${entrypoint}}`] },
  });

  assert.deepEqual(projected.fileServer, {
    type: "stdio",
    command: "node",
    args: ["/opt/app/index.js"],
    env: {},
  });
});

test("rejects unsupported types and malformed definitions", () => {
  assert.throws(
    () => projectMcp({ weird: { type: "carrier-pigeon" } }),
    SyncError,
  );
  assert.throws(
    () => projectMcp({ empty: { type: "local", command: [] } }),
    SyncError,
  );
  assert.throws(
    () => projectMcp({ noUrl: { type: "remote" } }),
    SyncError,
  );
});

// render-settings.js から移設した回帰検査。null の扱いを変えない。
test("handles null env and null headers the same way as before", () => {
  assert.throws(
    () =>
      projectMcp({
        local: { type: "local", command: ["server"], env: null },
      }),
    /local env must be a JSON object/,
  );

  const projected = projectMcp({
    remote: { type: "remote", url: "https://example.com", headers: null },
  });
  assert.deepEqual(projected.remote, {
    type: "http",
    url: "https://example.com",
  });
});

test("reads registered names only from the mcpServers key", () => {
  const directory = makeTempDir();
  assert.deepEqual(
    readRegisteredNames(path.join(directory, "absent.json")),
    [],
  );
  assert.deepEqual(
    readRegisteredNames(writeClaudeJson(directory, { oauthAccount: {} })),
    [],
  );
  assert.deepEqual(
    readRegisteredNames(
      writeClaudeJson(directory, { mcpServers: { a: {}, b: {} } }),
    ),
    ["a", "b"],
  );
});

test("builds add arguments for stdio and http servers", () => {
  assert.deepEqual(
    buildAddArgs("local", {
      type: "stdio",
      command: "npm",
      args: ["exec", "pkg"],
      env: { TOKEN: "secret" },
    }),
    [
      "mcp",
      "add",
      "--scope",
      "user",
      "local",
      "--env",
      "TOKEN=secret",
      "--",
      "npm",
      "exec",
      "pkg",
    ],
  );

  assert.deepEqual(
    buildAddArgs("remote", {
      type: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer tok" },
    }),
    [
      "mcp",
      "add",
      "--scope",
      "user",
      "--transport",
      "http",
      "remote",
      "https://example.test/mcp",
      "--header",
      "Authorization: Bearer tok",
    ],
  );
});

test("removes servers that are not in the source of truth", () => {
  const directory = makeTempDir();
  const claudeJsonPath = writeClaudeJson(directory, {
    mcpServers: { keep: {}, stale: {} },
  });
  const { runner, calls } = makeRunner();

  const result = syncMcp({
    mcp: { keep: { type: "local", command: ["keep-cmd"] } },
    claudeJsonPath,
    runner,
    log: () => {},
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.removed, ["stale"]);
  assert.deepEqual(result.added, ["keep"]);
  assert.ok(
    calls.some(
      (args) => args[1] === "remove" && args[args.length - 1] === "stale",
    ),
  );
});

test("keeps going when one add fails and exits non-zero", () => {
  const directory = makeTempDir();
  const claudeJsonPath = writeClaudeJson(directory, { mcpServers: {} });
  const { runner } = makeRunner({ failAdd: ["broken"] });
  const logged = [];

  const result = syncMcp({
    mcp: {
      broken: { type: "local", command: ["missing-binary"] },
      healthy: { type: "local", command: ["ok-binary"] },
    },
    claudeJsonPath,
    runner,
    log: (message) => logged.push(message),
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.failed, ["broken"]);
  assert.deepEqual(result.added, ["healthy"]);
  assert.ok(logged.some((message) => message.includes("broken")));
});

test("skips silently with exit code 0 when claude is absent", () => {
  const directory = makeTempDir();
  const claudeJsonPath = writeClaudeJson(directory, { mcpServers: {} });
  const { runner } = makeRunner({ missing: true });
  const logged = [];

  const result = syncMcp({
    mcp: { any: { type: "local", command: ["cmd"] } },
    claudeJsonPath,
    runner,
    log: (message) => logged.push(message),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.added, []);
  assert.ok(logged.some((message) => message.includes("not found")));
});

test("masks header and env values in output", () => {
  const projected = projectMcp({
    remoteServer: {
      type: "remote",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer perm-supersecret-token" },
    },
  });
  const secrets = collectSecrets(projected);

  assert.deepEqual(secrets, ["Bearer perm-supersecret-token"]);
  assert.equal(
    maskSecrets("failed: Bearer perm-supersecret-token rejected", secrets),
    "failed: [REDACTED] rejected",
  );
});

test("never logs secrets when an add fails", () => {
  const directory = makeTempDir();
  const claudeJsonPath = writeClaudeJson(directory, { mcpServers: {} });
  const secret = "Bearer perm-do-not-leak";
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[1] === "add") return { status: 1, output: `rejected ${secret}` };
    return { status: 0, output: "" };
  };
  const logged = [];

  const result = syncMcp({
    mcp: {
      leaky: {
        type: "remote",
        url: "https://example.test/mcp",
        headers: { Authorization: secret },
      },
    },
    claudeJsonPath,
    runner,
    log: (message) => logged.push(message),
  });

  assert.equal(result.exitCode, 1);
  const joined = logged.join("\n");
  assert.ok(!joined.includes("perm-do-not-leak"));
  assert.ok(joined.includes("[REDACTED]"));
});
