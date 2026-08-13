// このテストは、リポジトリ上のソースを直接呼ぶ単体テストではない。
// chezmoiで展開された実行時の`index.ts`と`config.jsonc`を、Piの実際の拡張ローダーで読み込む。
// `loadExtensions()`による拡張の発見・読み込み・`tool_call`ハンドラ登録までを実経路で検証する。
//
// 検証では、ハンドラへ偽の`tool_call`イベントを直接渡す。これにより、実際のエージェント推論、
// Piセッションからのツール配送、判定対象のBash / PowerShell操作は開始しない。
// PowerShellの標準ASTを取得するための`pwsh` / `powershell`プロセスは起動するが、
// 検査対象のPowerShell本文は実行しない。Bashも`web-tree-sitter`で解析するだけで実行しない。
//
// 主に次を確認する。
// - 管理ソースと展開後`index.ts`、テンプレート出力と実行時`config.jsonc`の一致
// - `read` / `write`の直接判定、allow優先、外部書き込みの既定拒否、`ask`を返さない二値判定
// - BashのAST、既知ラッパー、`find -exec` / `-execdir`、`find -delete`、`xargs`、shell `-c`の再帰検査
// - Bashの固定リダイレクトのread / write / read-write分類と、ヒアドキュメント等を対象外にすること
// - `cd` / `Set-Location`後の相対パス、存在しないパス、Windowsパス、動的置換値の扱い
// - PowerShellの固定cmdlet集合、前置きオプション付き`-c` / `-Command`、標準AST縮退経路
// - 判定中に試験対象のファイルやディレクトリを作らないこと、試験用設定を最後に復元すること
//
// このため、実行前にchezmoiで対象拡張を展開し、Pi本体・解析依存・PowerShellを利用できる必要がある。
// リポジトリ内だけで完結する単体テストではなく、Pi拡張の実行時接続を含む安全な統合テストである。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const cwd = resolve(process.cwd());

function gitBashPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const match = normalized.match(/^([A-Za-z]):(\/.*)?$/);
  assert.ok(match, `Windows絶対パスが必要: ${value}`);
  return `/${match[1].toLowerCase()}${match[2] ?? "/"}`;
}
const extensionDir = join(homedir(), ".pi", "agent", "extensions", "pi-tool-filter");
const extensionPath = join(extensionDir, "index.ts");
const configPath = join(extensionDir, "config.jsonc");
const packagePath = join(extensionDir, "package.json");
const lockPath = join(extensionDir, "package-lock.json");
const loaderPath = join(
  homedir(),
  "AppData",
  "Roaming",
  "npm",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);

function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      result += char === "\n" ? "\n" : " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
    } else if (char === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
    } else {
      result += char;
    }
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

function readConfig(): any {
  return JSON.parse(stripJsonComments(readFileSync(configPath, "utf8")));
}

async function handlerFor(config: any, extensionEntryPath = extensionPath): Promise<any> {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const loaded = await loadExtensions([extensionEntryPath], cwd);
  assert.deepEqual(loaded.errors, [], "Pi拡張の読み込みに失敗");
  assert.equal(loaded.extensions.length, 1, "Pi拡張が1件読み込まれる");
  const handlers = loaded.extensions[0].handlers.get("tool_call") ?? [];
  assert.equal(handlers.length, 1, "tool_callハンドラが1件登録される");
  return handlers[0];
}

type FilterResult = { block?: boolean; ask?: boolean; reason?: string };
async function call(handler: any, toolName: string, input: any): Promise<FilterResult | undefined> {
  return handler(
    { type: "tool_call", toolCallId: `${toolName}-v24`, toolName, input },
    { cwd },
  ) as Promise<FilterResult | undefined>;
}

function allowed(result: FilterResult | undefined, label: string): void {
  assert.equal(result, undefined, `${label} は許可される`);
}

function blocked(result: FilterResult | undefined, label: string): void {
  assert.equal(result?.block, true, `${label} は拒否される`);
  assert.equal(result?.ask, undefined, `${label} は ask を返さない`);
  assert.equal(typeof result?.reason, "string", `${label} は拒否理由を返す`);
}

test("Piフィルターの解析依存は拡張自身から解決される", () => {
  const managedPackage = JSON.parse(readFileSync("dot_pi/agent/extensions/pi-tool-filter/package.json", "utf8"));
  const runtimePackage = JSON.parse(readFileSync(packagePath, "utf8"));
  const managedLock = readFileSync("dot_pi/agent/extensions/pi-tool-filter/package-lock.json", "utf8");
  const runtimeLock = readFileSync(lockPath, "utf8");
  assert.deepEqual(runtimePackage, managedPackage, "展開後package.jsonが管理ソースと一致する");
  assert.equal(runtimeLock, managedLock, "展開後package-lock.jsonが管理ソースと一致する");
  assert.equal(managedPackage.dependencies["tree-sitter-bash"], "0.25.1", "tree-sitter-bashを拡張自身が宣言する");
  assert.equal(managedPackage.dependencies["web-tree-sitter"], "0.26.12", "web-tree-sitterを拡張自身が宣言する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "web-tree-sitter")), "拡張自身のweb-tree-sitter依存が存在する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-bash")), "拡張自身のtree-sitter-bash依存が存在する");
  assert.equal(readFileSync("dot_pi/agent/extensions/pi-tool-filter/index.ts", "utf8").includes("@gotgenes/pi-permission-system"), false, "別拡張を依存解決の起点にしない");
});

test("Piフィルターの解析依存なし縮退経路", async () => {
  const originalConfig = readFileSync(configPath, "utf8");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "pi-tool-filter-degraded-"));
  const temporaryExtensionPath = join(temporaryDirectory, "index.ts");
  const outside = join(homedir(), "pi-tool-filter-degraded-never-created.txt");
  const outsideShell = outside.replaceAll("\\", "/");
  copyFileSync(extensionPath, temporaryExtensionPath);

  try {
    const handler = await handlerFor(readConfig(), temporaryExtensionPath);
    assert.equal(
      existsSync(join(temporaryDirectory, "node_modules")),
      false,
      "依存なしの一時拡張へnode_modulesを作成しない",
    );
    blocked(await call(handler, "bash", { command: "git push" }), "解析依存なしの既存bash拒否Glob");
    allowed(await call(handler, "bash", { command: "printf safe" }), "解析依存なしの安全なbash");
    blocked(
      await call(handler, "bash", { command: `printf safe > ${outsideShell}` }),
      "解析依存なしの固定リダイレクトwrite",
    );
    allowed(
      await call(handler, "bash", { command: `cp README.md ${outsideShell}` }),
      "解析依存なしでは追加パス層を飛ばす",
    );
    assert.equal(existsSync(outside), false, "縮退判定中に外部試験対象を作成しない");
  } finally {
    writeFileSync(configPath, originalConfig);
    rmSync(temporaryDirectory, { recursive: true, force: true });
    assert.equal(readFileSync(configPath, "utf8"), originalConfig, "縮退試験の設定を復元できる");
  }
});

test("Piフィルター v24 のパス役割と実行前判定", async () => {
  assert.ok(existsSync(extensionPath), "展開後 index.ts が存在する");
  assert.ok(existsSync(configPath), "展開後 config.jsonc が存在する");

  const originalConfig = readFileSync(configPath, "utf8");
  const managedExtension = readFileSync("dot_pi/agent/extensions/pi-tool-filter/index.ts", "utf8");
  const runtimeExtension = readFileSync(extensionPath, "utf8");
  assert.equal(runtimeExtension, managedExtension, "展開後index.tsが管理ソースと一致する");
  const renderedConfig = execFileSync(
    "chezmoi",
    ["execute-template", "--file", "dot_pi/agent/extensions/pi-tool-filter/config.jsonc.tmpl"],
    { cwd, encoding: "utf8" },
  );
  assert.equal(renderedConfig, originalConfig, "展開後config.jsoncがテンプレート出力と一致する");
  const baseConfig = readConfig();
  const outside = join(homedir(), "pi-tool-filter-v24-never-created.txt");
  const outsideDirectory = join(homedir(), "pi-tool-filter-v24-directory-never-created");
  const outsideShell = outside.replaceAll("\\", "/");
  const gitBashInside = gitBashPath(join(cwd, "README.md"));
  const gitBashOutside = gitBashPath(outside);
  assert.equal(existsSync(outside), false, "試験対象ファイルが事前に存在しない");
  assert.equal(existsSync(outsideDirectory), false, "試験対象ディレクトリが事前に存在しない");

  try {
    let handler = await handlerFor(structuredClone(baseConfig));

    for (const toolName of ["read", "find", "grep", "ls"]) {
      blocked(
        await call(handler, toolName, { path: "~/.bashrc" }),
        `${toolName} の資格情報read`,
      );
    }
    blocked(await call(handler, "edit", { path: outside }), "外部edit");
    blocked(await call(handler, "write", { path: outside }), "外部write");
    allowed(await call(handler, "read", { path: gitBashInside }), "Git Bash形式の作業ディレクトリ内read");
    allowed(await call(handler, "write", { path: gitBashInside }), "Git Bash形式の作業ディレクトリ内write");
    blocked(await call(handler, "write", { path: gitBashOutside }), "Git Bash形式の外部write");
    allowed(
      await call(handler, "bash", { command: `touch ${gitBashInside}` }),
      "Git Bash形式のBash作業ディレクトリ内write",
    );
    blocked(
      await call(handler, "bash", { command: `touch ${gitBashOutside}` }),
      "Git Bash形式のBash外部write",
    );

    blocked(await call(handler, "bash", { command: "cat ~/.bashrc" }), "bash read path");
    blocked(await call(handler, "bash", { command: 'cat "C:\\Users\\nanashi\\.ssh\\config"' }), "bash Windows read path");
    blocked(await call(handler, "bash", { command: "sudo -u nobody -- cat ~/.bashrc" }), "sudo wrapper read path");
    blocked(await call(handler, "bash", { command: "env FOO=bar -- touch /tmp/pi-tool-filter-v24-never-created" }), "env wrapper write path");
    blocked(await call(handler, "bash", { command: "nice -n 5 touch /tmp/pi-tool-filter-v24-never-created" }), "nice wrapper write path");
    blocked(await call(handler, "bash", { command: "ionice -c 3 touch /tmp/pi-tool-filter-v24-never-created" }), "ionice wrapper write path");
    blocked(await call(handler, "bash", { command: "exec touch /tmp/pi-tool-filter-v24-never-created" }), "exec wrapper write path");
    blocked(await call(handler, "bash", { command: "builtin touch /tmp/pi-tool-filter-v24-never-created" }), "builtin wrapper write path");
    blocked(await call(handler, "bash", { command: "find . -exec touch /tmp/pi-tool-filter-v24-never-created \\;" }), "find exec write path");
    blocked(await call(handler, "bash", { command: "find . -execdir touch /tmp/pi-tool-filter-v24-never-created \\;" }), "find execdir write path");
    blocked(await call(handler, "bash", { command: "find . -exec printf safe \\; -exec touch /tmp/pi-tool-filter-v24-never-created \\;" }), "find multiple exec write path");
    blocked(await call(handler, "bash", { command: "find -L ~/.bashrc" }), "find option read path");
    const pathOnlyConfig = structuredClone(baseConfig);
    pathOnlyConfig.bash.deny = [];
    handler = await handlerFor(pathOnlyConfig);
    blocked(await call(handler, "bash", { command: "find -L ~/.bashrc" }), "find option read path without bash deny");
    blocked(await call(handler, "bash", { command: `find ${outsideShell} -delete` }), "find delete external write path");
    allowed(await call(handler, "bash", { command: "find . -delete" }), "find delete worktree path");
    for (const operator of [">", ">>", "1>", "2>", "&>", "&>>", ">|"]) {
      blocked(
        await call(handler, "bash", { command: `printf safe ${operator} ${outsideShell}` }),
        `redirect ${operator} write path`,
      );
    }
    blocked(await call(handler, "bash", { command: "cat < ~/.bashrc" }), "redirect read path");
    blocked(await call(handler, "bash", { command: "cat <> ~/.bashrc" }), "redirect read-write credential path");
    allowed(await call(handler, "bash", { command: "printf safe 2>&1" }), "file descriptor redirect");
    allowed(await call(handler, "bash", { command: "cat <<EOF\nsafe\nEOF" }), "heredoc redirect");
    allowed(await call(handler, "bash", { command: "cat <<< safe" }), "herestring redirect");
    allowed(await call(handler, "bash", { command: "cat <(printf safe)" }), "process substitution");
    blocked(await call(handler, "bash", { command: "xargs -0 -n 1 -- touch /tmp/pi-tool-filter-v24-never-created" }), "xargs write path");
    blocked(await call(handler, "bash", { command: `cp README.md ${outsideShell}` }), "cp destination write path");
    blocked(await call(handler, "bash", { command: `mv ${outsideShell} README.md` }), "mv source write path");
    blocked(await call(handler, "bash", { command: `cd ${outsideShell} && touch relative-never-created` }), "cd後の相対write");
    blocked(await call(handler, "bash", { command: `cd ${outsideShell} && printf safe > relative-never-created` }), "cd後の相対redirect write");
    blocked(await call(handler, "bash", { command: `find . -exec sh -c 'touch /tmp/pi-tool-filter-v24-never-created' sh {} \\;` }), "find exec shell body");

    for (const executable of ["powershell", "powershell.exe", "pwsh", "pwsh.exe"]) {
      for (const option of ["-c", "-Command"]) {
        const command = `${executable} -NoProfile -NonInteractive ${option} \"New-Item -ItemType Directory -Path /tmp/pi-tool-filter-v24-never-created\"`;
        blocked(await call(handler, "bash", { command }), `${executable} ${option} path`);
      }
    }
    blocked(await call(handler, "bash", { command: 'pwsh -Command "Get-Content \'~/.bashrc\'"' }), "PowerShell read cmdlet");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Set-Location '${outsideShell}'; New-Item relative-never-created"` }), "PowerShell相対write");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Set-Content '${outsideShell}' x"` }), "PowerShell write cmdlet");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Copy-Item README.md '${outsideShell}'"` }), "PowerShell copy cmdlet");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Move-Item '${outsideShell}' README.md"` }), "PowerShell move cmdlet");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Rename-Item '${outsideShell}' renamed"` }), "PowerShell rename cmdlet");
    blocked(await call(handler, "bash", { command: `pwsh -Command "Set-Acl '${outsideShell}' $acl"` }), "PowerShell ACL cmdlet");

    allowed(await call(handler, "bash", { command: "pwsh -NoProfile -NonInteractive -Command \"Write-Output safe\"" }), "PowerShell安全本文");
    allowed(await call(handler, "bash", { command: "printf safe" }), "bash安全本文");
    allowed(await call(handler, "bash", { command: "touch ..pi-tool-filter-v24-local-never-created" }), "ドット始まりの作業ディレクトリ内write");
    allowed(await call(handler, "bash", { command: "find . -exec touch /tmp/pi-tool-filter-v24-never-created/{} \\;" }), "find動的置換値");

    const denyPriorityConfig = structuredClone(baseConfig);
    denyPriorityConfig.write.outsideDefault = "allow";
    denyPriorityConfig.write.deny.push(outside);
    handler = await handlerFor(denyPriorityConfig);
    blocked(await call(handler, "write", { path: outside }), "write deny優先");
    allowed(await call(handler, "write", { path: join(homedir(), "pi-tool-filter-v24-unmatched-never-created.txt") }), "write未一致allow");

    const allowConfig = structuredClone(baseConfig);
    allowConfig.read.allow.push("~/.bashrc");
    allowConfig.write.allow.push(outside);
    allowConfig.bash.allow.push("exec touch *");
    handler = await handlerFor(allowConfig);
    allowed(await call(handler, "bash", { command: "cat ~/.bashrc" }), "bash read allow");
    allowed(await call(handler, "bash", { command: `touch ${outsideShell}` }), "bash write allow");
    allowed(await call(handler, "bash", { command: `cp README.md ${outsideShell}` }), "cp write allow");
    allowed(await call(handler, "bash", { command: `exec touch ${outsideShell}` }), "wrapper bash allow");
    allowed(await call(handler, "bash", { command: "pwsh -Command \\\"Get-Content '~/.bashrc'\\\"" }), "PowerShell read allow");
    allowed(await call(handler, "bash", { command: `pwsh -Command \"Set-Content '${outsideShell}' x\"` }), "PowerShell write allow");
    allowed(await call(handler, "bash", { command: "cat < ~/.bashrc" }), "redirect read allow");
    allowed(await call(handler, "bash", { command: `cat <> ${outsideShell}` }), "redirect read-write allow");
    allowed(await call(handler, "bash", { command: `printf safe > ${outsideShell}` }), "redirect write allow");
    allowed(await call(handler, "bash", { command: `find ${outsideShell} -delete` }), "find delete write allow");
    assert.equal(existsSync(outside), false, "拒否・判定中に外部試験対象を作成しない");
    assert.equal(existsSync(outsideDirectory), false, "拒否・判定中に外部試験対象ディレクトリを作成しない");

    const restoredConfig = readFileSync(configPath, "utf8");
    assert.equal(restoredConfig, JSON.stringify(allowConfig, null, 2) + "\n", "現在の試験設定を読み直せる");
  } finally {
    writeFileSync(configPath, originalConfig);
    assert.equal(readFileSync(configPath, "utf8"), originalConfig, "設定を元の内容へ復元できる");
  }
});
