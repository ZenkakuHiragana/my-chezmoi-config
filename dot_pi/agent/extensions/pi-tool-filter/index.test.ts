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
// - 管理ソースの実装ファイル群と展開後の実行時ファイル群、テンプレート出力と実行時`config.jsonc`の一致
// - `read`パスとBashの直接判定のallow優先、`write`パスのdeny優先、外部書き込みの既定拒否、`ask`を返さない二値判定
// - BashのAST、既知ラッパー、`find -exec` / `-execdir`、`find -delete`、`xargs`、shell `-c`の再帰検査
// - Python / Node.jsのインライン本文（`-c` / `-e`）とheredoc本文の再帰検査、`python -m`、`-EncodedCommand`復号
// - Bashの固定リダイレクトのread / write / read-write分類と、heredoc本文の言語別検査（データ消費コマンドは対象外）
// - `cd` / `Set-Location`後の相対パス、存在しないパス、Windowsパス、動的置換値の扱い
// - PowerShellの固定cmdlet集合、前置きオプション付き`-c` / `-Command`、標準AST縮退経路
// - 判定中に試験対象のファイルやディレクトリを作らないこと、試験用設定を最後に復元すること
//
// このため、実行前にchezmoiで対象拡張を展開し、Pi本体・解析依存・PowerShellを利用できる必要がある。
// リポジトリ内だけで完結する単体テストではなく、Pi拡張の実行時接続を含む安全な統合テストである。
import { registerDependencyTests } from "./tests/dependency.ts";
import { registerGlobTests } from "./tests/glob.ts";
import { registerPathTests } from "./tests/path.ts";
import { registerReasonTests } from "./tests/reason.ts";
import { registerScriptTests } from "./tests/script.ts";
import { registerSpecTests } from "./tests/specs.ts";
import { registerWriteTests } from "./tests/write.ts";

registerDependencyTests();
registerPathTests();
registerScriptTests();
registerSpecTests();
registerReasonTests();
registerWriteTests();
registerGlobTests();
