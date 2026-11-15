// 検査の設定を読み、検査コマンドを動かす。Pi に依存しない。

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

/** 検査。command の後ろに、リポジトリの根からの相対パスを付けて、根で実行する。 */
export interface Check {
  name: string;
  command: string[];
  /** ファイルのフォルダから上へこの名前を探し、見つかったファイルだけを渡す。 */
  ifFound?: string;
}

export type CheckDefaults = Record<string, Omit<Check, "name">>;

export interface CheckRun {
  name: string;
  root: string;
  /** 終了コードが 0 以外だった実行に渡したファイル（絶対パス）。 */
  violated: string[];
  /** 動かせなかった実行の理由（見つからない、時間切れ、中断）。 */
  failure?: string;
  /** 終了コードが 0 以外だった実行の標準出力と標準エラー。 */
  output: string;
  /** 検査が中身を書き換えたファイル（絶対パス）。 */
  fixed: string[];
}

const BATCH_SIZE = 50;
const TIMEOUT_MS = 120_000;

/** 名前ごとに設定を既定へ浅く重ね、null と command が不正な項目を除く。 */
export function loadChecks(settings: any, defaults: CheckDefaults): Check[] {
  const configured = settings?.editCheck?.checks ?? {};
  const names = [...new Set([...Object.keys(defaults), ...Object.keys(configured)])];
  const checks: Check[] = [];
  for (const name of names) {
    if (configured[name] === null) continue;
    const merged = { ...defaults[name], ...configured[name] };
    const { command } = merged;
    if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === "string" && part !== "")) continue;
    checks.push({ ...merged, name, command });
  }
  return checks;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** file のフォルダから上へ name を探す。found はフォルダごとの結果を覚える。 */
async function foundAbove(file: string, name: string, found: Map<string, boolean>): Promise<boolean> {
  const visited: string[] = [];
  let dir = dirname(file);
  let result: boolean;
  for (;;) {
    const known = found.get(dir);
    if (known !== undefined) {
      result = known;
      break;
    }
    visited.push(dir);
    if (await exists(join(dir, name))) {
      result = true;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      result = false;
      break;
    }
    dir = parent;
  }
  for (const path of visited) found.set(path, result);
  return result;
}

/** 中身の SHA-1。大きなファイルでもメモリに載せないよう、少しずつ読む。読めなければ undefined。 */
async function hash(file: string): Promise<string | undefined> {
  try {
    const digest = createHash("sha1");
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    return digest.digest("hex");
  } catch {
    return undefined;
  }
}

async function hashes(files: string[]): Promise<Map<string, string | undefined>> {
  const result = new Map<string, string | undefined>();
  for (const file of files) result.set(file, await hash(file));
  return result;
}

/** 動かせた実行は終了コードを、動かせなかった実行は理由を持つ。 */
type Execution = { code: number; output: string } | { failure: string; output: string };

function execute(command: string[], args: string[], cwd: string, signal?: AbortSignal): Promise<Execution> {
  return new Promise((resolveExecution) => {
    try {
      execFile(
        command[0], [...command.slice(1), ...args],
        { cwd, windowsHide: true, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, signal },
        (error, stdout, stderr) => {
          const output = [stdout, stderr].filter((text) => text.trim() !== "").join("\n");
          if (!error) return resolveExecution({ code: 0, output });
          if (typeof error.code === "number") return resolveExecution({ code: error.code, output });
          resolveExecution({ output, failure: error.message.split("\n")[0] });
        },
      );
    } catch (error) {
      resolveExecution({ output: "", failure: (error instanceof Error ? error.message : String(error)).split("\n")[0] });
    }
  });
}

/**
 * root の files（絶対パス）を、検査の順に検査する。対象が0個の検査は動かさない。
 * ファイルは BATCH_SIZE 個ずつに分けて渡す。動かせなかった実行があっても残りは続ける。
 * 相対パスが「-」で始まるときは「./」を付ける（オプションと取り違えさせない）。
 */
export async function runChecks(checks: Check[], root: string, files: string[], signal?: AbortSignal): Promise<CheckRun[]> {
  const found = new Map<string, Map<string, boolean>>();
  const runs: CheckRun[] = [];
  for (const check of checks) {
    let targets = files;
    const marker = check.ifFound;
    if (marker !== undefined) {
      const cache = found.get(marker) ?? new Map<string, boolean>();
      found.set(marker, cache);
      const selected: string[] = [];
      for (const file of files) if (await foundAbove(file, marker, cache)) selected.push(file);
      targets = selected;
    }
    if (targets.length === 0) continue;
    const before = await hashes(targets);
    const run: CheckRun = {
      name: check.name,
      root,
      violated: [],
      output: "",
      fixed: [],
    };
    const outputs: string[] = [];
    const failures: string[] = [];
    for (let start = 0; start < targets.length; start += BATCH_SIZE) {
      const batch = targets.slice(start, start + BATCH_SIZE);
      const args = batch.map((file) => {
        const path = relative(root, file).split(sep).join("/");
        return path.startsWith("-") ? "./" + path : path;
      });
      const result = await execute(check.command, args, root, signal);
      if ("failure" in result) {
        failures.push(result.failure);
      } else if (result.code !== 0) {
        run.violated.push(...batch);
        if (result.output.trim() !== "") outputs.push(result.output.trimEnd());
      }
    }
    const after = await hashes(targets);
    run.fixed = targets.filter((file) => before.get(file) !== after.get(file));
    run.output = outputs.join("\n");
    if (failures.length > 0) run.failure = [...new Set(failures)].join("、");
    runs.push(run);
  }
  return runs;
}
