import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FilterConfig, RuleConfig } from "./types.ts";

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

export function loadConfig(): FilterConfig | null {
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
