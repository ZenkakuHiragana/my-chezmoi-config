"use strict";

const fs = require("node:fs");
const { TextDecoder } = require("node:util");

const PRESERVED_KEYS = ["model", "effortLevel"];
const PERMISSION_ACTIONS = ["allow", "ask", "deny"];
const PERMISSION_PRIORITY = { allow: 1, ask: 2, deny: 3 };
const TARGET_TOOLS = ["PowerShell", "Bash"];
const OTHER_SHELL_TOOL_PLACEHOLDER = "{shell:other}";
const ENV_PLACEHOLDER_PATTERN = /\{env:([^}]+)\}/g;
const OTHER_SYMBOL = Symbol("other");

class RenderError extends Error {}

function describeJsonError(error, text) {
  const positionMatch = /position (\d+)/i.exec(error.message);
  if (!positionMatch) return error.message;

  const position = Number(positionMatch[1]);
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  const column = position - lastNewline;
  return `line ${line}, column ${column}: ${error.message}`;
}

function parseJson(jsonText, label) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new RenderError(
      `${label} contains invalid JSON (${describeJsonError(error, jsonText)})`,
    );
  }
}

function requireObject(value, label) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new RenderError(`${label} must be a JSON object`);
  }
  return value;
}

function loadJsonFile(path) {
  let bytes;
  try {
    bytes = fs.readFileSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new RenderError(
      `existing settings ${JSON.stringify(path)} could not be read: ${error.message}`,
    );
  }

  let jsonText;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RenderError(
      `existing settings ${JSON.stringify(path)} is not valid UTF-8: ${error.message}`,
    );
  }

  return requireObject(
    parseJson(jsonText, `existing settings ${JSON.stringify(path)}`),
    `existing settings ${JSON.stringify(path)}`,
  );
}

function loadManagedSettings(jsonText) {
  return requireObject(
    parseJson(jsonText, "managed settings argument"),
    "managed settings",
  );
}

function loadOpencodeBashRules(jsonText) {
  const value = requireObject(
    parseJson(jsonText, "opencode permission.bash argument"),
    "opencode permission.bash",
  );

  return Object.entries(value).map(([pattern, action]) => {
    if (!Object.hasOwn(PERMISSION_PRIORITY, action)) {
      throw new RenderError(
        `opencode permission.bash has unsupported action for ${JSON.stringify(pattern)}: ${JSON.stringify(action)}`,
      );
    }
    return [pattern, action];
  });
}

function globEpsilonClosure(patternCharacters, states) {
  const closed = new Set(states);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of [...closed]) {
      if (
        state < patternCharacters.length &&
        patternCharacters[state] === "*" &&
        !closed.has(state + 1)
      ) {
        closed.add(state + 1);
        changed = true;
      }
    }
  }
  return closed;
}

function globTransition(patternCharacters, states, symbol) {
  const nextStates = new Set();
  for (const state of states) {
    if (state >= patternCharacters.length) continue;
    const patternCharacter = patternCharacters[state];
    if (patternCharacter === "*") {
      nextStates.add(state);
    } else if (symbol !== OTHER_SYMBOL && patternCharacter === symbol) {
      nextStates.add(state + 1);
    }
  }
  return globEpsilonClosure(patternCharacters, nextStates);
}

function stateKey(narrowStates, broadStates) {
  return `${[...narrowStates].sort((a, b) => a - b).join(",")}|${[...broadStates].sort((a, b) => a - b).join(",")}`;
}

function globPatternCovers(broad, narrow) {
  const broadCharacters = [...broad];
  const narrowCharacters = [...narrow];
  const alphabet = [
    ...new Set(
      [...broadCharacters, ...narrowCharacters].filter(
        (character) => character !== "*",
      ),
    ),
  ].sort();
  const symbols = [...alphabet, OTHER_SYMBOL];
  const narrowStart = globEpsilonClosure(narrowCharacters, new Set([0]));
  const broadStart = globEpsilonClosure(broadCharacters, new Set([0]));
  const queue = [[narrowStart, broadStart]];
  const seen = new Set([stateKey(narrowStart, broadStart)]);

  while (queue.length > 0) {
    const [narrowStates, broadStates] = queue.shift();
    if (
      narrowStates.has(narrowCharacters.length) &&
      !broadStates.has(broadCharacters.length)
    )
      return false;

    for (const symbol of symbols) {
      const nextNarrow = globTransition(narrowCharacters, narrowStates, symbol);
      if (nextNarrow.size === 0) continue;
      const nextBroad = globTransition(broadCharacters, broadStates, symbol);
      const key = stateKey(nextNarrow, nextBroad);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nextNarrow, nextBroad]);
    }
  }
  return true;
}

function isProjectedDefaultAsk(pattern, action) {
  return pattern === "*" && action === "ask";
}

function assertPortableRules(rules) {
  const projectedRules = rules
    .map(([pattern, action], index) => [index, pattern, action])
    .filter(([, pattern, action]) => !isProjectedDefaultAsk(pattern, action));

  for (
    let leftPosition = 0;
    leftPosition < projectedRules.length;
    leftPosition += 1
  ) {
    const [leftIndex, leftPattern, leftAction] = projectedRules[leftPosition];
    for (const [rightIndex, rightPattern, rightAction] of projectedRules.slice(
      leftPosition + 1,
    )) {
      if (PERMISSION_PRIORITY[rightAction] >= PERMISSION_PRIORITY[leftAction])
        continue;
      if (!globPatternCovers(leftPattern, rightPattern)) continue;
      throw new RenderError(
        "opencode permission.bash contains a rule order that Claude permissions cannot represent: " +
          `#${leftIndex + 1} ${JSON.stringify(leftPattern)} => ${JSON.stringify(leftAction)} is overridden by ` +
          `#${rightIndex + 1} ${JSON.stringify(rightPattern)} => ${JSON.stringify(rightAction)}`,
      );
    }
  }
}

function resolveOtherShellTool(targetTool) {
  if (!TARGET_TOOLS.includes(targetTool)) {
    throw new RenderError(
      `unsupported target tool: ${JSON.stringify(targetTool)}`,
    );
  }
  return TARGET_TOOLS.find((tool) => tool !== targetTool);
}

function resolvePermissionPlaceholders(settings, otherTool) {
  if (!("permissions" in settings)) return;
  const permissions = requireObject(settings.permissions, "managed permissions");
  for (const action of PERMISSION_ACTIONS) {
    if (!(action in permissions)) continue;
    const list = permissions[action];
    if (!Array.isArray(list)) {
      throw new RenderError(`managed permissions.${action} must be an array`);
    }
    permissions[action] = list.map((item) =>
      item === OTHER_SHELL_TOOL_PLACEHOLDER ? otherTool : item,
    );
  }
}

function projectOpencodeBashRules(rules, targetTool) {
  if (!TARGET_TOOLS.includes(targetTool)) {
    throw new RenderError(
      `unsupported target tool: ${JSON.stringify(targetTool)}`,
    );
  }
  assertPortableRules(rules);

  const projected = Object.fromEntries(
    PERMISSION_ACTIONS.map((action) => [action, []]),
  );
  for (const [pattern, action] of rules) {
    if (!isProjectedDefaultAsk(pattern, action))
      projected[action].push(`${targetTool}(${pattern})`);
  }
  return projected;
}

function mergeUnique(left, right) {
  const merged = [];
  const seen = new Set();
  for (const item of [...left, ...right]) {
    const marker = JSON.stringify(item);
    if (seen.has(marker)) continue;
    seen.add(marker);
    merged.push(item);
  }
  return merged;
}

function mergeProjectedPermissions(settings, targetTool, projected) {
  if (!("permissions" in settings)) settings.permissions = {};
  const permissions = requireObject(
    settings.permissions,
    "managed permissions",
  );
  const existingDeny = permissions.deny ?? [];
  if (!Array.isArray(existingDeny)) {
    throw new RenderError("managed permissions.deny must be an array");
  }
  if (existingDeny.includes(targetTool)) {
    throw new RenderError(
      `cannot project opencode permission.bash to ${targetTool}: permissions.deny disables ${JSON.stringify(targetTool)}`,
    );
  }

  for (const action of PERMISSION_ACTIONS) {
    const existing = permissions[action] ?? [];
    if (!Array.isArray(existing)) {
      throw new RenderError(`managed permissions.${action} must be an array`);
    }
    const merged = mergeUnique(existing, projected[action]);
    if (merged.length > 0) permissions[action] = merged;
    else delete permissions[action];
  }
}

function loadOpencodeMcp(jsonText) {
  return requireObject(
    parseJson(jsonText, "opencode mcp argument"),
    "opencode mcp",
  );
}

function translateEnvPlaceholders(text) {
  return text.replace(ENV_PLACEHOLDER_PATTERN, "${$1}");
}

function projectOpencodeMcp(opencodeMcp) {
  const projected = {};
  for (const [name, definitionValue] of Object.entries(opencodeMcp)) {
    const definition = requireObject(
      definitionValue,
      `opencode mcp ${JSON.stringify(name)}`,
    );
    if (definition.enabled === false) continue;

    if (definition.type === "local") {
      const command = definition.command;
      if (!Array.isArray(command) || command.length === 0) {
        throw new RenderError(
          `opencode mcp ${JSON.stringify(name)} local command must be a non-empty array`,
        );
      }
      if (!command.every((item) => typeof item === "string")) {
        throw new RenderError(
          `opencode mcp ${JSON.stringify(name)} local command entries must be strings`,
        );
      }
      const env = Object.hasOwn(definition, "env") ? definition.env : {};
      requireObject(env, `opencode mcp ${JSON.stringify(name)} local env`);
      if (
        !Object.entries(env).every(
          ([key, value]) =>
            typeof key === "string" && typeof value === "string",
        )
      ) {
        throw new RenderError(
          `opencode mcp ${JSON.stringify(name)} local env must be a string map`,
        );
      }
      projected[name] = {
        type: "stdio",
        command: command[0],
        args: command.slice(1),
        env: Object.fromEntries(
          Object.entries(env).map(([key, value]) => [
            key,
            translateEnvPlaceholders(value),
          ]),
        ),
      };
      continue;
    }

    if (definition.type === "remote") {
      if (typeof definition.url !== "string" || definition.url.length === 0) {
        throw new RenderError(
          `opencode mcp ${JSON.stringify(name)} remote url must be a string`,
        );
      }
      const projectedServer = {
        type: "http",
        url: translateEnvPlaceholders(definition.url),
      };
      if (definition.headers != null) {
        const headers = requireObject(
          definition.headers,
          `opencode mcp ${JSON.stringify(name)} remote headers`,
        );
        if (
          !Object.entries(headers).every(
            ([key, value]) =>
              typeof key === "string" && typeof value === "string",
          )
        ) {
          throw new RenderError(
            `opencode mcp ${JSON.stringify(name)} remote headers must be a string map`,
          );
        }
        projectedServer.headers = Object.fromEntries(
          Object.entries(headers).map(([key, value]) => [
            key,
            translateEnvPlaceholders(value),
          ]),
        );
      }
      projected[name] = projectedServer;
      continue;
    }

    throw new RenderError(
      `opencode mcp ${JSON.stringify(name)} has unsupported type: ${JSON.stringify(definition.type)}`,
    );
  }
  return projected;
}

function renderSettings(
  existingPath,
  managedJson,
  targetTool,
  opencodeBashJson,
  opencodeMcpJson,
) {
  const otherTool = resolveOtherShellTool(targetTool);
  const managed = loadManagedSettings(managedJson);
  const existing = loadJsonFile(existingPath);
  const output = structuredClone(managed);
  resolvePermissionPlaceholders(output, otherTool);

  for (const key of PRESERVED_KEYS) {
    if (key in existing) output[key] = existing[key];
  }

  const rules = loadOpencodeBashRules(opencodeBashJson);
  mergeProjectedPermissions(
    output,
    targetTool,
    projectOpencodeBashRules(rules, targetTool),
  );

  const projectedMcp = projectOpencodeMcp(loadOpencodeMcp(opencodeMcpJson));
  if (Object.keys(projectedMcp).length > 0) output.mcpServers = projectedMcp;
  else delete output.mcpServers;

  return `${JSON.stringify(output, null, 2)}\n`;
}

function main(argv) {
  if (argv.length !== 5) {
    process.stderr.write(
      "usage: render-settings.js <existing-settings-path> <managed-settings-json> " +
        "<target-tool> <opencode-bash-json> <opencode-mcp-json>\n",
    );
    return 2;
  }

  try {
    process.stdout.write(renderSettings(...argv));
    return 0;
  } catch (error) {
    const detail = error instanceof RenderError ? error.message : error.stack;
    process.stderr.write(`render-settings.js: ${detail}\n`);
    return 1;
  }
}

module.exports = { RenderError, globPatternCovers, renderSettings };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
