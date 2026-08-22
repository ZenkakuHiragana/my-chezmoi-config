export type RuleConfig = { allow: string[]; deny: string[] };
export type FilterConfig = {
  read: RuleConfig;
  write: RuleConfig;
  outsideDefault: "allow" | "deny";
  bash: RuleConfig;
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

export type CommandParts = { name: string; args: string[] };
export type PathRole = "read" | "write";
export type PowerShellCommand = { text: string; elements: string[] };
export type InterpreterMode = "inline" | "module" | "stdin" | "file" | "none";
export type ScriptCallTarget = { module?: string; name: string };
export type BashRedirect = {
  readonly paths: Array<readonly [string, PathRole]>;
  readonly ownerStart?: number;
};
export type BashHeredoc = { body: string; quoted: boolean; ownerStart: number };
