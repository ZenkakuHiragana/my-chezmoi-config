// Pi のセッションファイルを会話検索の文書にする。Pi に依存しない。
// 文書の形はここだけで決める。id と中身を変えると、Meilisearch が埋め込みを作り直す。

import { readdirSync, readFileSync, realpathSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

/** ユーザー発言1つと、それに答える AI の本文。キーの順序も含めて文書の形。 */
export interface SessionDocument {
  id: string;
  source: "pi";
  conversation_id: string;
  message_id: string;
  question: string;
  reply: string;
  cwd: unknown;
  source_path: string;
  timestamp?: number;
  title?: string;
}

/** sessions フォルダの位置にあるセッションファイル、または読めない理由。 */
export type SessionFile = { path: string; error?: undefined } | { path: string; error: string };

// Python の str.strip() が除く文字。JS の trim() とは U+001C〜U+001F、U+0085、U+FEFF が違う。
function isPythonSpace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || (code >= 0x1c && code <= 0x20) || code === 0x85 || code === 0xa0
    || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
    || code === 0x202f || code === 0x205f || code === 0x3000;
}

function strip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isPythonSpace(text.charCodeAt(start))) start++;
  while (end > start && isPythonSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

type Entry = Record<string, unknown>;

function isObject(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 本文のテキストだけを取り出す。思考とツール呼び出しは落とす。 */
function textOf(content: unknown): string {
  if (typeof content === "string") return strip(content);
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => isObject(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => strip(block.text as string))
    .filter((text) => text)
    .join("\n\n");
}

// Pi は toISOString() の形（UTC、ミリ秒まで）で書く。時差のない形は扱わない。
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function epochMs(timestamp: unknown): number | undefined {
  if (typeof timestamp !== "string" || !ISO_TIME.test(timestamp)) return undefined;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? Math.round(ms) : undefined;
}

function role(entry: Entry): unknown {
  return entry.type === "message" && isObject(entry.message) ? entry.message.role : undefined;
}

function readEntries(path: string): unknown[] {
  const bytes = readFileSync(path);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const entries: unknown[] = [];
  let start = 0;
  for (let number = 1; start < bytes.length; number++) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline + 1;
    try {
      entries.push(JSON.parse(decoder.decode(bytes.subarray(start, end))));
    } catch {
      // 改行で終わらない最後の行だけは、Pi が書いている途中の行として読み飛ばす。
      if (newline !== -1) throw new Error(number + " 行目が JSON として読めない");
    }
    start = end;
  }
  return entries;
}

/**
 * ユーザー発言ごとに1文書を作る。見出し行がなければ null、読めない行があれば例外。
 *
 * エントリは parentId で木をなす。AI の発言は、親をたどって最も近いユーザー発言に属する。
 * 使われなかった枝の返答も同じ文書に入る。ツール結果や拡張の発言は、たどるだけで本文にしない。
 */
export function convertSession(path: string): SessionDocument[] | null {
  const parsed = readEntries(path);
  const header = parsed[0];
  if (!isObject(header) || header.type !== "session") return null;
  if (typeof header.id !== "string") throw new Error("見出し行に id がない");
  const entries = parsed.slice(1).filter(isObject);
  const byId = new Map<string, Entry>();
  for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);

  const nearestUser = (entry: Entry): string | undefined => {
    const seen = new Set<unknown>();
    let parent = entry.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = typeof parent === "string" ? byId.get(parent) : undefined;
      if (ancestor === undefined) return undefined;
      if (role(ancestor) === "user") return ancestor.id as string;
      parent = ancestor.parentId;
    }
    return undefined;
  };

  const turns = new Map<string, { entry: Entry; question: string; replies: string[] }>();
  let title: string | undefined;
  for (const entry of entries) {
    if (entry.type === "session_info" && typeof entry.name === "string") title = entry.name;
    const kind = role(entry);
    const message = entry.message as Entry;
    if (kind === "user" && typeof entry.id === "string") {
      turns.set(entry.id, { entry, question: textOf(message.content), replies: [] });
    } else if (kind === "assistant") {
      const text = textOf(message.content);
      const owner = text ? nearestUser(entry) : undefined;
      const turn = owner === undefined ? undefined : turns.get(owner);
      if (turn) turn.replies.push(text);
    }
  }

  const sourcePath = realpathSync.native(path);
  const documents: SessionDocument[] = [];
  for (const [entryId, turn] of turns) {
    if (!turn.replies.length) continue;
    const document: SessionDocument = {
      id: "pi_" + header.id + "_" + entryId,
      source: "pi",
      conversation_id: header.id,
      message_id: entryId,
      question: turn.question,
      reply: turn.replies.join("\n\n"),
      cwd: header.cwd === undefined ? null : header.cwd,
      source_path: sourcePath,
    };
    const timestamp = epochMs(turn.entry.timestamp);
    if (timestamp !== undefined) document.timestamp = timestamp;
    if (title !== undefined) document.title = title;
    documents.push(document);
  }
  return documents;
}

function isDirectory(entry: Dirent, path: string): boolean | undefined {
  try {
    return entry.isSymbolicLink() ? statSync(path).isDirectory() : entry.isDirectory();
  } catch {
    return undefined; // 種類が分からなければ残し、読むときに失敗として報告させる
  }
}

function sortedEntries(path: string): Dirent[] {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * <root>/<作業フォルダ>/<セッション>.jsonl をすべて名前順に返す。
 * サブエージェントのセッションはこれより深い場所か root の外にあるので含まれない。
 */
export function listSessionFiles(root: string): SessionFile[] {
  let folders: Dirent[];
  try {
    folders = sortedEntries(root);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return [{ path: root, error: missing ? "セッションのフォルダがない" : "フォルダを読めない (" + String(error) + ")" }];
  }
  const files: SessionFile[] = [];
  for (const folder of folders) {
    const folderPath = join(root, folder.name);
    if (isDirectory(folder, folderPath) === false) continue;
    let children: Dirent[];
    try {
      children = sortedEntries(folderPath);
    } catch (error) {
      files.push({ path: folderPath, error: "フォルダを読めない (" + String(error) + ")" });
      continue;
    }
    for (const child of children) {
      const childPath = join(folderPath, child.name);
      if (child.name.endsWith(".jsonl") && isDirectory(child, childPath) !== true) files.push({ path: childPath });
    }
  }
  return files;
}

