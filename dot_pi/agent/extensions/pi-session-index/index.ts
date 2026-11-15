// 応答が終わるたびに、今のセッションの文書を会話検索の Meilisearch へ送る。
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertSession } from "./documents.ts";
import { addDocuments, targetFromEnv, waitTask } from "./meilisearch.ts";

const STATUS_KEY = "session-index";
const SHUTDOWN_WAIT_MS = 3000;

function reason(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
  return text.length > 80 ? text.slice(0, 79) + "…" : text;
}

export default function sessionIndex(pi: ExtensionAPI) {
  let file: string | undefined;
  let posting: Promise<void> | undefined;
  let updated = false;
  const closed = new AbortController();
  const cancelled = new AbortController();
  let watching: AbortController | undefined;
  let ui: ExtensionContext["ui"] | undefined;

  function show(text: string | undefined): void {
    if (closed.signal.aborted) return;
    try { ui?.setStatus(STATUS_KEY, text); } catch { /* UI は既に使えない */ }
  }

  function stopWatching(): void {
    watching?.abort();
    watching = undefined;
  }

  function watch(task: number): void {
    stopWatching();
    if (closed.signal.aborted) return;
    const current = new AbortController();
    watching = current;
    void (async () => {
      let text: string | undefined;
      try {
        await waitTask(targetFromEnv(), task, AbortSignal.any([closed.signal, current.signal]), 1000);
      } catch (error) {
        text = "索引: 失敗 " + reason(error);
      }
      if (watching !== current || closed.signal.aborted) return;
      watching = undefined;
      show(text);
    })();
  }

  async function postUpdates(): Promise<void> {
    do {
      updated = false;
      try {
        const documents = convertSession(file!);
        if (documents?.length) watch(await addDocuments(targetFromEnv(), documents, cancelled.signal));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !cancelled.signal.aborted) {
          stopWatching(); // この失敗を、それ以前のタスクの結果で上書きしない
          show("索引: 失敗 " + reason(error));
        }
      }
    } while (updated && !cancelled.signal.aborted);
  }

  function startPosting(): void {
    posting ??= postUpdates().finally(() => {
      posting = undefined;
      if (updated && !cancelled.signal.aborted) startPosting();
    });
  }

  pi.on("agent_settled", (_event, ctx) => {
    if (closed.signal.aborted) return;
    ui = ctx.hasUI ? ctx.ui : undefined;
    const current = ctx.sessionManager.getSessionFile();
    if (!current) return;
    file = current;
    updated = true;
    startPosting();
  });

  pi.on("session_shutdown", async () => {
    closed.abort();
    stopWatching();
    ui = undefined;
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<true>((done) => { timer = setTimeout(done, SHUTDOWN_WAIT_MS, true); });
    while (posting && !(await Promise.race([posting.then(() => false), expired]))) {
      // 終了直前に受け付けた送り直しも待つ
    }
    clearTimeout(timer);
    cancelled.abort();
  });
}
