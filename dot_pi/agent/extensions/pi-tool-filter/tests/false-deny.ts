import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { allowed, blocked, call, configPath, handlerFor, readConfig, type FilterResult } from "./support.ts";

type Bash = (command: string) => Promise<FilterResult | undefined>;

// 作業ディレクトリ内の書き込みに使う既存のディレクトリとファイルには、リポジトリで管理しているもの（dot_pi、AGENTS.md）を使う。
// 判定だけを行い、ファイルは作らない。editConfig を渡すと、配置済みの設定を変えた設定で判定する（最後に元へ戻す）。
async function withHandler(run: (bash: Bash) => Promise<void>, editConfig?: (config: any) => void): Promise<void> {
  const originalConfig = readFileSync(configPath, "utf8");
  try {
    const config = readConfig();
    editConfig?.(config);
    const handler = await handlerFor(config);
    await run((command) => call(handler, "bash", { command }));
  } finally {
    writeFileSync(configPath, originalConfig);
  }
}

// 拒否理由が外部書き込みの既定値によるものであることを確かめる。
function outside(result: FilterResult | undefined, label: string): void {
  blocked(result, label);
  assert.match(String(result?.reason), /外部書き込みの未一致時既定値/, `${label} は外部書き込みとして拒否される`);
}

// 次の 3 種類を確かめる。
// - 誤って拒否されていた形（5 つの原因）が許可されることと、近い形の正当な拒否が残ること
// - 承認済みの追加として、ssh のリモートコマンドを入れ子のコマンドとして検査すること
// - 修正前から見逃していた外部書き込みのうち、引数とリダイレクトの読み方（`--`、`env -u`、`>&`）で拒否するもの
export function registerFalseDenyTests(): void {
  test("cp の宛先が変数のとき、コピー元を宛先として扱わない", async () => {
    await withHandler(async (bash) => {
      allowed(await bash('cp ~/pi-tool-filter-fd-src "$O/x"'), "引用符付きの変数を含む宛先");
      allowed(await bash("cp ~/pi-tool-filter-fd-src $O"), "引用符のない変数の宛先");
      allowed(await bash("cp ~/pi-tool-filter-fd-src $O/x"), "変数で始まる宛先");
      allowed(await bash("sudo cp ~/pi-tool-filter-fd-src $O"), "ラッパーの内側の変数の宛先");
      allowed(await bash("timeout 5 cp ~/pi-tool-filter-fd-src $O"), "値を取るラッパーの内側の変数の宛先");
      allowed(await bash("xargs cp ~/pi-tool-filter-fd-src $O"), "xargs の内側の変数の宛先");
      allowed(await bash("find . -maxdepth 0 -exec cp ~/pi-tool-filter-fd-src $O \\;"), "find -exec の内側の変数の宛先");
      blocked(await bash("cp AGENTS.md ~/pi-tool-filter-fd-x"), "静的な外部の宛先");
      blocked(await bash("sudo cp AGENTS.md ~/pi-tool-filter-fd-x"), "ラッパーの内側の静的な外部の宛先");
      blocked(await bash("sudo $X rm -rf ~/pi-tool-filter-fd-x"), "ラッパーの直後の変数は内側のコマンド名にしない");
      const source = await bash('cp ~/.ssh/id_rsa "$O/x"');
      blocked(source, "読み取りを拒否したコピー元");
      assert.match(String(source?.reason), /設定ファイルの拒否 Glob/, "コピー元は読み取りとして判定する");
      blocked(await bash("cp -t ~ AGENTS.md"), "-t で渡す外部の宛先");
      blocked(await bash("cp -rt ~ dot_pi"), "短いオプションをまとめた -t で渡す外部の宛先");
      blocked(await bash("cp --target-directory ~/pi-tool-filter-fd-dir AGENTS.md"), "--target-directory で渡す外部の宛先");
      allowed(await bash("cp -t dot_pi AGENTS.md"), "-t で渡す作業ディレクトリ内の宛先");
      outside(await bash("cp -Stest AGENTS.md ~/pi-tool-filter-fd-x"), "-S の値の中の t は -t と読まない");
      outside(await bash("cp -S .bak AGENTS.md ~/pi-tool-filter-fd-x"), "-S の値を別の語で渡す形");
    });
  });

  test("許可した場所そのものへの書き込み", async () => {
    await withHandler(async (bash) => {
      allowed(await bash("mkdir -p ~/AppData/Local/Temp/opencode"), "許可ルート自身の作成");
      allowed(await bash("rm -rf ~/AppData/Local/Temp/opencode"), "許可ルート自身の削除");
      blocked(await bash("mkdir -p ~/AppData/Local/Temp/opencode-other"), "許可ルートと同じ文字列で始まる別のディレクトリ");
      blocked(await bash("mkdir -p ~/AppData/Local/Temp"), "許可ルートの親");
    });
  });

  // Bash の `/tmp` は TEMP として判定する。設定の許可ルート `~/AppData/Local/Temp/opencode/**` と TEMP が
  // 同じ一時フォルダを指す環境でだけ確かめる（TEMP が別の場所を指す環境では期待値が変わる）。
  const samePath = (left: string, right: string) => left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase();
  const defaultTemp = process.platform === "win32" && samePath(tmpdir(), join(homedir(), "AppData", "Local", "Temp"));
  test("Git Bash の /tmp を TEMP として判定する", { skip: !defaultTemp }, async () => {
    await withHandler(async (bash) => {
      allowed(await bash("cd /tmp/opencode && echo a > pi-tool-filter-fd-x.txt"), "/tmp/opencode へ移動した後の相対パスへのリダイレクト");
      allowed(await bash("cd /tmp/opencode && touch pi-tool-filter-fd-x.txt"), "/tmp/opencode へ移動した後の相対パスの引数");
      allowed(await bash("git -C /tmp/opencode/pi-tool-filter-fd-repo init"), "git -C の /tmp");
      outside(await bash("cd /tmp && echo a > pi-tool-filter-fd-x.txt"), "許可していない TEMP の直下への相対パス");
      outside(await bash("echo a > /tmp/pi-tool-filter-fd-x.txt"), "許可していない TEMP の直下への絶対パス");
    });
  });

  test("移動先が静的でない cd の後の相対の cd は追跡しない", async () => {
    await withHandler(async (bash) => {
      allowed(await bash("D=dot_pi; cd $D && cd .. && rm -rf pi-tool-filter-fd-p"), "変数の cd の後の cd ..");
      allowed(await bash('cd "$D/sub" && cd .. && rm -rf pi-tool-filter-fd-p'), "引用符付きの変数の cd の後の cd ..");
      allowed(await bash("cd - && cd .. && rm -rf pi-tool-filter-fd-p"), "cd - の後の cd ..");
      // 受け入れた帰結: 間の cd .. を抜いた形（D=/; cd $D && rm -rf etc）は修正前から許可されている。
      allowed(await bash("D=/; cd $D && rm -rf etc"), "変数の cd の後の相対パス（修正前から許可）");
      allowed(await bash("D=/; cd $D && cd .. && rm -rf etc"), "変数の cd の後の cd .. の後の相対パス");
      outside(await bash("cd dot_pi && cd .. && cd .. && rm -rf pi-tool-filter-fd-p"), "静的な cd は追跡する");
      outside(await bash("cd $D && cd ~ && rm -rf pi-tool-filter-fd-p"), "絶対パスへ cd した後は追跡を再開する");
      outside(await bash("cd $D && cd .. && rm -rf ~/pi-tool-filter-fd-p"), "絶対パスの書き込み先は判定する");
      // 据え置いても、作業ディレクトリの外への相対パスは拒否する（据え置きの有無は上の allowed で確かめる）。
      outside(await bash("cd $D && cd .. && rm -rf ../pi-tool-filter-fd-p"), "据え置いた後の、作業ディレクトリの外への相対パス");
    });
  });

  test("引用符内の空白をコマンド Glob の区切りとして扱わない", async () => {
    await withHandler(async (bash) => {
      allowed(await bash('grep -n "a / b" AGENTS.md'), "二重引用符内の ` / `");
      allowed(await bash("rg -n 'a / b' AGENTS.md"), "単一引用符内の ` / `");
      allowed(await bash('sudo grep -n "a / b" AGENTS.md'), "ラッパーの内側の引用符内の ` / `");
      blocked(await bash("grep -r foo / -n"), "引数の /");
      blocked(await bash('grep -rn "foo" /'), "末尾の引数の /");
      blocked(await bash('"/mnt/c/Program Files/dotnet/dotnet.exe" push origin'), "引用符を含む拒否 Glob");
      blocked(await bash("/mnt/c/Program\\ Files/dotnet/dotnet.exe push origin"), "エスケープした空白を含む拒否 Glob");
      blocked(await bash('watch "git push origin"'), "watch が実行する文字列");
      blocked(await bash('watch -n 2 "git push origin"'), "オプション付きの watch が実行する文字列");
      blocked(await bash('parallel "git push origin" ::: x'), "parallel が実行する文字列");
      blocked(await bash('watch "echo a; git push origin"'), "watch が実行する文字列の中の後ろのコマンド");
      blocked(await bash('grep -n "a / b" AGENTS.md && echo "'), "構文を解析できない入力は引用符を解釈せずに照合する");
    });
  });

  test("ssh のリモートコマンドを入れ子のコマンドとして検査する", async () => {
    await withHandler(async (bash) => {
      blocked(await bash("ssh host git push origin"), "引用符のないリモートコマンド");
      blocked(await bash('ssh host "git push origin"'), "引用符付きのリモートコマンド");
      blocked(await bash("ssh -p 22 -i key host 'sudo git push origin'"), "値を取るオプションの後のリモートのラッパー");
      blocked(await bash(`ssh host "bash -c 'git push origin'"`), "リモートの bash -c");
      blocked(await bash('ssh host "powershell.exe -EncodedCommand AAAA"'), "リモートの -EncodedCommand");
      blocked(await bash(`ssh host "powershell -NoProfile -Command 'icacls C:/x'"`), "リモートの PowerShell の本文");
      blocked(await bash("ssh $H git push origin"), "宛先が変数のリモートコマンド");
      blocked(await bash("sudo ssh $H git push origin"), "ラッパーの内側の、宛先が変数の ssh");
      blocked(await bash(`pwsh -NoProfile -Command '& ssh host "git push origin"'`), "PowerShell の本文の ssh のリモートコマンド");
      allowed(await bash('ssh host "cat ~/.ssh/id_rsa"'), "リモートの読み取り先は判定しない");
      allowed(await bash("ssh host 'tar -P -cf x.tar /'"), "リモートの書き込み先は判定しない");
      allowed(await bash("ssh host ls -la"), "拒否 Glob に一致しないリモートコマンド");
      blocked(await bash("tar -P -cf x.tar /"), "ローカルの書き込み先を閉じられないモード");
    });
  });

  test("外部書き込みの既定値が allow でも、ローカルの書き込み先を閉じられないモードは拒否する", async () => {
    await withHandler(async (bash) => {
      blocked(await bash("tar -P -cf x.tar /"), "外部書き込みの既定値が allow の設定のローカルの tar -P");
      allowed(await bash("ssh host 'tar -P -cf x.tar /'"), "外部書き込みの既定値が allow の設定のリモートの tar -P");
    }, (config) => {
      config.write.outsideDefault = "allow";
      config.write.deny = [];
    });
  });

  test("引数とリダイレクトの読み方", async () => {
    await withHandler(async (bash) => {
      outside(await bash("touch -- -x/../../pi-tool-filter-fd-x"), "-- の後の - で始まるオペランド");
      allowed(await bash("touch -- -pi-tool-filter-fd-x"), "-- の後の - で始まる作業ディレクトリ内のオペランド");
      allowed(await bash("cd -- -pi-tool-filter-fd-d && cd .. && rm -rf pi-tool-filter-fd-p"), "cd の -- の後の - で始まる移動先");
      outside(await bash("cd -- -pi-tool-filter-fd-d && rm -rf ../../pi-tool-filter-fd-p"), "cd の -- の後の - で始まる移動先からの相対パス");
      allowed(await bash("cd ~ && chmod -- +x ~/AppData/Local/Temp/opencode/pi-tool-filter-fd-x"), "chmod の -- の後の + で始まるモード");
      allowed(await bash("cd ~ && chmod -- -w ~/AppData/Local/Temp/opencode/pi-tool-filter-fd-x"), "chmod の -- の後の - で始まるモード");
      outside(await bash("env -u X -C ~ touch pi-tool-filter-fd-x"), "env -u の値の後の -C");
      allowed(await bash("env -u X -C dot_pi touch pi-tool-filter-fd-x"), "env -u の値の後の作業ディレクトリ内の -C");
      outside(await bash("echo a >& ~/pi-tool-filter-fd-x"), ">& の後のファイル");
      allowed(await bash("echo a >& dot_pi/pi-tool-filter-fd-x"), ">& の後の作業ディレクトリ内のファイル");
      allowed(await bash("echo a >&2"), ">& の後のファイル記述子");
      allowed(await bash("echo a 2>&1"), "ファイル記述子の複製");
      allowed(await bash("echo a 2>& ~/pi-tool-filter-fd-x"), "ファイル記述子を指定した >& はファイルを開かない");
      blocked(await bash("echo a >& ~/pi-tool-filter-fd-x ("), "構文を解析できない入力の >& の後のファイル");
    });
  });
}
