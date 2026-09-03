import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const globalSourcePath = path.join(os.homedir(), ".config", "mcp", "mcp.json");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringMap(value) {
  return isObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function convert(name, source) {
  if (!isObject(source)) throw new Error(`${name}: definition must be an object`);
  if (Object.hasOwn(source, "command")) {
    if (typeof source.command !== "string") {
      throw new Error(`${name}: command must be a string`);
    }
    if (source.url !== undefined) {
      throw new Error(`${name}: command and url cannot both be defined`);
    }
  }

  if (Object.hasOwn(source, "url") && typeof source.url !== "string") {
    throw new Error(`${name}: url must be a string`);
  }

  if (typeof source.command === "string") {
    const args = source.args ?? [];
    if (!Array.isArray(args) || !args.every((item) => typeof item === "string")) {
      throw new Error(`${name}: args must be an array of strings`);
    }
    if (source.env !== undefined && !stringMap(source.env)) {
      throw new Error(`${name}: env must be a string map`);
    }
    const result = {
      type: "local",
      command: [source.command, ...args],
    };
    if (source.env !== undefined) result.environment = source.env;
    if (source.cwd !== undefined) result.cwd = source.cwd;
    if (source.timeout !== undefined) result.timeout = source.timeout;
    if (source.enabled !== undefined) result.enabled = source.enabled;
    return result;
  }

  if (typeof source.url === "string") {
    if (source.headers !== undefined && !stringMap(source.headers)) {
      throw new Error(`${name}: headers must be a string map`);
    }
    const result = { type: "remote", url: source.url };
    if (source.headers !== undefined) result.headers = source.headers;
    if (source.timeout !== undefined) result.timeout = source.timeout;
    if (source.enabled !== undefined) result.enabled = source.enabled;
    if (source.oauth !== undefined) result.oauth = source.oauth;
    return result;
  }

  throw new Error(`${name}: definition must contain command or url`);
}

async function readServers(sourcePath, { required = false } = {}) {
  let document;
  try {
    document = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      if (required) {
        console.error(`read-mcp: required file is missing: ${sourcePath}`);
      }
    } else {
      console.error(`read-mcp: could not read ${sourcePath}: ${error.message}`);
    }
    return {};
  }
  if (!isObject(document) || !isObject(document.mcpServers)) {
    console.error(`read-mcp: ${sourcePath} must contain an mcpServers object`);
    return {};
  }

  const servers = {};
  for (const [name, source] of Object.entries(document.mcpServers)) {
    try {
      servers[name] = convert(name, source);
    } catch (error) {
      console.error(`read-mcp: ${sourcePath}: ${error.message}`);
    }
  }
  return servers;
}

export default async function readGlobalMcp({ worktree } = {}) {
  const projectSourcePath = worktree
    ? path.join(worktree, ".mcp.json")
    : undefined;

  return {
    config: async (config) => {
      const globalServers = await readServers(globalSourcePath, { required: true });
      const projectServers = projectSourcePath
        ? await readServers(projectSourcePath)
        : {};
      const imported = { ...globalServers, ...projectServers };
      // OpenCode native configuration remains authoritative over imported files.
      config.mcp = { ...imported, ...(config.mcp ?? {}) };
    },
  };
}
