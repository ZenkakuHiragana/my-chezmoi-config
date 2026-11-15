// pi-fix-git-bash の試験。Windows の Git Bash でだけ動く。
// 実行: node --test dot_pi/agent/extensions/pi-fix-git-bash.test.ts
// Pi の部品は Pi の管理された配置（~/.pi/agent/install/）から読む。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const windows = process.platform === "win32";
const install = join(homedir(), ".pi", "agent", "install");
const modules = join(install, "releases", readFileSync(join(install, "current-version"), "utf8").trim(), "node_modules");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")).href);
const jiti = createJiti(import.meta.url, {
  alias: { "@earendil-works/pi-coding-agent": join(modules, "@earendil-works/pi-coding-agent/dist/index.js") },
  interopDefault: true,
});
const api = await jiti.import("@earendil-works/pi-coding-agent");
const extension = await jiti.import(join(import.meta.dirname, "pi-fix-git-bash.ts"));

let tool: any;
extension.default({ registerTool: (definition: any) => (tool = definition), getSettings: () => ({ shellCommandPrefix: "export PI_FIX_TEST_PREFIX=prefix-ok" }) });
mkdirSync(join(tmpdir(), "pi"), { recursive: true });
const work = mkdtempSync(join(tmpdir(), "pi", "pi-fix-git-bash-test-"));
const ctx = { cwd: work, sessionManager: { getSessionId: () => "s", getSessionFile: () => undefined }, model: undefined };
const shell = windows ? api.getShellConfig().shell : "";
const posix = (path: string) => path.split(String.fromCharCode(92)).join("/");

async function run(command: string, options: { timeout?: number; signal?: AbortSignal; onUpdate?: (update: any) => void } = {}) {
  try {
    const result = await tool.execute("id", { command, timeout: options.timeout }, options.signal, (update: any) => options.onUpdate?.(update), ctx);
    return { ok: true, text: result.content.map((part: any) => part.text).join("") };
  } catch (error) {
    return { ok: false, text: String((error as Error).message) };
  }
}

/** 秒数を一意にした sleep を、自分が起動したものとして数える。 */
const uniqueSeconds = () => "30." + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
function left(seconds: string): number {
  const result = spawnSync(shell, ["-c", 'grep -l "' + seconds.replace(".", "[.]") + '" /proc/[0-9]*/cmdline 2>/dev/null | wc -l'], { encoding: "utf8" });
  spawnSync(shell, ["-c", 'for f in $(grep -l "' + seconds.replace(".", "[.]") + '" /proc/[0-9]*/cmdline 2>/dev/null); do p=${f#/proc/}; kill -9 ${p%/cmdline} 2>/dev/null; done; true']);
  return Number(result.stdout.trim());
}

test("8K を超えるコマンドがそのまま届き、後のコマンドも動く", { skip: !windows }, async () => {
  const body = Array.from({ length: 400 }, (_, i) => "row " + String(i).padStart(3, "0") + " " + "y".repeat(40)).join("\n");
  const file = posix(join(work, "long.txt"));
  const result = await run("cat > '" + file + "' <<'EOF'\n" + body + "\nEOF\necho after");
  assert.equal(result.text.trim(), "after");
  assert.equal(readFileSync(join(work, "long.txt"), "utf8"), body + "\n");
});

test("バックスラッシュの連続がそのまま届く", { skip: !windows }, async () => {
  const backslash = String.fromCharCode(92);
  const words = [1, 2, 3, 4].map((n) => "a" + backslash.repeat(n) + "b");
  const result = await run("printf '%s|' " + words.map((word) => "'" + word + "'").join(" "));
  assert.equal(result.text.trim(), words.join("|") + "|");
});

test("組み込みと同じく、設定の前置きのコマンドが効く", { skip: !windows }, async () => {
  assert.equal((await run('echo "$PI_FIX_TEST_PREFIX"')).text.trim(), "prefix-ok");
});

test("コマンドの子に運び役の変数が渡らない", { skip: !windows }, async () => {
  assert.equal((await run("bash -c 'echo \"[$__pi_fix_git_bash_command]\"'")).text.trim(), "[]");
});

test("タイムアウトの後に、組み込みでは残るプロセスも残らない", { skip: !windows }, async () => {
  for (const template of ["sleep SLEEP; echo end", "bash -c 'sleep SLEEP; echo end'"]) {
    const seconds = uniqueSeconds();
    const result = await run(template.replace("SLEEP", seconds), { timeout: 2 });
    assert.ok(!result.ok && result.text.includes("timed out"), result.text);
    await new Promise((done) => setTimeout(done, 1500));
    assert.equal(left(seconds), 0, template);
  }
});

test("中断の後に、入れ子の bash の中のプロセスも残らない", { skip: !windows }, async () => {
  const leak = join(work, "leak.txt");
  const controller = new AbortController();
  const command = "bash -c '(sleep 4; echo leaked > " + posix(leak) + ") & echo started; sleep 8'";
  const result = await run(command, {
    signal: controller.signal,
    onUpdate: (update) => update.content?.some((part: any) => part.text?.includes("started")) && controller.abort(),
  });
  assert.ok(!result.ok && result.text.includes("aborted"), result.text);
  await new Promise((done) => setTimeout(done, 5500));
  assert.ok(!existsSync(leak));
});

test("止めた呼び出しの後始末は、並列の別の呼び出しを巻き込まない", { skip: !windows }, async () => {
  const [other, stopped] = await Promise.all([run("sleep 4; echo other-done"), run("sleep 30", { timeout: 1 })]);
  assert.ok(!stopped.ok && stopped.text.includes("timed out"), stopped.text);
  assert.equal(other.text.trim(), "other-done");
});

test("タイムアウトの後も出力し続けるコマンドを、期限で止める", { skip: !windows }, async () => {
  const started = Date.now();
  const result = await run("sh -c 'while :; do echo tick; sleep 0.05; done'", { timeout: 1 });
  assert.ok(!result.ok && result.text.includes("timed out"), result.text.slice(-200));
  assert.ok(Date.now() - started < 4000, "returned after " + (Date.now() - started) + " ms");
});

test("運び役と大文字小文字だけ違う環境変数があっても、コマンドが動く", { skip: !windows }, async () => {
  process.env.__PI_FIX_GIT_BASH_COMMAND = "echo wrong";
  try {
    assert.equal((await run("echo right")).text.trim(), "right");
  } finally {
    delete process.env.__PI_FIX_GIT_BASH_COMMAND;
  }
});
