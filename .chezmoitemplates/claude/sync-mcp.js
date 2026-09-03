"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { TextDecoder } = require("node:util");

const ENV_PLACEHOLDER_PATTERN = /\{env:([^}]+)\}/g;
const FILE_PLACEHOLDER_PATTERN = /\{file:([^}]+)\}/g;
const MASK = "[REDACTED]";

class SyncError extends Error {}

function requireObject(value, label) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new SyncError(`${label} must be a JSON object`);
  }
  return value;
}

function parseJson(jsonText, label) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new SyncError(`${label} contains invalid JSON (${error.message})`);
  }
}

function expandHome(rawPath) {
  if (rawPath === "~") return os.homedir();
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function readTextFile(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    throw new SyncError(
      `${label} could not read ${JSON.stringify(filePath)}: ${error.message}`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyncError(`${label} ${JSON.stringify(filePath)} is not valid UTF-8`);
  }
}

function translateEnvPlaceholders(text) {
  return text.replace(ENV_PLACEHOLDER_PATTERN, "${$1}");
}

function resolveFilePlaceholders(text, label) {
  return text.replace(FILE_PLACEHOLDER_PATTERN, (_match, rawPath) =>
    readTextFile(expandHome(rawPath.trim()), label).trim(),
  );
}

function resolveValue(text, label) {
  return translateEnvPlaceholders(resolveFilePlaceholders(text, label));
}

function requireStringMap(value, label) {
  requireObject(value, label);
  const invalid = Object.entries(value).some(
    ([key, item]) => typeof key !== "string" || typeof item !== "string",
  );
  if (invalid) throw new SyncError(`${label} must be a string map`);
  return value;
}

// 共通 MCP 定義を Claude Code の user スコープ登録へ射影する。
// enabled が false のものは除外する。
function projectMcp(mcp) {
  const projected = {};
  for (const [name, definitionValue] of Object.entries(
    requireObject(mcp, "mcp"),
  )) {
    const label = `mcp ${JSON.stringify(name)}`;
    const definition = requireObject(definitionValue, label);
    if (definition.enabled === false) continue;

    if (definition.type === "local") {
      const command = definition.command;
      if (!Array.isArray(command) || command.length === 0) {
        throw new SyncError(`${label} local command must be a non-empty array`);
      }
      if (!command.every((item) => typeof item === "string")) {
        throw new SyncError(`${label} local command entries must be strings`);
      }
      const env = Object.hasOwn(definition, "env") ? definition.env : {};
      requireStringMap(env, `${label} local env`);
      const resolved = command.map((item) => resolveValue(item, label));
      projected[name] = {
        type: "stdio",
        command: resolved[0],
        args: resolved.slice(1),
        env: Object.fromEntries(
          Object.entries(env).map(([key, item]) => [
            key,
            resolveValue(item, label),
          ]),
        ),
      };
      continue;
    }

    if (definition.type === "remote") {
      if (typeof definition.url !== "string" || definition.url.length === 0) {
        throw new SyncError(`${label} remote url must be a string`);
      }
      const server = { type: "http", url: resolveValue(definition.url, label) };
      if (definition.headers != null) {
        const headers = requireStringMap(
          definition.headers,
          `${label} remote headers`,
        );
        server.headers = Object.fromEntries(
          Object.entries(headers).map(([key, item]) => [
            key,
            resolveValue(item, label),
          ]),
        );
      }
      projected[name] = server;
      continue;
    }

    throw new SyncError(
      `${label} has unsupported type: ${JSON.stringify(definition.type)}`,
    );
  }
  return projected;
}

// 出力へ出してはならない値を集める。headers と env の値が対象。
function collectSecrets(projected) {
  const secrets = new Set();
  for (const server of Object.values(projected)) {
    for (const value of Object.values(server.headers ?? {})) {
      if (value) secrets.add(value);
    }
    for (const value of Object.values(server.env ?? {})) {
      if (value) secrets.add(value);
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length);
}

function maskSecrets(text, secrets) {
  let masked = String(text ?? "");
  for (const secret of secrets) masked = masked.split(secret).join(MASK);
  return masked;
}

// ~/.claude.json に実在する mcpServers のキーだけを削除候補にする。
// claude mcp list の出力は使わない（claude.ai コネクタを巻き込まないため）。
function readRegisteredNames(claudeJsonPath) {
  let raw;
  try {
    raw = fs.readFileSync(claudeJsonPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new SyncError(
      `could not read ${JSON.stringify(claudeJsonPath)}: ${error.message}`,
    );
  }
  const parsed = parseJson(raw, path.basename(claudeJsonPath));
  const servers = parsed?.mcpServers;
  if (servers === null || servers === undefined) return [];
  return Object.keys(requireObject(servers, "mcpServers"));
}

// --header と --env は可変長オプションのため、位置引数より後ろに置く。
// 前に置くと name や url を値として飲み込み "missing required argument" になる。
function buildAddArgs(name, server) {
  const args = ["mcp", "add", "--scope", "user"];
  if (server.type === "http") {
    args.push("--transport", "http", name, server.url);
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      args.push("--header", `${key}: ${value}`);
    }
    return args;
  }
  args.push(name);
  for (const [key, value] of Object.entries(server.env ?? {})) {
    args.push("--env", `${key}=${value}`);
  }
  args.push("--", server.command, ...server.args);
  return args;
}

function defaultRunner(args) {
  const result = spawnSync("claude", args, { encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") return { missing: true };
    return { status: 1, output: result.error.message };
  }
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

// 正本と登録を一致させる。remove 失敗は無視し、add 失敗は記録して続行する。
function syncMcp(options) {
  const { mcp, claudeJsonPath, runner = defaultRunner, log = console.error } =
    options;
  const projected = projectMcp(mcp);
  const secrets = collectSecrets(projected);
  const wanted = Object.keys(projected);
  const registered = readRegisteredNames(claudeJsonPath);
  const stale = registered.filter((name) => !wanted.includes(name));

  const probe = runner(["mcp", "list"]);
  if (probe.missing) {
    log("sync-mcp: claude executable not found; skipping MCP sync");
    return { exitCode: 0, skipped: true, added: [], removed: [], failed: [] };
  }

  const removed = [];
  for (const name of stale) {
    const result = runner(["mcp", "remove", "--scope", "user", name]);
    if (result.status === 0) removed.push(name);
    else log(`sync-mcp: could not remove stale ${name} (ignored)`);
  }

  const added = [];
  const failed = [];
  for (const name of wanted) {
    // 更新経路は remove してから add する。add 単体では既存を上書きできない。
    runner(["mcp", "remove", "--scope", "user", name]);
    const result = runner(buildAddArgs(name, projected[name]));
    if (result.status === 0) {
      added.push(name);
      continue;
    }
    failed.push(name);
    log(`sync-mcp: failed to add ${name}: ${maskSecrets(result.output, secrets)}`);
  }

  if (failed.length > 0) {
    log(`sync-mcp: ${failed.length} server(s) failed: ${failed.join(", ")}`);
    return { exitCode: 1, skipped: false, added, removed, failed };
  }
  return { exitCode: 0, skipped: false, added, removed, failed };
}

function main(argv) {
  if (argv.length !== 1) {
    process.stderr.write("usage: sync-mcp.js <mcp-json>\n");
    return 2;
  }
  try {
    const mcp = parseJson(argv[0], "mcp argument");
    const claudeJsonPath = path.join(os.homedir(), ".claude.json");
    return syncMcp({ mcp, claudeJsonPath }).exitCode;
  } catch (error) {
    const detail = error instanceof SyncError ? error.message : error.stack;
    process.stderr.write(`sync-mcp.js: ${detail}\n`);
    return 1;
  }
}

module.exports = {
  SyncError,
  projectMcp,
  collectSecrets,
  maskSecrets,
  readRegisteredNames,
  buildAddArgs,
  syncMcp,
  main,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
