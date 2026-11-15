/**
 * pi-scratchpad: a temporary folder for each session.
 *
 * The folder is <temp>/pi/sessions/<session id>, given to the agent's commands in the
 * PI_SCRATCHPAD environment variable. On Windows it is written as C:/..., which names the same
 * folder for Git Bash and for Node or Python, unlike /tmp.
 *
 * - session_start: sets the variable, then creates the folder (or keeps the existing one).
 *   On startup, folders under sessions/ other than this session's that are not used for 7 days are removed.
 * - turn_start: marks the folder as used now.
 * - session_shutdown: removes the folder unless the session is only reloaded. If it cannot be
 *   removed, it is left for the cleanup on a later startup. Windows does not send shutdown when the
 *   terminal is closed; that cleanup also covers it.
 *
 * Subagents do not load this extension. They inherit the variable and use the parent's folder.
 */
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SESSIONS = process.platform === "win32" ? `${tmpdir().replaceAll("\\", "/")}/pi/sessions` : "/tmp/pi/sessions";
const UNUSED_MS = 7 * 24 * 60 * 60 * 1000;

/** Removes folders of other sessions that are not used for UNUSED_MS. A folder that fails is left for next time. */
function removeUnused(current: string): void {
  let entries;
  try {
    entries = readdirSync(SESSIONS, { withFileTypes: true });
  } catch {
    return;
  }
  const limit = Date.now() - UNUSED_MS;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === current) continue;
    const path = `${SESSIONS}/${entry.name}`;
    try {
      if (statSync(path).mtimeMs < limit) rmSync(path, { recursive: true, force: true });
    } catch {
      // 次の起動でもう一度試す
    }
  }
}

export default function piScratchpad(pi: ExtensionAPI): void {
  let folder: string | undefined;

  pi.on("session_start", (event, ctx) => {
    const id = ctx.sessionManager.getSessionId();
    folder = `${SESSIONS}/${id}`;
    // 先に入れる。作れなくても、書き込みが「フォルダが無い」エラーになるだけで、変数が空の /x にはならない
    process.env.PI_SCRATCHPAD = folder;
    try {
      mkdirSync(folder, { recursive: true });
    } catch {
      // 書き込みの側でエラーになる
    }
    if (event.reason === "startup") removeUnused(id);
  });

  pi.on("turn_start", () => {
    if (!folder) return;
    const now = new Date();
    try {
      utimesSync(folder, now, now);
    } catch {
      // 消されていたら、使われた印は付けられない
    }
  });

  pi.on("session_shutdown", (event) => {
    if (!folder || event.reason === "reload") return;
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      // 起動時の掃除に任せる
    }
  });
}
