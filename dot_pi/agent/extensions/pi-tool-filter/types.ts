export type RuleConfig = { allow: string[]; deny: string[] };
export type FilterConfig = {
  read: RuleConfig;
  write: RuleConfig;
  outsideDefault: "allow" | "deny";
  bash: RuleConfig;
  // ssh のリモートコマンドの検査で、パスを判定しないことを表す。設定ファイルからは読まない（inspector.ts の pathlessConfig だけが設定する）。
  skipPathDecisions?: boolean;
};

export type BashNode = {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly parent?: BashNode | null;
  readonly isMissing?: boolean;
  child(index: number): BashNode | null;
  childForFieldName?(fieldName: string): BashNode | null;
};
export type BashTree = { readonly rootNode: BashNode; delete(): void };
export type BashParser = {
  parse(input: string): BashTree | null;
  setLanguage(language: unknown): void;
};
export type TreeSitterModule = {
  Parser: {
    new (): BashParser;
    init(options: { locateFile: () => string }): Promise<void>;
  };
  Language: { load(path: string): Promise<unknown> };
};

// args は、構文木で引用符のない変数展開やコマンド置換の節点（`$O`、`${O}`、`$(cmd)` など）として現れる語を含まない
// （コマンド Glob の照合とラッパーの解析が使う）。`$O/x` のように文字と連結した語は含む。
// argsWithExpansions は、それらの語も含めた引数列で、引数の位置が必要な判定（cp の宛先、cd の移動先、ssh の宛先）だけが使う。
// Bash の構文木から作るとき（commandParts）と、その入れ子のコマンド（ラッパー、xargs、find -exec の内側）で語の位置が一致するとき
// （nestedCommandParts）だけ設定する。設定されないときは args を使う。
export type CommandParts = { name: string; args: string[]; argsWithExpansions?: string[] };
export type PathRole = "read" | "write";
export type PowerShellCommand = { text: string; elements: string[] };
export type InterpreterMode = "inline" | "module" | "stdin" | "file" | "none";
export type ScriptCallTarget = { module?: string; name: string };
export type BashRedirect = {
  readonly paths: Array<readonly [string, PathRole]>;
  readonly ownerStart?: number;
};
export type BashHeredoc = { body: string; quoted: boolean; ownerStart: number };
