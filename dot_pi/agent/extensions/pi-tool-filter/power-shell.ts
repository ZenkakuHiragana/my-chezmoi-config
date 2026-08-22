import { spawnSync } from "node:child_process";
import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { CommandParts, FilterConfig, PathRole, PowerShellCommand } from "./types.ts";
import {
  checkBashValues,
  commandValues,
  simpleCommandCandidates,
} from "./command.ts";
import { pathRoleDecisions, resolveExistingPath, isStaticPathValue } from "./path-policy.ts";

export const POWER_SHELL_NAMES = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractPowerShellBody(command: string): string | undefined {
  const match = command.match(/(?:^|[;&|]\s*)["']?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^\s;&|]+))*\s+-(?:c|command)\s+([\s\S]+)$/i);
  if (!match) return undefined;
  const body = match[1].trim();
  if (body.length >= 2 && ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'")))) return body.slice(1, -1);
  return body;
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

// pwsh の -WorkingDirectory オプション。起動時の実行 cwd を置き換えるため、
// 本文（-Command / -EncodedCommand / heredoc stdin）をこの値を起点に検査する。
// 値が非静的なら追跡しない。
export function powershellWorkingDirectoryOption(parts: CommandParts): string | undefined {
  const args = parts.args;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (/^-+workingdirectory$/i.test(value)) {
      const dir = args[index + 1];
      return dir !== undefined && isStaticPathValue(dir) ? dir : undefined;
    }
    const equals = value.match(/^-+workingdirectory=(.+)$/i);
    if (equals) return isStaticPathValue(equals[1]) ? equals[1] : undefined;
  }
  return undefined;
}

// pwsh の -Command / -EncodedCommand 本文を、-WorkingDirectory を反映した cwd で検査する。
export function inspectPowerShellCommandText(commandText: string, parts: CommandParts, config: FilterConfig, cwd: string, boundaryCwd: string): ToolCallEventResult | undefined {
  const psWorkingDirectory = powershellWorkingDirectoryOption(parts);
  const psCwd = psWorkingDirectory ? resolveExistingPath(psWorkingDirectory, cwd) : cwd;
  const body = extractPowerShellBody(commandText);
  if (body) return checkPowerShellBody(body, config, psCwd, boundaryCwd);
  const encoded = extractPowerShellEncodedBody(commandText);
  if (encoded) return checkPowerShellBody(encoded, config, psCwd, boundaryCwd);
  return undefined;
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

export function extractPowerShellEncodedBody(command: string): string | undefined {
  const match = command.match(/(?:^|[;&|]\s*)["']?(?:powershell|pwsh)(?:\.exe)?["']?(?:\s+(?:"(?:\\.|[^"])*"|'(?:''|[^'])*'|[^\s;&|]+))*\s+-(?:EncodedCommand|enc)\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1], "base64");
  const utf16 = bytes.toString("utf16le");
  if (utf16 && !containsLoneSurrogate(utf16) && Buffer.from(utf16, "utf16le").equals(bytes)) return utf16;
  const utf8 = bytes.toString("utf8");
  if (utf8 && Buffer.from(utf8, "utf8").equals(bytes)) return utf8;
  return undefined;
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

export function checkPowerShellBody(body: string, config: FilterConfig, cwd: string, boundaryCwd = cwd) {
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
