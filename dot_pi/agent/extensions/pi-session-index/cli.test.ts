// node --test cli.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, describe, it } from "node:test";
import { batches, run, sessionsRoot, type Batch } from "./cli.ts";
import type { SessionDocument } from "./documents.ts";
import { waitTask, type Target } from "./meilisearch.ts";

type Reply = [number, unknown];
class FakeMeilisearch {
  requests: { method: string; url: string; body: unknown }[] = [];
  replies: Reply[] = [];
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => text += chunk);
    request.on("end", () => {
      this.requests.push({ method: request.method!, url: request.url!, body: text ? JSON.parse(text) : undefined });
      const [status, body] = this.replies.shift() ?? [500, { message: "no reply queued" }];
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
  });
  target: Target = { url: "", index: "conversations" };
  async start() {
    await new Promise<void>((done) => this.server.listen(0, "127.0.0.1", done));
    this.target.url = "http://127.0.0.1:" + (this.server.address() as { port: number }).port;
  }
}
const doc = (id: string): SessionDocument => ({ id, source: "pi", conversation_id: "s", message_id: id, question: "q", reply: "r", cwd: null, source_path: "p" });
const docs = (label: string, ...ids: string[]): Batch => ({ label, kind: "documents", documents: ids.map(doc) });
const accepted = (taskUid: number): Reply => [202, { taskUid }];
const statuses = (...results: object[]): Reply => [200, { results }];
async function capture(sessions: Batch[], target: Target) {
  const out: string[] = [], err: string[] = [];
  const code = await run(sessions, target, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err, summary: JSON.parse(out.at(-1)!) };
}
function writeSession(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [{ type: "session", id: "s" }, { type: "message", id: "u", parentId: null, message: { role: "user", content: "q" } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: "r" } }].map((e) => JSON.stringify(e) + "\n").join(""));
}

describe("cli", () => {
  const fake = new FakeMeilisearch();
  before(() => fake.start());
  after(() => fake.server.close());
  beforeEach(() => { fake.requests = []; fake.replies = []; });

  it("sends all sessions before waiting; reports failed and pending tasks without retry", async () => {
    fake.replies.push(accepted(1), accepted(2), [200, { status: "canceled" }],
      statuses({ uid: 1, status: "processing" }, { uid: 2, status: "canceled" }));
    const result = await capture([docs("a", "1"), { label: "bad", kind: "error", error: "broken" }, docs("b", "2")], fake.target);
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ["failed bad: broken", "failed a task=1: task 1 processing", "failed b task=2: task 2 canceled"]);
    assert.deepEqual(fake.requests.map((r) => r.method + " " + r.url), ["POST /indexes/conversations/documents?primaryKey=id",
      "POST /indexes/conversations/documents?primaryKey=id", "GET /tasks/2", "GET /tasks?uids=1,2&limit=2"]);
  });

  it("continues after HTTP errors and reports last failed task", async () => {
    fake.replies.push([400, { message: "bad" }], [503, { message: "busy" }], accepted(3),
      [200, { status: "failed", error: { message: "embed" } }], statuses({ uid: 3, status: "failed", error: { message: "embed" } }));
    const result = await capture([docs("a", "1"), docs("b", "2"), docs("c", "3")], fake.target);
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ["failed a: HTTP 400: bad", "failed b: HTTP 503: busy", "failed c task=3: embed"]);
    assert.equal(fake.requests.length, 5);
  });

  it("counts each session as failed if statuses cannot be read", async () => {
    fake.replies.push(accepted(1), [200, { status: "succeeded" }], [500, { message: "down" }]);
    const result = await capture([docs("a", "1")], fake.target);
    assert.equal(result.code, 1);
    assert.deepEqual(result.err, ["failed a task=1: HTTP 500: down"]);
  });

  it("continues after connection errors", async () => {
    const closed = new FakeMeilisearch(); await closed.start();
    await new Promise<void>((done) => closed.server.close(() => done()));
    const result = await capture([docs("a", "1"), docs("b", "2")], closed.target);
    assert.equal(result.code, 1); assert.equal(result.err.length, 2);
    assert.match(result.err[0], /^failed a: Meilisearch に接続できない/);
  });

  it("reads PI_CODING_AGENT_DIR like Pi", () => {
    assert.equal(sessionsRoot({}), join(homedir(), ".pi", "agent", "sessions"));
    assert.equal(sessionsRoot({ PI_CODING_AGENT_DIR: "~/other" }), join(homedir(), "other", "sessions"));
    if (process.platform === "win32") {
      assert.equal(sessionsRoot({ PI_CODING_AGENT_DIR: "/c/Users/x/agent" }, true), "C:\\Users\\x\\agent\\sessions");
      assert.equal(sessionsRoot({ PI_CODING_AGENT_DIR: "file:///D:/agent" }, true), "D:\\agent\\sessions");
    }
  });

  it("runs with default discovery and arbitrary explicit file", async (context) => {
    const work = join(tmpdir(), "pi"); mkdirSync(work, { recursive: true });
    const dir = mkdtempSync(join(work, "session-index-cli-"));
    context.after(() => rmSync(dir, { recursive: true, force: true }));
    const normal = join(dir, "sessions", "work", "s.jsonl"), other = join(dir, "elsewhere", "x.jsonl");
    writeSession(normal); writeSession(other);
    assert.equal([...batches([other], join(dir, "missing"))][0].kind, "documents");
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const command = (args: string[]) => new Promise<{code: number | null; out: string}>((done) => {
      const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, PI_CODING_AGENT_DIR: dir, MEILISEARCH_URL: fake.target.url } });
      let out = ""; child.stdout.on("data", (chunk) => out += chunk); child.on("close", (code) => done({ code, out }));
    });
    for (const args of [[], [other]]) {
      fake.replies.push(accepted(1), [200, { status: "succeeded" }], statuses({ uid: 1, status: "succeeded" }));
      const result = await command(args);
      assert.equal(result.code, 0); assert.equal(JSON.parse(result.out.trim().split("\n").at(-1)!).documents, 1);
    }
    assert.equal(fake.requests.filter((r) => r.method === "POST").length, 2);
  });
});

describe("meilisearch requests", () => {
  it("throws the caller's abort reason", async () => {
    const hang = createServer(() => {}); await new Promise<void>((done) => hang.listen(0, "127.0.0.1", done));
    const controller = new AbortController(), reason = new Error("stop");
    setTimeout(() => controller.abort(reason), 50);
    try { await assert.rejects(waitTask({ url: "http://127.0.0.1:" + (hang.address() as { port: number }).port, index: "x" }, 1, controller.signal), (error) => error === reason); }
    finally { hang.closeAllConnections(); hang.close(); }
  });
});
