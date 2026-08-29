import type { BashNode, BashRedirect, CommandParts, FilterConfig, PathRole } from "./types.ts";
import { findCommandNodes } from "./parser.ts";
import { TOOL_SPECS } from "./tool-specs.ts";
import type { ToolSpec, TargetSelector } from "./tool-specs.ts";
import {
  block,
  globToRegExp,
  isStaticPathValue,
  matchesCommandGlob,
  resolveExistingPath,
} from "./path-policy.ts";

function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, "").replace(/\s+/g, " ").trim();
}

export function commandValues(command: string): string[] {
  const trimmed = command.trim();
  const normalized = normalizeCommand(command);
  return normalized === trimmed ? [normalized] : [trimmed, normalized];
}

export function simpleCommandCandidates(command: string): string[] {
  const values = new Set<string>();
  for (const value of [command, ...command.split(/&&|\|\||[;|\n]/)]) {
    const candidate = value.trim().replace(/^[\s$()]+/, "");
    if (candidate) { values.add(candidate); values.add(normalizeCommand(candidate)); }
  }
  return [...values];
}

const SHELL_ARGUMENT_NODE_TYPES = new Set(["word", "raw_string", "string", "concatenation", "number"]);

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

export function commandParts(node: BashNode): CommandParts | undefined {
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

export function commandBasename(command: string): string {
  const normalized = command.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function shellPathArguments(args: readonly string[], commandName: string): string[] {
  return args.filter((value) => isStaticPathValue(value) && !value.startsWith("-") && (commandName !== "chmod" || !value.startsWith("+")));
}

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

export function simpleBashRedirectRoles(command: string): Array<readonly [string, PathRole]> {
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

export function findBashRedirects(root: BashNode): BashRedirect[] {
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

// 仕様テーブル（tool-specs.ts）に従って、コマンドの代表的な使い方の読み書き先を決める。
// 仕様に一致しなければ既存の bashPathRoles（cp / mv / find / cd / cat / rm / mkdir / touch /
// chmod / chown）へフォールバックする。仕様は「どこに書くか」の解釈だけを提供し、
// 方針（allow / deny / outsideDefault）は path-policy が所有する。
function matchToolSpec(parts: CommandParts): { spec: ToolSpec; positionals: string[]; forwarded: string[] | undefined } | undefined {
  const name = commandBasename(parts.name).replace(/\.exe$/i, "");
  for (const spec of TOOL_SPECS) {
    if (spec.command[0] !== name) continue;
    const tokens = spec.command.slice(1);
    const valueSet = new Set(spec.valueOptions ?? []);
    const flagSet = new Set(spec.flags ?? []);
    const positionals: string[] = [];
    let forwarded: string[] | undefined;
    const seenFlags = new Set<string>();
    let matchedIndex = 0;
    let mismatched = false;
    for (let index = 0; index < parts.args.length; index += 1) {
      const arg = parts.args[index];
      if (arg === "--") {
        // "--" 以降は転送 tail として保持し、位置引数には数えない。
        forwarded = parts.args.slice(index + 1);
        break;
      }
      if (arg.startsWith("-")) {
        if (flagSet.has(arg)) {
          seenFlags.add(arg);
          continue;
        }
        const key = arg.split("=", 1)[0];
        const isExactValue = valueSet.has(arg);
        const isAttachedValue = valueSet.has(key) && key.length === 2 && /^-[a-zA-Z]$/.test(key) && arg.length > key.length;
        // Exact "-o" は次の引数を値として消費する。attached（-o<dir>）や "=" 形は消費しない。
        if (isExactValue && !arg.includes("=")) index += 1;
        continue;
      }
      if (matchedIndex < tokens.length) {
        if (arg === tokens[matchedIndex]) {
          matchedIndex += 1;
          continue;
        }
        mismatched = true;
        break;
      }
      positionals.push(arg);
    }
    if (!mismatched && matchedIndex === tokens.length && [...flagSet].every((flag) => seenFlags.has(flag))) {
      return { spec, positionals, forwarded };
    }
  }
  return undefined;
}

function findOptionValue(args: readonly string[], option: string, attached = false): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) return args[index + 1];
    if (arg.startsWith(`${option}=`)) return arg.slice(option.length + 1);
    if (attached && option.length === 2 && /^-[a-zA-Z]$/.test(option) && arg.startsWith(option) && arg.length > option.length) return arg.slice(option.length);
    // クラスタ短縮中の値付きオプション（tar -cf 中の -f）。値は次の引数。
    if (!attached && option.length === 2 && /^-[a-zA-Z]$/.test(option)) {
      const ch = option.slice(1);
      if (/^-[a-zA-Z]+$/.test(arg) && !arg.startsWith("--") && arg.includes(ch) && arg !== option) return args[index + 1];
    }
  }
  return undefined;
}

// git -C <dir> は実行ディレクトリを変える。positional / option の相対パスは
// このディレクトリを基準に解決する必要がある（境界外 -C のバイパスを防ぐ）。
function gitWorkingDirectory(parts: CommandParts, cwd: string): string {
  let dir = cwd;
  for (let index = 0; index < parts.args.length; index += 1) {
    const arg = parts.args[index];
    let value: string | undefined;
    if (arg === "-C") value = parts.args[index + 1];
    else if (arg.startsWith("-C=")) value = arg.slice(3);
    else if (arg.startsWith("-C") && arg.length > 2) value = arg.slice(2); // -C<path>（添付形）
    if (value !== undefined && isStaticPathValue(value)) dir = resolveExistingPath(value, dir);
  }
  return dir;
}

function commandWorkingDirectory(parts: CommandParts, cwd: string): string {
  return commandBasename(parts.name).replace(/\.exe$/i, "") === "git" ? gitWorkingDirectory(parts, cwd) : cwd;
}

// フラグの存在を判定する（クラスタ短縮 -xf 中の -x も認識）。
// tar -xf / -cf / -tf、unzip -l / -t などのモード分岐に使う。
function hasAnyFlag(args: readonly string[], flags: readonly string[]): boolean {
  for (const flag of flags) {
    if (flag.startsWith("--")) {
      if (args.includes(flag)) return true;
    } else {
      const ch = flag.slice(1);
      for (const arg of args) {
        if (arg === flag) return true;
        if (ch.length === 1 && /^-[a-zA-Z]/.test(arg) && !arg.startsWith("--") && arg.includes(ch)) return true;
      }
    }
  }
  return false;
}

// セレクタを1つ解決して絶対パスを返す。未解決は undefined。
// セレクタを解決して絶対パスを返す。positional-range は複数パスを返す。
// option-by-mode は role（write / read）でモード条件を判定する。
function resolveSelectorPaths(selector: TargetSelector, parts: CommandParts, positionals: readonly string[], execCwd: string, role: "write" | "read"): string[] {
  if (selector.kind === "option-by-mode") {
    const modeFlags = role === "write" ? selector.writeWhen : selector.readWhen;
    if (!hasAnyFlag(parts.args, modeFlags)) return [];
    const value = findOptionValue(parts.args, selector.option);
    return value !== undefined && isStaticPathValue(value) ? [resolveExistingPath(value, execCwd)] : [];
  }
  if (!selectorApplies(selector, parts)) return [];
  if (selector.kind === "cwd") return [execCwd];
  if (selector.kind === "positional") {
    const value = positionals[selector.index];
    return value !== undefined && isStaticPathValue(value) ? [resolveExistingPath(value, execCwd)] : [];
  }
  if (selector.kind === "positional-range") {
    return positionals.slice(selector.start).filter((value) => isStaticPathValue(value)).map((value) => resolveExistingPath(value, execCwd));
  }
  if (selector.kind === "option") {
    const value = findOptionValue(parts.args, selector.option, selector.attached === true);
    return value !== undefined && isStaticPathValue(value) ? [resolveExistingPath(value, execCwd)] : [];
  }
  return [];
}

function selectorApplies(selector: TargetSelector, parts: CommandParts): boolean {
  if (selector.whenFlags && !hasAnyFlag(parts.args, selector.whenFlags)) return false;
  if (selector.whenNotFlags && hasAnyFlag(parts.args, selector.whenNotFlags)) return false;
  return true;
}

// 書き込み先を解決する。明示（positional / option / option-by-mode(write) / positional-range）が1件でもあればそれだけを使い、
// 無ければ cwd を既定の出力先とする（明示 dir と cwd を二重に判定しない）。
function resolveWriteTargets(spec: ToolSpec, parts: CommandParts, positionals: readonly string[], execCwd: string): string[] {
  const explicit: string[] = [];
  let cwdFallback = false;
  for (const selector of spec.writes ?? []) {
    const paths = resolveSelectorPaths(selector, parts, positionals, execCwd, "write");
    if (selector.kind === "cwd") {
      if (paths.length > 0) cwdFallback = true;
    } else if (paths.length > 0) {
      explicit.push(...paths);
    }
  }
  return explicit.length > 0 ? explicit : cwdFallback ? [execCwd] : [];
}

function resolveReadTargets(spec: ToolSpec, parts: CommandParts, positionals: readonly string[], execCwd: string): string[] {
  const results: string[] = [];
  for (const selector of spec.reads ?? []) {
    results.push(...resolveSelectorPaths(selector, parts, positionals, execCwd, "read"));
  }
  return results;
}

function buildForwardTarget(forward: NonNullable<ToolSpec["forward"]>, forwarded: readonly string[], positionals: readonly string[]): CommandParts {
  return { name: forward.target[0], args: [...forward.target.slice(1), ...forwarded, ...positionals] };
}

export function commandPathRoles(parts: CommandParts, cwd: string, depth = 0): Array<[string, PathRole]> {
  const matched = matchToolSpec(parts);
  if (matched) {
    const execCwd = commandWorkingDirectory(parts, cwd);
    const reads = resolveReadTargets(matched.spec, parts, matched.positionals, execCwd);
    const writes = resolveWriteTargets(matched.spec, parts, matched.positionals, execCwd);
    let roles: Array<[string, PathRole]> = [
      ...reads.map((value) => [value, "read"] as [string, PathRole]),
      ...writes.map((value) => [value, "write"] as [string, PathRole]),
    ];
    // "--" を別コマンドへ転送する仕様（gh repo clone）は、転送先（git clone）で再解釈して
    // 追加の write / read（--separate-git-dir 等）を拾う。深さを制限して循環を防ぐ。
    if (matched.spec.forward && matched.forwarded && depth < 3) {
      const target = buildForwardTarget(matched.spec.forward, matched.forwarded, matched.positionals);
      roles = [...roles, ...commandPathRoles(target, cwd, depth + 1)];
    }
    return roles;
  }
  // 既存の generic（cp / mv / find / cd / cat / rm / mkdir / touch / chmod / chown）へフォールバック。
  return bashPathRoles(parts) as Array<[string, PathRole]>;
}

const BASH_PATH_COMMANDS = new Map<string, PathRole>([["cd", "read"], ["cat", "read"], ["rm", "write"], ["mkdir", "write"], ["touch", "write"], ["chmod", "write"], ["chown", "write"]]);
export function bashPathRoles(parts: CommandParts): Array<readonly [string, PathRole]> {
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

export function checkBashValues(values: readonly string[], config: FilterConfig) {
  if (matchesCommandGlob(config.bash.allow, values)) return undefined;
  const pattern = matchingCommandPattern(config.bash.deny, values);
  return pattern
    ? block(`bash 拒否 Glob「${pattern}」に一致したため拒否。拒否は認可判断であり、同じ副作用を持つ代替経路（別コマンド、スクリプト、言語処理系、API、間接経路）も実行してはならない。`)
    : undefined;
}


export const BASH_WRAPPER_NAMES = new Set(["sudo", "env", "command", "time", "nohup", "timeout", "nice", "ionice", "exec", "builtin", "doas", "setsid", "stdbuf", "watch", "flock", "parallel", "rust-parallel", "rush"]);
export const BASH_SHELL_NAMES = new Set(["bash", "sh", "dash", "zsh", "ksh"]);
export const HEREDOC_EXPANSION_CHARS = /[$`\\]/;
export const BASH_EXEC_FLAGS = new Set(["-exec", "-execdir"]);

function optionTakesValue(commandName: string, option: string): boolean {
  const key = option.toLowerCase().split("=", 1)[0];
  if (commandName === "env") return new Set(["-u", "--unset", "-c", "--chdir"]).has(key);
  if (commandName === "timeout") return new Set(["-s", "--signal", "-k", "--kill-after"]).has(key);
  return new Set(["-u", "--user", "-g", "--group", "-c", "--chdir", "-d", "--directory", "-n", "--adjustment", "-s", "--signal"]).has(key);
}
export function wrappedCommandArgs(name: string, args: readonly string[]): string[] {
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
export function xargsCommandArgs(args: readonly string[]): string[] {
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

export function extractShellBody(parts: CommandParts): string | undefined {
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
export function findNestedCommands(parts: CommandParts): CommandParts[] {
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

export function bashWorkingDirectory(parts: CommandParts, cwd: string): string {
  if (commandBasename(parts.name) !== "cd") return cwd;
  const pathValue = shellPathArguments(parts.args, "cd")[0];
  return pathValue && isStaticPathValue(pathValue) ? resolveExistingPath(pathValue, cwd) : cwd;
}

// env の -c / -C / --chdir は子プロセスの実行 cwd を置き換える（シェルの cwd は変えない）。
// ラッパー展開で内側コマンドを検査するときに、この値を実行 cwd として渡す。
// 値が非静的なら追跡しない（cd 追跡と同じ扱い）。
export function envWorkingDirectory(parts: CommandParts, cwd: string): string {
  if (commandBasename(parts.name) !== "env") return cwd;
  const args = parts.args;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const key = value.toLowerCase();
    let dir: string | undefined;
    if (key === "-c" || key === "--chdir") {
      dir = args[index + 1];
    } else if (value.startsWith("--chdir=")) {
      dir = value.slice("--chdir=".length);
    }
    if (dir !== undefined) return isStaticPathValue(dir) ? resolveExistingPath(dir, cwd) : cwd;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue; // 環境変数代入はスキップ
    if (value.startsWith("-")) continue;
    break; // 最初の非オプション（コマンド本体）で停止
  }
  return cwd;
}
