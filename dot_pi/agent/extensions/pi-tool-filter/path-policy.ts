import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { FilterConfig, PathRole, RuleConfig } from "./types.ts";

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

// Bash のパスを、このプロセスのパスへ変換する。
// Git Bash は `/tmp` を利用者の一時フォルダへマウントするため、Node.js の resolve が返す `C:\tmp` とは違う場所を指す。
// Bash の `/tmp` は TEMP（os.tmpdir()）として判定する。TEMP を既定以外にして起動した環境では、
// Git Bash の `/tmp` の実際の行き先と食い違うことがある。
// Python、Node.js、PowerShell の本文が開く `/tmp` は `C:\tmp` を指すため、Bash のパス（引数、リダイレクト、cd の移動先）にだけ使う。
export function gitBashTmpPath(pathValue: string): string {
  if (process.platform === "win32" && (pathValue === "/tmp" || pathValue.startsWith("/tmp/"))) {
    return `${normalizePath(tmpdir())}${pathValue.slice("/tmp".length)}`;
  }
  return pathValue;
}

export function gitBashTmpPathRoles(paths: readonly (readonly [string, PathRole])[]): Array<readonly [string, PathRole]> {
  return paths.map(([value, role]) => [gitBashTmpPath(value), role] as const);
}

// Bash のパスを cwd 基準で解決する（`/tmp` は Git Bash の TEMP として扱う）。
export function resolveShellPath(pathValue: string, cwd: string): string {
  return resolveExistingPath(gitBashTmpPath(pathValue), cwd);
}

export function resolveExistingPath(pathValue: string, cwd: string): string {
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

export function globToRegExp(pattern: string, commandMode = false): RegExp {
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

// 書き込みの allow 判定では、各候補 X を X/ としても照合する。
// これにより X/** の形の許可ルートは、配下だけでなく X 自身の作成と削除も許可する。
// 読み取りの allow と、すべての deny には適用しない。
function matchesWriteAllowGlob(patterns: readonly string[], candidates: readonly string[]): boolean {
  return matchesPathGlob(patterns, candidates.flatMap((candidate) => candidate.endsWith("/") ? [candidate] : [candidate, `${candidate}/`]));
}

export function matchesCommandGlob(patterns: readonly string[], values: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern, true);
    return values.some((value) => matcher.test(value));
  });
}

export function block(reason: string): ToolCallEventResult {
  return { block: true, reason };
}

// 既知の危険モード（tar -P / 7z -spf / unzip -:）で、書き込み先を静的に閉じられないことを表す値。
// pathRoleDecisions はこの値を write として見ると、危険モードとして拒否する。
export const UNBOUNDED_WRITE = "<unbounded-write>";

function isUnboundedWrite(pathValue: string): boolean {
  return pathValue === UNBOUNDED_WRITE;
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

export function readPathDecision(pathValue: string, cwd: string, config: FilterConfig) {
  return pathDecision(pathValue, cwd, config.read);
}

export function writePathDecision(pathValue: string, cwd: string, config: FilterConfig, boundaryCwd = cwd) {
  const candidates = pathCandidates(pathValue, cwd);
  if (matchesPathGlob(config.write.deny, candidates)) {
    return block("書き込みの拒否 Glob に一致したため拒否");
  }
  if (matchesWriteAllowGlob(config.write.allow, candidates)) return undefined;
  if (isInsideDirectory(pathValue, cwd, boundaryCwd)) return undefined;
  return config.outsideDefault === "allow"
    ? undefined
    : block("外部書き込みの未一致時既定値が deny のため拒否");
}

export function isStaticPathValue(value: string): boolean {
  return value.length > 0 &&
    !value.includes("$") &&
    !value.includes("`") &&
    !value.includes("{}");
}

export function pathRoleDecisions(
  paths: readonly (readonly [string, PathRole])[],
  cwd: string,
  config: FilterConfig,
  boundaryCwd = cwd,
): ToolCallEventResult | undefined {
  // ssh のリモートコマンドの検査では、パスはこのマシンのファイルではないため判定しない。
  if (config.skipPathDecisions) return undefined;
  for (const [value, role] of paths) {
    if (role === "write" && isUnboundedWrite(value)) {
      return block("書き込み先を静的に閉じられないモード（tar -P / 7z -spf / unzip -: 等）のため拒否");
    }
    if (!isStaticPathValue(value)) continue;
    const decision = role === "read"
      ? readPathDecision(value, cwd, config)
      : writePathDecision(value, cwd, config, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}
