import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
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
  readonly isMissing?: boolean;
  child(index: number): BashNode | null;
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

function pathCandidates(pathValue: string, cwd: string): string[] {
  const absolute = resolve(cwd, expandInputHome(pathValue));
  const normalizedAbsolute = normalizePath(absolute);
  const candidates = new Set([normalizedAbsolute, normalizePath(pathValue)]);
  const home = normalizePath(homedir());
  if (normalizedAbsolute === home || normalizedAbsolute.startsWith(`${home}/`)) {
    candidates.add(`~${normalizedAbsolute.slice(home.length)}`);
  }
  const cwdRelative = normalizePath(relative(cwd, absolute));
  if (cwdRelative && cwdRelative !== "." && !cwdRelative.startsWith("../") && !isAbsolute(cwdRelative)) {
    candidates.add(cwdRelative);
  }
  return [...candidates];
}

function globToRegExp(pattern: string, commandMode = false): RegExp {
  const normalized = commandMode ? pattern : expandHome(pattern);
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let source = normalized
    .split("*")
    .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
    .join(".*");
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

function isInsideDirectory(pathValue: string, cwd: string): boolean {
  const absolute = resolve(cwd, expandInputHome(pathValue));
  const cwdRelative = relative(cwd, absolute);
  return cwdRelative === "" ||
    (!cwdRelative.startsWith("..") && !isAbsolute(cwdRelative));
}

function readPathDecision(pathValue: string, cwd: string, config: FilterConfig) {
  return pathDecision(pathValue, cwd, config.read);
}

function writePathDecision(pathValue: string, cwd: string, config: FilterConfig) {
  if (isInsideDirectory(pathValue, cwd)) return undefined;
  const candidates = pathCandidates(pathValue, cwd);
  if (matchesPathGlob(config.write.allow, candidates)) return undefined;
  if (matchesPathGlob(config.write.deny, candidates)) {
    return block("外部書き込みの拒否 Glob に一致したため拒否");
  }
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
    if (candidate) {
      values.add(candidate);
      values.add(normalizeCommand(candidate));
    }
  }
  return [...values];
}

function extractPowerShellBody(command: string): string | undefined {
  const match = command.match(
    /(?:^|[;&|]\s*)["']?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^\s;&|]+))*\s+-(?:c|command)\s+([\s\S]+)$/i,
  );
  if (!match) return undefined;
  const body = match[1].trim();
  if (body.length >= 2 && ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'")))) {
    return body.slice(1, -1);
  }
  return body;
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

function checkBashValues(values: readonly string[], config: FilterConfig) {
  if (matchesCommandGlob(config.bash.allow, values)) return undefined;
  return matchesCommandGlob(config.bash.deny, values)
    ? block("設定ファイルの bash 拒否 Glob に一致したため拒否")
    : undefined;
}

function resolvePermissionPackageJson(): string | undefined {
  const extensionRequire = createRequire(import.meta.url);
  const packageJsonPaths: string[] = [];
  try {
    const packageEntry = extensionRequire.resolve("@gotgenes/pi-permission-system");
    packageJsonPaths.push(
      join(dirname(packageEntry), "package.json"),
      join(dirname(dirname(packageEntry)), "package.json"),
    );
  } catch {
    // Pi の npm 管理領域を下位互換の探索先として試す。
  }
  packageJsonPaths.push(
    join(
      homedir(),
      ".pi",
      "agent",
      "npm",
      "node_modules",
      "@gotgenes",
      "pi-permission-system",
      "package.json",
    ),
  );
  return packageJsonPaths.find((path) => existsSync(path));
}

async function loadBashParser(): Promise<BashParser | null> {
  try {
    const packageJson = resolvePermissionPackageJson();
    if (!packageJson) return null;
    const packageRequire = createRequire(pathToFileURL(packageJson));
    const webPath = packageRequire.resolve("web-tree-sitter");
    const webWasm = packageRequire.resolve("web-tree-sitter/web-tree-sitter.wasm");
    const bashWasm = packageRequire.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
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

function runPowerShellParser(body: string): string[] | null {
  const parserCommand = "$inputText = [Console]::In.ReadToEnd(); $tokens = $null; $errors = $null; $ast = [System.Management.Automation.Language.Parser]::ParseInput($inputText, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { exit 2 }; @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.Extent.Text }) | ConvertTo-Json -Compress";
  for (const executable of ["pwsh", "pwsh.exe", "powershell", "powershell.exe"]) {
    const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", parserCommand], {
      input: body,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 3000,
      windowsHide: true,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") continue;
    if (result.error || result.status !== 0) return null;
    try {
      const parsed: unknown = JSON.parse(result.stdout.trim() || "[]");
      if (typeof parsed === "string") return [parsed];
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      return null;
    }
  }
  return null;
}

function checkPowerShellBody(body: string, config: FilterConfig) {
  const parsed = runPowerShellParser(body);
  const values = parsed
    ? parsed.flatMap(commandValues)
    : simpleCommandCandidates(body).flatMap(commandValues);
  return checkBashValues(values, config);
}

async function inspectBashWithoutParser(command: string, config: FilterConfig) {
  for (const candidate of simpleCommandCandidates(command)) {
    const directDecision = checkBashValues(commandValues(candidate), config);
    if (directDecision) return directDecision;
    const body = extractPowerShellBody(candidate);
    if (body) {
      const powerShellDecision = checkPowerShellBody(body, config);
      if (powerShellDecision) return powerShellDecision;
    }
  }
  return undefined;
}

async function inspectBash(command: string, config: FilterConfig) {
  const parser = await getBashParser();
  if (!parser) return inspectBashWithoutParser(command, config);
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(command);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return inspectBashWithoutParser(command, config);
    for (const node of findCommandNodes(tree.rootNode)) {
      const directDecision = checkBashValues(commandValues(node.text), config);
      if (directDecision) return directDecision;
      const body = extractPowerShellBody(node.text);
      if (body) {
        const powerShellDecision = checkPowerShellBody(body, config);
        if (powerShellDecision) return powerShellDecision;
      }
    }
    return undefined;
  } catch {
    return inspectBashWithoutParser(command, config);
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
    if (isToolCallEventType("bash", event)) return inspectBash(event.input.command, config);
    return inspectPathTool(event, ctx.cwd, config);
  });
}
