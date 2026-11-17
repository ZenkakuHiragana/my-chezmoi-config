// 会話検索の Meilisearch へ文書を送る。Pi に依存しない。
// 索引の設定（埋め込みを含む）は containers/session-search/ の compose が当てる。ここは文書を送るだけ。
//
// 要求は fetch ではなく node:http で送る。Windows の Node v26.7.0 では、fetch はイベントループが
// しばらく待機した後の要求で約3秒止まる（node:http では起きない）。

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/** 送り先。session.sh と同じ環境変数で決める。 */
export interface Target {
  url: string;
  index: string;
  /** Meilisearch の API キー。あれば要求に付ける。 */
  apiKey?: string;
}

export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): Target {
  return {
    url: (env.MEILISEARCH_URL || "http://127.0.0.1:7700").replace(/\/+$/, ""),
    index: env.MEILISEARCH_INDEX || "conversations",
    apiKey: env.MEILISEARCH_API_KEY || undefined,
  };
}

/** Meilisearch とのやり取りの失敗。 */
export class MeiliError extends Error {}

/** タスクが failed か canceled で終わった。その文書は追加されていない。 */
export class TaskFailed extends MeiliError {}

const REQUEST_TIMEOUT_MS = 60_000;

/** 要求を1つ送り、応答の状態コードと本文を返す。接続や受信に失敗したら、その例外で失敗する。 */
function send(url: URL, method: string, body: string | undefined, apiKey: string | undefined, signal: AbortSignal): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const headers = {
      ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
    };
    const outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method, headers, signal }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
      response.on("error", reject);
      // 本文の途中で接続が切れたとき
      response.on("close", () => {
        if (!response.complete) reject(new Error("応答が途中で切れた"));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function request(target: Target, method: string, path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let status: number;
  let text: string;
  try {
    ({ status, text } = await send(new URL(target.url + path), method, body === undefined ? undefined : JSON.stringify(body),
      target.apiKey, signal ? AbortSignal.any([signal, timeout]) : timeout));
  } catch (error) {
    // node:http は理由を cause に包んだ AbortError を投げる。呼び出し側が渡した理由をそのまま返す。
    if (signal?.aborted) throw signal.reason;
    throw new MeiliError("Meilisearch に接続できない (" + target.url + "): " + String(error));
  }
  const ok = status >= 200 && status < 300;
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    if (!ok) throw new MeiliError("HTTP " + status + ": " + text.slice(0, 200));
    throw new MeiliError("JSON でない応答: " + text.slice(0, 200));
  }
  if (!ok) {
    const message = typeof value === "object" && value !== null && "message" in value ? String(value.message) : text;
    throw new MeiliError("HTTP " + status + ": " + message);
  }
  return value;
}

/**
 * 文書を追加・置換するタスクを作り、その番号を返す。
 * 主キーは索引にまだない場合だけ効く。文書には id を含む項目が3つあり、推定に任せると失敗する。
 */
export async function addDocuments(target: Target, documents: readonly object[], signal?: AbortSignal): Promise<number> {
  const path = "/indexes/" + encodeURIComponent(target.index) + "/documents?primaryKey=id";
  const response = await request(target, "POST", path, documents, signal);
  const taskUid = typeof response === "object" && response !== null ? (response as { taskUid?: unknown }).taskUid : undefined;
  if (typeof taskUid !== "number") throw new MeiliError(("taskUid のない応答: " + JSON.stringify(response)).slice(0, 300));
  return taskUid;
}

/** Meilisearch のタスク。使う項目だけ。 */
export type Task = Record<string, unknown> & { status?: unknown; batchUid?: unknown; error?: unknown };

/** failed か canceled で終わったタスクの理由。canceled には error がない。 */
export function taskError(task: Task, taskUid: number): string {
  const error = task.error as { message?: unknown } | null | undefined;
  return String(error?.message ?? "task " + taskUid + " " + task.status);
}

/** まだ終わっていない状態か。終わった状態（succeeded、failed、canceled）でも未完了でもなければ MeiliError。 */
export function isPending(task: Task | undefined, taskUid: number): boolean {
  const status = task?.status;
  if (status === "enqueued" || status === "processing") return true;
  if (status === "succeeded" || status === "failed" || status === "canceled") return false;
  throw new MeiliError(("task " + taskUid + " の状態が分からない: " + JSON.stringify(task ?? null)).slice(0, 300));
}

/** タスクの終了を待つ。失敗で終わったら TaskFailed、状態が分からなくなったら MeiliError。 */
export async function waitTask(target: Target, taskUid: number, signal?: AbortSignal, pollMs = 500): Promise<void> {
  for (;;) {
    const task = (await request(target, "GET", "/tasks/" + taskUid, undefined, signal)) as Task;
    if (!isPending(task, taskUid)) {
      if (task.status === "succeeded") return;
      throw new TaskFailed(taskError(task, taskUid));
    }
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      }, pollMs);
      const stop = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", stop, { once: true });
    });
  }
}

const STATUS_PAGE = 100;

/** 複数のタスクの今の状態を、番号ごとに返す。Meilisearch が返さなかった番号は含まない。 */
export async function taskStatuses(target: Target, taskUids: readonly number[]): Promise<Map<number, Task>> {
  const tasks = new Map<number, Task>();
  for (let start = 0; start < taskUids.length; start += STATUS_PAGE) {
    const page = taskUids.slice(start, start + STATUS_PAGE);
    const response = await request(target, "GET", "/tasks?uids=" + page.join(",") + "&limit=" + page.length, undefined);
    const results = typeof response === "object" && response !== null ? (response as { results?: unknown }).results : undefined;
    if (!Array.isArray(results)) throw new MeiliError(("results のない応答: " + JSON.stringify(response)).slice(0, 300));
    for (const task of results as Task[]) if (typeof task?.uid === "number") tasks.set(task.uid, task);
  }
  return tasks;
}
