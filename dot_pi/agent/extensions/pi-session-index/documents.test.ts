// node --test documents.test.ts
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { convertSession, listSessionFiles } from "./documents.ts";

function writeJsonl(path: string, entries: unknown[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry) + "\n").join(""));
}

function message(id: string, parentId: string | null, role: string, content: unknown, timestamp = "2026-11-13T00:00:00.000Z") {
  return { type: "message", id, parentId, timestamp, message: { role, content } };
}

const HEADER = { type: "session", version: 3, id: "session-1", timestamp: "2026-11-13T00:00:00.000Z", cwd: "C:\\Work\\repo" };
const SESSION = [
  HEADER,
  { type: "model_change", id: "m1", parentId: null },
  message("u1", "m1", "user", [{ type: "text", text: "最初の質問" }], "2026-11-13T01:02:03.456Z"),
  { type: "custom_message", id: "c1", parentId: "u1", customType: "hindsight", content: "差し込まれた記憶" },
  message("a1", "c1", "assistant", [{ type: "thinking", thinking: "考え中" }, { type: "text", text: "確認するね" },
    { type: "toolCall", name: "bash", arguments: { command: "ls" } }]),
  message("t1", "a1", "toolResult", [{ type: "text", text: "ツールの出力" }]),
  message("a2", "t1", "assistant", [{ type: "text", text: "結論です" }]),
  message("a3", "u1", "assistant", [{ type: "text", text: "別の枝の返答" }]),
  { type: "session_info", id: "i1", parentId: "a2", name: "古い名前" },
  { type: "session_info", id: "i2", parentId: "i1", name: "セッション名" },
  message("u2", "i2", "user", "二つ目の質問"),
  message("a4", "u2", "assistant", [{ type: "thinking", thinking: "思考だけ" }]),
  message("u3", "a4", "user", [{ type: "text", text: "三つ目" }]),
  message("a5", "u3", "assistant", [{ type: "text", text: "三つ目への返答" }]),
];

describe("documents", () => {
  let sessions: string;
  let session: string;
  let nested: string;
  let headerless: string;

  beforeEach((context) => {
    const work = join(tmpdir(), "pi");
    mkdirSync(work, { recursive: true });
    const root = mkdtempSync(join(work, "session-index-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    sessions = join(root, "sessions");
    const folder = join(sessions, "--C--Work-repo--");
    session = join(folder, "2026-11-13_session-1.jsonl");
    writeJsonl(session, SESSION);
    nested = join(folder, "2026-11-13_session-1", "sub-1", "run-0", "session.jsonl");
    writeJsonl(nested, [{ type: "session", id: "sub-1" }, message("su", null, "user", "依頼"), message("sa", "su", "assistant", "返答")]);
    writeJsonl(join(folder, "subagent-artifacts", "sub-2_transcript.jsonl"), [message("su", null, "user", "成果物")]);
    headerless = join(folder, "no-header.jsonl");
    writeJsonl(headerless, [message("u", null, "user", "見出しなし")]);
  });

  it("joins assistant text per user turn and drops everything else", () => {
    const documents = convertSession(session)!;
    assert.deepEqual(documents.map((d) => d.message_id), ["u1", "u3"]);
    assert.deepEqual(documents[0], {
      id: "pi_session-1_u1",
      source: "pi",
      conversation_id: "session-1",
      message_id: "u1",
      question: "最初の質問",
      reply: "確認するね\n\n結論です\n\n別の枝の返答",
      cwd: "C:\\Work\\repo",
      source_path: realpathSync.native(session),
      timestamp: 1794531723456,
      title: "セッション名",
    });
    // キーの順序も Python 版と同じ
    assert.deepEqual(Object.keys(documents[1]), ["id", "source", "conversation_id", "message_id", "question", "reply", "cwd", "source_path", "timestamp", "title"]);
  });

  it("strips the same characters as Python str.strip()", () => {
    const path = join(sessions, "w", "strip.jsonl");
    writeJsonl(path, [HEADER, message("u", null, "user", "\u001c\u0085 問い \u3000"), message("a", "u", "assistant", "\ufeff答え\ufeff")]);
    const [document] = convertSession(path)!;
    assert.equal(document.question, "問い");
    assert.equal(document.reply, "\ufeff答え\ufeff");
  });

  it("keeps cwd null and leaves out a missing title or timestamp", () => {
    const path = join(sessions, "w", "bare.jsonl");
    writeJsonl(path, [{ type: "session", id: "s" }, message("u", null, "user", "q", "unknown"), message("a", "u", "assistant", "r")]);
    const [document] = convertSession(path)!;
    assert.equal(document.cwd, null);
    assert.ok(!("timestamp" in document) && !("title" in document));
  });

  it("follows parents, not file order", () => {
    const path = join(sessions, "w", "order.jsonl");
    writeJsonl(path, [HEADER, message("A", null, "user", "A の質問"), message("B", "A", "user", "B の質問"),
      message("rb", "B", "assistant", "B への返答"), message("ra", "A", "assistant", "A への返答")]);
    const replies = Object.fromEntries(convertSession(path)!.map((d) => [d.message_id, d.reply]));
    assert.deepEqual(replies, { A: "A への返答", B: "B への返答" });
  });

  it("returns null without a header", () => {
    assert.equal(convertSession(headerless), null);
  });

  it("ignores only an unterminated last line that is not JSON", () => {
    appendFileSync(session, '{"type": "message", "id": "u9"');
    assert.equal(convertSession(session)!.length, 2);
    appendFileSync(session, Buffer.from('}\n{"text": "日本').subarray(0, -1)); // 文字の途中で切れた最後の行
    assert.equal(convertSession(session)!.length, 2);
  });

  it("reads an unterminated last line that is complete JSON", () => {
    const path = join(sessions, "w", "last.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, [HEADER, message("u", null, "user", "q")].map((e) => JSON.stringify(e) + "\n").join("")
      + JSON.stringify(message("a", "u", "assistant", "answer")));
    assert.equal(convertSession(path)![0].reply, "answer");
  });

  it("fails on a terminated line that is not JSON or not UTF-8", () => {
    appendFileSync(session, "{broken}\n");
    assert.throws(() => convertSession(session), /15 行目/);
    writeJsonl(session, SESSION);
    appendFileSync(session, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d, 0x0a]));
    assert.throws(() => convertSession(session), /15 行目/);
  });

  it("lists only <root>/<folder>/*.jsonl in name order", () => {
    writeJsonl(join(sessions, "--A--", "x.jsonl"), SESSION);
    writeFileSync(join(sessions, "stray.jsonl"), "");
    assert.deepEqual(listSessionFiles(sessions), [
      { path: join(sessions, "--A--", "x.jsonl") },
      { path: session },
      { path: headerless },
    ]);
  });

  it("reports a missing sessions folder", () => {
    const [entry] = listSessionFiles(join(sessions, "missing"));
    assert.match(entry.error!, /セッションのフォルダがない/);
  });

});
