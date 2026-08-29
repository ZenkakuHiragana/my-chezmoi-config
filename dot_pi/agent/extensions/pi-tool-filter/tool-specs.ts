// 解釈層：bash コマンドの「代表的な使い方」がどこに読み書きするかを宣言する仕様テーブル。
//
// このファイルは解釈（どこに書き込む/読むか）だけを扱う。解釈結果への方針
// （allow / deny / outsideDefault）は config が所有し、ここには持たない。
//
// 各仕様は「構文」と「意味論」を分離して宣言する。
// - valueOptions: 構文。このオプションは値を1個取るので、位置引数の番地を保つ。
// - writes / reads: 意味論。値がどこへ書き込み / 読み込むかを明示する。
//
// 意味論のカテゴリ（TargetSelector）:
// - positional: 位置引数（サブコマンド・オプションを除いた残り）の index 番目。
// - option: 値付きオプションの値（--separate-git-dir、7z -o、dotnet -o など）。
// - cwd: 現在の実行 cwd を既定の出力先とする（clone の dir 省略）。
// - option-by-mode: 値付きオプションの値が、モードで read / write が変わる（tar -f）。
//
// whenFlags / whenNotFlags（各セレクタ）:
// - whenFlags: このフラグがすべて存在するときだけ適用。
// - whenNotFlags: このフラグが1つでも存在すれば適用しない。
//   フラグ判定はクラスタ短縮（-xf 中の -x）も認識する。
//
// forward（仕様単位）:
// - "--" 以降を別コマンド（target）で再解釈する。例: gh repo clone ... -- <gitflags>。
//
// このテーブルは「代表的な使い方」を対象にする。副作用が複雑で代表的な形に
// 収まらないもの（7z -sdel の元ファイル削除、sed の script とファイル列の扱い、
// find -delete の走査意味論、複雑な転送先）は載せず「既知の残差」として扱う
// （要件契約 区別3 fail-open）。

export type TargetSelector =
  | { kind: "positional"; index: number; whenFlags?: readonly string[]; whenNotFlags?: readonly string[] }
  | { kind: "option"; option: string; attached?: boolean; whenFlags?: readonly string[]; whenNotFlags?: readonly string[] }
  | { kind: "cwd"; whenFlags?: readonly string[]; whenNotFlags?: readonly string[] }
  | { kind: "option-by-mode"; option: string; readWhen: readonly string[]; writeWhen: readonly string[] };

export type ToolSpec = {
  // コマンドトークン列。["git","clone"] / ["gh","repo","fork"] / ["cargo","new"]。
  command: readonly string[];
  // このフラグがすべて args に存在するときだけ一致。
  flags?: readonly string[];
  // 構文：値付きオプション（位置引数の番地を保つ）。意味論は writes / reads へ明示する。
  valueOptions?: readonly string[];
  // 書き込み先の取り出し（複数あれば各々 path 方針を判定する）。
  writes?: readonly TargetSelector[];
  // 読み込み先の取り出し。既定はなし。
  reads?: readonly TargetSelector[];
  // "--" 以降を target（別コマンド）で再解釈する（gh repo clone の git flags 転送）。
  forward?: { via: string; target: readonly string[] };
};

// git の代表的な値付きオプション（グローバル + clone / worktree 系）。
// 注意: `--[no-]recurse-submodules[=<pathspec>]` は値が省略可能（`=` 形のみ取引）なので
// ここに含めない（値を消費すると位置引数が崩れる）。意味論を持つものは writes / reads で明示する。
const GIT_VALUE_OPTIONS = [
  "-C",
  "--git-dir",
  "--work-tree",
  "-c",
  "--config",
  "-b",
  "-B",
  "--branch",
  "-o",
  "--origin",
  "-j",
  "--jobs",
  "--depth",
  "--shallow-since",
  "--shallow-exclude",
  "--reference",
  "--reference-if-able",
  "--template",
  "--separate-git-dir",
  "--filter",
] as const;

// gh の代表的な値付きオプション（--repo / -R はグローバル）。
const GH_VALUE_OPTIONS = ["-R", "--repo", "--config", "-b", "--branch", "--depth", "--upstream-remote-name"] as const;

export const TOOL_SPECS: readonly ToolSpec[] = [
  // VCS 生成：書き込み先は明示 dir（positional 1）または cwd。--separate-git-dir は metadata を別地点へ書く。
  {
    command: ["git", "clone"],
    valueOptions: GIT_VALUE_OPTIONS,
    writes: [{ kind: "positional", index: 1 }, { kind: "option", option: "--separate-git-dir" }, { kind: "cwd" }],
    reads: [{ kind: "option", option: "--reference" }, { kind: "option", option: "--template" }],
  },
  { command: ["git", "init"], valueOptions: GIT_VALUE_OPTIONS, writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },
  { command: ["git", "worktree", "add"], valueOptions: GIT_VALUE_OPTIONS, writes: [{ kind: "positional", index: 0 }] },
  {
    command: ["gh", "repo", "clone"],
    valueOptions: GH_VALUE_OPTIONS,
    writes: [{ kind: "positional", index: 1 }, { kind: "cwd" }],
    // "--" 以降は git clone へ転送される。git clone 仕様で再解釈して追加の write / read を拾う。
    forward: { via: "--", target: ["git", "clone"] },
  },
  { command: ["gh", "repo", "fork"], flags: ["--clone"], valueOptions: GH_VALUE_OPTIONS, writes: [{ kind: "cwd" }] },

  // 言語/テンプレート生成：出力先は位置引数（cargo new/init <path>）または cwd（既定）。
  { command: ["cargo", "new"], valueOptions: ["--name", "--vcs", "--edition"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },
  { command: ["cargo", "init"], valueOptions: ["--name", "--vcs", "--edition"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },
  { command: ["dotnet", "new"], valueOptions: ["-o", "--output", "--name", "-n"], writes: [{ kind: "option", option: "-o" }, { kind: "option", option: "--output" }, { kind: "cwd" }] },

  // パッケージ/スキャフォルド生成：既定で cwd に生成する。--prefix は出力先を変える。
  { command: ["npm", "init"], valueOptions: ["-y", "--yes", "-w", "--workspace", "--scope", "--prefix"], writes: [{ kind: "option", option: "--prefix" }, { kind: "cwd" }] },
  { command: ["npm", "create"], valueOptions: ["-y", "--yes", "-w", "--workspace", "--prefix"], writes: [{ kind: "option", option: "--prefix" }, { kind: "cwd" }] },
  { command: ["yarn", "create"], valueOptions: ["-y", "--yes"], writes: [{ kind: "cwd" }] },
  { command: ["pnpm", "create"], valueOptions: ["-y", "--yes"], writes: [{ kind: "cwd" }] },
  { command: ["bun", "init"], valueOptions: ["-y", "--yes"], writes: [{ kind: "cwd" }] },
  { command: ["bun", "create"], valueOptions: ["-y", "--yes"], writes: [{ kind: "cwd" }] },

  // モジュール初期化：既定で cwd に書き込む。
  { command: ["go", "mod", "init"], valueOptions: ["-go", "-v"], writes: [{ kind: "cwd" }] },

  // 環境構築：python -m venv は pythonModuleArgs の再検査で "venv <path>" として到達する。
  { command: ["venv"], valueOptions: ["--clear", "--upgrade", "--prompt"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },
  { command: ["uv", "init"], valueOptions: ["--name", "--python"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },
  { command: ["uv", "venv"], valueOptions: ["--no-seed", "--python"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }] },

  // アーカイブ解凍：モード（解凍 / 一覧 / 作成）で書き込み先が分かれる。
  // tar -f はモードで read（一覧・解凍）と write（作成・追記）が変わる（option-by-mode）。
  {
    command: ["tar"],
    valueOptions: ["-C", "--directory", "-f", "--file", "-T", "--files-from", "--transform", "--exclude", "-X"],
    writes: [
      { kind: "option", option: "-C", whenFlags: ["-x", "--extract", "--get"] },
      { kind: "option", option: "--directory", whenFlags: ["-x", "--extract", "--get"] },
      { kind: "cwd", whenFlags: ["-x", "--extract", "--get"] },
      { kind: "option-by-mode", option: "-f", readWhen: ["-x", "--extract", "--get", "-t", "--list"], writeWhen: ["-c", "--create", "-r", "--append", "-A", "--catenate", "-u", "--update"] },
    ],
    reads: [{ kind: "option-by-mode", option: "-f", readWhen: ["-x", "--extract", "--get", "-t", "--list"], writeWhen: ["-c", "--create", "-r", "--append", "-A", "--catenate", "-u", "--update"] }],
  },
  {
    command: ["unzip"],
    valueOptions: ["-d", "--dir", "-P", "--password", "-x", "--exclude", "-o"],
    writes: [
      { kind: "option", option: "-d", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
      { kind: "option", option: "--dir", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
      { kind: "cwd", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
    ],
  },
  { command: ["7z", "x"], valueOptions: ["-o"], writes: [{ kind: "option", option: "-o", attached: true }, { kind: "cwd" }] },
  { command: ["7za", "x"], valueOptions: ["-o"], writes: [{ kind: "option", option: "-o", attached: true }, { kind: "cwd" }] },
  { command: ["7z", "a"], valueOptions: ["-o"], writes: [{ kind: "positional", index: 0 }] },
  { command: ["7za", "a"], valueOptions: ["-o"], writes: [{ kind: "positional", index: 0 }] },
];
