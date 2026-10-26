import type { BashNode, BashRedirect, CommandParts, FilterConfig, PathRole } from "./types.ts";
import { findCommandNodes } from "./parser.ts";
import { TOOL_SPECS } from "./tool-specs.ts";
import type { ToolSpec, TargetSelector } from "./tool-specs.ts";
import {
  block,
  globToRegExp,
  isStaticPathValue,
  matchesCommandGlob,
  resolveShellPath,
  UNBOUNDED_WRITE,
} from "./path-policy.ts";

function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, "").replace(/\s+/g, " ").trim();
}

export function commandValues(command: string): string[] {
  const trimmed = command.trim();
  const normalized = normalizeCommand(command);
  return normalized === trimmed ? [normalized] : [trimmed, normalized];
}

// コマンド Glob のリテラル空白は引数の区切りを表す。
// 引用符やエスケープで一つの引数に含まれる空白は、照合の前に制御文字 U+0001 へ置き換え、区切りとして一致させない。
const QUOTED_WHITESPACE = "\u0001";

// 引用符内の空白とエスケープされた空白を QUOTED_WHITESPACE へ置き換える。照合値と Glob の両方へ同じ規則で適用する。
// 引用符の外のエスケープ改行は行継続なので置き換えない。
export function maskQuotedWhitespace(text: string): string {
  let result = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote !== "'" && char === "\\" && next !== undefined) {
      const escapedWhitespace = quote === '"' ? /\s/.test(next) : next === " " || next === "\t";
      result += char + (escapedWhitespace ? QUOTED_WHITESPACE : next);
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      result += /\s/.test(char) ? QUOTED_WHITESPACE : char;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    result += char;
  }
  return result;
}

// コマンド節点の原文から、引用符内の空白を置き換えた照合値を作る。
export function maskedCommandValues(command: string): string[] {
  return commandValues(command).map(maskQuotedWhitespace);
}

// 解析済みの引数列から照合値を作る。各引数の内部の空白は区切りとして扱わない。
export function argvCommandValues(parts: CommandParts): string[] {
  return [[parts.name, ...parts.args].map((value) => value.replace(/\s/g, QUOTED_WHITESPACE)).join(" ")];
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

const SHELL_EXPANSION_NODE_TYPES = new Set(["simple_expansion", "expansion", "command_substitution"]);

export function commandParts(node: BashNode): CommandParts | undefined {
  const tokens: string[] = [];
  // 引用符のない変数展開とコマンド置換だけでできた語も含めた語の並び（argsWithExpansions）。
  // 間に空白のない隣り合う節点（`$O/$f.jpg` など）は一つの語にまとめる。
  const words: Array<{ text: string; end: number }> = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "variable_assignment") continue;
    const argument = child.type === "command_name" || SHELL_ARGUMENT_NODE_TYPES.has(child.type);
    if (argument) {
      const token = shellTokenText(child.text);
      if (token !== undefined) tokens.push(token); // 空文字列（''）も引数の値として保持する
    }
    if (!argument && !SHELL_EXPANSION_NODE_TYPES.has(child.type)) continue;
    const text = argument ? shellTokenText(child.text) : child.text;
    const previous = words.at(-1);
    if (previous && previous.end === child.startIndex) {
      previous.text += text;
      previous.end = child.endIndex;
    } else {
      words.push({ text, end: child.endIndex });
    }
  }
  if (tokens.length === 0) return undefined;
  // 最初の語は command_name（コマンド名）である。
  return { name: tokens[0], args: tokens.slice(1), argsWithExpansions: words.slice(1).map((word) => word.text) };
}

export function commandBasename(command: string): string {
  const normalized = command.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

// パスのオペランド。- で始まる語はオプションとして除く。-- の後の語は、- で始まってもオペランドとして扱う。
// chmod の - や + で始まる語はモード（-w、+x）なので、-- の後でも除く。
function shellPathArguments(args: readonly string[], commandName: string): string[] {
  const operands: string[] = [];
  let options = true;
  for (const value of args) {
    if (options && value === "--") {
      options = false;
      continue;
    }
    if (!isStaticPathValue(value)) continue;
    const mode = commandName === "chmod" && (value.startsWith("-") || value.startsWith("+"));
    if (mode || (options && value.startsWith("-"))) continue;
    operands.push(value);
  }
  return operands;
}

function redirectOperator(text: string): string | undefined {
  return text.match(/^\d*(?:<<<|<<|<&|>&|&>>|&>|<>|>>|>\||>|<)/)?.[0]?.replace(/^\d+/, "");
}

// >& の後の語が数字（ファイル記述子。後ろに - が付く移動の形を含む）や - でなく、>& の前にファイル記述子がないとき、
// bash は標準出力と標準エラーをその名前のファイルへ書き込む（&> と同じ）。
function duplicationWritesFile(descriptorGiven: boolean, destination: string): boolean {
  return !descriptorGiven && !/^(?:\d+-?|-)$/.test(destination);
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
    let roles = redirectRoles(operator);
    let targetStart = index + operator.length;
    while (/\s/.test(command[targetStart] ?? "")) targetStart += 1;
    if (operator === ">&" && command[targetStart] !== "(") {
      // >& の直前に、語の始まりから続く数字があれば、それがファイル記述子である。
      let digitsStart = index;
      while (digitsStart > 0 && /\d/.test(command[digitsStart - 1])) digitsStart -= 1;
      const descriptorGiven = digitsStart < index && (digitsStart === 0 || /[\s;&|()]/.test(command[digitsStart - 1]));
      const target = shellTokenText(command.slice(targetStart, redirectWordEnd(command, targetStart)));
      if (duplicationWritesFile(descriptorGiven, target)) roles = ["write"];
    }
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
      const operator = redirectOperator(node.text);
      const value = redirectDestination(node);
      // file_redirect の字句は、ファイル記述子があればその数字から始まる。
      const roles: PathRole[] = operator === ">&" && value !== undefined && duplicationWritesFile(/^\d/.test(node.text), value)
        ? ["write"]
        : redirectRoles(operator);
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
    if (value !== undefined && isStaticPathValue(value)) dir = resolveShellPath(value, dir);
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

// tar の伝統形モード（第一の非オプション位置引数が英字クラスタ: xf / xvf / cf / tf）。
// 値付きオプション（-C <dir> 等）はその値も位置引数として数えないようスキップする。
function tarTraditionalMode(parts: CommandParts, valueOptions: readonly string[] | undefined): string {
  const valueSet = new Set(valueOptions ?? []);
  for (let index = 0; index < parts.args.length; index += 1) {
    const arg = parts.args[index];
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      const key = arg.split("=", 1)[0];
      const isExactValue = valueSet.has(arg);
      const isAttachedValue = valueSet.has(key) && key.length === 2 && /^-[a-zA-Z]$/.test(key) && arg.length > key.length;
      if (isExactValue && !arg.includes("=")) index += 1;
      continue;
    }
    if (/^[a-zA-Z]+$/.test(arg)) return arg.toLowerCase();
    return "";
  }
  return "";
}

// モードフラグ判定。tar は伝統形（`tar xf` 等）の英字クラスタも mode として認識する。
function hasModeFlag(parts: CommandParts, spec: ToolSpec, flags: readonly string[]): boolean {
  if (hasAnyFlag(parts.args, flags)) return true;
  if (spec.command[0] === "tar") {
    const mode = tarTraditionalMode(parts, spec.valueOptions);
    for (const flag of flags) {
      if (/^-[a-zA-Z]$/.test(flag) && mode.includes(flag[1])) return true;
    }
  }
  return false;
}

// セレクタを解決して絶対パスを返す。positional-range は複数パスを返す。
// option-by-mode は role（write / read）でモード条件を判定する。
// Bash のコマンドの引数なので、`/tmp` は Git Bash の TEMP として解決する。
function resolveSelectorPaths(selector: TargetSelector, parts: CommandParts, positionals: readonly string[], execCwd: string, role: "write" | "read", spec?: ToolSpec): string[] {
  if (selector.kind === "option-by-mode") {
    const modeFlags = role === "write" ? selector.writeWhen : selector.readWhen;
    if (!(spec ? hasModeFlag(parts, spec, modeFlags) : hasAnyFlag(parts.args, modeFlags))) return [];
    const value = findOptionValue(parts.args, selector.option);
    return value !== undefined && isStaticPathValue(value) ? [resolveShellPath(value, execCwd)] : [];
  }
  if (!(spec ? selectorApplies(selector, parts, spec) : selectorApplies(selector, parts))) return [];
  if (selector.kind === "cwd") return [execCwd];
  if (selector.kind === "positional") {
    const value = positionals[selector.index];
    return value !== undefined && isStaticPathValue(value) ? [resolveShellPath(value, execCwd)] : [];
  }
  if (selector.kind === "positional-range") {
    return positionals.slice(selector.start).filter((value) => isStaticPathValue(value)).map((value) => resolveShellPath(value, execCwd));
  }
  if (selector.kind === "option") {
    const value = findOptionValue(parts.args, selector.option, selector.attached === true);
    return value !== undefined && isStaticPathValue(value) ? [resolveShellPath(value, execCwd)] : [];
  }
  return [];
}

function selectorApplies(selector: TargetSelector, parts: CommandParts, spec?: ToolSpec): boolean {
  if (selector.whenFlags) {
    const all = spec ? hasModeFlag(parts, spec, selector.whenFlags) : hasAnyFlag(parts.args, selector.whenFlags);
    if (!all) return false;
  }
  if (selector.whenNotFlags) {
    const any = spec ? hasModeFlag(parts, spec, selector.whenNotFlags) : hasAnyFlag(parts.args, selector.whenNotFlags);
    if (any) return false;
  }
  return true;
}

// 書き込み先を解決する。明示（positional / option / option-by-mode(write) / positional-range）が1件でもあればそれだけを使い、
// 無ければ cwd を既定の出力先とする（明示 dir と cwd を二重に判定しない）。
function resolveWriteTargets(spec: ToolSpec, parts: CommandParts, positionals: readonly string[], execCwd: string): string[] {
  const explicit: string[] = [];
  let cwdFallback = false;
  for (const selector of spec.writes ?? []) {
    const paths = resolveSelectorPaths(selector, parts, positionals, execCwd, "write", spec);
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
    results.push(...resolveSelectorPaths(selector, parts, positionals, execCwd, "read", spec));
  }
  return results;
}

function buildForwardTarget(forward: NonNullable<ToolSpec["forward"]>, forwarded: readonly string[], positionals: readonly string[]): CommandParts {
  return { name: forward.target[0], args: [...forward.target.slice(1), ...forwarded, ...positionals] };
}

export function commandPathRoles(parts: CommandParts, cwd: string, depth = 0): Array<[string, PathRole]> {
  const matched = matchToolSpec(parts);
  if (matched) {
    const spec = matched.spec;
    // 既知の危険モード（tar -P / 7z -spf / unzip -:）は書き込み先を静的に閉じられない。
    if (spec.unbounded && hasAnyFlag(parts.args, spec.unbounded.flags)) {
      return [[UNBOUNDED_WRITE, "write"]];
    }
    const execCwd = commandWorkingDirectory(parts, cwd);
    const reads = resolveReadTargets(spec, parts, matched.positionals, execCwd);
    const writes = resolveWriteTargets(spec, parts, matched.positionals, execCwd);
    let roles: Array<[string, PathRole]> = [
      ...reads.map((value) => [value, "read"] as [string, PathRole]),
      ...writes.map((value) => [value, "write"] as [string, PathRole]),
    ];
    // 追加の書き込み先（destination とは独立）。--separate-git-dir は working tree 出力とは別に metadata を書く。
    for (const selector of spec.extraWrites ?? []) {
      for (const value of resolveSelectorPaths(selector, parts, matched.positionals, execCwd, "write", spec)) {
        roles.push([value, "write"] as [string, PathRole]);
      }
    }
    // "--" を別コマンドへ転送する仕様（gh repo clone）は、転送先（git clone）で再解釈して
    // 追加の write / read（--separate-git-dir 等）を拾う。深さを制限して循環を防ぐ。
    if (spec.forward && matched.forwarded && depth < 3) {
      const target = buildForwardTarget(spec.forward, matched.forwarded, matched.positionals);
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
  if (name === "cp") return cpPathRoles(parts.argsWithExpansions ?? parts.args);
  const values = shellPathArguments(parts.args, name);
  if (name === "mv") return values.map((value) => [value, "write"] as const);
  const role = BASH_PATH_COMMANDS.get(name);
  return role ? values.map((value) => [value, role] as const) : [];
}

// cp の宛先は -t / --target-directory の値、なければ最後のオペランドである。
// 宛先の位置は、引用符のない変数展開も含めた引数列で決める（変数の語を除いてから数えると、最後のコピー元を宛先と取り違える）。
// ラッパーなどの内側の cp で、その引数列が渡されないとき（nestedCommandParts を参照）は args で決める。
// 値の分からない宛先とコピー元は、ほかのパスと同じく判定しない。
function cpPathRoles(words: readonly string[]): Array<readonly [string, PathRole]> {
  let target: string | undefined;
  const operands: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    if (value === "--") {
      operands.push(...words.slice(index + 1));
      break;
    }
    if (value === "--target-directory") {
      target = words[index + 1];
      index += 1;
      continue;
    }
    if (value.startsWith("--target-directory=")) {
      target = value.slice("--target-directory=".length);
      continue;
    }
    if (value.startsWith("-") && value !== "-") {
      // 短いオプションは -rt DIR、-tDIR、-Sbak のようにまとめて書けるため、1 文字ずつ読む。
      // -S の後ろの文字は接尾辞なので、その中の t を -t と読まない（-S の値は変更前と同じく別の語ならオペランドとして扱う）。
      for (let at = 1; !value.startsWith("--") && at < value.length; at += 1) {
        if (value[at] === "S") break;
        if (value[at] !== "t") continue;
        const attached = value.slice(at + 1);
        if (attached !== "") {
          target = attached;
        } else {
          target = words[index + 1];
          index += 1;
        }
        break;
      }
      continue;
    }
    operands.push(value);
  }
  const sources = target === undefined ? operands.slice(0, -1) : operands;
  const destination = target ?? operands.at(-1);
  const roles: Array<readonly [string, PathRole]> = sources.filter(isStaticPathValue).map((value) => [value, "read"] as const);
  if (destination !== undefined && isStaticPathValue(destination)) roles.push([destination, "write"]);
  return roles;
}

function matchingCommandPattern(patterns: readonly string[], values: readonly string[]): string | undefined {
  return patterns.find((pattern) => {
    const matcher = globToRegExp(pattern, true);
    return values.some((value) => matcher.test(value));
  });
}

// masked が true のとき、照合値は引用符内の空白を置き換えた値（maskedCommandValues、argvCommandValues）であり、
// Glob にも同じ置き換え（maskQuotedWhitespace）を適用して照合する。
export function checkBashValues(values: readonly string[], config: FilterConfig, masked = false) {
  const prepare = (pattern: string) => masked ? maskQuotedWhitespace(pattern) : pattern;
  if (matchesCommandGlob(config.bash.allow.map(prepare), values)) return undefined;
  const pattern = config.bash.deny.find((candidate) => matchingCommandPattern([prepare(candidate)], values) !== undefined);
  return pattern
    ? block(`bash 拒否 Glob「${pattern}」に一致したため拒否。拒否は認可判断であり、同じ副作用を持つ代替経路（別コマンド、スクリプト、言語処理系、API、間接経路）も実行してはならない。`)
    : undefined;
}


export const BASH_WRAPPER_NAMES = new Set(["sudo", "env", "command", "time", "nohup", "timeout", "nice", "ionice", "exec", "builtin", "doas", "setsid", "stdbuf", "watch", "flock", "parallel", "rust-parallel", "rush"]);
export const BASH_SHELL_NAMES = new Set(["bash", "sh", "dash", "zsh", "ksh"]);
export const HEREDOC_EXPANSION_CHARS = /[$`\\]/;
export const BASH_EXEC_FLAGS = new Set(["-exec", "-execdir"]);
export const SSH_NAMES = new Set(["ssh", "ssh.exe"]);
// OpenSSH の ssh(1) で値を取るオプション。
const SSH_VALUE_OPTIONS = new Set("BbcDEeFIiJLlmOoPpQRSWw");

// ssh の引数から、リモートで実行するコマンドを取り出す。
// オプションの後の最初の引数が宛先で、その後ろの引数を空白で連結した文字列がリモートのシェルへ渡る。
// 宛先の位置を正しく決めるため、引用符のない変数展開も含めた引数列を渡す。
export function sshRemoteCommand(args: readonly string[]): string | undefined {
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === "--") {
      index += 1;
      break;
    }
    if (!value.startsWith("-") || value === "-") break;
    // -tt や -p22 のような結合形。値を取るオプションが末尾にあれば、次の引数がその値。
    let consumed = 1;
    for (let at = 1; at < value.length; at += 1) {
      if (!SSH_VALUE_OPTIONS.has(value[at])) continue;
      if (at === value.length - 1) consumed = 2;
      break;
    }
    index += consumed;
  }
  const remote = args.slice(index + 1);
  return remote.length > 0 ? remote.join(" ") : undefined;
}

function optionTakesValue(commandName: string, option: string): boolean {
  const key = option.split("=", 1)[0];
  if (commandName === "env") return new Set(["-u", "--unset", "-C", "--chdir"]).has(key);
  const normalizedKey = key.toLowerCase();
  if (commandName === "timeout") return new Set(["-s", "--signal", "-k", "--kill-after"]).has(normalizedKey);
  return new Set(["-u", "--user", "-g", "--group", "-c", "--chdir", "-d", "--directory", "-n", "--adjustment", "-s", "--signal"]).has(normalizedKey);
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
// 入れ子のコマンド（ラッパー、xargs、find -exec の内側）の CommandParts。
// nestedArgs は外側の args から、nestedWords は外側の argsWithExpansions から、同じ規則で取り出した内側の語の並びである。
// 引用符のない変数展開があると、オプションの値として読み飛ばす語がずれうるため（sudo $X rm ... など）、
// 内側のコマンド名が一致するときだけ argsWithExpansions を渡す。一致しないときは変更前と同じく args だけを使う。
export function nestedCommandParts(nestedArgs: readonly string[], nestedWords: readonly string[] | undefined): CommandParts {
  const parts: CommandParts = { name: nestedArgs[0], args: nestedArgs.slice(1) };
  if (nestedWords !== undefined && nestedWords.length > 0 && nestedWords[0] === nestedArgs[0]) parts.argsWithExpansions = nestedWords.slice(1);
  return parts;
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

export type BashCwdState = { readonly cwd: string; readonly frozen: boolean };

// cd の後の実行 cwd。
// 移動先が静的でない cd（cd $D、cd "$D/x"、cd -、引数のない cd）は追跡せず、cwd を据え置く（frozen）。
// 据え置いた後の相対パスの cd は、据え置いた位置から解決すると実際の位置と食い違うため、同じく追跡しない。
// 静的な絶対パス（~ で始まるパスを含む）への cd は移動先が決まるため、追跡を再開する。
export function bashWorkingDirectory(parts: CommandParts, state: BashCwdState): BashCwdState {
  if (commandBasename(parts.name) !== "cd") return state;
  const words = parts.argsWithExpansions ?? parts.args;
  let operand: string | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    if (value === "--") {
      // -- の後の語は、- で始まっても移動先として扱う。
      operand = words[index + 1];
      break;
    }
    if (value === "-" || !value.startsWith("-")) {
      operand = value;
      break;
    }
  }
  if (operand === undefined || operand === "-" || !isStaticPathValue(operand)) return { cwd: state.cwd, frozen: true };
  const absolute = /^(?:[/\\~]|[A-Za-z]:)/.test(operand);
  if (state.frozen && !absolute) return state;
  return { cwd: resolveShellPath(operand, state.cwd), frozen: false };
}

// env の -C / --chdir は子プロセスの実行 cwd を置き換える（シェルの cwd は変えない）。
// ラッパー展開で内側コマンドを検査するときに、この値を実行 cwd として渡す。
// 値が非静的なら追跡しない。値を取るオプション（-u NAME など）は、その値も読み飛ばす。
export function envWorkingDirectory(parts: CommandParts, cwd: string): string {
  if (commandBasename(parts.name) !== "env") return cwd;
  const args = parts.args;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    let dir: string | undefined;
    if (value === "-C" || value === "--chdir") {
      dir = args[index + 1];
    } else if (value.startsWith("--chdir=")) {
      dir = value.slice("--chdir=".length);
    }
    if (dir !== undefined) return isStaticPathValue(dir) ? resolveShellPath(dir, cwd) : cwd;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue; // 環境変数代入はスキップ
    if (value.startsWith("-")) {
      if (optionTakesValue("env", value) && !value.includes("=")) index += 1;
      continue;
    }
    break; // 最初の非オプション（コマンド本体）で停止
  }
  return cwd;
}
