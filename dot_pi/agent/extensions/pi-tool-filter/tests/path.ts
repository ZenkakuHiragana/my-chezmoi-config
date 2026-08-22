import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allowed,
  blocked,
  call,
  configPath,
  cwd,
  extensionPath,
  gitBashPath,
  handlerFor,
  readConfig,
} from "./support.ts";

export function registerPathTests(): void {
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

}
