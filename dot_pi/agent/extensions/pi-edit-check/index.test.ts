// pi-edit-check の試験。ソースのフォルダで node --test index.test.ts を実行する。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import editCheck, { defaultChecks, EDITORCONFIG_CHECKER } from "./index.ts";
import { loadChecks } from "./checks.ts";

const bundled = existsSync(EDITORCONFIG_CHECKER);
const checker = bundled ? EDITORCONFIG_CHECKER : join(homedir(), ".pi", "agent", "extensions", "pi-edit-check", "node_modules", "editorconfig-checker", "dist", "index.js");
if (!existsSync(checker)) throw new Error("editorconfig-checker が見つからない: " + checker);
/** 既定の editorconfig の検査（ソースのフォルダでは、コマンドだけを置き換えたもの）。 */
const DEFAULT_EDITORCONFIG = bundled ? {} : { command: [process.execPath, checker, "-fix", "-no-color"] };

const work = join(tmpdir(), "pi");
mkdirSync(work, { recursive: true });
const base = mkdtempSync(join(work, "edit-check-"));
after(() => rmSync(base, { recursive: true, force: true }));

const EDITORCONFIG = [
  "root = true",
  "[*]",
  "end_of_line = lf",
  "insert_final_newline = true",
  "trim_trailing_whitespace = true",
  "indent_style = space",
  "indent_size = 2",
  "charset = utf-8",
  "",
].join("\n");

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(base, prefix));
}

function initRepo(dir: string) {
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "config", "commit.gpgsign", "false");
  // 利用者のグローバルの除外設定に左右されないようにする
  writeFileSync(join(dir, ".git", "no-excludes"), "");
  git(dir, "config", "core.excludesFile", join(dir, ".git", "no-excludes"));
}

function repo(files: Record<string, string> = {}): string {
  const dir = tempDir("r-");
  initRepo(dir);
  write(dir, ".editorconfig", EDITORCONFIG);
  for (const [name, text] of Object.entries(files)) write(dir, name, text);
  git(dir, "add", "--", ".editorconfig", ...Object.keys(files));
  git(dir, "commit", "-qm", "init");
  return dir;
}

function write(dir: string, name: string, text: string | Buffer) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

type Handler = (event: any, ctx: any) => any;

function harness(cwd: string, settings?: unknown) {
  const handlers = new Map<string, Handler[]>();
  const status: (string | undefined)[] = [];
  const current = settings ?? (bundled ? {} : { editCheck: { checks: { editorconfig: DEFAULT_EDITORCONFIG } } });
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    getSettings: () => structuredClone(current),
  };
  editCheck(pi as any);
  const ctx = { cwd, hasUI: true, ui: { setStatus: (_key: string, text: string | undefined) => status.push(text) } };
  const emit = async (name: string, event: any) => {
    let result: any;
    for (const handler of handlers.get(name) ?? []) result = (await handler(event, ctx)) ?? result;
    return result;
  };
  return {
    status,
    prompt: () => emit("before_agent_start", { type: "before_agent_start" }),
    settle: (options: { entries?: any[]; proposed?: boolean; outcome?: string } = {}) =>
      emit("agent_before_settle", {
        type: "agent_before_settle",
        entries: options.entries ?? [],
        continue: options.proposed ?? false,
        outcome: options.outcome ?? "completed",
      }),
    last: () => status.at(-1),
    shutdown: () => emit("session_shutdown", { type: "session_shutdown" }),
    /** 処理や検査の失敗が状態表示に出ていないこと。 */
    noFailure() {
      assert.ok(!status.some((text) => /失敗|見つからない|不正|時間切れ|中断/.test(text ?? "")), String(status.at(-1)));
    },
  };
}

const text = (result: any) => String(result?.entries?.at(-1)?.content ?? "");

test("利用1: 直せる違反は整形して記録し、続きは頼まない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "a.txt", "hello  \r\nworld");
  const result = await h.settle();
  assert.equal(read(dir, "a.txt"), "hello\nworld\n");
  assert.equal(result.continue, undefined);
  assert.match(text(result), /整形した/);
  assert.match(text(result), /editorconfig（[^）]+）:\n  - a\.txt/);
  assert.equal(result.entries.at(-1).type, "custom_message");
  assert.equal(h.last(), undefined);
});

test("利用2: 直らない問題は事実だけを1回知らせ、残れば状態表示にとどめる", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "tab.txt", "\tx\n");
  const first = await h.settle();
  assert.equal(first.continue, true);
  assert.match(text(first), /0 以外の終了コードで終わった/);
  assert.equal(first.entries.at(-1).type, "custom_message");
  assert.match(text(first), /tab\.txt:\s+1: wrong indent style/);
  assert.doesNotMatch(text(first), /直して|直すこと/);
  assert.match(String(h.last()), /問題が残った（editorconfig）/);
  // 続きで直さずに終わる
  assert.equal(await h.settle(), undefined);
  assert.match(String(h.last()), /問題が残った（editorconfig）/);
});

test("利用2b, 2c: 続きで直せば状態表示が消え、別のファイルだけ通っても残った問題は消えない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "m.txt", "\tm\n");
  write(dir, "n.txt", "\tn\n");
  assert.equal((await h.settle()).continue, true);
  write(dir, "m.txt", "  m\n");
  assert.equal(await h.settle(), undefined);
  assert.match(String(h.last()), /問題が残った（editorconfig）/);
  write(dir, "n.txt", "  n\n");
  await h.settle();
  assert.equal(h.last(), undefined);
});

test("利用3: 作業前からの違反や変更は、触らなければ渡さない", async () => {
  const dir = repo({ "old.txt": "\told\n", "pre.txt": "pre\n" });
  write(dir, "pre.txt", "\tpre\n");
  const h = harness(dir);
  await h.prompt();
  write(dir, "new.txt", "new\n");
  assert.equal(await h.settle(), undefined);
  h.noFailure();
  await h.prompt();
  write(dir, "pre.txt", "\tpre changed\n");
  const result = await h.settle();
  assert.match(text(result), /pre\.txt/);
  assert.doesNotMatch(text(result), /old\.txt/);
});

test("利用4: 変更の無い追跡済みファイルの編集は渡し、HEAD と同じ内容への書き戻しは渡さない", async () => {
  const dir = repo({ "tracked.txt": "t\n", "back.txt": "\tb\n" });
  write(dir, "back.txt", "b2\n");
  const h = harness(dir);
  await h.prompt();
  write(dir, "tracked.txt", "\tt\n");
  write(dir, "back.txt", "\tb\n");
  const result = await h.settle();
  assert.match(text(result), /tracked\.txt/);
  // HEAD にある内容（前からの違反）なので、編集したものとして扱わない
  assert.doesNotMatch(text(result), /back\.txt/);
});

test("利用5: .gitattributes ではなく .editorconfig で改行を決める", async () => {
  const dir = repo({ ".gitattributes": "* text eol=crlf\n" });
  const h = harness(dir);
  await h.prompt();
  write(dir, "b.txt", "x\r\n");
  await h.settle();
  assert.equal(read(dir, "b.txt"), "x\n");
});

test("変更1, 2: 検査を足す・既定を外しても足した検査は動く", async () => {
  const dir = repo({ "lint.mjs": "import { readFileSync } from 'node:fs';\nlet bad = 0;\nfor (const f of process.argv.slice(2)) if (readFileSync(f, 'utf8').includes('BAD')) { console.log(f + ': BAD'); bad = 1; }\nprocess.exit(bad);\n" });
  const lint = { command: [process.execPath, "lint.mjs"] };
  const both = harness(dir, { editCheck: { checks: { editorconfig: DEFAULT_EDITORCONFIG, lint } } });
  await both.prompt();
  write(dir, "c.txt", "\tBAD\n");
  const result = await both.settle();
  assert.match(text(result), /## editorconfig/);
  assert.match(text(result), /## lint/);
  const only = harness(dir, { editCheck: { checks: { editorconfig: null, lint } } });
  await only.prompt();
  write(dir, "d.txt", "\tBAD\n");
  const onlyResult = await only.settle();
  assert.match(text(onlyResult), /## lint/);
  assert.doesNotMatch(text(onlyResult), /## editorconfig/);
});

test("変更3: .editorconfig で外したファイルは整形も違反もしない", async () => {
  const dir = repo({ "keep/.editorconfig": "[raw.txt]\nend_of_line = unset\ninsert_final_newline = unset\ntrim_trailing_whitespace = unset\nindent_style = unset\nindent_size = unset\ncharset = unset\n" });
  const h = harness(dir);
  await h.prompt();
  write(dir, "keep/raw.txt", "\ta  \r\nb");
  write(dir, "keep/other.txt", "o\r\n");
  const result = await h.settle();
  assert.equal(read(dir, "keep/raw.txt"), "\ta  \r\nb");
  assert.doesNotMatch(text(result), /raw\.txt/);
  assert.equal(read(dir, "keep/other.txt"), "o\n");
  h.noFailure();
});

test("動作1: 中断した編集とプロンプト間の人の編集は次の検査に渡さない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "aborted.txt", "\ta  \r\n");
  // agent_before_settle を通らず中断し、人が書く
  write(dir, "human.txt", "\thuman  \r\n");
  await h.prompt();
  write(dir, "new.txt", "\tnew\n");
  const result = await h.settle();
  assert.match(text(result), /new\.txt/);
  assert.doesNotMatch(text(result), /aborted\.txt|human\.txt/);
  assert.equal(read(dir, "aborted.txt"), "\ta  \r\n");
  assert.equal(read(dir, "human.txt"), "\thuman  \r\n");
});

test("動作2: 先の拡張が続きを頼んだときは次に回し、他の拡張の entries は消さない", async () => {
  const dir = repo();
  const h = harness(dir);
  const other = { type: "custom", customType: "other" };
  await h.prompt();
  write(dir, "l.txt", "l  \n");
  assert.equal(await h.settle({ entries: [other], proposed: true }), undefined);
  assert.equal(read(dir, "l.txt"), "l  \n");
  const result = await h.settle({ entries: [other] });
  assert.deepEqual(result.entries[0], other);
  assert.equal(result.entries.length, 2);
  assert.equal(result.continue, undefined);
  assert.equal(read(dir, "l.txt"), "l\n");
});

test("動作4: 新しいプロンプトでは、新しい問題をまた1回知らせる", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "j.txt", "\tj\n");
  assert.equal((await h.settle()).continue, true);
  await h.prompt();
  write(dir, "k.txt", "\tk\n");
  assert.equal((await h.settle()).continue, true);
});

test("動作5: git の外では何もしない", async () => {
  const outside = tempDir("o-");
  const h = harness(outside);
  await h.prompt();
  write(outside, "i.txt", "\ti\n");
  assert.equal(await h.settle(), undefined);
  h.noFailure();
});

test("動作6, 8: 「-」や「..」で始まる名前もファイルとして検査する", async () => {
  const dir = repo({ "other.txt": "o\n" });
  write(dir, "other.txt", "o\r\n");
  const h = harness(dir);
  await h.prompt();
  write(dir, "-fix", "x\r\n");
  write(dir, "..hidden", "y\r\n");
  await h.settle();
  assert.equal(read(dir, "-fix"), "x\n");
  assert.equal(read(dir, "..hidden"), "y\n");
  assert.equal(read(dir, "other.txt"), "o\r\n");
});

test("動作7: リンクと、親フォルダのリンクをたどると外にあるファイルは渡さない", async (t) => {
  const dir = repo();
  const outside = tempDir("o-");
  write(outside, "secret.txt", "\tsecret\r\n");
  try {
    symlinkSync(join(outside, "secret.txt"), join(outside, "probe.txt"), "file");
  } catch (error) {
    t.skip("シンボリックリンクを作れない: " + String(error));
    return;
  }
  const h = harness(dir);
  await h.prompt();
  symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"), "file");
  write(dir, "sub/victim.txt", "inside\r\n");
  rmSync(join(dir, "sub"), { recursive: true });
  symlinkSync(outside, join(dir, "sub"), "junction");
  assert.equal(await h.settle(), undefined);
  assert.equal(read(outside, "secret.txt"), "\tsecret\r\n");
  h.noFailure();
});

test("動作9: UTF-8 でないファイルは問題として知らせる", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "sjis.txt", Buffer.from([0x82, 0xa0, 0x0a]));
  const result = await h.settle();
  assert.equal(result.continue, true);
  assert.match(text(result), /sjis\.txt:\s+wrong character encoding/);
});

test("動作10: 50 個を超えるファイルも、後の回に渡したファイルまで検査する", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  for (let i = 0; i < 55; i++) write(dir, `many/f${String(i).padStart(2, "0")}.txt`, "ok\n");
  write(dir, "many/zz-last.txt", "\tlast\r\n");
  const result = await h.settle();
  assert.match(text(result), /many\/zz-last\.txt:/);
  assert.equal(read(dir, "many/zz-last.txt"), "\tlast\n");
});

test("動作13: 検査の後、次のプロンプトの前に書かれたファイルは渡さない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "mine.txt", "mine\n");
  await h.settle();
  write(dir, "between.txt", "\tbetween\n");
  await h.prompt();
  write(dir, "mine.txt", "\tmine\n");
  const result = await h.settle();
  assert.match(text(result), /mine\.txt/);
  assert.doesNotMatch(text(result), /between\.txt/);
});

test("範囲1: 無視されたファイル、別のリポジトリ、サブモジュールの中は渡さない", async () => {
  const dir = repo({ ".gitignore": "ignored/\n" });
  const other = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "ignored/x.txt", "\tx\r\n");
  write(other, "y.txt", "\ty\r\n");
  // サブモジュールの代わりに入れ子のリポジトリ（git は中身を個別のファイルとして示さない）
  const nested = join(dir, "nested");
  mkdirSync(nested);
  initRepo(nested);
  write(nested, ".editorconfig", EDITORCONFIG);
  write(nested, "z.txt", "\tz\r\n");
  assert.equal(await h.settle(), undefined);
  assert.equal(read(dir, "ignored/x.txt"), "\tx\r\n");
  assert.equal(read(other, "y.txt"), "\ty\r\n");
  assert.equal(read(nested, "z.txt"), "\tz\r\n");
});

test("ifFound: 印のあるフォルダのファイルだけを渡す", async () => {
  const dir = repo({ "with/.marker": "" });
  const lint = { command: [process.execPath, "-e", "console.log(process.argv.slice(1).join(' ')); process.exit(1)"], ifFound: ".marker" };
  const h = harness(dir, { editCheck: { checks: { editorconfig: null, lint } } });
  await h.prompt();
  write(dir, "with/a.txt", "a\n");
  write(dir, "without/b.txt", "b\n");
  const result = await h.settle();
  assert.match(text(result), /渡したファイル:\n  - with\/a\.txt\n/);
  assert.doesNotMatch(text(result), /without/);
});

test("長い出力は省略した文字数を書く", async () => {
  const dir = repo();
  const lint = { command: [process.execPath, "-e", "console.log('x'.repeat(9000)); process.exit(1)"] };
  const h = harness(dir, { editCheck: { checks: { editorconfig: null, lint } } });
  await h.prompt();
  write(dir, "long.txt", "l\n");
  assert.match(text(await h.settle()), /出力の残り 1000 文字は省略した/);
});

test("既定の検査は .editorconfig がある場所でだけ動く", () => {
  assert.equal(defaultChecks().editorconfig.ifFound, ".editorconfig");
});

test("同じ回に渡した問題の無いファイルも、問題のあるファイルが直れば状態表示から外れる", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "bad.txt", "\tbad\n");
  write(dir, "good.txt", "good\n");
  await h.settle();
  assert.match(String(h.last()), /問題が残った/);
  write(dir, "bad.txt", "  bad\n");
  await h.settle();
  assert.equal(h.last(), undefined);
});

test("知らせた問題は、次のプロンプトでも同じものなら知らせ直さない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "same.txt", "\tsame\n");
  assert.equal((await h.settle()).continue, true);
  await h.prompt();
  write(dir, "ok.txt", "ok\n");
  assert.equal(await h.settle(), undefined);
  assert.equal(h.last(), undefined);
});

test("範囲1b: 作業中に無視されるようになったファイルと、サブモジュールの中は渡さない", async () => {
  const dir = repo();
  write(dir, "u.txt", "u\n");
  const inner = repo({ "s.txt": "s\n" });
  git(dir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", inner.split("\\").join("/"), "sub");
  git(dir, "commit", "-qm", "sub");
  const h = harness(dir);
  await h.prompt();
  write(dir, "u.txt", "\tu\r\n");
  write(dir, ".gitignore", "u.txt\n");
  write(dir, "sub/s.txt", "\ts\r\n");
  await h.settle();
  assert.equal(read(dir, "u.txt"), "\tu\r\n");
  assert.equal(read(dir, "sub/s.txt"), "\ts\r\n");
});

test("続きは同じプロンプトで1回だけ: 続きで新しい問題ができても、もう一度は頼まない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "first.txt", "\tfirst\n");
  assert.equal((await h.settle()).continue, true);
  write(dir, "second.txt", "\tsecond\n");
  const again = await h.settle();
  assert.equal(again?.continue, undefined);
  assert.match(String(h.last()), /問題が残った（editorconfig）/);
});

test("親の追跡ファイルでも、間に別のリポジトリがあれば渡さない", async () => {
  const dir = repo({ "nested/n.txt": "n\n" });
  const h = harness(dir);
  await h.prompt();
  initRepo(join(dir, "nested"));
  write(dir, "nested/n.txt", "n2\r\n");
  await h.settle();
  assert.equal(read(dir, "nested/n.txt"), "n2\r\n");
});

test("問題の残ったファイルを消したら、状態表示から外す", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "gone.txt", "\tgone\n");
  await h.settle();
  assert.match(String(h.last()), /問題が残った/);
  rmSync(join(dir, "gone.txt"));
  await h.settle();
  assert.equal(h.last(), undefined);
});

test("起動できない検査は状態に出し、次の回へファイルを持ち越さない", async () => {
  const dir = repo();
  const settings: any = { editCheck: { checks: { editorconfig: null, eslint: { command: [join(dir, "no-such-checker.exe")] } } } };
  const h = harness(dir, settings);
  await h.prompt();
  write(dir, "e.txt", "e\n");
  assert.equal(await h.settle(), undefined);
  assert.match(String(h.last()), /eslint: .*no-such-checker/);
  settings.editCheck.checks.eslint = { command: [process.execPath, "-e", "process.exit(1)"] };
  assert.equal(await h.settle(), undefined);
  assert.equal(h.last(), undefined);
});

test("前の問題ファイルをプロンプト間に人が編集しても検査しない", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "c.md", "\tbad\n");
  assert.equal((await h.settle()).continue, true);
  write(dir, "c.md", "human  \r\n");
  await h.prompt();
  assert.equal(await h.settle(), undefined);
  assert.equal(read(dir, "c.md"), "human  \r\n");
  assert.equal(h.last(), undefined);
});

test("既定の検査への浅い上書き、null、無効な command", async () => {
  const dir = repo();
  const settings = {
    editCheck: {
      checks: {
        editorconfig: { command: [process.execPath, "-e", "process.exit(1)"] },
        invalid: { command: [] },
        disabled: null,
      }
    }
  };
  const h = harness(dir, settings);
  await h.prompt();
  write(dir, "x.txt", "x\n");
  const result = await h.settle();
  assert.match(text(result), /## editorconfig/);
  assert.doesNotMatch(String(h.last()), /invalid|disabled|不正/);
});

test("浅い上書きは既定の ifFound を保持する", () => {
  const checks = loadChecks({ editCheck: { checks: { editorconfig: { command: ["other"] } } } }, defaultChecks());
  assert.equal(checks[0].ifFound, ".editorconfig");
  assert.deepEqual(checks[0].command, ["other"]);
});

test("知らせたファイルが HEAD に戻ったら再検査しない", async () => {
  const dir = repo({ "tracked.txt": "original\n" });
  const settings = { editCheck: { checks: { editorconfig: null, lint: { command: [process.execPath, "-e", "process.exit(1)"] } } } };
  const h = harness(dir, settings);
  await h.prompt();
  write(dir, "tracked.txt", "changed\n");
  assert.equal((await h.settle()).continue, true);
  write(dir, "tracked.txt", "original\n");
  assert.equal(await h.settle(), undefined);
  assert.equal(h.last(), undefined);
});

test("内側の別リポジトリを指すジャンクション経由の追跡ファイルは渡さない", async () => {
  const dir = repo({ "alias/a.txt": "old\n" });
  const inner = join(dir, "inner");
  mkdirSync(inner);
  initRepo(inner);
  write(inner, "a.txt", "inner\r\n");
  const h = harness(dir);
  await h.prompt();
  rmSync(join(dir, "alias"), { recursive: true });
  symlinkSync(inner, join(dir, "alias"), "junction");
  assert.match(git(dir, "status", "--porcelain", "--untracked-files=all"), /alias\/a\.txt/);
  await h.settle();
  assert.equal(read(inner, "a.txt"), "inner\r\n");
});

test("リポジトリ外へのジャンクションの先を検査しない", async () => {
  const dir = repo({ "portal/secret.txt": "old\n" });
  const outside = tempDir("outside-");
  write(outside, "secret.txt", "secret\r\n");
  const h = harness(dir);
  await h.prompt();
  rmSync(join(dir, "portal"), { recursive: true });
  symlinkSync(outside, join(dir, "portal"), "junction");
  assert.match(git(dir, "status", "--porcelain", "--untracked-files=all"), /portal\/secret\.txt/);
  await h.settle();
  assert.equal(read(outside, "secret.txt"), "secret\r\n");
});


test("続きで無視・コミット・削除された問題ファイルを再検査しない", async () => {
  const dir = repo();
  const lint = { command: [process.execPath, "-e", "process.exit(1)"] };
  const h = harness(dir, { editCheck: { checks: { editorconfig: null, lint } } });
  await h.prompt();
  for (const name of ["ignored.txt", "committed.txt", "deleted.txt"]) write(dir, name, "bad\n");
  assert.equal((await h.settle()).continue, true);
  write(dir, ".gitignore", "ignored.txt\n");
  git(dir, "add", "--", ".gitignore", "committed.txt");
  git(dir, "commit", "-qm", "save");
  rmSync(join(dir, "deleted.txt"));
  assert.equal(await h.settle(), undefined);
  assert.equal(h.last(), undefined);
});

test("開始時に git を起動できなければ理由を表示する", async () => {
  const dir = repo();
  const h = harness(dir);
  const path = process.env.PATH;
  try {
    process.env.PATH = "";
    await h.prompt();
    assert.match(String(h.last()), /git を動かせない: .*ENOENT/i);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
  }
});

test("開始時の git status の失敗を理由とともに表示する", async () => {
  const dir = repo();
  writeFileSync(join(dir, ".git", "index"), "broken");
  const h = harness(dir);
  await h.prompt();
  assert.match(String(h.last()), /git を動かせない: .*index/i);
  assert.equal(await h.settle(), undefined);
});

test("検査前の git status の失敗を理由とともに表示する", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "a.txt", "a\n");
  writeFileSync(join(dir, ".git", "index"), "broken");
  assert.equal(await h.settle(), undefined);
  assert.match(String(h.last()), /git を動かせない: .*index/i);
});

test("検査後の git status が失敗しても整形と問題を知らせる", async () => {
  const dir = repo();
  const script = "const fs = require('node:fs'); fs.writeFileSync(process.argv[1], 'fixed\\n'); fs.writeFileSync('.git/index', 'broken'); console.log('lint problem'); process.exit(1)";
  const h = harness(dir, { editCheck: { checks: { editorconfig: null, lint: { command: [process.execPath, "-e", script] } } } });
  await h.prompt();
  write(dir, "a.txt", "before\n");
  const result = await h.settle();
  assert.equal(result.continue, true);
  assert.match(text(result), /整形した/);
  assert.match(text(result), /lint problem/);
  assert.equal(read(dir, "a.txt"), "fixed\n");
  assert.match(String(h.last()), /git を動かせない: .*index/i);
  assert.match(String(h.last()), /問題が残った（lint）/);
});

test("セッション終了時に状態表示を消す", async () => {
  const dir = repo();
  const h = harness(dir);
  await h.prompt();
  write(dir, "bad.txt", "\tbad\n");
  await h.settle();
  assert.match(String(h.last()), /問題が残った/);
  await h.shutdown();
  assert.equal(h.last(), undefined);
});
