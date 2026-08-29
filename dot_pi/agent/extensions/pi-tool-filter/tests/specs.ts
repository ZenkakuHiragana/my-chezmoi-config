import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import test from "node:test";
import { allowed, blocked, call, configPath, cwd, handlerFor, readConfig } from "./support.ts";

export function registerSpecTests(): void {
  test("tool-specs: 代表的な使い方の読み書き先と境界判定", async () => {
    const originalConfig = readFileSync(configPath, "utf8");
    try {
      const baseConfig = readConfig();
      const config = structuredClone(baseConfig);
      // bash の Glob 拒否を外し、path 判定（仕様テーブル + 境界）の挙動だけを確認する。
      config.bash.deny = [];
      const handler = await handlerFor(config);
      const home = homedir().replaceAll("\\", "/");

      // 作業境界内の clone / 生成は許可（cwd 既定の書き込み先が境界内）。
      allowed(await call(handler, "bash", { command: "git clone https://x/y" }), "git clone 境界内");
      allowed(await call(handler, "bash", { command: "gh repo clone owner/repo" }), "gh repo clone 境界内");
      allowed(await call(handler, "bash", { command: "cargo new app" }), "cargo new 境界内");
      allowed(await call(handler, "bash", { command: "dotnet new console" }), "dotnet new 境界内");
      allowed(await call(handler, "bash", { command: "npm init -y" }), "npm init 境界内");

      // cd で境界外へ移ってからの clone / fork は拒否。
      blocked(await call(handler, "bash", { command: "cd ~ && git clone https://x/y" }), "cd ~ && git clone 拒否");
      blocked(await call(handler, "bash", { command: "cd ~ && gh repo clone owner/repo" }), "cd ~ && gh repo clone 拒否");
      blocked(await call(handler, "bash", { command: "cd ~ && gh repo fork --clone owner/repo" }), "cd ~ && gh repo fork --clone 拒否");

      // 明示された境界外 dir は拒否（dir 省略の cwd 既定とは別経路）。
      blocked(await call(handler, "bash", { command: `git clone https://x/y ${home}/repo` }), "明示境界外 dir 拒否");
      blocked(await call(handler, "bash", { command: `cargo new ${home}/app` }), "明示境界外 cargo new 拒否");
      blocked(await call(handler, "bash", { command: `cargo init ${home}/repo` }), "cargo init 明示境界外 拒否");
      blocked(await call(handler, "bash", { command: `dotnet new console -o ${home}/app` }), "dotnet new -o 明示境界外 拒否");

      // git -C は実行ディレクトリを変える（境界外 -C のバイパスを防ぐ）。
      blocked(await call(handler, "bash", { command: `git -C ${home} clone https://x/y` }), "git -C 境界外 clone 拒否");
      allowed(await call(handler, "bash", { command: `git -C ${home} clone https://x/y ${cwd}/repo` }), "git -C 境界外でも明示境界内 dir は許可");

      // --recurse-submodules(値省略可)で位置引数が崩れない。
      blocked(await call(handler, "bash", { command: `git clone --recurse-submodules https://x/y ${home}/repo` }), "--recurse-submodules 明示境界外 拒否");
      allowed(await call(handler, "bash", { command: `git clone --recurse-submodules https://x/y ${cwd}/repo` }), "--recurse-submodules 明示境界内 許可");

      // サブコマンド位置の誤認をしない（git help clone は clone ではない）。
      allowed(await call(handler, "bash", { command: "git help clone" }), "git help clone は遮断しない");

      // アーカイブ解凍・環境構築：モード（解凍/一覧/作成）で書き込み先が分かれる。
      blocked(await call(handler, "bash", { command: `tar -xvf x.tar -C ${home}/out` }), "tar 解凍 -C 境界外 拒否");
      allowed(await call(handler, "bash", { command: "tar -tf x.tar" }), "tar 一覧は遮断しない");
      allowed(await call(handler, "bash", { command: "tar -cf out.tar files" }), "tar 作成は遮断しない");
      blocked(await call(handler, "bash", { command: `tar -cf ${home}/oops.tar files` }), "tar -cf 境界外 archive 拒否");
      blocked(await call(handler, "bash", { command: `unzip x.zip -d ${home}/out` }), "unzip -d 境界外 拒否");
      allowed(await call(handler, "bash", { command: "unzip -l x.zip" }), "unzip 一覧は遮断しない");
      blocked(await call(handler, "bash", { command: "cd ~ && 7z x x.7z" }), "7z x 境界外 cwd 拒否");
      blocked(await call(handler, "bash", { command: `7z x x.7z -o${home}/out` }), "7z x -o 境界外 拒否");
      allowed(await call(handler, "bash", { command: "7z a out.7z files" }), "7z a (作成) 境界内 遮断しない");
      blocked(await call(handler, "bash", { command: `python -m venv ${home}/venv` }), "python -m venv 境界外 拒否");

      // 破壊的・in-place：フラグでオペランドが書込み／削除対象になる。
      blocked(await call(handler, "bash", { command: `sed -i s/x/y/ ${home}/file` }), "sed -i 境界外 拒否");
      allowed(await call(handler, "bash", { command: `sed s/x/y/ ${home}/file` }), "sed 非 -i は遮断しない");
      blocked(await call(handler, "bash", { command: `7z a out.7z ${home}/file -sdel` }), "7z a -sdel 境界外 input 拒否");
      blocked(await call(handler, "bash", { command: "cd ~ && git clean -fd" }), "git clean -fd 境界外 cwd 拒否");
      allowed(await call(handler, "bash", { command: "git clean -n" }), "git clean -n (dry-run) 遮断しない");

      // destination(cwd fallback) と追加出力(--separate-git-dir)は独立。伝統形 tar xf / 7z e。
      blocked(await call(handler, "bash", { command: "cd ~ && git clone --separate-git-dir " + cwd + "/meta https://x/y" }), "cd ~ && git clone --separate-git-dir 境界外 worktree 拒否");
      blocked(await call(handler, "bash", { command: "cd ~ && tar xf x.tar" }), "tar xf (伝統形) 境界外 cwd 拒否");
      blocked(await call(handler, "bash", { command: `tar -C ${home}/out xf x.tar` }), "tar -C dir xf 境界外 拒否");
      blocked(await call(handler, "bash", { command: "cd ~ && 7z e x.7z" }), "7z e 境界外 cwd 拒否");

      // 既知の危険モード（unbounded）は拒否。unzip -p（stdout）は遮断しない。
      blocked(await call(handler, "bash", { command: `tar -xPf evil.tar -C ${cwd}/out` }), "tar -xPf 高危険モード 拒否");
      blocked(await call(handler, "bash", { command: `7z x evil.7z -spf -o${cwd}/out` }), "7z x -spf 高危険モード 拒否");
      blocked(await call(handler, "bash", { command: `unzip -: evil.zip -d ${cwd}/out` }), "unzip -: 高危険モード 拒否");
      allowed(await call(handler, "bash", { command: "unzip -p x.zip" }), "unzip -p (stdout) 遮断しない");

      // option-value / forward：別地点への metadata 書き込みと、git flags の転送。
      blocked(await call(handler, "bash", { command: `git clone --separate-git-dir ${home}/g.git https://x/y ${cwd}/safe` }), "git clone --separate-git-dir 境界外 拒否");
      blocked(await call(handler, "bash", { command: `gh repo clone owner/repo ${cwd}/safe -- --separate-git-dir=${home}/g.git` }), "gh repo clone --gitflags 境界外 拒否");

      // 仕様に合致しない使い方 / 未知コマンドは遮断しない。
      allowed(await call(handler, "bash", { command: "gh repo fork owner/repo" }), "--clone なし fork は遮断しない");
      allowed(await call(handler, "bash", { command: "git status" }), "仕様外 git サブコマンドは遮断しない");
      allowed(await call(handler, "bash", { command: "mystery-tool foo" }), "未知コマンドは遮断しない");

      // 既存 generic 挙動は維持される（cp の境界外 write は拒否）。
      blocked(await call(handler, "bash", { command: `cp README.md ${home}/dst` }), "cp 境界外 write は拒否");
    } finally {
      writeFileSync(configPath, originalConfig);
    }
  });
}
