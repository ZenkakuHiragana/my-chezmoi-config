// エージェントが編集したファイルを、作業が一通り終わってから検査する。
// プロンプトの開始時と作業の終わりの git の状態を比べて、変わったファイルを検査コマンドに渡す。
// 検査コマンドが整形したら記録を残す。直らない問題が残ったら事実だけを知らせ、1回だけ続きを走らせる。
// 並行作業では書き込む範囲が重ならないことを前提にする（別のセッションが書いたファイルも検査・整形する）。

import type {
  CustomMessageEntryDraft,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { changedFiles, findRoot, snapshot, type Snapshot } from "./changes.ts";
import { loadChecks, runChecks, type CheckDefaults, type CheckRun } from "./checks.ts";

const STATUS_KEY = "edit-check";
const MESSAGE_TYPE = "pi-edit-check";
const OUTPUT_LIMIT = 8000;

export const EDITORCONFIG_CHECKER = fileURLToPath(
  new URL("./node_modules/editorconfig-checker/dist/index.js", import.meta.url),
);

/**
 * 既定の検査。依存が入っていなければ、そのパスをコマンドにして起動に失敗させる
 * （Node が読めずに終了コード 1 で終わるのを、問題が残ったと取り違えないため）。
 */
export function defaultChecks(): CheckDefaults {
  const command = existsSync(EDITORCONFIG_CHECKER)
    ? [process.execPath, EDITORCONFIG_CHECKER, "-fix", "-no-color"]
    : [EDITORCONFIG_CHECKER];
  return { editorconfig: { command, ifFound: ".editorconfig" } };
}

/**
 * 検査に渡してよいファイル: 通常のファイルで、親フォルダのリンクをたどってもリポジトリの中にあり、
 * 根との間に別のリポジトリ（.git を持つフォルダ）が無いもの。
 */
async function checkable(file: string, root: string): Promise<boolean> {
  try {
    if (!(await lstat(file)).isFile()) return false;
    const realRoot = await realpath(root);
    const realFile = await realpath(file);
    const inside = relative(realRoot, realFile);
    if (inside === "" || inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) return false;
    for (const [path, base] of [[file, root], [realFile, realRoot]]) {
      for (let dir = dirname(path); relative(base, dir) !== ""; dir = dirname(dir)) {
        if (existsSync(join(dir, ".git"))) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function display(file: string, root: string): string {
  return relative(root, file).split(sep).join("/");
}

/** ファイルを1行に1つずつ並べる（名前にカンマなどがあっても区切りを取り違えない）。 */
function fileList(files: string[], root: string): string {
  return files.map((file) => `  - ${display(file, root)}`).join("\n");
}

function fixedSection(runs: CheckRun[]): string | undefined {
  const lines = runs
    .filter((run) => run.fixed.length > 0)
    .map((run) => `- ${run.name}（${run.root}）:\n${fileList(run.fixed, run.root)}`);
  if (lines.length === 0) return undefined;
  return [
    "作業の後、検査コマンドが次のファイルを整形した（改行、末尾の改行、行末の空白など）。パスはリポジトリの根からの相対。読み直すと、書いた内容と違うことがある。",
    ...lines,
  ].join("\n");
}

function remainingSection(runs: CheckRun[]): string {
  const parts = runs
    .filter((run) => run.violated.length > 0)
    .map((run) => {
      const output = run.output || "（出力なし）";
      const lines = [
        `## ${run.name}（${run.root}）`,
        `渡したファイル:\n${fileList(run.violated, run.root)}`,
        "```\n" + output.slice(0, OUTPUT_LIMIT) + "\n```",
      ];
      if (output.length > OUTPUT_LIMIT) lines.push(`（出力の残り ${output.length - OUTPUT_LIMIT} 文字は省略した）`);
      return lines.join("\n");
    });
  const head = [
    "渡したファイルの検査コマンドが、0 以外の終了コードで終わった。自動では直せなかった問題の報告か、検査コマンド自体の失敗かは、終了コードからは区別できない。",
  ];
  const firstViolated = runs.findIndex((run) => run.violated.length > 0);
  if (runs.some((run, index) => index > firstViolated && run.fixed.length > 0)) {
    head.push("出力はそれぞれの検査を動かした時点のもので、後の検査が整形していることがある。");
  }
  return [head.join(""), ...parts].join("\n\n");
}

function gitFailure(error: unknown): string {
  const reason = error instanceof Error
    ? ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) || error.message
    : String(error);
  const lines = reason.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return "git を動かせない: " + (lines.find((line) => /^(fatal:|error:)/i.test(line)) ?? lines[0] ?? reason);
}

export default function editCheck(pi: ExtensionAPI): void {
  let baseline: Snapshot | undefined;
  let notified = false;
  const flagged = new Set<string>();

  const setStatus = (ctx: ExtensionContext, notes: string[]) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, notes.length ? "edit-check: " + notes.join(" / ") : undefined);
  };

  pi.on("before_agent_start", async (_event, ctx) => {
    notified = false;
    flagged.clear();
    try {
      const root = await findRoot(ctx.cwd);
      baseline = root === undefined ? undefined : await snapshot(root);
      setStatus(ctx, []);
    } catch (error) {
      baseline = undefined;
      setStatus(ctx, [gitFailure(error)]);
    }
  });

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed" || event.continue || baseline === undefined) return;
    const root = baseline.root;
    let now: Snapshot;
    try {
      now = await snapshot(root);
    } catch (error) {
      setStatus(ctx, [gitFailure(error)]);
      return undefined;
    }
    const files: string[] = [];
    const candidates = new Set([...changedFiles(baseline, now), ...flagged]);
    for (const file of candidates) {
      if (now.files.has(file) && await checkable(file, root)) files.push(file);
    }
    if (files.length === 0) {
      baseline = now;
      setStatus(ctx, []);
      return;
    }

    const checks = loadChecks(pi.getSettings(), defaultChecks());
    const runs = await runChecks(checks, root, files, ctx.signal);
    const notes: string[] = [];
    try {
      baseline = await snapshot(root);
    } catch (error) {
      baseline = undefined;
      notes.push(gitFailure(error));
    }
    for (const run of runs) {
      if (run.failure !== undefined) notes.push(run.name + ": " + run.failure);
      if (run.violated.length > 0) notes.push("問題が残った（" + run.name + "）");
    }
    setStatus(ctx, notes);

    const notify = !notified && runs.some((run) => run.violated.length > 0);
    if (notify) {
      notified = true;
      for (const run of runs) for (const file of run.violated) flagged.add(file);
    }
    const sections = [fixedSection(runs), notify ? remainingSection(runs) : undefined].filter(
      (section): section is string => section !== undefined,
    );
    if (sections.length === 0) return;
    const message: CustomMessageEntryDraft = {
      type: "custom_message",
      customType: MESSAGE_TYPE,
      content: "pi-edit-check: " + sections.join("\n\n"),
      display: true,
    };
    return notify ? { entries: [...event.entries, message], continue: true } : { entries: [...event.entries, message] };
  });

  pi.on("session_shutdown", (_event, ctx) => {
    baseline = undefined;
    flagged.clear();
    notified = false;
    setStatus(ctx, []);
  });
}
