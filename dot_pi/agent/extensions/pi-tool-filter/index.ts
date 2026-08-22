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
      if (token !== undefined) tokens.push(token); // 空文字列（''）も引数の値として保持する
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
const PYTHON_NAMES = new Set(["python", "python3", "py"]);
const NODE_NAMES = new Set(["node", "nodejs"]);
const POWER_SHELL_NAMES = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const SUBPROCESS_CALL_NAMES = new Set(["run", "call", "Popen", "check_call", "check_output"]);
const OS_COMMAND_NAMES = new Set(["system", "popen"]);
const NODE_CHILD_PROCESS_NAMES = new Set(["exec", "execSync", "spawn", "spawnSync", "execFile", "execFileSync", "fork"]);
const NODE_SHELL_STRING_NAMES = new Set(["exec", "execSync"]);
const NODE_ARGV_NAMES = new Set(["spawn", "spawnSync", "execFile", "execFileSync"]);
const NODE_FORK_NAME = "fork";
const HEREDOC_EXPANSION_CHARS = /[$`\\]/;
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
    if (/^-[^-]*c/.test(value)) {
      // `-c'code'` は同じ要素に本文、`-xc 'code'` は結合部が空なら次の要素が本文
      const attached = value.slice(value.indexOf("c") + 1);
      const code = attached !== "" ? attached : parts.args[index + 1];
      if (code !== undefined) return code;
    }
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


// ---- スクリプト本文の抽出と復元（python / node / PowerShell -EncodedCommand / heredoc） ----

// python / node 等の実行時オプション走査の終端。最初のオプションでない引数
// （スクリプトファイル）が現れると、それ以降の -c / -e / -m はスクリプトの
// 引数であり、インライン本文やモジュール実行としては扱わない。
// 値付きオプションの網羅はしない（契約の「含まない範囲」）。値付きオプションの
// 値はスクリプトファイル扱いで停止し、その奥の -c / -e / -m は検査されない。
// それは検査機会を逃すだけで許可側へ倒れる。
function interpreterOptionStop(args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") return index;
    if (value.startsWith("-")) continue;
    return index;
  }
  return args.length;
}

// インタープリターの実行モード。最初に現れた本文源（-c / -m / - / ファイル）が勝つ。
// python / node の CLI は -c・-m・ファイル・-（stdin）のうち先に来たものが本文源になり、
// 残りは argv として渡る。この模倣は既存の cd 追跡（bashWorkingDirectory）と同種であり、
// 現行の決定子を超えて拡張しない（契約の「含まない範囲」）。値付きオプションの値は
// ファイル扱いで先に勝つため、その奥のフラグは検査されない（許可側へ倒れる）。
type InterpreterMode = "inline" | "module" | "stdin" | "file" | "none";
function interpreterMode(args: readonly string[], inlineFlags: readonly string[], stdinFlags: readonly string[] = []): InterpreterMode {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") return "file";
    if (value === "-") return "stdin";
    if (inlineFlags.some((flag) => value === flag || value.startsWith(flag))) return "inline";
    if (value === "-m" || value.startsWith("-m")) return "module";
    if (stdinFlags.some((flag) => value === flag)) return "stdin";
    if (value.startsWith("-")) continue;
    return "file";
  }
  return "none";
}

function pythonBodyFromInline(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-c") return args[index + 1];
    const combined = value.match(/^-c([\s\S]+)$/);
    if (combined) return combined[1];
  }
  return undefined;
}

function nodeBodyFromInline(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-e" || value === "--eval" || value === "-p" || value === "--print") return args[index + 1];
    const combined = value.match(/^(-e|--eval|-p|--print)([\s\S]+)$/);
    if (combined) return combined[2].replace(/^=/, ""); // `--eval=<本文>` の = を除去する
  }
  return undefined;
}

function extractPythonBody(parts: CommandParts): string | undefined {
  if (!PYTHON_NAMES.has(commandBasename(parts.name))) return undefined;
  if (interpreterMode(parts.args, ["-c"]) !== "inline") return undefined;
  return pythonBodyFromInline(parts.args);
}

function extractNodeBody(parts: CommandParts): string | undefined {
  if (!NODE_NAMES.has(commandBasename(parts.name))) return undefined;
  if (interpreterMode(parts.args, ["-e", "--eval", "-p", "--print"]) !== "inline") return undefined;
  return nodeBodyFromInline(parts.args);
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function extractPowerShellEncodedBody(command: string): string | undefined {
  const match = command.match(/(?:^|[;&|]\s*)["']?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^\s;&|]+))*\s+-(?:EncodedCommand|enc)\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1], "base64");
  const utf16 = bytes.toString("utf16le");
  if (utf16 && !containsLoneSurrogate(utf16) && Buffer.from(utf16, "utf16le").equals(bytes)) return utf16;
  const utf8 = bytes.toString("utf8");
  if (utf8 && Buffer.from(utf8, "utf8").equals(bytes)) return utf8;
  return undefined;
}

function unescapeCommon(content: string, mode: "python" | "js"): string | undefined {
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== "\\") { result += char; continue; }
    const next = content[index + 1];
    if (next === undefined) return undefined;
    const simple: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "0": "\0" };
    if (simple[next] !== undefined) { result += simple[next]; index += 1; continue; }
    if (next === "x") {
      const hex = content.slice(index + 2, index + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { result += String.fromCharCode(parseInt(hex, 16)); index += 3; continue; }
      return undefined;
    }
    if (next === "u") {
      if (content[index + 2] === "{" && content[index + 3] !== undefined) {
        if (mode !== "js") return undefined;
        const close = content.indexOf("}", index + 2);
        if (close < 0) return undefined;
        const hex = content.slice(index + 3, close);
        if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
          const codePoint = parseInt(hex, 16);
          if (codePoint <= 0x10ffff) { result += String.fromCodePoint(codePoint); index = close; continue; }
        }
        return undefined;
      }
      const hex = content.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { result += String.fromCharCode(parseInt(hex, 16)); index += 5; continue; }
      return undefined;
    }
    if (next === "U" && mode === "python") {
      const hex = content.slice(index + 2, index + 10);
      if (/^[0-9a-fA-F]{8}$/.test(hex)) {
        const codePoint = parseInt(hex, 16);
        if (codePoint <= 0x10ffff) { result += String.fromCodePoint(codePoint); index += 9; continue; }
      }
      return undefined;
    }
    return undefined;
  }
  return result;
}

function pythonStringValue(node: BashNode): string | undefined {
  const text = node.text;
  const prefix = text.match(/^[rRuUbBfF]*/)?.[0] ?? "";
  if (prefix.includes("f") || prefix.includes("F") || prefix.includes("b") || prefix.includes("B")) return undefined;
  const rest = text.slice(prefix.length);
  if (rest.length < 2) return undefined;
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return undefined;
  const triple = rest.startsWith(quote.repeat(3));
  const close = triple ? rest.lastIndexOf(quote.repeat(3)) : rest.lastIndexOf(quote);
  if (close < (triple ? 3 : 1)) return undefined;
  const content = rest.slice(triple ? 3 : 1, close);
  return prefix.includes("r") || prefix.includes("R") ? content : unescapeCommon(content, "python");
}

function jsStringValue(node: BashNode): string | undefined {
  const text = node.text;
  if (text.length < 2) return undefined;
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  if (quote === "`" && text.includes("${")) return undefined;
  return unescapeCommon(text.slice(1, -1), "js");
}

// argv 要素を再構成トークンへ変換する。シェルが構文として解釈し得る文字
// （空白・展開・メタ文字）を含む要素は任意一致 `*` にする。join の単語分割の
// 曖昧さと、シェル=False で実行されるリテラルが bash 構文として誤解釈される
// ことを防ぐ。拒否は「値によらず一致が証明できる場合」だけに働く。
function argvToken(value: string): string {
  return /[\s$`\\;&|<>()]/.test(value) ? "*" : value;
}

function concatenatedValue(node: BashNode): string | undefined {
  let result = "";
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child?.type !== "string") continue;
    const value = pythonStringValue(child);
    if (value === undefined) return undefined;
    result += value;
  }
  return result;
}

function pythonSequenceTokens(node: BashNode): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "string") tokens.push(argvToken(pythonStringValue(child) ?? "*"));
    else if (child.type === "concatenated_string") tokens.push(argvToken(concatenatedValue(child) ?? "*"));
    else tokens.push("*");
  }
  return tokens;
}

function pythonSequenceFirstLiteral(node: BashNode): string | undefined {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "string") return pythonStringValue(child);
    if (child.type === "concatenated_string") return concatenatedValue(child);
    return undefined;
  }
  return undefined;
}

type ScriptCallTarget = { module?: string; name: string };
function pythonCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode) return undefined;
  if (fnNode.type === "attribute") {
    const objectNode = fnNode.childForFieldName?.("object");
    const attrNode = fnNode.childForFieldName?.("attribute");
    if (!objectNode || !attrNode || objectNode.type !== "identifier") return undefined;
    const module = objectNode.text.trim();
    const name = attrNode.text.trim();
    return (module === "subprocess" && SUBPROCESS_CALL_NAMES.has(name)) || (module === "os" && OS_COMMAND_NAMES.has(name))
      ? { module, name }
      : undefined;
  }
  if (fnNode.type === "identifier") {
    const name = fnNode.text.trim();
    return SUBPROCESS_CALL_NAMES.has(name) ? { name } : undefined;
  }
  return undefined;
}

function nodeCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode) return undefined;
  if (fnNode.type === "identifier") {
    const name = fnNode.text.trim();
    return NODE_CHILD_PROCESS_NAMES.has(name) ? { name } : undefined;
  }
  if (fnNode.type === "member_expression") {
    const property = fnNode.childForFieldName?.("property");
    if (property) {
      const name = property.type === "property_identifier" ? property.text.trim() : property.type === "string" ? jsStringValue(property) : undefined;
      if (name !== undefined && NODE_CHILD_PROCESS_NAMES.has(name)) return { name };
    }
  }
  if (fnNode.type === "subscript_expression") {
    // プロパティ側（ブラケット内）だけを見る。オブジェクト側の文字列を誤認しない。
    // 動的な名前解決の網羅はしない（契約の「含まない範囲」）。ここまでの対応は
    // 文字列・補間なしテンプレート・括弧付きの静的な形に限る。
    let indexNode = fnNode.childForFieldName?.("index");
    // 括弧付き（`[('execSync')]` 等）は内側の式を辿る
    for (let hops = 0; hops < 3 && indexNode?.type === "parenthesized_expression"; hops += 1) {
      for (let i = 0; i < indexNode.childCount; i += 1) {
        const child = indexNode.child(i);
        if (child && child.type !== "(" && child.type !== ")") { indexNode = child; break; }
      }
    }
    const candidates = indexNode ? [indexNode] : [];
    if (!indexNode) {
      for (let index = 1; index < fnNode.childCount; index += 1) {
        const child = fnNode.child(index);
        if (child) candidates.push(child);
      }
    }
    for (const child of candidates) {
      let name: string | undefined;
      if (child.type === "string") name = jsStringValue(child);
      else if (child.type === "template_string" && !child.text.includes("${")) name = jsStringValue(child);
      if (name !== undefined && NODE_CHILD_PROCESS_NAMES.has(name)) return { name };
    }
  }
  return undefined;
}

function jsArrayTokens(node: BashNode): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === ",") continue;
    if (child.type === "string") tokens.push(argvToken(jsStringValue(child) ?? "*"));
    else if (child.type === "template_string") tokens.push(argvToken(jsStringValue(child) ?? "*"));
    else tokens.push("*");
  }
  return tokens;
}

function jsStringValueOf(node: BashNode): string | undefined {
  return node.type === "string" || node.type === "template_string" ? jsStringValue(node) : undefined;
}

function jsObjectCwd(options: BashNode | undefined, cwd: string): string {
  if (!options) return cwd;
  for (let index = 0; index < options.childCount; index += 1) {
    const child = options.child(index);
    if (child?.type !== "pair") continue;
    const key = child.child(0);
    if (key?.type !== "property_identifier" || key.text.trim() !== "cwd") continue;
    const value = child.childCount > 2 ? child.child(2) : undefined;
    const literal = value ? jsStringValueOf(value) : undefined;
    return literal && isStaticPathValue(literal) ? resolveExistingPath(literal, cwd) : cwd;
  }
  return cwd;
}

function pythonCallKeywords(argsNode: BashNode): Map<string, BashNode> {
  const keywords = new Map<string, BashNode>();
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (child?.type !== "keyword_argument") continue;
    const nameNode = child.child(0);
    const valueNode = child.childCount > 2 ? child.child(2) : undefined;
    if (nameNode?.type === "identifier" && valueNode) keywords.set(nameNode.text.trim(), valueNode);
  }
  return keywords;
}

function pythonPositionalArgs(argsNode: BashNode): BashNode[] {
  const items: BashNode[] = [];
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "," || child.type === "(" || child.type === ")" || child.type === "keyword_argument") continue;
    items.push(child);
  }
  return items;
}

async function inspectPythonBody(body: string, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd) {
  // コメント行は任意のインデントで書けるため、最初の非空・非コメント行を見る。
  // トップレベルのインデントは IndentationError で実行されない。
  const firstStatement = body.split("\n").map((line) => line.trimEnd()).find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  }) ?? "";
  if (/^[ \t]/.test(firstStatement)) return undefined;
  const parser = await getParser("python");
  if (!parser) return undefined;
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(body);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return undefined;
    const stack = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === "call") {
        const target = pythonCallTarget(node);
        if (target) {
          const decision = await inspectPythonCall(node, target, config, cwd, depth, boundaryCwd);
          if (decision) return decision;
        }
      }
      for (let index = node.childCount - 1; index >= 0; index -= 1) {
        const child = node.child(index);
        if (child) stack.push(child);
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    tree?.delete();
  }
}

async function inspectPythonCall(node: BashNode, target: ScriptCallTarget, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string) {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  const keywords = pythonCallKeywords(argsNode);
  const items = pythonPositionalArgs(argsNode);
  const first = items[0] ?? keywords.get("args") ?? (target.module === "os" ? keywords.get("command") ?? keywords.get("cmd") : undefined);
  if (!first) return undefined;
  const shell = keywords.get("shell")?.type === "true";
  let execCwd = cwd;
  const cwdNode = keywords.get("cwd");
  if (cwdNode?.type === "string" || cwdNode?.type === "concatenated_string") {
    const value = cwdNode.type === "string" ? pythonStringValue(cwdNode) : concatenatedValue(cwdNode);
    if (value) execCwd = resolveExistingPath(value, cwd);
  }
  let text: string | undefined;
  if (target.module === "os") {
    if (first.type === "string") text = pythonStringValue(first);
    else if (first.type === "concatenated_string") text = concatenatedValue(first);
    else text = "*"; // 非リテラルは任意一致として再構成（値によらず一致が証明できる場合のみ拒否）
  } else if (first.type === "list" || first.type === "tuple") {
    if (shell) text = pythonSequenceFirstLiteral(first);
    else {
      const tokens = pythonSequenceTokens(first);
      if (tokens.length > 0) text = tokens.join(" ");
    }
  } else if (first.type === "string") {
    const value = pythonStringValue(first);
    if (value !== undefined) text = shell ? value : argvToken(value);
  } else if (first.type === "concatenated_string") {
    const value = concatenatedValue(first);
    if (value !== undefined) text = shell ? value : argvToken(value);
  } else {
    text = "*"; // 非リテラルは任意一致として再構成
  }
  if (text) {
    const decision = await inspectBash(text, config, execCwd, depth + 1, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}

async function inspectNodeJsBody(body: string, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd) {
  const parser = await getParser("javascript");
  if (!parser) return undefined;
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(body);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return undefined;
    const stack = [tree.rootNode];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.type === "call_expression") {
        const target = nodeCallTarget(node);
        if (target) {
          const decision = await inspectNodeJsCall(node, target, config, cwd, depth, boundaryCwd);
          if (decision) return decision;
        }
      }
      for (let index = node.childCount - 1; index >= 0; index -= 1) {
        const child = node.child(index);
        if (child) stack.push(child);
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    tree?.delete();
  }
}

async function inspectNodeJsCall(node: BashNode, target: ScriptCallTarget, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string) {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  const items: BashNode[] = [];
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    items.push(child);
  }
  const options = [...items].reverse().find((item) => item.type === "object");
  const execCwd = jsObjectCwd(options, cwd);
  let text: string | undefined;
  if (NODE_SHELL_STRING_NAMES.has(target.name)) {
    const value = items[0] ? jsStringValueOf(items[0]) ?? "*" : "*"; // exec 系は常にシェル経由。非リテラルは任意一致として再構成
    text = value;
  } else if (target.name === NODE_FORK_NAME) {
    const moduleToken = argvToken(items[0] ? jsStringValueOf(items[0]) ?? "*" : "*");
    const argTokens = items[1]?.type === "array" ? jsArrayTokens(items[1]) : [];
    text = ["node", moduleToken, ...argTokens].join(" ");
  } else {
    const cmdToken = items[0] ? argvToken(jsStringValueOf(items[0]) ?? "*") : "*";
    const argTokens = items[1]?.type === "array" ? jsArrayTokens(items[1]) : [];
    text = [cmdToken, ...argTokens].join(" ");
  }
  if (text) {
    const decision = await inspectBash(text, config, execCwd, depth + 1, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}

type BashHeredoc = { body: string; quoted: boolean; ownerStart: number };
function findStatementCommands(statement: BashNode): BashNode[] {
  const found: BashNode[] = [];
  const stack = [statement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "command") { found.push(node); continue; }
    // ネストした redirected_statement のコマンドは、別の heredoc が処理する
    if (node.type === "redirected_statement" && node !== statement) continue;
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return found;
}
function findBashHeredocs(root: BashNode, rawText: string): BashHeredoc[] {
  const heredocs: BashHeredoc[] = [];
  const stack = [root];
  const statementCommands = new Map<number, BashNode[]>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "heredoc_redirect") {
      const statement = node.parent;
      if (statement?.type === "redirected_statement") {
        // 同一 statement のコマンド探索は heredoc ごとに繰り返さない
        let commands = statementCommands.get(statement.startIndex);
        if (!commands) {
          commands = findStatementCommands(statement);
          statementCommands.set(statement.startIndex, commands);
        }
        // 本文を消費するコマンドは、構文上この heredoc に最も近いコマンド。
        // 通常は直前（`A && B <<'PY'` は B、`python <<'PY' | cat` は python）だが、
        // リダイレクト前置形（`<<'PY' python`）では直後になる。
        let ownerStart = -1;
        let bestEnd = -1;
        let bestStart = -1;
        for (const command of commands) {
          if (command.endIndex <= node.startIndex && command.endIndex > bestEnd) {
            bestEnd = command.endIndex;
            ownerStart = command.startIndex;
          }
          if (command.startIndex >= node.endIndex && (bestStart < 0 || command.startIndex < bestStart)) {
            bestStart = command.startIndex;
          }
        }
        if (ownerStart < 0) ownerStart = bestStart;
        let quoted = false;
        let tabStrip = false;
        let bodyStart = -1;
        let bodyEnd = -1;
        for (let index = 0; index < node.childCount; index += 1) {
          const child = node.child(index);
          if (child?.type === "heredoc_start") {
            quoted = child.text.startsWith("'") || child.text.startsWith('"');
            bodyStart = child.endIndex;
          } else if (child?.type === "heredoc_end") {
            bodyEnd = child.startIndex;
          } else if (child?.text === "<<-") {
            tabStrip = true;
          }
        }
        if (ownerStart >= 0 && bodyStart >= 0 && bodyEnd > bodyStart) {
          // tree-sitter-bash のオフセットは UTF-16 コード単位に等しく、
          // heredoc の本文開始は「開始デリミタ行の最初の改行の直後」で始まる。
          // パイプライン等で開始行に後続トークン（| cat 等）が続く場合は、
          // heredoc_start の直後ではなく改行位置から切り出す。
          const lineBreak = rawText.indexOf("\n", bodyStart);
          const contentStart = lineBreak >= 0 && lineBreak < bodyEnd ? lineBreak + 1 : bodyStart;
          let body = rawText.slice(contentStart, bodyEnd).replace(/^\r/, "");
          if (tabStrip) body = body.split("\n").map((line) => line.replace(/^\t+/, "")).join("\n");
          if (body.trim()) heredocs.push({ body, quoted, ownerStart });
        }
      }
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return heredocs;
}

// heredoc 本文を消費する実効コマンドを、既知ラッパーを剥いたうえで決める。
// 本文をコードとして実行せずデータとしてのみ消費する呼び出し（-c / -e 併用や
// スクリプトファイル指定）は検査対象外とする。
async function inspectHeredocBody(body: string, parts: CommandParts, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd) {
  let effective = parts;
  let hops = 0;
  // ラッパー剥き。多段（2 段以上）は意図的回避の典型であり、網羅しない
  // （契約の「含まない範囲」）。現行の上限と深さガードは維持し、これ以上は拡張しない。
  for (let index = 0; index < 5; index += 1) {
    const wrapperName = commandBasename(effective.name);
    if (!BASH_WRAPPER_NAMES.has(wrapperName)) break;
    // `command -v python` などの照会形は対象コマンドを実行しない。
    // heredoc は実行されないデータとして扱う
    if (wrapperName === "command" && (effective.args[0]?.startsWith("-") ?? false)) return undefined;
    const nestedArgs = wrappedCommandArgs(wrapperName, effective.args);
    if (nestedArgs.length === 0) break;
    effective = { name: nestedArgs[0], args: nestedArgs.slice(1) };
    hops += 1;
  }
  if (depth + hops >= 3) return undefined; // ラッパー段数も既存の深さ制限に数える
  const effectiveDepth = depth + hops;
  const base = commandBasename(effective.name);
  if (BASH_SHELL_NAMES.has(base)) {
    const inline = extractShellBody(effective);
    // `-s` は stdin を本文として実行するが、-c が同時にある場合は -c が勝ち、
    // スクリプトファイルが先行すればその引数になる
    const readsStdin = inline === undefined && interpreterMode(effective.args, ["-c"], ["-s"]) === "stdin";
    if (!readsStdin && inline !== undefined) return undefined;
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectBash(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (PYTHON_NAMES.has(base)) {
    if (extractPythonBody(effective) !== undefined) return undefined;
    if (pythonModuleArgs(effective.args)) return undefined;
    // `-`（stdin 本文）がモードのときは、後続の位置引数があっても検査する
    const readsStdin = interpreterMode(effective.args, ["-c"]) === "stdin";
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectPythonBody(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (NODE_NAMES.has(base)) {
    if (extractNodeBody(effective) !== undefined) return undefined;
    // `-`（stdin 本文）がモードのときは、後続の位置引数があっても検査する
    const readsStdin = interpreterMode(effective.args, ["-e", "--eval", "-p", "--print"]) === "stdin";
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectNodeJsBody(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (POWER_SHELL_NAMES.has(base)) {
    // -File の値が `-` の場合は stdin 本文を実行するため、後続の位置引数は
    // スクリプトの引数であり、PowerShell 本体のオプションとして扱わない
    const fileIsStdin = effective.args.some((value, index) => /^-+file$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] === "-");
    if (fileIsStdin) return checkPowerShellBody(body, config, cwd, boundaryCwd);
    const argsText = [effective.name, ...effective.args].join(" ");
    const inlineBody = extractPowerShellBody(argsText);
    // `-Command -` は stdin を本文として実行するため、heredoc 本文はデータではない。
    // 値が空文字列の -Command / -c も同様にデータ消費。
    // （値の無い -Command は stdin 本文の実行形であり、空文字列の値を持つ場合のみデータ）
    const hasEmptyCommandValue = effective.args.some((value, index) => /^-+(?:command|c)$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] === "");
    // -EncodedCommand は値の復号可否に関わらず heredoc 本文を実行しない（復号不能は検査不能）
    const hasEncodedOption = effective.args.some((value) => /^-+(?:encodedcommand|enc)$/i.test(value));
    if ((inlineBody !== undefined && inlineBody.trim() !== "-") || hasEncodedOption || hasEmptyCommandValue) return undefined;
    const hasFileOption = effective.args.some((value, index) => /^-+file$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] !== "-");
    if (hasFileOption) return undefined;
    const stop = interpreterOptionStop(effective.args);
    if (stop < effective.args.length) return undefined;
    return checkPowerShellBody(body, config, cwd, boundaryCwd);
  }
  return undefined;
}

function pythonModuleArgs(args: readonly string[]): { module: string; rest: string[] } | undefined {
  if (interpreterMode(args, ["-c"]) !== "module") return undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-m") {
      const module = args[index + 1];
      return module ? { module, rest: args.slice(index + 2) } : undefined;
    }
    const combined = value.match(/^-m(.+)$/);
    if (combined) return { module: combined[1], rest: args.slice(index + 1) };
  }
  return undefined;
}

const PARSER_WASM_PATHS = {
  bash: "tree-sitter-bash/tree-sitter-bash.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
} as const;
type ParserKind = keyof typeof PARSER_WASM_PATHS;

async function loadParser(kind: ParserKind): Promise<BashParser | null> {
  try {
    const extensionRequire = createRequire(import.meta.url);
    const webPath = extensionRequire.resolve("web-tree-sitter");
    const webWasm = extensionRequire.resolve("web-tree-sitter/web-tree-sitter.wasm");
    const wasmPath = extensionRequire.resolve(PARSER_WASM_PATHS[kind]);
    const treeSitter = (await import(pathToFileURL(webPath).href)) as unknown as TreeSitterModule;
    await treeSitter.Parser.init({ locateFile: () => webWasm });
    const parser = new treeSitter.Parser();
    parser.setLanguage(await treeSitter.Language.load(wasmPath));
    return parser;
  } catch {
    return null;
  }
}

const parserPromises = new Map<ParserKind, Promise<BashParser | null>>();
function getParser(kind: ParserKind): Promise<BashParser | null> {
  let promise = parserPromises.get(kind);
  if (!promise) {
    promise = loadParser(kind);
    parserPromises.set(kind, promise);
  }
  return promise;
}

function getBashParser(): Promise<BashParser | null> {
  return getParser("bash");
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
  const encodedBody = extractPowerShellEncodedBody(commandText);
  if (encodedBody) return checkPowerShellBody(encodedBody, config, cwd, boundaryCwd);
  if (depth >= 3) return undefined;
  const shellBody = extractShellBody(parts);
  if (shellBody) {
    const nestedDecision = await inspectBash(shellBody, config, cwd, depth + 1, boundaryCwd);
    if (nestedDecision) return nestedDecision;
  }
  const name = commandBasename(parts.name);
  if (PYTHON_NAMES.has(name)) {
    const pythonBody = extractPythonBody(parts);
    if (pythonBody) {
      const nestedDecision = await inspectPythonBody(pythonBody, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
    const moduleArgs = pythonModuleArgs(parts.args);
    if (moduleArgs) {
      const nestedDecision = await inspectCommandParts({ name: moduleArgs.module, args: moduleArgs.rest }, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (NODE_NAMES.has(name)) {
    const nodeBody = extractNodeBody(parts);
    if (nodeBody) {
      const nestedDecision = await inspectNodeJsBody(nodeBody, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
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
    const encoded = extractPowerShellEncodedBody(candidate);
    if (encoded) {
      const powerShellDecision = checkPowerShellBody(encoded, config, cwd, boundaryCwd);
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
    const heredocs = findBashHeredocs(tree.rootNode, command);
    const heredocsByOwner = new Map<number, BashHeredoc[]>();
    for (const heredoc of heredocs) {
      const owned = heredocsByOwner.get(heredoc.ownerStart) ?? [];
      owned.push(heredoc);
      heredocsByOwner.set(heredoc.ownerStart, owned);
    }
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
      for (const heredoc of heredocsByOwner.get(node.startIndex) ?? []) {
        if (!heredoc.quoted && HEREDOC_EXPANSION_CHARS.test(heredoc.body)) continue;
        if (!parts || depth >= 3) continue;
        const heredocDecision = await inspectHeredocBody(heredoc.body, parts, config, currentCwd, depth, boundaryCwd);
        if (heredocDecision) return heredocDecision;
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
