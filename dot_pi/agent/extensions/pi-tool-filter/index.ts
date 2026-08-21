import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

type RuleConfig = { allow: string[]; deny: string[] };
type FilterConfig = {
  read: RuleConfig;
  write: RuleConfig;
  outsideDefault: "allow" | "deny";
  bash: RuleConfig;
};

type BashNode = {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  readonly startIndex: number;
  readonly parent?: BashNode | null;
  readonly isMissing?: boolean;
  child(index: number): BashNode | null;
  childForFieldName?(fieldName: string): BashNode | null;
};
type BashTree = { readonly rootNode: BashNode; delete(): void };
type BashParser = {
  parse(input: string): BashTree | null;
  setLanguage(language: unknown): void;
};
type TreeSitterModule = {
  Parser: {
    new (): BashParser;
    init(options: { locateFile: () => string }): Promise<void>;
  };
  Language: { load(path: string): Promise<unknown> };
};

const CONFIG_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "pi-tool-filter",
  "config.jsonc",
);

const EMPTY_RULE: RuleConfig = { allow: [], deny: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        result += char;
      } else result += " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else result += char === "\n" ? "\n" : " ";
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
    } else result += char;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

function readRule(value: unknown): RuleConfig {
  if (!isRecord(value)) return { ...EMPTY_RULE };
  return { allow: stringArray(value.allow), deny: stringArray(value.deny) };
}

function loadConfig(): FilterConfig | null {
  try {
    const parsed: unknown = JSON.parse(
      stripJsonComments(readFileSync(CONFIG_PATH, "utf8")),
    );
    if (!isRecord(parsed) || !isRecord(parsed.write)) return null;
    const write = parsed.write;
    const outsideDefault = write.outsideDefault;
    if (outsideDefault !== "allow" && outsideDefault !== "deny") return null;
    return {
      read: readRule(parsed.read),
      write: readRule(write),
      outsideDefault,
      bash: readRule(parsed.bash),
    };
  } catch {
    return null;
  }
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/");
}

function expandHome(pattern: string): string {
  const home = normalizePath(homedir());
  if (pattern === "~") return home;
  if (pattern.startsWith("~/")) return `${home}${pattern.slice(1)}`;
  return normalizePath(pattern);
}

function expandInputHome(value: string): string {
  const home = homedir();
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return `${home}${value.slice(1)}`;
  }
  return value;
}

function normalizeInputPath(value: string): string {
  const expanded = expandInputHome(value);
  if (process.platform !== "win32") return expanded;
  const match = expanded.match(/^\/([A-Za-z])(?=\/|$)/);
  return match ? `${match[1].toUpperCase()}:${expanded.slice(2) || "/"}` : expanded;
}

function resolveExistingPath(pathValue: string, cwd: string): string {
  const lexicalAbsolute = resolve(cwd, normalizeInputPath(pathValue));
  let existing = lexicalAbsolute;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return lexicalAbsolute;
    existing = parent;
  }
  try {
    const resolvedExisting = realpathSync(existing);
    const remainder = relative(existing, lexicalAbsolute);
    return remainder ? resolve(resolvedExisting, remainder) : resolvedExisting;
  } catch {
    return lexicalAbsolute;
  }
}

function pathCandidates(pathValue: string, cwd: string): string[] {
  const lexicalAbsolute = resolve(cwd, normalizeInputPath(pathValue));
  const absolute = resolveExistingPath(pathValue, cwd);
  const normalizedAbsolute = normalizePath(absolute);
  const candidates = new Set([
    normalizedAbsolute,
    normalizePath(lexicalAbsolute),
    normalizePath(pathValue),
  ]);

  const home = normalizePath(homedir());
  if (normalizedAbsolute === home || normalizedAbsolute.startsWith(`${home}/`)) {
    candidates.add(`~${normalizedAbsolute.slice(home.length)}`);
  }
  const canonicalCwd = resolveExistingPath(".", cwd);
  const cwdRelative = normalizePath(relative(canonicalCwd, absolute));
  if (cwdRelative && cwdRelative !== "." && !cwdRelative.startsWith("../") && !isAbsolute(cwdRelative)) {
    candidates.add(cwdRelative);
  }
  return [...candidates];
}

function globToRegExp(pattern: string, commandMode = false): RegExp {
  const normalized = commandMode ? pattern : expandHome(pattern);
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const doubleStar = "\u0000";
  let source = normalized
    .replaceAll("**", doubleStar)
    .split("*")
    .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
    .join(".*")
    .replaceAll(doubleStar, ".*");
  if (source.endsWith(" .*")) source = `${source.slice(0, -3)}(?: .*)?`;
  return new RegExp(`^${source}$`, "i");
}

function matchesPathGlob(patterns: readonly string[], candidates: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern);
    return candidates.some((candidate) => matcher.test(candidate));
  });
}

function matchesCommandGlob(patterns: readonly string[], values: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern, true);
    return values.some((value) => matcher.test(value));
  });
}

function block(reason: string): ToolCallEventResult {
  return { block: true, reason };
}

function pathDecision(
  pathValue: string,
  cwd: string,
  rules: RuleConfig,
 ): ToolCallEventResult | undefined {
  const candidates = pathCandidates(pathValue, cwd);
  if (matchesPathGlob(rules.allow, candidates)) return undefined;
  if (matchesPathGlob(rules.deny, candidates)) {
    return block("設定ファイルの拒否 Glob に一致したため拒否");
  }
  return undefined;
}

function isInsideDirectory(pathValue: string, cwd: string, boundaryCwd = cwd): boolean {
  const absolute = resolveExistingPath(pathValue, cwd);
  const canonicalCwd = resolveExistingPath(".", boundaryCwd);
  const cwdRelative = relative(canonicalCwd, absolute);
  return cwdRelative === "" ||
    (cwdRelative !== ".." &&
      !cwdRelative.startsWith("../") &&
      !cwdRelative.startsWith("..\\") &&
      !isAbsolute(cwdRelative));
}

function readPathDecision(pathValue: string, cwd: string, config: FilterConfig) {
  return pathDecision(pathValue, cwd, config.read);
}

function writePathDecision(pathValue: string, cwd: string, config: FilterConfig, boundaryCwd = cwd) {
  const candidates = pathCandidates(pathValue, cwd);
  if (matchesPathGlob(config.write.deny, candidates)) {
    return block("書き込みの拒否 Glob に一致したため拒否");
  }
  if (matchesPathGlob(config.write.allow, candidates)) return undefined;
  if (isInsideDirectory(pathValue, cwd, boundaryCwd)) return undefined;
  return config.outsideDefault === "allow"
    ? undefined
    : block("外部書き込みの未一致時既定値が deny のため拒否");
}

function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, "").replace(/\s+/g, " ").trim();
}

function commandValues(command: string): string[] {
  const trimmed = command.trim();
  const normalized = normalizeCommand(command);
  return normalized === trimmed ? [normalized] : [trimmed, normalized];
}

function simpleCommandCandidates(command: string): string[] {
  const values = new Set<string>();
  for (const value of [command, ...command.split(/&&|\|\||[;|\n]/)]) {
    const candidate = value.trim().replace(/^[\s$()]+/, "");
    if (candidate) { values.add(candidate); values.add(normalizeCommand(candidate)); }
  }
  return [...values];
}

const SHELL_ARGUMENT_NODE_TYPES = new Set(["word", "raw_string", "string", "concatenation", "number"]);
type CommandParts = { name: string; args: string[] };
type PathRole = "read" | "write";
type PowerShellCommand = { text: string; elements: string[] };

function shellTokenText(value: string): string {
  let result = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else result += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = undefined;
      } else if (
        char === "\\" &&
        next &&
        (next === "$" || next === "`" || next === "\\" || next === '"' || next === "\n")
      ) {
        result += next;
        index += 1;
      } else {
        result += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\" && next) {
      result += next;
      index += 1;
    } else {
      result += char;
    }
  }
  return result;
}

function commandParts(node: BashNode): CommandParts | undefined {
  const tokens: string[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "variable_assignment") continue;
    if (child.type === "command_name" || SHELL_ARGUMENT_NODE_TYPES.has(child.type)) {
      const token = shellTokenText(child.text);
      if (token) tokens.push(token);
    }
  }
  return tokens.length > 0 ? { name: tokens[0], args: tokens.slice(1) } : undefined;
}

function commandBasename(command: string): string {
  const normalized = command.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function isStaticPathValue(value: string): boolean {
  return value.length > 0 &&
    !value.includes("$") &&
    !value.includes("`") &&
    !value.includes("{}");
}

function pathRoleDecisions(
  paths: readonly (readonly [string, PathRole])[],
  cwd: string,
  config: FilterConfig,
  boundaryCwd = cwd,
 ): ToolCallEventResult | undefined {
  for (const [value, role] of paths) {
    if (!isStaticPathValue(value)) continue;
    const decision = role === "read"
      ? readPathDecision(value, cwd, config)
      : writePathDecision(value, cwd, config, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}

function shellPathArguments(args: readonly string[], commandName: string): string[] {
  return args.filter((value) => isStaticPathValue(value) && !value.startsWith("-") && (commandName !== "chmod" || !value.startsWith("+")));
}

type BashRedirect = {
  readonly paths: Array<readonly [string, PathRole]>;
  readonly ownerStart?: number;
};

function redirectOperator(text: string): string | undefined {
  return text.match(/^\d*(?:<<<|<<|<&|>&|&>>|&>|<>|>>|>\||>|<)/)?.[0]?.replace(/^\d+/, "");
}

function redirectRoles(operator: string | undefined): PathRole[] {
  if (operator === "<") return ["read"];
  if (operator === "<>") return ["read", "write"];
  if ([">", ">>", ">|", "&>", "&>>"].includes(operator ?? "")) return ["write"];
  return [];
}

function redirectWordEnd(value: string, start: number): number {
  let quote: "'" | '"' | undefined;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\" && next) index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && next) {
      index += 1;
      continue;
    }
    if (/\s|[;&|()<>]/.test(char)) return index;
  }
  return value.length;
}

function simpleBashRedirectRoles(command: string): Array<readonly [string, PathRole]> {
  const paths: Array<readonly [string, PathRole]> = [];
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length;) {
    const char = command[index];
    const next = command[index + 1];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === "\\" && next) index += 1;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "\\" && next) {
      index += 2;
      continue;
    }
    const operator = ["<<<", "<<", "<&", ">&", "&>>", "&>", "<>", ">>", ">|", ">", "<"]
      .find((candidate) => command.startsWith(candidate, index));
    if (!operator) {
      index += 1;
      continue;
    }
    const roles = redirectRoles(operator);
    let targetStart = index + operator.length;
    while (/\s/.test(command[targetStart] ?? "")) targetStart += 1;
    if (roles.length > 0 && command[targetStart] !== "(") {
      const targetEnd = redirectWordEnd(command, targetStart);
      const target = shellTokenText(command.slice(targetStart, targetEnd));
      if (isStaticPathValue(target)) {
        for (const role of roles) paths.push([target, role]);
      }
      index = targetEnd;
    } else {
      index += operator.length;
    }
  }
  return paths;
}

function redirectDestination(node: BashNode): string | undefined {
  const destination = node.childForFieldName?.("destination");
  if (destination) return shellTokenText(destination.text);
  const operator = redirectOperator(node.text);
  if (!operator) return undefined;
  const operatorIndex = node.text.indexOf(operator);
  return shellTokenText(node.text.slice(operatorIndex + operator.length).trim()) || undefined;
}

function redirectOwnerStart(node: BashNode): number | undefined {
  let ancestor = node.parent;
  while (ancestor) {
    if (ancestor.type === "command") return ancestor.startIndex;
    if (ancestor.type === "redirected_statement") {
      const body = ancestor.childForFieldName?.("body");
      const commands = body ? findCommandNodes(body).sort((left, right) => right.startIndex - left.startIndex) : [];
      return commands[0]?.startIndex;
    }
    ancestor = ancestor.parent;
  }
  return undefined;
}

function findBashRedirects(root: BashNode): BashRedirect[] {
  const redirects: BashRedirect[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "file_redirect") {
      const roles = redirectRoles(redirectOperator(node.text));
      const value = redirectDestination(node);
      if (value && isStaticPathValue(value) && roles.length > 0) {
        redirects.push({
          paths: roles.map((role) => [value, role] as const),
          ownerStart: redirectOwnerStart(node),
        });
      }
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return redirects;
}

const FIND_GLOBAL_OPTIONS = new Set([
  "-h",
  "-l",
  "-p",
  "-xdev",
  "-mount",
  "-depth",
  "-d",
  "-ignore_readdir_race",
  "-noignore_readdir_race",
]);
function findStartPaths(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (const value of args) {
    const lower = value.toLowerCase();
    if (FIND_GLOBAL_OPTIONS.has(lower)) continue;
    if (value === "--") continue;
    if (value.startsWith("-") || value === "!" || value === "(") break;
    if (isStaticPathValue(value)) paths.push(value);
  }
  return paths.length > 0 ? paths : ["."];
}

const BASH_PATH_COMMANDS = new Map<string, PathRole>([["cd", "read"], ["cat", "read"], ["rm", "write"], ["mkdir", "write"], ["touch", "write"], ["chmod", "write"], ["chown", "write"]]);
function bashPathRoles(parts: CommandParts): Array<readonly [string, PathRole]> {
  const name = commandBasename(parts.name);
  if (name === "find") {
    const starts = findStartPaths(parts.args);
    const paths: Array<readonly [string, PathRole]> = starts.map((value) => [value, "read"] as const);
    if (parts.args.some((value) => value.toLowerCase() === "-delete")) {
      paths.push(...starts.map((value) => [value, "write"] as const));
    }
    return paths;
  }
  const values = shellPathArguments(parts.args, name);
  if (name === "cp") return values.map((value, index) => [value, index === values.length - 1 ? "write" : "read"] as const);
  if (name === "mv") return values.map((value) => [value, "write"] as const);
  const role = BASH_PATH_COMMANDS.get(name);
  return role ? values.map((value) => [value, role] as const) : [];
}

function matchingCommandPattern(patterns: readonly string[], values: readonly string[]): string | undefined {
  return patterns.find((pattern) => {
    const matcher = globToRegExp(pattern, true);
    return values.some((value) => matcher.test(value));
  });
}

function checkBashValues(values: readonly string[], config: FilterConfig) {
  if (matchesCommandGlob(config.bash.allow, values)) return undefined;
  const pattern = matchingCommandPattern(config.bash.deny, values);
  return pattern
    ? block(`bash 拒否 Glob「${pattern}」に一致したため拒否。拒否は認可判断であり、同じ副作用を持つ代替経路（別コマンド、スクリプト、言語処理系、API、間接経路）も実行してはならない。`)
    : undefined;
}

const BASH_WRAPPER_NAMES = new Set(["sudo", "env", "command", "time", "nohup", "timeout", "nice", "ionice", "exec", "builtin", "doas", "setsid", "stdbuf", "watch", "flock", "parallel", "rust-parallel", "rush"]);
const BASH_SHELL_NAMES = new Set(["bash", "sh", "dash", "zsh", "ksh"]);
const BASH_EXEC_FLAGS = new Set(["-exec", "-execdir"]);
function optionTakesValue(commandName: string, option: string): boolean {
  const key = option.toLowerCase().split("=", 1)[0];
  if (commandName === "env") return new Set(["-u", "--unset", "-c", "--chdir"]).has(key);
  if (commandName === "timeout") return new Set(["-s", "--signal", "-k", "--kill-after"]).has(key);
  return new Set(["-u", "--user", "-g", "--group", "-c", "--chdir", "-d", "--directory", "-n", "--adjustment", "-s", "--signal"]).has(key);
}
function wrappedCommandArgs(name: string, args: readonly string[]): string[] {
  let index = 0;
  let positionalToSkip = name === "timeout" || name === "flock" ? 1 : 0;
  while (index < args.length) {
    const value = args[index];
    if (value === "--") return args.slice(index + 1);
    if (name === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) { index += 1; continue; }
    if (value.startsWith("-")) { index += optionTakesValue(name, value) && !value.includes("=") ? 2 : 1; continue; }
    if (positionalToSkip > 0) { positionalToSkip -= 1; index += 1; continue; }
    return args.slice(index);
  }
  return [];
}
function xargsCommandArgs(args: readonly string[]): string[] {
  const valueOptions = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === "--") return args.slice(index + 1);
    if (!value.startsWith("-")) return args.slice(index);
    const option = value.toLowerCase().split("=", 1)[0];
    index += valueOptions.has(option) && !value.includes("=") ? 2 : 1;
  }
  return [];
}

function extractPowerShellBody(command: string): string | undefined {
  const match = command.match(/(?:^|[;&|]\s*)["']?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^\s;&|]+))*\s+-(?:c|command)\s+([\s\S]+)$/i);
  if (!match) return undefined;
  const body = match[1].trim();
  if (body.length >= 2 && ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'")))) return body.slice(1, -1);
  return body;
}
function extractShellBody(parts: CommandParts): string | undefined {
  if (!BASH_SHELL_NAMES.has(commandBasename(parts.name))) return undefined;
  for (let index = 0; index < parts.args.length; index += 1) {
    const value = parts.args[index];
    if (value === "--") return undefined;
    if (/^-[^-]*c/.test(value)) return parts.args[index + 1];
  }
  return undefined;
}
const FIND_EXEC_TERMINATORS = new Set([";", "\\;", "+", "\\+"]);
function findNestedCommands(parts: CommandParts): CommandParts[] {
  const nested: CommandParts[] = [];
  for (let index = 0; index < parts.args.length; index += 1) {
    if (!BASH_EXEC_FLAGS.has(parts.args[index])) continue;
    const tokens: string[] = [];
    for (index += 1; index < parts.args.length; index += 1) {
      const value = parts.args[index];
      if (FIND_EXEC_TERMINATORS.has(value)) break;
      tokens.push(value);
    }
    if (tokens.length > 0) nested.push({ name: tokens[0], args: tokens.slice(1) });
  }
  return nested;
}

function bashWorkingDirectory(parts: CommandParts, cwd: string): string {
  if (commandBasename(parts.name) !== "cd") return cwd;
  const pathValue = shellPathArguments(parts.args, "cd")[0];
  return pathValue && isStaticPathValue(pathValue) ? resolveExistingPath(pathValue, cwd) : cwd;
}

const POWER_SHELL_READ_COMMANDS = new Set(["get-content", "cat", "type", "gc", "get-childitem", "ls", "dir", "gci", "set-location", "cd", "chdir", "sl"]);
const POWER_SHELL_WRITE_COMMANDS = new Set(["remove-item", "rm", "del", "erase", "rmdir", "rd", "copy-item", "cp", "copy", "move-item", "mv", "move", "new-item", "ni", "mkdir", "md", "set-content", "sc", "add-content", "ac", "clear-content", "clc", "rename-item", "ren", "rni", "set-acl"]);
const POWER_SHELL_COPY_COMMANDS = new Set(["copy-item", "cp", "copy"]);
const POWER_SHELL_MOVE_COMMANDS = new Set(["move-item", "mv", "move"]);
const POWER_SHELL_RENAME_COMMANDS = new Set(["rename-item", "ren", "rni"]);
const POWER_SHELL_SWITCHES = new Set(["-force", "-recurse", "-directory", "-file", "-container", "-verbose", "-whatif", "-confirm", "-passthru", "-includehidden", "-readonly", "-followsymlink", "-raw", "-wait"]);
function powerShellTokenText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/`(["'$`])/g, "$1");
  }
  return trimmed;
}

function powerShellArguments(args: readonly string[]): { positional: string[]; named: Map<string, string[]> } {
  const positional: string[] = [];
  const named = new Map<string, string[]>();
  const pathParameters = new Set(["-path", "-literalpath", "-destination", "-newname"]);
  for (let index = 0; index < args.length; index += 1) {
    const value = powerShellTokenText(args[index]);
    if (!value.startsWith("-")) { if (isStaticPathValue(value)) positional.push(value); continue; }
    const match = value.match(/^(--?[A-Za-z][A-Za-z0-9-]*)(?::|=)?(.*)$/);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const inline = powerShellTokenText(match[2]);
    if (inline) {
      if (pathParameters.has(name) && isStaticPathValue(inline)) named.set(name, [...(named.get(name) ?? []), inline]);
      continue;
    }
    const next = args[index + 1] === undefined ? undefined : powerShellTokenText(args[index + 1]);
    if (!POWER_SHELL_SWITCHES.has(name) && next && !next.startsWith("-")) {
      if (pathParameters.has(name) && isStaticPathValue(next)) named.set(name, [...(named.get(name) ?? []), next]);
      index += 1;
    }
  }
  return { positional, named };
}
function powerShellPathRoles(command: PowerShellCommand): Array<readonly [string, PathRole]> {
  const name = powerShellTokenText(command.elements[0] ?? "").toLowerCase();
  if (!name || (!POWER_SHELL_READ_COMMANDS.has(name) && !POWER_SHELL_WRITE_COMMANDS.has(name))) return [];
  const { positional, named } = powerShellArguments(command.elements.slice(1));
  const source = [...(named.get("-path") ?? []), ...(named.get("-literalpath") ?? [])];
  if (POWER_SHELL_READ_COMMANDS.has(name)) return [...source, ...positional].map((value) => [value, "read"] as const);
  if (POWER_SHELL_COPY_COMMANDS.has(name)) {
    const destination = named.get("-destination") ?? [];
    const sourceValues = destination.length > 0 ? [...source, ...positional] : [...source, ...positional.slice(0, -1)];
    return [...sourceValues.map((value) => [value, "read"] as const), ...destination.map((value) => [value, "write"] as const), ...(destination.length === 0 && positional.length > 0 ? [[positional[positional.length - 1], "write"] as const] : [])];
  }
  if (POWER_SHELL_MOVE_COMMANDS.has(name)) return [...source, ...(named.get("-destination") ?? []), ...(named.get("-newname") ?? []), ...positional].map((value) => [value, "write"] as const);
  if (POWER_SHELL_RENAME_COMMANDS.has(name)) return [...source, ...(named.get("-newname") ?? []), ...positional].map((value) => [value, "write"] as const);
  return [...source, ...(named.get("-destination") ?? []), ...(named.get("-newname") ?? []), ...positional].map((value) => [value, "write"] as const);
}

function parsePowerShellCommands(value: unknown): PowerShellCommand[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.filter(isRecord).flatMap((entry) => {
    const text = typeof entry.text === "string" ? entry.text : undefined;
    const elements = Array.isArray(entry.elements) ? entry.elements.filter((item): item is string => typeof item === "string") : [];
    return text && elements.length > 0 ? [{ text, elements }] : [];
  });
}

function powerShellWorkingDirectory(command: PowerShellCommand, cwd: string): string {
  const name = powerShellTokenText(command.elements[0] ?? "").toLowerCase();
  if (!POWER_SHELL_READ_COMMANDS.has(name) || !["set-location", "cd", "chdir", "sl"].includes(name)) return cwd;
  const { positional, named } = powerShellArguments(command.elements.slice(1));
  const pathValue = [...(named.get("-path") ?? []), ...(named.get("-literalpath") ?? []), ...positional][0];
  return pathValue && isStaticPathValue(pathValue) ? resolveExistingPath(pathValue, cwd) : cwd;
}


async function loadBashParser(): Promise<BashParser | null> {
  try {
    const extensionRequire = createRequire(import.meta.url);
    const webPath = extensionRequire.resolve("web-tree-sitter");
    const webWasm = extensionRequire.resolve("web-tree-sitter/web-tree-sitter.wasm");
    const bashWasm = extensionRequire.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
    const treeSitter = (await import(pathToFileURL(webPath).href)) as unknown as TreeSitterModule;
    await treeSitter.Parser.init({ locateFile: () => webWasm });
    const parser = new treeSitter.Parser();
    parser.setLanguage(await treeSitter.Language.load(bashWasm));
    return parser;
  } catch {
    return null;
  }
}
let bashParserPromise: Promise<BashParser | null> | undefined;
function getBashParser(): Promise<BashParser | null> {
  bashParserPromise ??= loadBashParser();
  return bashParserPromise;
}

function runPowerShellParser(body: string): PowerShellCommand[] | null {
  const parserCommand = "$inputText = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseInput($inputText, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { exit 2 }; @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { [pscustomobject]@{ text=$_.Extent.Text; elements=@($_.CommandElements | ForEach-Object { $_.Extent.Text }) } }) | ConvertTo-Json -Compress";
  for (const executable of ["pwsh", "pwsh.exe", "powershell", "powershell.exe"]) {
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", parserCommand], { input: body, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 3000, windowsHide: true });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.error || result.status !== 0) return null;
    try { return parsePowerShellCommands(JSON.parse(result.stdout.trim() || "[]")); } catch { return null; }
  }
  return null;
}

function checkPowerShellBody(body: string, config: FilterConfig, cwd: string, boundaryCwd = cwd) {
  const parsed = runPowerShellParser(body);
  if (!parsed) return checkBashValues(simpleCommandCandidates(body).flatMap(commandValues), config);
  let currentCwd = cwd;
  for (const command of parsed) {
    const commandDecision = checkBashValues(commandValues(command.text), config);
    if (commandDecision) return commandDecision;
    const pathDecision = pathRoleDecisions(powerShellPathRoles(command), currentCwd, config, boundaryCwd);
    if (pathDecision) return pathDecision;
    currentCwd = powerShellWorkingDirectory(command, currentCwd);
  }
  return undefined;
}

async function inspectCommandParts(parts: CommandParts, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd): Promise<ToolCallEventResult | undefined> {
  const commandText = [parts.name, ...parts.args].join(" ");
  const directDecision = checkBashValues(commandValues(commandText), config);
  if (directDecision) return directDecision;
  const pathDecision = pathRoleDecisions(bashPathRoles(parts), cwd, config, boundaryCwd);
  if (pathDecision) return pathDecision;
  const powerShellBody = extractPowerShellBody(commandText);
  if (powerShellBody) return checkPowerShellBody(powerShellBody, config, cwd, boundaryCwd);
  if (depth >= 3) return undefined;
  const shellBody = extractShellBody(parts);
  if (shellBody) {
    const nestedDecision = await inspectBash(shellBody, config, cwd, depth + 1, boundaryCwd);
    if (nestedDecision) return nestedDecision;
  }
  const name = commandBasename(parts.name);
  if (name === "find") {
    for (const nested of findNestedCommands(parts)) {
      const nestedDecision = await inspectCommandParts(nested, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (name === "xargs") {
    const nestedArgs = xargsCommandArgs(parts.args);
    if (nestedArgs.length > 0) {
      const nestedDecision = await inspectCommandParts({ name: nestedArgs[0], args: nestedArgs.slice(1) }, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (BASH_WRAPPER_NAMES.has(name)) {
    const nestedArgs = wrappedCommandArgs(name, parts.args);
    if (nestedArgs.length > 0) {
      const nestedDecision = await inspectCommandParts({ name: nestedArgs[0], args: nestedArgs.slice(1) }, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  return undefined;
}

function findCommandNodes(root: BashNode): BashNode[] {
  const commands: BashNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "command") commands.push(node);
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return commands;
}

function treeHasSyntaxError(root: BashNode): boolean {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "ERROR" || node.isMissing) return true;
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return false;
}

async function inspectBashWithoutParser(command: string, config: FilterConfig, cwd: string, boundaryCwd = cwd) {
  for (const candidate of simpleCommandCandidates(command)) {
    const directDecision = checkBashValues(commandValues(candidate), config);
    if (directDecision) return directDecision;
    const redirectDecision = pathRoleDecisions(simpleBashRedirectRoles(candidate), cwd, config, boundaryCwd);
    if (redirectDecision) return redirectDecision;
    const body = extractPowerShellBody(candidate);
    if (body) {
      const powerShellDecision = checkPowerShellBody(body, config, cwd, boundaryCwd);
      if (powerShellDecision) return powerShellDecision;
    }
  }
  return undefined;
}

async function inspectBash(command: string, config: FilterConfig, cwd = process.cwd(), depth = 0, boundaryCwd = cwd) {
  const parser = await getBashParser();
  if (!parser) return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(command);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
    let currentCwd = cwd;
    const commandNodes = findCommandNodes(tree.rootNode).sort((left, right) => left.startIndex - right.startIndex);
    const redirects = findBashRedirects(tree.rootNode);
    const handledRedirects = new Set<BashRedirect>();
    for (const node of commandNodes) {
      const directDecision = checkBashValues(commandValues(node.text), config);
      if (directDecision) return directDecision;
      for (const redirect of redirects) {
        if (redirect.ownerStart !== node.startIndex) continue;
        const redirectDecision = pathRoleDecisions(redirect.paths, currentCwd, config, boundaryCwd);
        if (redirectDecision) return redirectDecision;
        handledRedirects.add(redirect);
      }
      const parts = commandParts(node);
      if (parts) {
        const nestedDecision = await inspectCommandParts(parts, config, currentCwd, depth, boundaryCwd);
        if (nestedDecision) return nestedDecision;
        currentCwd = bashWorkingDirectory(parts, currentCwd);
      }
    }
    for (const redirect of redirects) {
      if (handledRedirects.has(redirect)) continue;
      const redirectDecision = pathRoleDecisions(redirect.paths, currentCwd, config, boundaryCwd);
      if (redirectDecision) return redirectDecision;
    }
    return undefined;
  } catch {
    return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
  } finally {
    tree?.delete();
  }
}

function inspectPathTool(event: ToolCallEvent, cwd: string, config: FilterConfig) {
  if (isToolCallEventType("read", event)) {
    return typeof event.input.path === "string" ? readPathDecision(event.input.path, cwd, config) : undefined;
  }
  if (isToolCallEventType("find", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("grep", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("ls", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("edit", event)) return writePathDecision(event.input.path, cwd, config);
  if (isToolCallEventType("write", event)) return writePathDecision(event.input.path, cwd, config);
  return undefined;
}

export default function piToolFilter(pi: ExtensionAPI): void {
  const config = loadConfig();
  pi.on("tool_call", async (event, ctx) => {
    if (!config) return undefined;
    if (isToolCallEventType("bash", event)) return inspectBash(event.input.command, config, ctx.cwd);
    return inspectPathTool(event, ctx.cwd, config);
  });
}
