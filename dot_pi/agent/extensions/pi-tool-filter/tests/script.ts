import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  allowed,
  blocked,
  call,
  configPath,
  handlerFor,
  readConfig,
} from "./support.ts";

export function registerScriptTests(): void {
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

}
