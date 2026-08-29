import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
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
  if (matchesPathGlob(config.write.allow, candidates)) return undefined;
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
