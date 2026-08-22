import assert from "node:assert/strict";
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const cwd = resolve(process.cwd());

export function gitBashPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const match = normalized.match(/^([A-Za-z]):(\/.*)?$/);
  assert.ok(match, `Windows絶対パスが必要: ${value}`);
  return `/${match[1].toLowerCase()}${match[2] ?? "/"}`;
}
export const extensionDir = join(homedir(), ".pi", "agent", "extensions", "pi-tool-filter");
export const extensionPath = join(extensionDir, "index.ts");
export const configPath = join(extensionDir, "config.jsonc");
export const packagePath = join(extensionDir, "package.json");
export const lockPath = join(extensionDir, "package-lock.json");
export const loaderPath = join(
  homedir(),
  "AppData",
  "Roaming",
  "npm",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);

export function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      result += char === "\n" ? "\n" : " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += char === "\n" ? "\n" : " ";
      }
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
    } else {
      result += char;
    }
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

export function readConfig(): any {
  return JSON.parse(stripJsonComments(readFileSync(configPath, "utf8")));
}

export async function handlerFor(config: any, extensionEntryPath = extensionPath): Promise<any> {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const loaded = await loadExtensions([extensionEntryPath], cwd);
  assert.deepEqual(loaded.errors, [], "Pi拡張の読み込みに失敗");
  assert.equal(loaded.extensions.length, 1, "Pi拡張が1件読み込まれる");
  const handlers = loaded.extensions[0].handlers.get("tool_call") ?? [];
  assert.equal(handlers.length, 1, "tool_callハンドラが1件登録される");
  return handlers[0];
}

export type FilterResult = { block?: boolean; ask?: boolean; reason?: string };
export async function call(handler: any, toolName: string, input: any): Promise<FilterResult | undefined> {
  return handler(
    { type: "tool_call", toolCallId: `${toolName}-v24`, toolName, input },
    { cwd },
  ) as Promise<FilterResult | undefined>;
}

export function allowed(result: FilterResult | undefined, label: string): void {
  assert.equal(result, undefined, `${label} は許可される`);
}

export function blocked(result: FilterResult | undefined, label: string): void {
  assert.equal(result?.block, true, `${label} は拒否される`);
  assert.equal(result?.ask, undefined, `${label} は ask を返さない`);
  assert.equal(typeof result?.reason, "string", `${label} は拒否理由を返す`);
}


export function productionSourceNames(): string[] {
  return readdirSync("dot_pi/agent/extensions/pi-tool-filter")
    .filter((name) => name.endsWith(".ts") && name !== "index.test.ts")
    .sort();
}

export function copyProductionSources(destination: string): void {
  for (const name of productionSourceNames()) {
    copyFileSync(join(extensionDir, name), join(destination, name));
  }
}
