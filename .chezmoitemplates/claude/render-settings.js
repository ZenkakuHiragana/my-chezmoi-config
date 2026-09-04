"use strict";

const PERMISSION_ACTIONS = ["allow", "ask", "deny"];
const PERMISSION_PRIORITY = { allow: 1, ask: 2, deny: 3 };
const TARGET_TOOLS = ["PowerShell", "Bash"];
const OTHER_SHELL_TOOL_PLACEHOLDER = "{shell:other}";
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

function loadManagedSettings(jsonText) {
  return requireObject(
    parseJson(jsonText, "managed settings argument"),
    "managed settings",
  );
}

function loadBashRules(jsonText) {
  const value = requireObject(
    parseJson(jsonText, "permissions.bash argument"),
    "permissions.bash",
  );

  return Object.entries(value).map(([pattern, action]) => {
    if (!Object.hasOwn(PERMISSION_PRIORITY, action)) {
      throw new RenderError(
        `permissions.bash has unsupported action for ${JSON.stringify(pattern)}: ${JSON.stringify(action)}`,
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
        "permissions.bash contains a rule order that Claude permissions cannot represent: " +
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
  const permissions = requireObject(
    settings.permissions,
    "managed permissions",
  );
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

function projectBashRules(rules, targetTool) {
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
      `cannot project permissions.bash to ${targetTool}: permissions.deny disables ${JSON.stringify(targetTool)}`,
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

function renderSettings(managedJson, targetTool, bashRulesJson) {
  const otherTool = resolveOtherShellTool(targetTool);
  const desired = structuredClone(loadManagedSettings(managedJson));
  resolvePermissionPlaceholders(desired, otherTool);
  desired.permissions = requireObject(
    desired.permissions ?? {},
    "managed permissions",
  );

  const rules = loadBashRules(bashRulesJson);
  mergeProjectedPermissions(
    desired,
    targetTool,
    projectBashRules(rules, targetTool),
  );

  // MCP は --mcp-config で別の JSON を渡すため、settings.json には出力しない。
  delete desired.mcpServers;
  return `${JSON.stringify(desired)}\n`;
}

function main(argv) {
  if (argv.length !== 3) {
    process.stderr.write(
      "usage: render-settings.js <managed-settings-json> <target-tool> " +
        "<bash-rules-json>\n",
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
