#!/usr/bin/env node
/**
 * npm's postinstall: put radio.default.json at pie-boy/radio.json in Pi's agent
 * directory when no file is there, so that RADIO starts with its stations. An
 * existing file is never touched. The place must be the one features/radio.ts reads
 * (stationsFile); change both together.
 *
 * npm runs this without Pi, so Pi's getAgentDir cannot be loaded. agentDir() follows
 * it: PI_CODING_AGENT_DIR through a copy of Pi's normalizePath, else ~/.pi/agent. A
 * value that does not come out as a full absolute path (a relative path, `C:foo`,
 * `\foo`, `///x`) may name another place for npm than for Pi, whose working
 * directories differ, so nothing is written then.
 *
 * Nothing here fails the install: a problem is a warning, and RADIO shows an empty
 * list when the file is missing.
 */
import { copyFileSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy of Pi 1.5.2's normalizeWindowsShellPath (dist/utils/paths.js). */
function normalizeWindowsShellPath(filePath) {
  if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\")) return filePath;
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return filePath;
  const suffix = match[2]?.replaceAll("/", "\\");
  return `${match[1].toUpperCase()}:\\${suffix ?? ""}`;
}

/** Copy of Pi 1.5.2's normalizePath with its default options (dist/utils/paths.js). */
function normalizePath(input) {
  let normalized = input;
  if (process.platform === "win32") normalized = normalizeWindowsShellPath(normalized);
  const home = homedir();
  if (normalized === "~") return home;
  if (normalized.startsWith("~/") || (process.platform === "win32" && normalized.startsWith("~\\"))) {
    return join(home, normalized.slice(2));
  }
  if (/^file:\/\//.test(normalized)) return fileURLToPath(normalized);
  return normalized;
}

/** Whether `path` names the same place from any working directory and drive. */
function isFullAbsolute(path) {
  if (process.platform !== "win32") return isAbsolute(path);
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(path);
}

/** Pi's agent directory as Pi's getAgentDir gives it, or undefined when it cannot be told. */
function agentDir() {
  const value = process.env.PI_CODING_AGENT_DIR;
  if (!value) return join(homedir(), ".pi", "agent");
  const path = normalizePath(value);
  return isFullAbsolute(path) ? path : undefined;
}

try {
  const dir = agentDir();
  if (!dir) {
    console.warn(`pie-boy: radio.json was not put in place: PI_CODING_AGENT_DIR (${process.env.PI_CODING_AGENT_DIR}) is not an absolute path.`);
  } else {
    const target = join(dir, "pie-boy", "radio.json");
    const source = fileURLToPath(new URL("../radio.default.json", import.meta.url));
    mkdirSync(dirname(target), { recursive: true });
    try {
      copyFileSync(source, target, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
} catch (error) {
  console.warn(`pie-boy: radio.json was not put in place: ${error instanceof Error ? error.message : String(error)}`);
}
