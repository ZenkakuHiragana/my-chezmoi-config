// エージェントが書いたファイルを、ツールの実行の前後の git の状態から見つける。Pi に依存しない。

import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 写し: git が作業コピーの変更として示すファイル（追跡外を含み、無視されたものを除く）の、
 * 絶対パスから「サイズと mtime」への対応。通常のファイルでないもの（シンボリックリンクを含む）は含めない。
 */
export interface Snapshot {
  root: string;
  files: Map<string, string>;
}

const GIT_TIMEOUT_MS = 30_000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveGit, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        windowsHide: true,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
      },
      (error, stdout) => (error ? reject(error) : resolveGit(stdout)),
    );
  });
}

/** cwd を含む git リポジトリの根。リポジトリ外なら undefined、git の失敗は伝える。 */
export async function findRoot(cwd: string): Promise<string | undefined> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).replace(/\r?\n$/, "");
    return root ? resolve(root) : undefined;
  } catch (error) {
    if (error instanceof Error && /not a git repository/i.test(error.message)) return undefined;
    throw error;
  }
}

async function signature(path: string): Promise<string | undefined> {
  try {
    // リンクはたどらない。リポジトリの外のファイルを検査に渡さないため
    const info = await lstat(path);
    return info.isFile() ? `${info.size}:${info.mtimeMs}` : undefined;
  } catch {
    return undefined;
  }
}

export async function snapshot(root: string): Promise<Snapshot> {
  // --no-optional-locks: 並行して動くエージェントの git コマンドとインデックスのロックを取り合わない
  const status = await git(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  // -z の各項目は "XY パス"。パスは根からの相対で、引用符で囲まれない
  const paths = status
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => resolve(root, entry.slice(3)));
  const files = new Map<string, string>();
  await Promise.all(
    paths.map(async (path) => {
      const value = await signature(path);
      if (value !== undefined) files.set(path, value);
    }),
  );
  return { root, files };
}

/**
 * 前後の写しで変わったファイル: 後の写しにあって、前の写しに無いか値が違うもの。
 * 後の写しに無いもの（コミットした、HEAD と同じ内容に戻した、無視されるようになった、消した）は含めない。
 */
export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const changed: string[] = [];
  for (const [path, value] of after.files) {
    if (before.files.get(path) !== value) changed.push(path);
  }
  return changed;
}
