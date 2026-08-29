// 解釈層：bash コマンドの「代表的な使い方」がどこに読み書きするかを宣言する仕様テーブル。
//
// このファイルは解釈（どこに書き込む/読むか）だけを扱う。解釈結果への方針
// （allow / deny / outsideDefault）は config が所有し、ここには持たない。
//
// 対象は「挙動の安定したメジャーなツールの代表的な使い方」で、出力先が
// 位置引数・オプション値・現在の実行 cwd のいずれかで表せるものに限る。
// 副作用が複雑で代表的な形にならないもの（tar / unzip の解凍、npm install の
// 既存 node_modules 書き込み、python -m venv の引数解析など）は、このテーブルに
// 載せず「未知」として扱う。未知は遮断しない（要件契約 区別2）。
//
// flags が指定されると、そのフラグがすべて存在するときだけ仕様が一致する。
// 仕様に一致しない呼び出しは unknown(write) 扱いで、遮断しない（区別3 fail-open）。

// 書き込み先・読み込み先の取り出し規則。
// - positional: 位置引数（サブコマンド・オプションを除いた残り）の index 番目。
// - option: 値付きオプションの値（例: dotnet new -o <dir>、tar -C <dir>）。
// - cwd: 現在の実行 cwd を既定の出力先とする（例: clone の dir 省略）。
// whenFlags が指定されると、そのフラグがすべて存在するときだけ適用する。
// whenNotFlags が指定されると、そのフラグが1つでも存在すれば適用しない
// （tar の解凍・一覧・作成、unzip の一覧・検査などモード分岐に使う）。
// フラグ判定はクラスタ短縮（-xf 中の -x）も認識する。
export type TargetSelector = {
  kind: "positional" | "option" | "cwd";
  index?: number;
  option?: string;
  whenFlags?: readonly string[];
  whenNotFlags?: readonly string[];
};

export type ToolSpec = {
  // コマンドトークン列。["git","clone"] / ["gh","repo","fork"] / ["cargo","new"]。
  command: readonly string[];
  // このフラグがすべて args に存在するときだけ一致。
  flags?: readonly string[];
  // 値付きオプション。位置引数の番地を保つため、オプションの次の引数を消費する。
  valueOptions?: readonly string[];
  // 書き込み先の取り出し（複数あれば各々 path 方針を判定する）。
  writes: readonly TargetSelector[];
  // 読み込み先の取り出し。既定はなし。
  reads?: readonly TargetSelector[];
};

// git の代表的な値付きオプション（グローバル + clone / worktree 系）。
// 注意: `--[no-]recurse-submodules[=<pathspec>]` は値が省略可能（`=` 形のみ取引）なので
// ここに含めない（値を消費すると位置引数が崩れる）。
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
  // VCS 生成：書き込み先は明示 dir（positional 1）または現在の cwd。
  { command: ["git", "clone"], writes: [{ kind: "positional", index: 1 }, { kind: "cwd" }], valueOptions: GIT_VALUE_OPTIONS },
  { command: ["git", "init"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: GIT_VALUE_OPTIONS },
  { command: ["git", "worktree", "add"], writes: [{ kind: "positional", index: 0 }], valueOptions: GIT_VALUE_OPTIONS },
  { command: ["gh", "repo", "clone"], writes: [{ kind: "positional", index: 1 }, { kind: "cwd" }], valueOptions: GH_VALUE_OPTIONS },
  { command: ["gh", "repo", "fork"], flags: ["--clone"], writes: [{ kind: "cwd" }], valueOptions: GH_VALUE_OPTIONS },

  // 言語/テンプレート生成：出力先は位置引数（cargo new/init <path>）または cwd（既定）。
  { command: ["cargo", "new"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: ["--name", "--vcs", "--edition"] },
  { command: ["cargo", "init"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: ["--name", "--vcs", "--edition"] },
  { command: ["dotnet", "new"], writes: [{ kind: "option", option: "-o" }, { kind: "option", option: "--output" }, { kind: "cwd" }], valueOptions: ["-o", "--output", "--name", "-n"] },

  // パッケージ/スキャフォルド生成：既定で cwd に生成する。--prefix は出力先を変える。
  { command: ["npm", "init"], writes: [{ kind: "option", option: "--prefix" }, { kind: "cwd" }], valueOptions: ["-y", "--yes", "-w", "--workspace", "--scope", "--prefix"] },
  { command: ["npm", "create"], writes: [{ kind: "option", option: "--prefix" }, { kind: "cwd" }], valueOptions: ["-y", "--yes", "-w", "--workspace", "--prefix"] },
  { command: ["yarn", "create"], writes: [{ kind: "cwd" }], valueOptions: ["-y", "--yes"] },
  { command: ["pnpm", "create"], writes: [{ kind: "cwd" }], valueOptions: ["-y", "--yes"] },
  { command: ["bun", "init"], writes: [{ kind: "cwd" }], valueOptions: ["-y", "--yes"] },
  { command: ["bun", "create"], writes: [{ kind: "cwd" }], valueOptions: ["-y", "--yes"] },

  // モジュール初期化：既定で cwd に書き込む。
  { command: ["go", "mod", "init"], writes: [{ kind: "cwd" }], valueOptions: ["-go", "-v"] },

  // 環境構築：python -m venv は pythonModuleArgs の再検査で "venv <path>" として到達する。
  { command: ["venv"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: ["--clear", "--upgrade", "--prompt"] },
  { command: ["uv", "init"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: ["--name", "--python"] },
  { command: ["uv", "venv"], writes: [{ kind: "positional", index: 0 }, { kind: "cwd" }], valueOptions: ["--no-seed", "--python"] },

  // アーカイブ解凍：モード（解凍 / 一覧 / 作成）で書き込み先が分かれる。
  { command: ["tar"], valueOptions: ["-C", "--directory", "-f", "--file", "-T", "--files-from", "--transform", "--exclude", "-X"], writes: [
    { kind: "option", option: "-C", whenFlags: ["-x", "--extract", "--get"] },
    { kind: "option", option: "--directory", whenFlags: ["-x", "--extract", "--get"] },
    { kind: "cwd", whenFlags: ["-x", "--extract", "--get"] },
  ] },
  { command: ["unzip"], valueOptions: ["-d", "--dir", "-P", "--password", "-x", "--exclude", "-o"], writes: [
    { kind: "option", option: "-d", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
    { kind: "option", option: "--dir", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
    { kind: "cwd", whenNotFlags: ["-l", "-t", "-v", "-Z"] },
  ] },
  { command: ["7z", "x"], writes: [{ kind: "cwd" }] },
  { command: ["7za", "x"], writes: [{ kind: "cwd" }] },
  { command: ["7z", "a"], writes: [{ kind: "positional", index: 0 }] },
  { command: ["7za", "a"], writes: [{ kind: "positional", index: 0 }] },
];
