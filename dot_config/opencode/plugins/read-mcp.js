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

const oauthFieldNames = {
  clientId: "client_id",
  clientSecret: "client_secret",
  callbackPort: "callback_port",
  redirectUri: "redirect_uri",
};

function convertOauth(oauth) {
  if (!isObject(oauth)) return oauth;
  return Object.fromEntries(
    Object.entries(oauth).map(([key, value]) => [oauthFieldNames[key] ?? key, value]),
  );
}

function convertTimeout(timeout) {
  return { catalog: timeout, execution: timeout };
}

// OpenCode expands {env:NAME} only while loading config files, not in plugin-provided MCP servers.
function substituteEnv(name, value) {
  if (typeof value === "string") {
    return value.replace(/\{env:([^}]+)\}/g, (_, variable) => {
      const resolved = process.env[variable];
      if (resolved === undefined) {
        throw new Error(`${name}: environment variable ${variable} is not set`);
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map((item) => substituteEnv(name, item));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteEnv(name, item)]),
    );
  }
  return value;
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
    if (source.timeout !== undefined) result.timeout = convertTimeout(source.timeout);
    if (source.enabled !== undefined) result.disabled = !source.enabled;
    return result;
  }

  if (typeof source.url === "string") {
    if (source.headers !== undefined && !stringMap(source.headers)) {
      throw new Error(`${name}: headers must be a string map`);
    }
    const result = { type: "remote", url: source.url };
    if (source.headers !== undefined) result.headers = source.headers;
    if (source.timeout !== undefined) result.timeout = convertTimeout(source.timeout);
    if (source.enabled !== undefined) result.disabled = !source.enabled;
    if (source.oauth !== undefined) result.oauth = convertOauth(source.oauth);
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
      servers[name] = substituteEnv(name, convert(name, source));
    } catch (error) {
      console.error(`read-mcp: ${sourcePath}: ${error.message}`);
    }
  }
  return servers;
}

export default {
  id: "local.read-mcp",
  async setup(ctx) {
    const projectDirectory = ctx.location?.project?.directory;
    const globalServers = await readServers(globalSourcePath, { required: true });
    const projectServers = projectDirectory
      ? await readServers(path.join(projectDirectory, ".mcp.json"))
      : {};
    const imported = { ...globalServers, ...projectServers };

    await ctx.mcp.transform((editor) => {
      for (const [name, server] of Object.entries(imported)) {
        // OpenCode native configuration remains authoritative over imported files.
        if (editor.get(name) === undefined) editor.set(name, server);
      }
    });
  },
};
