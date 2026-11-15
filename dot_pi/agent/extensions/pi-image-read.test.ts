// pi-image-read の試験。パスの解決は Windows の Git Bash で確かめる。
// 実行: node --test dot_pi/agent/extensions/pi-image-read.test.ts
// Pi の部品は Pi の管理された配置（~/.pi/agent/install/）から読む。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const windows = process.platform === "win32";
const install = join(homedir(), ".pi", "agent", "install");
const modules = join(install, "releases", readFileSync(join(install, "current-version"), "utf8").trim(), "node_modules");
const { createJiti } = await import(pathToFileURL(join(modules, "jiti/lib/jiti.mjs")).href);
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": join(modules, "@earendil-works/pi-coding-agent/dist/index.js"),
    typebox: join(modules, "typebox/build/index.mjs"),
  },
  interopDefault: true,
});
const api = await jiti.import("@earendil-works/pi-coding-agent");
const extension = await jiti.import(join(import.meta.dirname, "pi-image-read.ts"));

function load(settings: object): any {
  let tool: any;
  extension.default({ registerTool: (definition: any) => (tool = definition), getSettings: () => settings });
  return tool;
}
const tool = load({});
mkdirSync(join(tmpdir(), "pi"), { recursive: true });
const work = mkdtempSync(join(tmpdir(), "pi", "pi-image-read-test-"));
mkdirSync(join(work, "sub"), { recursive: true });
const ctx = { cwd: work, sessionManager: { getSessionId: () => "s", getSessionFile: () => undefined }, model: undefined };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function read(path: string, use: any = tool) {
  try {
    const result = await use.execute("id", { path }, undefined, undefined, ctx);
    return { ok: true, image: result.content.some((part: any) => part.type === "image") };
  } catch (error) {
    return { ok: false, error: String((error as Error).message) };
  }
}

/** bash から見たパス。 */
function bashPath(file: string): string {
  return spawnSync(api.getShellConfig().shell, ["-c", '/usr/bin/cygpath -u "$1"', "_", file], { encoding: "utf8" }).stdout.trim();
}

test("bash の /tmp で書いた画像を読む", { skip: !windows }, async () => {
  writeFileSync(join(work, "a.png"), PNG);
  const path = bashPath(join(work, "a.png"));
  assert.ok(path.startsWith("/tmp/"), path);
  assert.deepEqual(await read(path), { ok: true, image: true });
});

test("~ は bash と同じく HOME を指す", { skip: !windows }, async () => {
  const home = join(work, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "h.png"), PNG);
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.deepEqual(await read("~/h.png"), { ok: true, image: true });
  } finally {
    if (saved === undefined) delete process.env.HOME;
    else process.env.HOME = saved;
  }
});

test("相対パスと、@ で始まる名前", async () => {
  writeFileSync(join(work, "sub", "r.png"), PNG);
  writeFileSync(join(work, "sub", "@at.png"), PNG);
  assert.deepEqual(await read("sub/r.png"), { ok: true, image: true });
  assert.deepEqual(await read("sub/@at.png"), { ok: true, image: true });
});

test("画像でないファイルと、無いファイルはエラー", async () => {
  writeFileSync(join(work, "text.png"), "Read image file [image/png]\n");
  const text = await read("text.png");
  assert.ok(!text.ok && text.error.includes("Not an image"), JSON.stringify(text));
  assert.equal((await read("missing.png")).ok, false);
});

test("末尾が空白のファイル名をそのまま開く", { skip: !windows }, async () => {
  const name = "nbsp" + String.fromCharCode(0xa0) + ".png";
  writeFileSync(join(work, name), PNG);
  assert.deepEqual(await read(name), { ok: true, image: true });
});

test("設定の前置きのコマンドが変えた HOME を、bash と同じく使う", { skip: !windows }, async () => {
  const home = join(work, "prefix-home");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "p.png"), PNG);
  const withPrefix = load({ shellCommandPrefix: "export HOME='" + bashPath(home) + "'" });
  assert.deepEqual(await read("~/p.png", withPrefix), { ok: true, image: true });
});
