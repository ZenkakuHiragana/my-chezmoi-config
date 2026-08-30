import type { BashNode, CommandParts, InterpreterMode, PathRole, ScriptCallTarget } from "./types.ts";
import { commandBasename } from "./command.ts";
import { isStaticPathValue, resolveExistingPath } from "./path-policy.ts";

export const PYTHON_NAMES = new Set(["python", "python3", "py"]);
export const NODE_NAMES = new Set(["node", "nodejs"]);

const SUBPROCESS_CALL_NAMES = new Set(["run", "call", "Popen", "check_call", "check_output"]);
const OS_COMMAND_NAMES = new Set(["system", "popen"]);
const PYTHON_FILE_WRITE_NAMES = new Set(["remove", "unlink", "rename", "replace"]);
const NODE_FILE_READ_NAMES = new Set(["readFile", "readFileSync"]);
const NODE_FILE_WRITE_NAMES = new Set(["writeFile", "writeFileSync", "rm", "rmSync", "unlink", "unlinkSync", "rename", "renameSync"]);
const NODE_CHILD_PROCESS_NAMES = new Set(["exec", "execSync", "spawn", "spawnSync", "execFile", "execFileSync", "fork"]);
export const NODE_SHELL_STRING_NAMES = new Set(["exec", "execSync"]);
export const NODE_FORK_NAME = "fork";

// ---- スクリプト本文の抽出と復元（python / node / PowerShell -EncodedCommand / heredoc） ----

// python / node 等の実行時オプション走査の終端。最初のオプションでない引数
// （スクリプトファイル）が現れると、それ以降の -c / -e / -m はスクリプトの
// 引数であり、インライン本文やモジュール実行としては扱わない。
// 値付きオプションはここでは解釈せず、その値をスクリプトファイルとして扱う。
// その奥の -c / -e / -m は検査されず、別の拒否条件がなければ許可される。
export function interpreterOptionStop(args: readonly string[]): number {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") return index;
    if (value.startsWith("-")) continue;
    return index;
  }
  return args.length;
}

// インタープリターの実行モード。最初に現れた本文源（-c / -m / - / ファイル）が勝つ。
// python / node の CLI は -c・-m・ファイル・-（stdin）のうち先に来たものが本文源になり、
// 残りは argv として渡る。値付きオプションは解釈せず、その値をファイルとして先に扱うため、
// その奥のフラグは検査されない。
export function interpreterMode(args: readonly string[], inlineFlags: readonly string[], stdinFlags: readonly string[] = []): InterpreterMode {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") return "file";
    if (value === "-") return "stdin";
    if (inlineFlags.some((flag) => value === flag || value.startsWith(flag))) return "inline";
    if (value === "-m" || value.startsWith("-m")) return "module";
    if (stdinFlags.some((flag) => value === flag)) return "stdin";
    if (value.startsWith("-")) continue;
    return "file";
  }
  return "none";
}

export function pythonBodyFromInline(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-c") return args[index + 1];
    const combined = value.match(/^-c([\s\S]+)$/);
    if (combined) return combined[1];
  }
  return undefined;
}

export function nodeBodyFromInline(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-e" || value === "--eval" || value === "-p" || value === "--print") return args[index + 1];
    const combined = value.match(/^(-e|--eval|-p|--print)([\s\S]+)$/);
    if (combined) return combined[2].replace(/^=/, ""); // `--eval=<本文>` の = を除去する
  }
  return undefined;
}

export function extractPythonBody(parts: CommandParts): string | undefined {
  if (!PYTHON_NAMES.has(commandBasename(parts.name))) return undefined;
  if (interpreterMode(parts.args, ["-c"]) !== "inline") return undefined;
  return pythonBodyFromInline(parts.args);
}

export function extractNodeBody(parts: CommandParts): string | undefined {
  if (!NODE_NAMES.has(commandBasename(parts.name))) return undefined;
  if (interpreterMode(parts.args, ["-e", "--eval", "-p", "--print"]) !== "inline") return undefined;
  return nodeBodyFromInline(parts.args);
}

function unescapeCommon(content: string, mode: "python" | "js"): string | undefined {
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== "\\") { result += char; continue; }
    const next = content[index + 1];
    if (next === undefined) return undefined;
    const simple: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "0": "\0" };
    if (simple[next] !== undefined) { result += simple[next]; index += 1; continue; }
    if (next === "x") {
      const hex = content.slice(index + 2, index + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { result += String.fromCharCode(parseInt(hex, 16)); index += 3; continue; }
      return undefined;
    }
    if (next === "u") {
      if (content[index + 2] === "{" && content[index + 3] !== undefined) {
        if (mode !== "js") return undefined;
        const close = content.indexOf("}", index + 2);
        if (close < 0) return undefined;
        const hex = content.slice(index + 3, close);
        if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
          const codePoint = parseInt(hex, 16);
          if (codePoint <= 0x10ffff) { result += String.fromCodePoint(codePoint); index = close; continue; }
        }
        return undefined;
      }
      const hex = content.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { result += String.fromCharCode(parseInt(hex, 16)); index += 5; continue; }
      return undefined;
    }
    if (next === "U" && mode === "python") {
      const hex = content.slice(index + 2, index + 10);
      if (/^[0-9a-fA-F]{8}$/.test(hex)) {
        const codePoint = parseInt(hex, 16);
        if (codePoint <= 0x10ffff) { result += String.fromCodePoint(codePoint); index += 9; continue; }
      }
      return undefined;
    }
    return undefined;
  }
  return result;
}

export function pythonStringValue(node: BashNode): string | undefined {
  const text = node.text;
  const prefix = text.match(/^[rRuUbBfF]*/)?.[0] ?? "";
  if (prefix.includes("f") || prefix.includes("F") || prefix.includes("b") || prefix.includes("B")) return undefined;
  const rest = text.slice(prefix.length);
  if (rest.length < 2) return undefined;
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return undefined;
  const triple = rest.startsWith(quote.repeat(3));
  const close = triple ? rest.lastIndexOf(quote.repeat(3)) : rest.lastIndexOf(quote);
  if (close < (triple ? 3 : 1)) return undefined;
  const content = rest.slice(triple ? 3 : 1, close);
  return prefix.includes("r") || prefix.includes("R") ? content : unescapeCommon(content, "python");
}

export function jsStringValue(node: BashNode): string | undefined {
  const text = node.text;
  if (text.length < 2) return undefined;
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
  if (quote === "`" && text.includes("${")) return undefined;
  return unescapeCommon(text.slice(1, -1), "js");
}

// argv 要素を再構成トークンへ変換する。シェルが構文として解釈し得る文字
// （空白・展開・メタ文字）を含む要素は任意一致 `*` にする。join の単語分割の
// 曖昧さと、シェル=False で実行されるリテラルが bash 構文として誤解釈される
// ことを防ぐ。拒否は「値によらず一致が証明できる場合」だけに働く。
export function argvToken(value: string): string {
  return /[\s$`\\;&|<>()]/.test(value) ? "*" : value;
}

export function concatenatedValue(node: BashNode): string | undefined {
  let result = "";
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child?.type !== "string") continue;
    const value = pythonStringValue(child);
    if (value === undefined) return undefined;
    result += value;
  }
  return result;
}

export function pythonSequenceTokens(node: BashNode): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "string") tokens.push(argvToken(pythonStringValue(child) ?? "*"));
    else if (child.type === "concatenated_string") tokens.push(argvToken(concatenatedValue(child) ?? "*"));
    else tokens.push("*");
  }
  return tokens;
}

export function pythonSequenceFirstLiteral(node: BashNode): string | undefined {
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "string") return pythonStringValue(child);
    if (child.type === "concatenated_string") return concatenatedValue(child);
    return undefined;
  }
  return undefined;
}

export function pythonCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode) return undefined;
  if (fnNode.type === "attribute") {
    const objectNode = fnNode.childForFieldName?.("object");
    const attrNode = fnNode.childForFieldName?.("attribute");
    if (!objectNode || !attrNode || objectNode.type !== "identifier") return undefined;
    const module = objectNode.text.trim();
    const name = attrNode.text.trim();
    return (module === "subprocess" && SUBPROCESS_CALL_NAMES.has(name)) || (module === "os" && OS_COMMAND_NAMES.has(name))
      ? { module, name }
      : undefined;
  }
  if (fnNode.type === "identifier") {
    const name = fnNode.text.trim();
    return SUBPROCESS_CALL_NAMES.has(name) ? { name } : undefined;
  }
  return undefined;
}

export function nodeCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode) return undefined;
  if (fnNode.type === "identifier") {
    const name = fnNode.text.trim();
    return NODE_CHILD_PROCESS_NAMES.has(name) ? { name } : undefined;
  }
  if (fnNode.type === "member_expression") {
    const property = fnNode.childForFieldName?.("property");
    if (property) {
      const name = property.type === "property_identifier" ? property.text.trim() : property.type === "string" ? jsStringValue(property) : undefined;
      if (name !== undefined && NODE_CHILD_PROCESS_NAMES.has(name)) return { name };
    }
  }
  if (fnNode.type === "subscript_expression") {
    // プロパティ側（ブラケット内）だけを見る。オブジェクト側の文字列を誤認しない。
    // 動的な名前解決の網羅はしない（契約の「含まない範囲」）。ここまでの対応は
    // 文字列・補間なしテンプレート・括弧付きの静的な形に限る。
    let indexNode = fnNode.childForFieldName?.("index");
    // 括弧付き（`[('execSync')]` 等）は内側の式を辿る
    for (let hops = 0; hops < 3 && indexNode?.type === "parenthesized_expression"; hops += 1) {
      for (let i = 0; i < indexNode.childCount; i += 1) {
        const child = indexNode.child(i);
        if (child && child.type !== "(" && child.type !== ")") { indexNode = child; break; }
      }
    }
    const candidates = indexNode ? [indexNode] : [];
    if (!indexNode) {
      for (let index = 1; index < fnNode.childCount; index += 1) {
        const child = fnNode.child(index);
        if (child) candidates.push(child);
      }
    }
    for (const child of candidates) {
      let name: string | undefined;
      if (child.type === "string") name = jsStringValue(child);
      else if (child.type === "template_string" && !child.text.includes("${")) name = jsStringValue(child);
      if (name !== undefined && NODE_CHILD_PROCESS_NAMES.has(name)) return { name };
    }
  }
  return undefined;
}

export function pythonStaticStringValue(node: BashNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "string") return pythonStringValue(node);
  if (node.type === "concatenated_string") return concatenatedValue(node);
  return undefined;
}

export function pythonFileCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode) return undefined;
  if (fnNode.type === "identifier" && fnNode.text.trim() === "open") return { name: "open" };
  if (fnNode.type !== "attribute") return undefined;
  const objectNode = fnNode.childForFieldName?.("object");
  const attrNode = fnNode.childForFieldName?.("attribute");
  if (!objectNode || !attrNode || objectNode.type !== "identifier") return undefined;
  const module = objectNode.text.trim();
  const name = attrNode.text.trim();
  if (module === "io" && name === "open") return { module, name };
  if (module === "os" && PYTHON_FILE_WRITE_NAMES.has(name)) return { module, name };
  return undefined;
}

export function pythonFileModeRoles(mode: string): PathRole[] | undefined {
  if (!/^[rwax](?:[bt+]|U)*$/.test(mode)) return undefined;
  const base = mode[0];
  const roles: PathRole[] = [];
  if (base === "r" || mode.includes("+")) roles.push("read");
  if (base === "w" || base === "a" || base === "x" || mode.includes("+")) roles.push("write");
  return roles.length > 0 ? roles : undefined;
}

export function pythonFilePathRoles(node: BashNode, target: ScriptCallTarget): Array<readonly [string, PathRole]> {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return [];
  const keywords = pythonCallKeywords(argsNode);
  const items = pythonPositionalArgs(argsNode);
  const positionalOrKeyword = (index: number, keyword: string) => pythonStaticStringValue(items[index] ?? keywords.get(keyword));

  if (target.module === "os") {
    if (target.name === "remove" || target.name === "unlink") {
      const path = positionalOrKeyword(0, "path");
      return path ? [[path, "write"]] : [];
    }
    const source = positionalOrKeyword(0, "src");
    const destination = positionalOrKeyword(1, "dst");
    return [source, destination].filter((value): value is string => value !== undefined).map((value) => [value, "write"] as const);
  }

  const path = positionalOrKeyword(0, "file");
  if (path === undefined) return [];
  const modeNode = items[1] ?? keywords.get("mode");
  const mode = modeNode ? pythonStaticStringValue(modeNode) : "r";
  if (mode === undefined) return [];
  return (pythonFileModeRoles(mode) ?? []).map((role) => [path, role] as const);
}

export function nodeCallArguments(node: BashNode): BashNode[] {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return [];
  const items: BashNode[] = [];
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    items.push(child);
  }
  return items;
}

export function nodeRequiredModulePath(node: BashNode | null | undefined): string | undefined {
  if (!node || node.type !== "call_expression") return undefined;
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode || fnNode.type !== "identifier" || fnNode.text.trim() !== "require") return undefined;
  const moduleName = jsStringValueOf(nodeCallArguments(node)[0]);
  return moduleName === "fs" || moduleName === "node:fs" || moduleName === "fs/promises" ? moduleName : undefined;
}

export function nodeFsModulePath(node: BashNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "identifier" && node.text.trim() === "fs") return "fs";
  const required = nodeRequiredModulePath(node);
  if (required) return required;
  if (node.type !== "member_expression") return undefined;
  const property = node.childForFieldName?.("property");
  if (!property || property.type !== "property_identifier" || property.text.trim() !== "promises") return undefined;
  const object = nodeFsModulePath(node.childForFieldName?.("object"));
  return object === "fs" || object === "node:fs" ? "fs/promises" : undefined;
}

export function nodeFileCallTarget(node: BashNode): ScriptCallTarget | undefined {
  const fnNode = node.childForFieldName?.("function");
  if (!fnNode || fnNode.type !== "member_expression") return undefined;
  const property = fnNode.childForFieldName?.("property");
  if (!property || property.type !== "property_identifier") return undefined;
  const name = property.text.trim();
  const module = nodeFsModulePath(fnNode.childForFieldName?.("object"));
  if (!module) return undefined;
  return NODE_FILE_READ_NAMES.has(name) || NODE_FILE_WRITE_NAMES.has(name) ? { module, name } : undefined;
}

export function nodeFilePathRoles(node: BashNode, target: ScriptCallTarget): Array<readonly [string, PathRole]> {
  const items = nodeCallArguments(node);
  if (NODE_FILE_WRITE_NAMES.has(target.name) && (target.name === "rename" || target.name === "renameSync")) {
    return items.slice(0, 2)
      .map((item) => jsStringValueOf(item))
      .filter((value): value is string => value !== undefined)
      .map((value) => [value, "write"] as const);
  }
  const path = jsStringValueOf(items[0]);
  if (path === undefined) return [];
  return [[path, NODE_FILE_READ_NAMES.has(target.name) ? "read" : "write"]];
}

export function jsArrayTokens(node: BashNode): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child || child.type === "[" || child.type === "]" || child.type === ",") continue;
    if (child.type === "string") tokens.push(argvToken(jsStringValue(child) ?? "*"));
    else if (child.type === "template_string") tokens.push(argvToken(jsStringValue(child) ?? "*"));
    else tokens.push("*");
  }
  return tokens;
}

export function jsStringValueOf(node: BashNode | undefined): string | undefined {
  return node && (node.type === "string" || node.type === "template_string") ? jsStringValue(node) : undefined;
}

export function jsObjectCwd(options: BashNode | undefined, cwd: string): string {
  if (!options) return cwd;
  for (let index = 0; index < options.childCount; index += 1) {
    const child = options.child(index);
    if (child?.type !== "pair") continue;
    const key = child.child(0);
    if (key?.type !== "property_identifier" || key.text.trim() !== "cwd") continue;
    const value = child.childCount > 2 ? child.child(2) : undefined;
    const literal = value ? jsStringValueOf(value) : undefined;
    return literal && isStaticPathValue(literal) ? resolveExistingPath(literal, cwd) : cwd;
  }
  return cwd;
}

export function pythonCallKeywords(argsNode: BashNode): Map<string, BashNode> {
  const keywords = new Map<string, BashNode>();
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (child?.type !== "keyword_argument") continue;
    const nameNode = child.child(0);
    const valueNode = child.childCount > 2 ? child.child(2) : undefined;
    if (nameNode?.type === "identifier" && valueNode) keywords.set(nameNode.text.trim(), valueNode);
  }
  return keywords;
}

export function pythonPositionalArgs(argsNode: BashNode): BashNode[] {
  const items: BashNode[] = [];
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "," || child.type === "(" || child.type === ")" || child.type === "keyword_argument") continue;
    items.push(child);
  }
  return items;
}


export function pythonModuleArgs(args: readonly string[]): { module: string; rest: string[] } | undefined {
  if (interpreterMode(args, ["-c"]) !== "module") return undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-m") {
      const module = args[index + 1];
      return module ? { module, rest: args.slice(index + 2) } : undefined;
    }
    const combined = value.match(/^-m(.+)$/);
    if (combined) return { module: combined[1], rest: args.slice(index + 1) };
  }
  return undefined;
}
