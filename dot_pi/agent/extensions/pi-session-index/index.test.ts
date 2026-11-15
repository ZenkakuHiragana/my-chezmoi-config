// node --test index.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

const { default: sessionIndex } = await import("./index.ts");

type Handler = (event: unknown, ctx: unknown) => unknown;

/** 要求を記録し、文書の追加には連番のタスクで、タスクの照会には tasks の状態で答える。 */
class FakeMeilisearch {
  posts: unknown[] = [];
  postDelay = 0;
  postFailure = false;
  gets: number[] = [];
  tasks = new Map<number, string>();
  server: Server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      let body: unknown;
      if (request.method === "POST") {
        this.posts.push(JSON.parse(text));
        const uid = this.posts.length;
        this.tasks.set(uid, this.tasks.get(uid) ?? "succeeded");
        body = { taskUid: uid };
      } else {
        const uid = Number(request.url!.split("/").pop());
        this.gets.push(uid);
        const status = this.tasks.get(uid);
        body = status === "failed" ? { status, error: { message: "embedding failed" } } : { status };
      }
      const respond = () => response.writeHead(request.method === "POST" ? (this.postFailure ? 503 : 202) : 200, { "Content-Type": "application/json" }).end(JSON.stringify(request.method === "POST" && this.postFailure ? { message: "busy" } : body));
      if (request.method === "POST" && this.postDelay) setTimeout(respond, this.postDelay); else respond();
    });
  });
  url = "";
}

function writeSession(path: string, question: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    { type: "session", id: "s", cwd: "C:\\w" },
    { type: "message", id: "u", parentId: null, timestamp: "2026-11-13T00:00:00.000Z", message: { role: "user", content: question } },
    { type: "message", id: "a", parentId: "u", message: { role: "assistant", content: "答え" } },
  ].map((entry) => JSON.stringify(entry) + "\n").join(""));
}

const until = async (condition: () => boolean, what: string) => {
  for (let i = 0; i < 250 && !condition(); i++) await new Promise((done) => setTimeout(done, 20));
  assert.ok(condition(), what);
};

describe("extension", () => {
  const fake = new FakeMeilisearch();
  let agentDir: string;
  let session: string;
  let handlers: Record<string, Handler>;
  let statuses: (string | undefined)[];
  let ctx: unknown;
  const settle = (file = session) => {
    (ctx as { sessionManager: { getSessionFile: () => string } }).sessionManager.getSessionFile = () => file;
    return handlers.agent_settled({ aborted: false }, ctx);
  };

  before(async () => {
    await new Promise<void>((done) => fake.server.listen(0, "127.0.0.1", done));
    fake.url = "http://127.0.0.1:" + (fake.server.address() as { port: number }).port;
  });
  after(() => fake.server.close());

  beforeEach((context) => {
    const work = join(tmpdir(), "pi");
    mkdirSync(work, { recursive: true });
    agentDir = mkdtempSync(join(work, "session-index-ext-"));
    context.after(() => rmSync(agentDir, { recursive: true, force: true }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.MEILISEARCH_URL = fake.url;
    process.env.MEILISEARCH_INDEX = "conversations";
    session = join(agentDir, "sessions", "--C--w--", "s.jsonl");
    writeSession(session, "問い");
    fake.posts = [];
    fake.postDelay = 0;
    fake.postFailure = false;
    fake.gets = [];
    fake.tasks = new Map();
    handlers = {};
    statuses = [];
    ctx = { hasUI: true, ui: { setStatus: (_key: string, text?: string) => statuses.push(text) }, sessionManager: {} };
    sessionIndex({ on: (event: string, handler: Handler) => (handlers[event] = handler) } as never);
  });

  it("sends the current session without blocking and clears the status on success", async () => {
    assert.equal(settle(), undefined); // 待たずに戻る
    await until(() => statuses.length > 0, "status");
    assert.deepEqual(fake.posts, [[{
      id: "pi_s_u", source: "pi", conversation_id: "s", message_id: "u", question: "問い", reply: "答え",
      cwd: "C:\\w", source_path: realpathSync.native(session), timestamp: 1794528000000,
    }]]);
    assert.deepEqual(statuses, [undefined]);
  });

  it("sends sessions outside the default folder and ignores files not written yet", async () => {
    const other = join(agentDir, "elsewhere", "x.jsonl");
    writeSession(other, "依頼");
    settle(other);
    await until(() => statuses.length > 0, "status");
    settle(join(agentDir, "sessions", "missing.jsonl"));
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(fake.posts.length, 1);
    assert.deepEqual(statuses, [undefined]);
  });

  it("sends an update arriving just after a synchronous missing-file result", async () => {
    settle(join(agentDir, "missing.jsonl"));
    settle(session);
    await until(() => statuses.length > 0, "second update sent");
    assert.equal(fake.posts.length, 1);
    await handlers.session_shutdown({}, ctx);
  });

  it("shows failures in the status", async () => {
    fake.tasks.set(1, "failed");
    settle();
    await until(() => statuses.length > 0, "status");
    assert.deepEqual(statuses, ["索引: 失敗 embedding failed"]);
    process.env.MEILISEARCH_URL = "http://127.0.0.1:1";
    settle();
    await until(() => statuses.length > 1, "second status");
    assert.match(statuses[1]!, /^索引: 失敗 Meilisearch に接続できない/);
  });

  it("does not wait for a slow task before sending the next update", async () => {
    for (const uid of [1, 2, 3]) fake.tasks.set(uid, "processing");
    settle();
    await until(() => fake.posts.length === 1, "first post");
    writeSession(session, "新しい問い");
    settle();
    await until(() => fake.posts.length === 2, "second post");
    assert.equal((fake.posts[1] as { question: string }[])[0].question, "新しい問い");
    settle();
    await until(() => fake.posts.length === 3, "third post");
    fake.gets = [];
    // 1秒ごとの照会を少なくとも1回は観察する
    await until(() => fake.gets.length >= 2, "polls of the processing task");
    assert.deepEqual([...new Set(fake.gets)], [3]); // 最新のタスクに見張りを切り替える
    assert.deepEqual(statuses, []);
    // Meilisearch は受け付けた順に処理する。古いタスクの失敗は、新しいタスクの結果に代わられる
    fake.tasks.set(1, "failed");
    fake.tasks.set(2, "succeeded");
    fake.tasks.set(3, "succeeded");
    await until(() => statuses.length > 0, "status of the newer task");
    await new Promise((done) => setTimeout(done, 200));
    assert.deepEqual(statuses, [undefined]);
    await handlers.session_shutdown({}, ctx);
  });

  it("coalesces updates while posting, including during shutdown", async () => {
    fake.postDelay = 200;
    settle();
    await until(() => fake.posts.length === 1, "first post");
    writeSession(session, "二つ目"); settle();
    writeSession(session, "最新"); settle();
    await handlers.session_shutdown({}, ctx);
    assert.equal(fake.posts.length, 2);
    assert.equal((fake.posts[1] as { question: string }[])[0].question, "最新");
    assert.deepEqual(statuses, []);
  });

  it("does not let an older task overwrite a later POST failure", async () => {
    fake.tasks.set(1, "processing"); settle();
    await until(() => fake.gets.includes(1), "first task watched");
    fake.postFailure = true; settle();
    await until(() => statuses.length > 0, "post failure");
    assert.match(statuses[0]!, /HTTP 503: busy/);
    fake.tasks.set(1, "succeeded");
    await new Promise((done) => setTimeout(done, 1200));
    assert.equal(statuses.length, 1);
    await handlers.session_shutdown({}, ctx);
  });

  it("recovers on the next response after a connection failure", async () => {
    process.env.MEILISEARCH_URL = "http://127.0.0.1:1"; settle();
    await until(() => statuses.length === 1, "connection failure");
    process.env.MEILISEARCH_URL = fake.url; settle();
    await until(() => statuses.length === 2, "recovered");
    assert.match(statuses[0]!, /^索引: 失敗/);
    assert.equal(statuses[1], undefined);
    await handlers.session_shutdown({}, ctx);
  });

  it("limits the shutdown wait for an unfinished POST", async () => {
    fake.postDelay = 3500;
    settle(); await until(() => fake.posts.length === 1, "post started");
    const start = Date.now();
    await handlers.session_shutdown({}, ctx);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 2800 && elapsed < 3400, "shutdown bounded: " + elapsed);
    assert.deepEqual(statuses, []);
  });

  it("finishes sending at shutdown, then stops showing anything", async () => {
    settle();
    await handlers.session_shutdown({}, ctx);
    assert.equal(fake.posts.length, 1);
    await new Promise((done) => setTimeout(done, 1200));
    assert.deepEqual(statuses, []);
    settle();
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(fake.posts.length, 1);
  });
});
