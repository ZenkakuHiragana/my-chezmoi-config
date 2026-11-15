// Pi のセッションを会話検索の Meilisearch へまとめて送る。
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { convertSession, listSessionFiles, type SessionDocument, type SessionFile } from "./documents.ts";
import { addDocuments, TaskFailed, taskError, targetFromEnv, taskStatuses, waitTask, type Target } from "./meilisearch.ts";

const HELP = `使い方: node cli.ts [セッション.jsonl ...]
引数を省くと Pi の sessions/<作業フォルダ>/*.jsonl をすべて送る。
PI_CODING_AGENT_DIR、MEILISEARCH_URL、MEILISEARCH_INDEX で保存先と接続先を指定する。
終了コード: 0 失敗なし、1 失敗あり。
`;

export type Batch =
  | { label: string; kind: "documents"; documents: SessionDocument[] }
  | { label: string; kind: "skipped" }
  | { label: string; kind: "error"; error: string };

/**
 * Pi の getAgentDir() と同じく PI_CODING_AGENT_DIR を読み、その下の sessions を返す。
 * Pi の normalizePath() に合わせ、~ と、Windows では Git Bash 形式（/c/...）と file:// を解決する。
 */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env, windows = process.platform === "win32"): string {
  let dir = env.PI_CODING_AGENT_DIR;
  if (!dir) return join(homedir(), ".pi", "agent", "sessions");
  const shell = windows && !dir.startsWith("//") && !dir.includes("\\") ? /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(dir) : null;
  if (shell) dir = shell[1].toUpperCase() + ":\\" + (shell[2] ?? "").replaceAll("/", "\\");
  if (dir === "~") dir = homedir();
  else if (dir.startsWith("~/") || (windows && dir.startsWith("~\\"))) dir = join(homedir(), dir.slice(2));
  else if (dir.startsWith("file://")) dir = fileURLToPath(dir);
  return join(dir, "sessions");
}


export function* batches(paths: readonly string[], root: string): Generator<Batch> {
  const files: SessionFile[] = paths.length ? paths.map((path) => ({ path })) : listSessionFiles(root);
  for (const file of files) {
    if (file.error !== undefined) {
      yield { label: file.path, kind: "error", error: file.error };
      continue;
    }
    try {
      const documents = convertSession(file.path);
      yield documents === null ? { label: basename(file.path), kind: "skipped" }
        : { label: basename(file.path), kind: "documents", documents };
    } catch (error) {
      yield { label: file.path, kind: "error", error: String(error) };
    }
  }
}

export interface Output { out(line: string): void; err(line: string): void }
interface Sent { label: string; count: number; task: number }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 全セッションを送ってから最後のタスクを待ち、全タスクの状態を調べる。 */
export async function run(sessions: Iterable<Batch>, target: Target, output: Output): Promise<number> {
  const summary = { conversations: 0, documents: 0, skipped: 0, failed: [] as object[] };
  const failed = (label: string, error: string, task?: number) => {
    summary.failed.push(task === undefined ? { label, error } : { label, error, task });
    output.err("failed " + (task === undefined ? label : label + " task=" + task) + ": " + error);
  };
  const succeeded = (label: string, count: number) => {
    summary.conversations++;
    summary.documents += count;
    output.out("ok " + label + " docs=" + count);
  };
  const sent: Sent[] = [];
  for (const batch of sessions) {
    if (batch.kind === "skipped") { summary.skipped++; continue; }
    if (batch.kind === "error") { failed(batch.label, batch.error); continue; }
    if (!batch.documents.length) { succeeded(batch.label, 0); continue; }
    try {
      const task = await addDocuments(target, batch.documents);
      sent.push({ label: batch.label, count: batch.documents.length, task });
      output.out("sent " + batch.label + " task=" + task + " docs=" + batch.documents.length);
    } catch (error) { failed(batch.label, message(error)); }
  }
  if (sent.length) {
    const last = sent[sent.length - 1];
    output.out("wait task=" + last.task + " sessions=" + sent.length);
    try { await waitTask(target, last.task); }
    catch (error) {
      // タスクの失敗・取り消しは状態一覧で報告する。照会エラーでも一覧を試す。
      if (!(error instanceof TaskFailed)) output.err("wait task=" + last.task + ": " + message(error));
    }
    try {
      const tasks = await taskStatuses(target, sent.map((item) => item.task));
      for (const item of sent) {
        const task = tasks.get(item.task);
        if (task?.status === "succeeded") succeeded(item.label, item.count);
        else failed(item.label, task ? taskError(task, item.task) : "task " + item.task + " の状態が分からない", item.task);
      }
    } catch (error) {
      for (const item of sent) failed(item.label, message(error), item.task);
    }
  }
  output.out(JSON.stringify(summary));
  return summary.failed.length ? 1 : 0;
}

async function main(): Promise<number> {
  let parsed;
  try { parsed = parseArgs({ options: { help: { type: "boolean", short: "h" } }, allowPositionals: true }); }
  catch (error) { process.stderr.write(message(error) + "\n" + HELP); return 1; }
  if (parsed.values.help) { process.stdout.write(HELP); return 0; }
  return run(batches(parsed.positionals, sessionsRoot()), targetFromEnv(), {
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  });
}

if (import.meta.main) process.exitCode = await main();
