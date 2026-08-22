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
// - Python / Node.jsのインライン本文（`-c` / `-e`）とheredoc本文の再帰検査、`python -m`、`-EncodedCommand`復号
// - Bashの固定リダイレクトのread / write / read-write分類と、heredoc本文の言語別検査（データ消費コマンドは対象外）
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
  assert.equal(managedPackage.dependencies["tree-sitter-python"], "0.25.0", "tree-sitter-pythonを拡張自身が宣言する");
  assert.equal(managedPackage.dependencies["tree-sitter-javascript"], "0.25.0", "tree-sitter-javascriptを拡張自身が宣言する");
  assert.equal(managedPackage.dependencies["web-tree-sitter"], "0.26.12", "web-tree-sitterを拡張自身が宣言する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "web-tree-sitter")), "拡張自身のweb-tree-sitter依存が存在する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-bash")), "拡張自身のtree-sitter-bash依存が存在する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-python")), "拡張自身のtree-sitter-python依存が存在する");
  assert.ok(existsSync(join(extensionDir, "node_modules", "tree-sitter-javascript")), "拡張自身のtree-sitter-javascript依存が存在する");
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

test("Piフィルター v25 のスクリプト本文検査", async () => {
  const originalConfig = readFileSync(configPath, "utf8");
  const baseConfig = readConfig();
  const outside = join(homedir(), "pi-tool-filter-v25-never-created.txt");
  const outsideDirectory = join(homedir(), "pi-tool-filter-v25-directory-never-created");
  const outsideShell = outside.replaceAll("\\", "/");
  const base64Utf16le = (body: string) => Buffer.from(body, "utf16le").toString("base64");
  assert.equal(existsSync(outside), false, "試験対象ファイルが事前に存在しない");
  assert.equal(existsSync(outsideDirectory), false, "試験対象ディレクトリが事前に存在しない");

  const strippedConfig = structuredClone(baseConfig);
  strippedConfig.bash.deny = [];
  const gitPushConfig = structuredClone(strippedConfig);
  gitPushConfig.bash.deny.push("git push *");

  try {
    let handler = await handlerFor(structuredClone(baseConfig));
    const encodedBody = "git push";
    const encodedB64 = base64Utf16le(encodedBody);
    blocked(await call(handler, "bash", { command: `pwsh -EncodedCommand ${encodedB64}` }), "pwsh -EncodedCommand の既存拒否Glob");

    handler = await handlerFor(structuredClone(gitPushConfig));
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['git','push','--force-with-lease'])"` }), "python -c のリテラルsubprocess");
    allowed(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['printf','safe'])"` }), "python -c の安全なsubprocess");
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; origin='feature'; subprocess.run(['git','push',origin])"` }), "python -c の変数がGlobの*に覆われる位置");
    allowed(await call(handler, "bash", { command: `python -c "import subprocess; prog='git'; subprocess.run([prog,'push'])"` }), "python -c の未証明のプログラム名");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.system('git push')"` }), "python -c のos.system文字列");
    blocked(await call(handler, "bash", { command: `node -e "require('child_process').execSync('git push')"` }), "node -e のexecSync");
    blocked(await call(handler, "bash", { command: `node -e "const { spawn } = require('child_process'); spawn('git', ['push'], { stdio: 'inherit' })"` }), "node -e のspawn argv");
    allowed(await call(handler, "bash", { command: `node -e "console.log('safe')"` }), "node -e の安全な本文");

    blocked(await call(handler, "bash", { command: `python - <<'PY'\nsubprocess.run(['git','push'])\nPY` }), "python heredoc クォート付き");
    blocked(await call(handler, "bash", { command: `python3 - <<PY\nimport os\nos.system("git push")\nPY` }), "python heredoc 展開文字なしのクォート無し");
    allowed(await call(handler, "bash", { command: `python3 - <<PY\nimport subprocess\nsubprocess.run([prog, 'push'])\nPY` }), "python heredoc 未証明の本文");
    allowed(await call(handler, "bash", { command: `python - <<PY\ndo $x\nPY` }), "python heredoc 展開文字のあるクォート無し");
    blocked(await call(handler, "bash", { command: `bash <<'EOF'\ngit push origin main\nEOF` }), "bash heredoc 本文の再帰検査");
    blocked(await call(handler, "bash", { command: `node - <<'JS'\nrequire('child_process').execSync('git push');\nJS` }), "node heredoc 本文");
    allowed(await call(handler, "bash", { command: `cat <<EOF\nsafe\nEOF` }), "データ消費コマンドのheredocは対象外");

    blocked(await call(handler, "bash", { command: `env python <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "ラッパー経由のpython heredoc");
    blocked(await call(handler, "bash", { command: `env sudo python <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "多段ラッパー経由のpython heredoc");
    allowed(await call(handler, "bash", { command: `python -W ignore -c "import subprocess; subprocess.run(['git','push'])"` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `node --require fs -e "require('child_process').execSync('git push')"` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `bash --rcfile /dev/null <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `bash --init-file /dev/null <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    blocked(await call(handler, "bash", { command: `bash -s - -- <<'EOF'\ngit push\nEOF` }), "bash -s -- のheredoc本文");
    allowed(await call(handler, "bash", { command: `<<'PY' python\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "リダイレクト前置形は文法解析不能で検査対象外（I1）");
    allowed(await call(handler, "bash", { command: `bash -s -c 'echo safe' <<'EOF'\ngit push\nEOF` }), "-sと-c併用では-cが勝ちheredocはデータ");
    allowed(await call(handler, "bash", { command: `node --report-dir /tmp/r -e "require('child_process').execSync('git push')"` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    blocked(await call(handler, "bash", { command: `pwsh -File - arg1 <<'EOF'\ngit push\nEOF` }), "pwsh -File - の位置引数があってもstdin本文を検査");
    allowed(await call(handler, "bash", { command: `bash -c'echo hi' <<'EOF'\ngit push\nEOF` }), "-cの結合形はデータとして対象外");
    blocked(await call(handler, "bash", { command: `node --eval="require('child_process').execSync('git push')"` }), "--eval=形式のnode -e");
    blocked(await call(handler, "bash", { command: `bash -xc 'git push'` }), "複合短縮オプションの-c");
    allowed(await call(handler, "bash", { command: `bash -c '' <<'EOF'\ngit push\nEOF` }), "空の-c本文のheredocはデータ");
    blocked(await call(handler, "bash", { command: "node -e \"require('child_process')[('execSync')]('git push')\"" }), "括弧付きsubscriptのexecSync");
    allowed(await call(handler, "bash", { command: `command -v python <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "command -v の照会形は対象コマンドを実行しない");
    blocked(await call(handler, "bash", { command: `pwsh -File - -Command '' <<'EOF'\ngit push\nEOF` }), "pwsh -File - の後続-Commandはスクリプト引数でstdin本文を検査");
    blocked(await call(handler, "bash", { command: `pwsh -File - -EncodedCommand AAAA <<'EOF'\ngit push\nEOF` }), "pwsh -File - のstdin本文を検査");
    blocked(await call(handler, "bash", { command: `pwsh -File - <<'EOF'\ngit push\nEOF` }), "pwsh -File - はstdin本文を実行");
    allowed(await call(handler, "bash", { command: `pwsh -EncodedCommand //// <<'EOF'\ngit push\nEOF` }), "復号不能の-EncodedCommandは検査不能として許可");
    allowed(await call(handler, "bash", { command: `python file.py -- - foo <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "A4 スクリプトファイル後の-は対象外");
    allowed(await call(handler, "bash", { command: `bash script.sh -s <<'EOF'\ngit push\nEOF` }), "A4 スクリプトファイル後の-sは対象外");
    blocked(await call(handler, "bash", { command: `python - -m pip <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "python - の後の-mはargvでstdin本文を検査");
    allowed(await call(handler, "bash", { command: `bash -o posix <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    blocked(await call(handler, "bash", { command: `python <<-'PY'\n\timport subprocess; subprocess.run(['git','push'])\nPY` }), "タブ除去heredocのpython本文");
    allowed(await call(handler, "bash", { command: `node -c file.js -e "require('child_process').execSync('git push')"` }), "A4 node -c (--check) はフラグで、ファイル実行は対象外");
    allowed(await call(handler, "bash", { command: `bash -O extdebug <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `node --experimental-loader fs -e "require('child_process').execSync('git push')"` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    blocked(await call(handler, "bash", { command: "node -e 'require(\"child_process\")[`execSync`](\"git push\")'" }), "subscript のテンプレートリテラル");
    blocked(await call(handler, "bash", { command: `pwsh -WorkingDirectory /tmp <<'EOF'\ngit push\nEOF` }), "-WorkingDirectory は置換型として追跡し本文を検査する");
    blocked(await call(handler, "bash", { command: `printf 日本 && python <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "非ASCIIを先行させたheredoc本文");
    blocked(await call(handler, "bash", { command: `python <<'PY' | cat\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "パイプ先頭コマンドのheredoc本文");
    blocked(await call(handler, "bash", { command: `python <<'PY' && echo ok\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "&&の左辺コマンドのheredoc本文");
    allowed(await call(handler, "bash", { command: `python -c '' <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "空の-c本文のheredocはデータ");
    blocked(await call(handler, "bash", { command: `pwsh -Command - <<'EOF'\ngit push\nEOF` }), "pwsh -Command - はstdin本文を実行");
    allowed(await call(handler, "bash", { command: `pwsh -ConfigurationName Microsoft.PowerShell <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `pwsh -WindowStyle Hidden <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: "node -e \"'execSync'.foo('git push')\"" }), "オブジェクト側の名前はchild_process呼び出しではない");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.system('git ' 'push')"` }), "os.systemの隣接文字列リテラル");
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['touch','relative-never-created'], cwd='../../' '../')"` }), "cwdの隣接文字列リテラル");
    allowed(await call(handler, "bash", { command: `node --input-type module -e "require('child_process').execSync('git push')"` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `pwsh -ExecutionPolicy Bypass <<'EOF'\ngit push\nEOF` }), "値付きオプションは網羅しないため検査機会を逃す（許可側）");
    allowed(await call(handler, "bash", { command: `python -x file.py -c "import subprocess; subprocess.run(['git','push'])"` }), "A4 python -x フラグ付きスクリプト実行は検査対象外");
    allowed(await call(handler, "bash", { command: `python -m pip -c "import subprocess; subprocess.run(['git','push'])"` }), "モジュールの引数はpython本体の-cではない");
    blocked(await call(handler, "bash", { command: `python - foo <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "python - の位置引数があってもstdin本文を検査");
    blocked(await call(handler, "bash", { command: `node - foo <<'JS'\nrequire('child_process').execSync('git push');\nJS` }), "node - の位置引数があってもstdin本文を検査");
    blocked(await call(handler, "bash", { command: `bash -s foo <<'EOF'\ngit push\nEOF` }), "bash -s の位置引数があってもstdin本文を検査");
    allowed(await call(handler, "bash", { command: `printf safe | python - -c "print(1)"` }), "A6 パイプstdinは検査対象外");
    allowed(await call(handler, "bash", { command: `env env env env python <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "深さ制限を超えるラッパー段のheredocは検査しない");
    allowed(await call(handler, "bash", { command: `env sudo python <<'PY'\nimport os; os.system("bash -c 'git push origin'")\nPY` }), "ラッパー段を含む深さでは後続の本文展開はしない");
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['find','/tmp','-delete'])"` }), "OBL-3 find -delete の外部write");
    allowed(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['cp','README.md','out.txt'])"` }), "OBL-3 作業領域内cpは許可");
    blocked(await call(handler, "bash", { command: `python -c "  # comment\nimport subprocess; subprocess.run(['git','push'])"` }), "インデント付きコメントが先頭でも本文を検査");
    allowed(await call(handler, "bash", { command: `pwsh -File script.ps1 <<'EOF'\ngit push\nEOF` }), "A4 pwsh -File heredoc は検査対象外");
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(args=['git','push'])"` }), "python argsキーワード引数");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.popen(cmd='git push')"` }), "os.popenのcmdキーワード引数");
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['git','\\U00000070\\U00000075\\U00000073\\U00000068'])"` }), "python \\Uエスケープの復元");
    blocked(await call(handler, "bash", { command: `node -e "require('child_process').execSync('git \\u{0070}ush')"` }), "js \\u{...}エスケープの復元");
    blocked(await call(handler, "bash", { command: `node -e "require('child_process')['execSync']('git push')"` }), "js 計算プロパティのexecSync");
    allowed(await call(handler, "bash", { command: `python - <<'PY'\n    subprocess.run(['git','push'])\nPY` }), "トップレベルインデントのpython heredocは実行不能");
    allowed(await call(handler, "bash", { command: `bash <<'A'\nbash <<'B'\nbash <<'C'\npython - <<'D'\nimport subprocess; subprocess.run(['git','push'])\nD\nC\nB\nA` }), "深さ制限を超えるheredoc再帰は検査しない");
    allowed(await call(handler, "bash", { command: `python -c "print(1)" <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "-c併用のheredocはデータとして対象外");
    allowed(await call(handler, "bash", { command: `bash -c 'echo hi' <<'EOF'\ngit push\nEOF` }), "bash -c併用のheredocはデータとして対象外");
    allowed(await call(handler, "bash", { command: `python -c "import os; os.spawnv('git', ['push'])"` }), "契約外のos APIは検査対象外");

    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['touch','relative-never-created'], cwd='../../../../')"` }), "python subprocess cwdでの外部write");

    const forkConfig = structuredClone(strippedConfig);
    forkConfig.bash.deny.push("node child.js git push *");
    handler = await handlerFor(forkConfig);
    blocked(await call(handler, "bash", { command: `node -e "require('child_process').fork('child.js', ['git','push'])"` }), "node -e のfork argv");

    const pipConfig = structuredClone(strippedConfig);
    pipConfig.bash.deny.push("pip install *");
    handler = await handlerFor(pipConfig);
    blocked(await call(handler, "bash", { command: "python -m pip install requests" }), "python -m のモジュール先頭検査");
    blocked(await call(handler, "bash", { command: "python3 -m pip install --upgrade pip" }), "python3 -m のモジュール先頭検査");
    allowed(await call(handler, "bash", { command: "python -m http.server 8000" }), "python -m の検査対象外モジュール");

    handler = await handlerFor(structuredClone(strippedConfig));
    allowed(await call(handler, "bash", { command: "python -m pip install requests" }), "pip拒否の無い設定では許可");

    handler = await handlerFor(structuredClone(pipConfig));
    allowed(await call(handler, "bash", { command: "python file.py -m pip install requests" }), "A4 python file.py -m は検査対象外");
    handler = await handlerFor(structuredClone(gitPushConfig));
    allowed(await call(handler, "bash", { command: `python file.py -c "import subprocess; subprocess.run(['git','push'])"` }), "A4 python file.py -c は検査対象外");
    allowed(await call(handler, "bash", { command: `node file.js -e "require('child_process').execSync('git push')"` }), "A4 node file.js -e は検査対象外");
    allowed(await call(handler, "bash", { command: `python file.py <<'PY'\nimport subprocess; subprocess.run(['git','push'])\nPY` }), "A4 python file.py heredoc は検査対象外");
    blocked(await call(handler, "bash", { command: `python -c "open('~/.bashrc').read()"` }), "A5 Python open 読み取りは read deny で拒否");
    blocked(await call(handler, "bash", { command: `python -c "io.open('~/.bashrc', 'r')"` }), "A5 Python io.open 読み取りは read deny で拒否");
    blocked(await call(handler, "bash", { command: `python -c "open('${outsideShell}', 'w')"` }), "A5 Python open 書き込みは外部 write 既定値で拒否");
    blocked(await call(handler, "bash", { command: `python -c "open('${outsideShell}', 'r+')"` }), "A5 Python open の r+ は write として拒否");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.rename('${outsideShell}', 'pi-tool-filter-file-api-renamed-never-created')"` }), "A5 Python os.rename は write として拒否");
    blocked(await call(handler, "bash", { command: `node -e "require('fs').readFileSync('~/.bashrc')"` }), "A5 Node.js fs 読み取りは read deny で拒否");
    blocked(await call(handler, "bash", { command: `node -e "require('fs').writeFileSync('${outsideShell}', 'x')"` }), "A5 Node.js fs 書き込みは外部 write 既定値で拒否");
    blocked(await call(handler, "bash", { command: `node -e "require('fs/promises').writeFile('${outsideShell}', 'x')"` }), "A5 Node.js fs/promises 書き込みは外部 write 既定値で拒否");
    blocked(await call(handler, "bash", { command: `node -e "fs.promises.readFile('~/.bashrc')"` }), "A5 Node.js fs.promises 読み取りは read deny で拒否");
    blocked(await call(handler, "bash", { command: `node -e "require('node:fs').renameSync('${outsideShell}', 'pi-tool-filter-file-api-renamed-never-created')"` }), "A5 Node.js fs.rename は write として拒否");
    blocked(await call(handler, "bash", { command: `node -e "require('fs').rmSync('${outsideShell}')"` }), "A5 Node.js fs.rm は write として拒否");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.remove('${outsideShell}')"` }), "A5 Python os.remove は write として拒否");
    allowed(await call(handler, "bash", { command: `python -c "open('relative-open-never-created', 'w')"` }), "A5 Python open の作業ディレクトリ内 write は許可");
    allowed(await call(handler, "bash", { command: `node -e "require('fs').writeFileSync('relative-write-never-created', 'x')"` }), "A5 Node.js fs の作業ディレクトリ内 write は許可");
    allowed(await call(handler, "bash", { command: `python -c "path='~/.bashrc'; open(path).read()"` }), "A5 Python 動的 path は追加拒否しない");
    allowed(await call(handler, "bash", { command: `python -c "mode='w'; open('~/.bashrc', mode)"` }), "A5 Python 動的 mode は追加拒否しない");
    allowed(await call(handler, "bash", { command: `node -e "const path = '~/.bashrc'; require('fs').readFileSync(path)"` }), "A5 Node.js 動的 path は追加拒否しない");
    allowed(await call(handler, "bash", { command: `node -e "const moduleName = 'fs'; require(moduleName).readFileSync('~/.bashrc')"` }), "A5 Node.js 動的 module は追加拒否しない");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.chdir('..'); open('pi-tool-filter-file-api-cwd-never-created', 'w')"` }), "A5 Python os.chdir 後の相対 write は外部 write として拒否");
    blocked(await call(handler, "bash", { command: `node -e "process.chdir('..'); require('fs').writeFileSync('pi-tool-filter-file-api-cwd-never-created', 'x')"` }), "A5 Node.js process.chdir 後の相対 write は外部 write として拒否");

    const fileAllowConfig = structuredClone(strippedConfig);
    fileAllowConfig.read.allow.push("~/.bashrc");
    handler = await handlerFor(fileAllowConfig);
    allowed(await call(handler, "bash", { command: `python -c "open('~/.bashrc').read()"` }), "A5 Python open は read allow に従う");

    const fileDenyPriorityConfig = structuredClone(strippedConfig);
    fileDenyPriorityConfig.write.outsideDefault = "allow";
    fileDenyPriorityConfig.write.allow.push(outside);
    fileDenyPriorityConfig.write.deny.push(outside);
    handler = await handlerFor(fileDenyPriorityConfig);
    blocked(await call(handler, "bash", { command: `node -e "require('fs').writeFileSync('${outsideShell}', 'x')"` }), "A5 Node.js fs は write deny を write allow より優先");

    handler = await handlerFor(structuredClone(gitPushConfig));
    allowed(await call(handler, "bash", { command: `printf 'safe' | python -` }), "A6 パイプstdinは検査対象外");

    // 作業ディレクトリ変更の置換型追跡（env -C / os.chdir / process.chdir / -WorkingDirectory）
    blocked(await call(handler, "bash", { command: `env -C /tmp rm -rf .` }), "env -C は内側コマンドのcwdを置換する");
    blocked(await call(handler, "bash", { command: `env --chdir=/tmp rm -rf .` }), "env --chdir= は内側コマンドのcwdを置換する");
    allowed(await call(handler, "bash", { command: `env rm -rf .` }), "env 単独ではcwdは変わらない");
    allowed(await call(handler, "bash", { command: `env -C $UNSET_VAR rm -rf .` }), "非静的 -C は追跡しない");
    blocked(await call(handler, "bash", { command: `python -c "import os; os.chdir('/tmp'); import subprocess; subprocess.run(['rm','-rf','.'])"` }), "os.chdir は後続の実行cwdを置換する");
    allowed(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['rm','-rf','.'])"` }), "chdir なしでは作業領域内のrmは許可");
    allowed(await call(handler, "bash", { command: `python -c "import os; os.chdir(x); import subprocess; subprocess.run(['rm','-rf','.'])"` }), "非静的 os.chdir は追跡しない");
    blocked(await call(handler, "bash", { command: `node -e "process.chdir('/tmp'); require('child_process').execSync('rm -rf .')"` }), "process.chdir は後続の実行cwdを置換する");
    blocked(await call(handler, "bash", { command: `pwsh -WorkingDirectory /tmp -Command "Remove-Item ./evil"` }), "pwsh -WorkingDirectory は本文のcwdを置換する");
    blocked(await call(handler, "bash", { command: `pwsh -WorkingDirectory /tmp <<'EOF'\nRemove-Item ./evil\nEOF` }), "pwsh -WorkingDirectory の heredoc 本文を置換 cwd で検査");
    allowed(await call(handler, "bash", { command: `pwsh -Command "Remove-Item ./ok"` }), "作業領域内のRemove-Itemは許可");

    const spaceConfig = structuredClone(strippedConfig);
    spaceConfig.bash.deny.push("git commit -m fix bug");
    handler = await handlerFor(spaceConfig);
    allowed(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['git','commit','-m','fix bug'])"` }), "スペースを含む要素は任意一致になり正確Globに一致しない");
    const spaceAnyConfig = structuredClone(strippedConfig);
    spaceAnyConfig.bash.deny.push("git commit -m *");
    handler = await handlerFor(spaceAnyConfig);
    blocked(await call(handler, "bash", { command: `python -c "import subprocess; subprocess.run(['git','commit','-m','fix bug'])"` }), "スペースを含む要素は任意一致でGlobに一致");

    const encConfig = structuredClone(strippedConfig);
    encConfig.bash.deny.push("git push *");
    handler = await handlerFor(encConfig);
    const encodedResult = await call(handler, "bash", { command: `pwsh -EncodedCommand ${encodedB64}` });
    blocked(encodedResult, "pwsh -EncodedCommand の復号後の本文拒否");
    const commandResult = await call(handler, "bash", { command: `pwsh -Command "${encodedBody}"` });
    blocked(commandResult, "pwsh -Command 経由の拒否");
    assert.equal(encodedResult?.reason, commandResult?.reason, "-EncodedCommand は -Command と同じ理由を返す");

    const fffdBody = "Write-Output '\uFFFD'; git push";
    const fffdEncoded = await call(handler, "bash", { command: `pwsh -EncodedCommand ${base64Utf16le(fffdBody)}` });
    const fffdCommand = await call(handler, "bash", { command: `pwsh -Command "${fffdBody}"` });
    blocked(fffdEncoded, "U+FFFDを含む本文の復号後拒否");
    assert.equal(fffdEncoded?.reason, fffdCommand?.reason, "U+FFFDを含む本文も-Commandと同じ理由");
    allowed(await call(handler, "bash", { command: `pwsh -EncodedCommand ${base64Utf16le("git push\n# \uD800")}` }), "孤立サロゲートを含む本文は検査不能として許可");

    assert.equal(existsSync(outside), false, "拒否・判定中に外部試験対象を作成しない");
    assert.equal(existsSync(outsideDirectory), false, "拒否・判定中に外部試験対象ディレクトリを作成しない");
  } finally {
    writeFileSync(configPath, originalConfig);
    assert.equal(readFileSync(configPath, "utf8"), originalConfig, "設定を元の内容へ復元できる");
  }
});

test("bash 拒否 reason は一致 Glob と作用禁止の意味論を含む", async () => {
  const originalConfig = readFileSync(configPath, "utf8");
  try {
    const handler = await handlerFor(readConfig());
    const result = await call(handler, "bash", { command: "git push" });
    assert.equal(result?.block, true, "bash git push は拒否される");
    assert.ok(result?.reason?.includes("git push *"), "拒否理由に一致した Glob を含む");
    assert.ok(result?.reason?.includes("認可判断"), "拒否理由に認可判断の意味論を含む");
    assert.ok(result?.reason?.includes("代替経路"), "拒否理由に代替経路の禁止を含む");
  } finally {
    writeFileSync(configPath, originalConfig);
  }
});

test("write 明示 deny は作業ディレクトリ内でも拒否する", async () => {
  const originalConfig = readFileSync(configPath, "utf8");
  try {
    const baseConfig = readConfig();
    const denyConfig = structuredClone(baseConfig);
    denyConfig.write.deny = [...(denyConfig.write.deny ?? []), "dot_pi/**"];
    const handler = await handlerFor(denyConfig);
    blocked(await call(handler, "write", { path: "dot_pi/agent/reject.txt" }), "作業ディレクトリ内 write の明示 deny");
    blocked(await call(handler, "edit", { path: "dot_pi/agent/reject.txt" }), "作業ディレクトリ内 edit の明示 deny");
    allowed(await call(handler, "write", { path: "pi-tool-filter-deny-allow.txt" }), "deny と一致しない内部 write");
  } finally {
    writeFileSync(configPath, originalConfig);
  }
});

test("glob ** は配下ファイルに一致する", () => {
  const config = { read: { allow: [], deny: [] }, write: { allow: [], deny: [".git/**"] }, outsideDefault: "deny", bash: { allow: [], deny: [] } };
  const pattern = ".git/**";
  const matcher = (candidate: string) => {
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const doubleStar = "\u0000";
    const source = pattern
      .replaceAll("**", doubleStar)
      .split("*")
      .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
      .join(".*")
      .replaceAll(doubleStar, ".*");
    return new RegExp(`^${source}$`, "i").test(candidate);
  };
  assert.equal(matcher(".git/index"), true, ".git 直下ファイルに一致");
  assert.equal(matcher(".git/refs/heads/main"), true, ".git のネストに一致");
  assert.equal(matcher(".git"), false, ".git 自身には一致しない");
  assert.equal(matcher("README.md"), false, "配下でないファイルには一致しない");
  assert.ok(config.write.deny.includes(".git/**"), "require: .git/** は write.deny で表現できる");
});
