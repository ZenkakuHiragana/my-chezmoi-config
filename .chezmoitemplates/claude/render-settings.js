"use strict";

const {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
} = require("jsonc-parser");

const INITIAL_KEYS = [
  "model",
  "agent",
  "effortLevel",
  "showThinkingSummaries",
  "promptSuggestionEnabled",
];
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

function parseJsonc(jsonText, label) {
  const errors = [];
  const value = parse(jsonText, errors);
  if (errors.length > 0) {
    const error = errors[0];
    const before = jsonText.slice(0, error.offset);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const column = error.offset - lastNewline;
    throw new RenderError(
      `${label} contains invalid JSON (${`line ${line}, column ${column}: ${printParseErrorCode(error.error)}`})`,
    );
  }
  return value;
}

function loadExistingSettings(jsonText) {
  if (jsonText === "") return {};

  return requireObject(
    parseJsonc(jsonText, "existing settings input"),
    "existing settings input",
  );
}

function loadManagedSettings(jsonText) {
  return requireObject(
    parseJson(jsonText, "managed settings argument"),
    "managed settings",
  );
}

function loadSpecificSettings(jsonText) {
  return requireObject(
    parseJson(jsonText, "Claude-specific settings argument"),
    "Claude-specific settings",
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

function getAtPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function semanticallyEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function arraysSemanticallyEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
    return false;
  const canonicalItems = (items) =>
    items.map((item) => JSON.stringify(canonicalize(item))).sort();
  return semanticallyEqual(canonicalItems(left), canonicalItems(right));
}

function formattingOptions(text) {
  return { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" };
}

function lineIndentAt(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, offset))[0];
}

function formatInsertedValue(value, indent, multiline) {
  const serialized = JSON.stringify(value, null, multiline ? 2 : undefined);
  return multiline ? serialized.replace(/\n/g, `\n${indent}`) : serialized;
}

function insertObjectProperty(text, parentPath, key, value) {
  const errors = [];
  const tree = parseTree(text, errors);
  if (errors.length > 0) return applyEdits(text, modify(text, [...parentPath, key], value, {
    formattingOptions: formattingOptions(text),
  }));
  const objectNode = findNodeAtLocation(tree, parentPath);
  if (!objectNode || objectNode.type !== "object")
    return applyEdits(text, modify(text, [...parentPath, key], value, {
      formattingOptions: formattingOptions(text),
    }));

  const closeOffset = objectNode.offset + objectNode.length - 1;
  const objectIndent = lineIndentAt(text, objectNode.offset);
  const children = objectNode.children ?? [];
  const firstChild = children[0];
  const lastChild = children.at(-1);
  const hasIndentedProperty =
    firstChild && lineIndentAt(text, firstChild.offset).length > objectIndent.length;
  const multiline = Boolean(hasIndentedProperty);
  const childIndent = multiline
    ? lineIndentAt(text, lastChild.offset)
    : "";
  const keyText = JSON.stringify(key);
  const valueText = formatInsertedValue(value, childIndent, multiline);
  const beforeClose = text.slice(objectNode.offset + 1, closeOffset);
  const trailingWhitespace = /[ \t\r\n]*$/.exec(beforeClose)[0];
  const insertionOffset = closeOffset - trailingWhitespace.length;

  let content;
  if (children.length === 0) {
    content = multiline
      ? `${childIndent}${keyText}: ${valueText}`
      : ` ${keyText}: ${valueText} `;
  } else if (multiline) {
    content = `,\n${childIndent}${keyText}: ${valueText}`;
  } else {
    content = `, ${keyText}: ${valueText}`;
  }
  return applyEdits(text, [{ offset: insertionOffset, length: 0, content }]);
}

function setMissingPath(text, path, desired) {
  let result = text;
  for (let index = 0; index < path.length; index += 1) {
    const parentPath = path.slice(0, index);
    const key = path[index];
    const current = loadExistingSettings(result);
    if (getAtPath(current, [...parentPath, key]) !== undefined) continue;
    const value = index === path.length - 1 ? desired : {};
    result = insertObjectProperty(result, parentPath, key, value);
  }
  return result;
}

function setPathIfChanged(text, path, desired, compare = semanticallyEqual) {
  const current = loadExistingSettings(text);
  const existing = getAtPath(current, path);
  if (existing !== undefined && compare(existing, desired)) return text;
  if (existing === undefined) return setMissingPath(text, path, desired);
  return applyEdits(text, modify(text, path, desired, {
    formattingOptions: formattingOptions(text),
  }));
}

function removePathIfPresent(text, path) {
  const current = loadExistingSettings(text);
  if (getAtPath(current, path) === undefined) return text;

  const errors = [];
  const tree = parseTree(text, errors);
  const valueNode = findNodeAtLocation(tree, path);
  const propertyNode = valueNode?.parent;
  const objectNode = propertyNode?.parent;
  if (
    errors.length > 0 ||
    !propertyNode ||
    propertyNode.type !== "property" ||
    !objectNode ||
    objectNode.type !== "object"
  )
    return applyEdits(text, modify(text, path, undefined, {
      formattingOptions: formattingOptions(text),
    }));

  const children = objectNode.children ?? [];
  const index = children.indexOf(propertyNode);
  let start;
  let end;
  if (children.length === 1) {
    start = objectNode.offset + 1;
    end = objectNode.offset + objectNode.length - 1;
  } else if (index < children.length - 1) {
    start = propertyNode.offset;
    end = children[index + 1].offset;
  } else {
    start = children[index - 1].offset + children[index - 1].length;
    end = propertyNode.offset + propertyNode.length;
  }
  return applyEdits(text, [{ offset: start, length: end - start, content: "" }]);
}

function syncObjectPath(text, path, desired) {
  const current = loadExistingSettings(text);
  const existing = getAtPath(current, path);
  if (existing === undefined) return setPathIfChanged(text, path, desired);
  if (existing === null || Array.isArray(existing) || typeof existing !== "object")
    return setPathIfChanged(text, path, desired);

  let result = text;
  for (const key of Object.keys(existing)) {
    if (!Object.hasOwn(desired, key))
      result = removePathIfPresent(result, [...path, key]);
  }
  for (const [key, value] of Object.entries(desired))
    result = setPathIfChanged(result, [...path, key], value);
  return result;
}

function syncPermissions(text, desired) {
  const current = loadExistingSettings(text);
  const existing = getAtPath(current, ["permissions"]);
  if (existing === undefined) return setPathIfChanged(text, ["permissions"], desired);
  if (existing === null || Array.isArray(existing) || typeof existing !== "object")
    return setPathIfChanged(text, ["permissions"], desired);

  let result = text;
  for (const key of Object.keys(existing)) {
    if (!Object.hasOwn(desired, key))
      result = removePathIfPresent(result, ["permissions", key]);
  }
  for (const [action, values] of Object.entries(desired))
    result = setPathIfChanged(result, ["permissions", action], values, arraysSemanticallyEqual);
  return result;
}

function mergePermissionSources(base, specific) {
  const result = {};
  for (const action of PERMISSION_ACTIONS) {
    const left = base[action] ?? [];
    const right = specific[action] ?? [];
    if (!Array.isArray(left) || !Array.isArray(right))
      throw new RenderError(`permissions.${action} must be an array`);
    const merged = mergeUnique(left, right);
    if (merged.length > 0) result[action] = merged;
  }
  return result;
}

function renderSettings(
  existingJson,
  managedJson,
  targetTool,
  opencodeBashJson,
  specificJson = "{}",
) {
  const otherTool = resolveOtherShellTool(targetTool);
  const managed = structuredClone(loadManagedSettings(managedJson));
  const specific = structuredClone(loadSpecificSettings(specificJson));
  resolvePermissionPlaceholders(managed, otherTool);
  resolvePermissionPlaceholders(specific, otherTool);

  const managedPermissions = requireObject(
    managed.permissions ?? {},
    "managed permissions",
  );
  const specificPermissions = requireObject(
    specific.permissions ?? {},
    "Claude-specific permissions",
  );
  const desired = structuredClone(managed);
  desired.permissions = mergePermissionSources(
    managedPermissions,
    specificPermissions,
  );
  if (Object.hasOwn(managed, "enabledPlugins") || Object.hasOwn(specific, "enabledPlugins")) {
    desired.enabledPlugins = {
      ...requireObject(managed.enabledPlugins ?? {}, "managed enabledPlugins"),
      ...requireObject(
        specific.enabledPlugins ?? {},
        "Claude-specific enabledPlugins",
      ),
    };
  }

  const rules = loadOpencodeBashRules(opencodeBashJson);
  mergeProjectedPermissions(
    desired,
    targetTool,
    projectOpencodeBashRules(rules, targetTool),
  );

  let result = existingJson === "" ? "{}" : existingJson;
  for (const key of INITIAL_KEYS) {
    if (Object.hasOwn(managed, key) && getAtPath(loadExistingSettings(result), [key]) === undefined)
      result = setPathIfChanged(result, [key], managed[key]);
  }
  if (getAtPath(desired, ["hooks", "SessionStart"]) !== undefined)
    result = setPathIfChanged(result, ["hooks", "SessionStart"], desired.hooks.SessionStart);
  result = syncPermissions(result, desired.permissions);
  if (desired.enabledPlugins !== undefined)
    result = syncObjectPath(result, ["enabledPlugins"], desired.enabledPlugins);
  // MCP 登録は settings.json では扱わない。Claude Code はこのキーを読まない。
  // 同期は run_onchange_after_claude-mcp.js が sync-mcp.js 経由で行う。
  result = removePathIfPresent(result, ["mcpServers"]);
  return result.endsWith("\n") ? result : `${result}\n`;
}

function main(argv) {
  if (argv.length !== 5) {
    process.stderr.write(
      "usage: render-settings.js <existing-settings-json> <managed-settings-json> " +
        "<target-tool> <opencode-bash-json> <claude-specific-json>\n",
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
