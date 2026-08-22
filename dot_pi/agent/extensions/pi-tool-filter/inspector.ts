import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type {
  BashHeredoc,
  BashNode,
  BashRedirect,
  BashTree,
  CommandParts,
  FilterConfig,
  ScriptCallTarget,
} from "./types.ts";
import {
  BASH_SHELL_NAMES,
  BASH_WRAPPER_NAMES,
  HEREDOC_EXPANSION_CHARS,
  bashPathRoles,
  bashWorkingDirectory,
  checkBashValues,
  commandBasename,
  commandParts,
  commandValues,
  envWorkingDirectory,
  extractShellBody,
  findBashRedirects,
  findNestedCommands,
  simpleBashRedirectRoles,
  simpleCommandCandidates,
  wrappedCommandArgs,
  xargsCommandArgs,
} from "./command.ts";
import {
  POWER_SHELL_NAMES,
  checkPowerShellBody,
  extractPowerShellBody,
  extractPowerShellEncodedBody,
  inspectPowerShellCommandText,
  powershellWorkingDirectoryOption,
} from "./power-shell.ts";
import {
  NODE_FORK_NAME,
  NODE_NAMES,
  NODE_SHELL_STRING_NAMES,
  PYTHON_NAMES,
  argvToken,
  concatenatedValue,
  extractNodeBody,
  extractPythonBody,
  interpreterMode,
  interpreterOptionStop,
  jsArrayTokens,
  jsObjectCwd,
  jsStringValue,
  jsStringValueOf,
  nodeCallTarget,
  nodeFileCallTarget,
  nodeFilePathRoles,
  pythonCallKeywords,
  pythonCallTarget,
  pythonFileCallTarget,
  pythonFilePathRoles,
  pythonModuleArgs,
  pythonPositionalArgs,
  pythonSequenceFirstLiteral,
  pythonSequenceTokens,
  pythonStringValue,
} from "./script-helpers.ts";
import {
  findCommandNodes,
  getBashParser,
  getParser,
  treeHasSyntaxError,
} from "./parser.ts";
import { isStaticPathValue, pathRoleDecisions, resolveExistingPath } from "./path-policy.ts";

async function inspectPythonBody(body: string, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd) {
  // コメント行は任意のインデントで書けるため、最初の非空・非コメント行を見る。
  // トップレベルのインデントは IndentationError で実行されない。
  const firstStatement = body.split("\n").map((line) => line.trimEnd()).find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  }) ?? "";
  if (/^[ \t]/.test(firstStatement)) return undefined;
  const parser = await getParser("python");
  if (!parser) return undefined;
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(body);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return undefined;
    // トップレベル文をソース順に処理し、os.chdir を実行 cwd の置換として追跡する。
    // 関数定義・条件分岐内の chdir は追跡しない（cd 追跡と同じ静的リテラルの扱い）。
    let currentCwd = cwd;
    const root = tree.rootNode;
    for (let index = 0; index < root.childCount; index += 1) {
      const statement = root.child(index);
      if (!statement) continue;
      const decision = await inspectPythonStatementCalls(statement, config, currentCwd, depth, boundaryCwd);
      if (decision) return decision;
      const chdir = pythonChdirTarget(statement);
      if (chdir) currentCwd = resolveExistingPath(chdir, currentCwd);
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    tree?.delete();
  }
}

async function inspectPythonStatementCalls(statement: BashNode, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string): Promise<ToolCallEventResult | undefined> {
  const stack = [statement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "call") {
      const fileTarget = pythonFileCallTarget(node);
      if (fileTarget) {
        const decision = pathRoleDecisions(pythonFilePathRoles(node, fileTarget), cwd, config, boundaryCwd);
        if (decision) return decision;
      }
      const commandTarget = pythonCallTarget(node);
      if (commandTarget) {
        const decision = await inspectPythonCall(node, commandTarget, config, cwd, depth, boundaryCwd);
        if (decision) return decision;
      }
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return undefined;
}

// トップレベルの os.chdir(<静的パス>) 呼び出し文から、実行 cwd の置換値を取り出す。
// 式の直接の呼び出しだけを追跡し、代入・条件・関数内に埋め込まれた呼び出しは追跡しない。
function pythonChdirTarget(statement: BashNode): string | undefined {
  if (statement.type !== "expression_statement") return undefined;
  let callNode: BashNode | undefined;
  for (let index = 0; index < statement.childCount; index += 1) {
    const child = statement.child(index);
    if (child?.type === "call") { callNode = child; break; }
  }
  if (!callNode) return undefined;
  const fnNode = callNode.childForFieldName?.("function");
  if (!fnNode || fnNode.type !== "attribute") return undefined;
  const objectNode = fnNode.childForFieldName?.("object");
  const attrNode = fnNode.childForFieldName?.("attribute");
  if (!objectNode || !attrNode || objectNode.type !== "identifier" || objectNode.text.trim() !== "os") return undefined;
  if (attrNode.text.trim() !== "chdir") return undefined;
  const argsNode = callNode.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    let value: string | undefined;
    if (child.type === "string") value = pythonStringValue(child);
    else if (child.type === "concatenated_string") value = concatenatedValue(child);
    return value !== undefined && isStaticPathValue(value) ? value : undefined;
  }
  return undefined;
}

async function inspectPythonCall(node: BashNode, target: ScriptCallTarget, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string) {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  const keywords = pythonCallKeywords(argsNode);
  const items = pythonPositionalArgs(argsNode);
  const first = items[0] ?? keywords.get("args") ?? (target.module === "os" ? keywords.get("command") ?? keywords.get("cmd") : undefined);
  if (!first) return undefined;
  const shell = keywords.get("shell")?.type === "true";
  let execCwd = cwd;
  const cwdNode = keywords.get("cwd");
  if (cwdNode?.type === "string" || cwdNode?.type === "concatenated_string") {
    const value = cwdNode.type === "string" ? pythonStringValue(cwdNode) : concatenatedValue(cwdNode);
    if (value) execCwd = resolveExistingPath(value, cwd);
  }
  let text: string | undefined;
  if (target.module === "os") {
    if (first.type === "string") text = pythonStringValue(first);
    else if (first.type === "concatenated_string") text = concatenatedValue(first);
    else text = "*"; // 非リテラルは任意一致として再構成（値によらず一致が証明できる場合のみ拒否）
  } else if (first.type === "list" || first.type === "tuple") {
    if (shell) text = pythonSequenceFirstLiteral(first);
    else {
      const tokens = pythonSequenceTokens(first);
      if (tokens.length > 0) text = tokens.join(" ");
    }
  } else if (first.type === "string") {
    const value = pythonStringValue(first);
    if (value !== undefined) text = shell ? value : argvToken(value);
  } else if (first.type === "concatenated_string") {
    const value = concatenatedValue(first);
    if (value !== undefined) text = shell ? value : argvToken(value);
  } else {
    text = "*"; // 非リテラルは任意一致として再構成
  }
  if (text) {
    const decision = await inspectBash(text, config, execCwd, depth + 1, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}

async function inspectNodeJsBody(body: string, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd) {
  const parser = await getParser("javascript");
  if (!parser) return undefined;
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(body);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return undefined;
    // トップレベル文をソース順に処理し、process.chdir を実行 cwd の置換として追跡する。
    let currentCwd = cwd;
    const root = tree.rootNode;
    for (let index = 0; index < root.childCount; index += 1) {
      const statement = root.child(index);
      if (!statement) continue;
      const decision = await inspectNodeJsStatementCalls(statement, config, currentCwd, depth, boundaryCwd);
      if (decision) return decision;
      const chdir = nodeChdirTarget(statement);
      if (chdir) currentCwd = resolveExistingPath(chdir, currentCwd);
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    tree?.delete();
  }
}

async function inspectNodeJsStatementCalls(statement: BashNode, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string): Promise<ToolCallEventResult | undefined> {
  const stack = [statement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "call_expression") {
      const fileTarget = nodeFileCallTarget(node);
      if (fileTarget) {
        const decision = pathRoleDecisions(nodeFilePathRoles(node, fileTarget), cwd, config, boundaryCwd);
        if (decision) return decision;
      }
      const commandTarget = nodeCallTarget(node);
      if (commandTarget) {
        const decision = await inspectNodeJsCall(node, commandTarget, config, cwd, depth, boundaryCwd);
        if (decision) return decision;
      }
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return undefined;
}

// トップレベルの process.chdir(<静的パス>) 呼び出し文から、実行 cwd の置換値を取り出す。
function nodeChdirTarget(statement: BashNode): string | undefined {
  if (statement.type !== "expression_statement") return undefined;
  let callNode: BashNode | undefined;
  for (let index = 0; index < statement.childCount; index += 1) {
    const child = statement.child(index);
    if (child?.type === "call_expression") { callNode = child; break; }
  }
  if (!callNode) return undefined;
  const fnNode = callNode.childForFieldName?.("function");
  if (!fnNode || fnNode.type !== "member_expression") return undefined;
  const objectNode = fnNode.childForFieldName?.("object");
  const propertyNode = fnNode.childForFieldName?.("property");
  if (!objectNode || !propertyNode || objectNode.type !== "identifier" || objectNode.text.trim() !== "process") return undefined;
  if (propertyNode.type !== "property_identifier" || propertyNode.text.trim() !== "chdir") return undefined;
  const argsNode = callNode.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    const value = child.type === "string" || child.type === "template_string" ? jsStringValue(child) : undefined;
    return value !== undefined && isStaticPathValue(value) ? value : undefined;
  }
  return undefined;
}

async function inspectNodeJsCall(node: BashNode, target: ScriptCallTarget, config: FilterConfig, cwd: string, depth: number, boundaryCwd: string) {
  const argsNode = node.childForFieldName?.("arguments");
  if (!argsNode) return undefined;
  const items: BashNode[] = [];
  for (let index = 0; index < argsNode.childCount; index += 1) {
    const child = argsNode.child(index);
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    items.push(child);
  }
  const options = [...items].reverse().find((item) => item.type === "object");
  const execCwd = jsObjectCwd(options, cwd);
  let text: string | undefined;
  if (NODE_SHELL_STRING_NAMES.has(target.name)) {
    const value = items[0] ? jsStringValueOf(items[0]) ?? "*" : "*"; // exec 系は常にシェル経由。非リテラルは任意一致として再構成
    text = value;
  } else if (target.name === NODE_FORK_NAME) {
    const moduleToken = argvToken(items[0] ? jsStringValueOf(items[0]) ?? "*" : "*");
    const argTokens = items[1]?.type === "array" ? jsArrayTokens(items[1]) : [];
    text = ["node", moduleToken, ...argTokens].join(" ");
  } else {
    const cmdToken = items[0] ? argvToken(jsStringValueOf(items[0]) ?? "*") : "*";
    const argTokens = items[1]?.type === "array" ? jsArrayTokens(items[1]) : [];
    text = [cmdToken, ...argTokens].join(" ");
  }
  if (text) {
    const decision = await inspectBash(text, config, execCwd, depth + 1, boundaryCwd);
    if (decision) return decision;
  }
  return undefined;
}

function findStatementCommands(statement: BashNode): BashNode[] {
  const found: BashNode[] = [];
  const stack = [statement];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "command") { found.push(node); continue; }
    // ネストした redirected_statement のコマンドは、別の heredoc が処理する
    if (node.type === "redirected_statement" && node !== statement) continue;
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return found;
}
function findBashHeredocs(root: BashNode, rawText: string): BashHeredoc[] {
  const heredocs: BashHeredoc[] = [];
  const stack = [root];
  const statementCommands = new Map<number, BashNode[]>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "heredoc_redirect") {
      const statement = node.parent;
      if (statement?.type === "redirected_statement") {
        // 同一 statement のコマンド探索は heredoc ごとに繰り返さない
        let commands = statementCommands.get(statement.startIndex);
        if (!commands) {
          commands = findStatementCommands(statement);
          statementCommands.set(statement.startIndex, commands);
        }
        // 本文を消費するコマンドは、構文上この heredoc に最も近いコマンド。
        // 通常は直前（`A && B <<'PY'` は B、`python <<'PY' | cat` は python）だが、
        // リダイレクト前置形（`<<'PY' python`）では直後になる。
        let ownerStart = -1;
        let bestEnd = -1;
        let bestStart = -1;
        for (const command of commands) {
          if (command.endIndex <= node.startIndex && command.endIndex > bestEnd) {
            bestEnd = command.endIndex;
            ownerStart = command.startIndex;
          }
          if (command.startIndex >= node.endIndex && (bestStart < 0 || command.startIndex < bestStart)) {
            bestStart = command.startIndex;
          }
        }
        if (ownerStart < 0) ownerStart = bestStart;
        let quoted = false;
        let tabStrip = false;
        let bodyStart = -1;
        let bodyEnd = -1;
        for (let index = 0; index < node.childCount; index += 1) {
          const child = node.child(index);
          if (child?.type === "heredoc_start") {
            quoted = child.text.startsWith("'") || child.text.startsWith('"');
            bodyStart = child.endIndex;
          } else if (child?.type === "heredoc_end") {
            bodyEnd = child.startIndex;
          } else if (child?.text === "<<-") {
            tabStrip = true;
          }
        }
        if (ownerStart >= 0 && bodyStart >= 0 && bodyEnd > bodyStart) {
          // tree-sitter-bash のオフセットは UTF-16 コード単位に等しく、
          // heredoc の本文開始は「開始デリミタ行の最初の改行の直後」で始まる。
          // パイプライン等で開始行に後続トークン（| cat 等）が続く場合は、
          // heredoc_start の直後ではなく改行位置から切り出す。
          const lineBreak = rawText.indexOf("\n", bodyStart);
          const contentStart = lineBreak >= 0 && lineBreak < bodyEnd ? lineBreak + 1 : bodyStart;
          let body = rawText.slice(contentStart, bodyEnd).replace(/^\r/, "");
          if (tabStrip) body = body.split("\n").map((line) => line.replace(/^\t+/, "")).join("\n");
          if (body.trim()) heredocs.push({ body, quoted, ownerStart });
        }
      }
    }
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return heredocs;
}

// heredoc 本文を消費する実効コマンドを、既知ラッパーを剥いたうえで決める。
// 本文をコードとして実行せずデータとしてのみ消費する呼び出し（-c / -e 併用や
// スクリプトファイル指定）は検査対象外とする。
async function inspectHeredocBody(body: string, parts: CommandParts, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd): Promise<ToolCallEventResult | undefined> {
  let effective = parts;
  let hops = 0;
  // ラッパー剥き。多段（2 段以上）は意図的回避の典型であり、網羅しない
  // （契約の「含まない範囲」）。現行の上限と深さガードは維持し、これ以上は拡張しない。
  for (let index = 0; index < 5; index += 1) {
    const wrapperName = commandBasename(effective.name);
    if (!BASH_WRAPPER_NAMES.has(wrapperName)) break;
    // `command -v python` などの照会形は対象コマンドを実行しない。
    // heredoc は実行されないデータとして扱う
    if (wrapperName === "command" && (effective.args[0]?.startsWith("-") ?? false)) return undefined;
    const nestedArgs = wrappedCommandArgs(wrapperName, effective.args);
    if (nestedArgs.length === 0) break;
    effective = { name: nestedArgs[0], args: nestedArgs.slice(1) };
    hops += 1;
  }
  if (depth + hops >= 3) return undefined; // ラッパー段数も既存の深さ制限に数える
  const effectiveDepth = depth + hops;
  const base = commandBasename(effective.name);
  if (BASH_SHELL_NAMES.has(base)) {
    const inline = extractShellBody(effective);
    // `-s` は stdin を本文として実行するが、-c が同時にある場合は -c が勝ち、
    // スクリプトファイルが先行すればその引数になる
    const readsStdin = inline === undefined && interpreterMode(effective.args, ["-c"], ["-s"]) === "stdin";
    if (!readsStdin && inline !== undefined) return undefined;
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectBash(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (PYTHON_NAMES.has(base)) {
    if (extractPythonBody(effective) !== undefined) return undefined;
    if (pythonModuleArgs(effective.args)) return undefined;
    // `-`（stdin 本文）がモードのときは、後続の位置引数があっても検査する
    const readsStdin = interpreterMode(effective.args, ["-c"]) === "stdin";
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectPythonBody(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (NODE_NAMES.has(base)) {
    if (extractNodeBody(effective) !== undefined) return undefined;
    // `-`（stdin 本文）がモードのときは、後続の位置引数があっても検査する
    const readsStdin = interpreterMode(effective.args, ["-e", "--eval", "-p", "--print"]) === "stdin";
    const stop = interpreterOptionStop(effective.args);
    if (!readsStdin && stop < effective.args.length) return undefined;
    return inspectNodeJsBody(body, config, cwd, effectiveDepth + 1, boundaryCwd);
  }
  if (POWER_SHELL_NAMES.has(base)) {
    // -File の値が `-` の場合は stdin 本文を実行するため、後続の位置引数は
    // スクリプトの引数であり、PowerShell 本体のオプションとして扱わない
    const fileIsStdin = effective.args.some((value, index) => /^-+file$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] === "-");
    if (fileIsStdin) return checkPowerShellBody(body, config, cwd, boundaryCwd);
    const argsText = [effective.name, ...effective.args].join(" ");
    const inlineBody = extractPowerShellBody(argsText);
    // `-Command -` は stdin を本文として実行するため、heredoc 本文はデータではない。
    // 値が空文字列の -Command / -c も同様にデータ消費。
    // （値の無い -Command は stdin 本文の実行形であり、空文字列の値を持つ場合のみデータ）
    const hasEmptyCommandValue = effective.args.some((value, index) => /^-+(?:command|c)$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] === "");
    // -EncodedCommand は値の復号可否に関わらず heredoc 本文を実行しない（復号不能は検査不能）
    const hasEncodedOption = effective.args.some((value) => /^-+(?:encodedcommand|enc)$/i.test(value));
    if ((inlineBody !== undefined && inlineBody.trim() !== "-") || hasEncodedOption || hasEmptyCommandValue) return undefined;
    const hasFileOption = effective.args.some((value, index) => /^-+file$/i.test(value) && index + 1 < effective.args.length && effective.args[index + 1] !== "-");
    if (hasFileOption) return undefined;
    // -WorkingDirectory は値付きオプションとして追跡する。heredoc 本文はそのディレクトリ
    // を実行 cwd として検査され、値が非静的なら追跡しない（cd 追跡と同じ扱い）
    const psWorkingDirectory = powershellWorkingDirectoryOption(effective);
    if (psWorkingDirectory) return checkPowerShellBody(body, config, resolveExistingPath(psWorkingDirectory, cwd), boundaryCwd);
    const stop = interpreterOptionStop(effective.args);
    if (stop < effective.args.length) return undefined;
    return checkPowerShellBody(body, config, cwd, boundaryCwd);
  }
  return undefined;
}

async function inspectCommandParts(parts: CommandParts, config: FilterConfig, cwd: string, depth: number, boundaryCwd = cwd): Promise<ToolCallEventResult | undefined> {
  const commandText = [parts.name, ...parts.args].join(" ");
  const directDecision = checkBashValues(commandValues(commandText), config);
  if (directDecision) return directDecision;
  const pathDecision = pathRoleDecisions(bashPathRoles(parts), cwd, config, boundaryCwd);
  if (pathDecision) return pathDecision;
  const psDecision = inspectPowerShellCommandText(commandText, parts, config, cwd, boundaryCwd);
  if (psDecision) return psDecision;
  if (depth >= 3) return undefined;
  const shellBody = extractShellBody(parts);
  if (shellBody) {
    const nestedDecision = await inspectBash(shellBody, config, cwd, depth + 1, boundaryCwd);
    if (nestedDecision) return nestedDecision;
  }
  const name = commandBasename(parts.name);
  if (PYTHON_NAMES.has(name)) {
    const pythonBody = extractPythonBody(parts);
    if (pythonBody) {
      const nestedDecision = await inspectPythonBody(pythonBody, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
    const moduleArgs = pythonModuleArgs(parts.args);
    if (moduleArgs) {
      const nestedDecision = await inspectCommandParts({ name: moduleArgs.module, args: moduleArgs.rest }, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (NODE_NAMES.has(name)) {
    const nodeBody = extractNodeBody(parts);
    if (nodeBody) {
      const nestedDecision = await inspectNodeJsBody(nodeBody, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (name === "find") {
    for (const nested of findNestedCommands(parts)) {
      const nestedDecision = await inspectCommandParts(nested, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (name === "xargs") {
    const nestedArgs = xargsCommandArgs(parts.args);
    if (nestedArgs.length > 0) {
      const nestedDecision = await inspectCommandParts({ name: nestedArgs[0], args: nestedArgs.slice(1) }, config, cwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  if (BASH_WRAPPER_NAMES.has(name)) {
    const nestedArgs = wrappedCommandArgs(name, parts.args);
    if (nestedArgs.length > 0) {
      // env の -c / -C / --chdir は内側コマンドの実行 cwd を置き換える
      const nestedCwd = name === "env" ? envWorkingDirectory(parts, cwd) : cwd;
      const nestedDecision = await inspectCommandParts({ name: nestedArgs[0], args: nestedArgs.slice(1) }, config, nestedCwd, depth + 1, boundaryCwd);
      if (nestedDecision) return nestedDecision;
    }
  }
  return undefined;
}

async function inspectBashWithoutParser(command: string, config: FilterConfig, cwd: string, boundaryCwd = cwd) {
  for (const candidate of simpleCommandCandidates(command)) {
    const directDecision = checkBashValues(commandValues(candidate), config);
    if (directDecision) return directDecision;
    const redirectDecision = pathRoleDecisions(simpleBashRedirectRoles(candidate), cwd, config, boundaryCwd);
    if (redirectDecision) return redirectDecision;
    const body = extractPowerShellBody(candidate);
    if (body) {
      const powerShellDecision = checkPowerShellBody(body, config, cwd, boundaryCwd);
      if (powerShellDecision) return powerShellDecision;
    }
    const encoded = extractPowerShellEncodedBody(candidate);
    if (encoded) {
      const powerShellDecision = checkPowerShellBody(encoded, config, cwd, boundaryCwd);
      if (powerShellDecision) return powerShellDecision;
    }
  }
  return undefined;
}

export async function inspectBash(command: string, config: FilterConfig, cwd = process.cwd(), depth = 0, boundaryCwd = cwd): Promise<ToolCallEventResult | undefined> {
  const parser = await getBashParser();
  if (!parser) return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
  let tree: BashTree | null = null;
  try {
    tree = parser.parse(command);
    if (!tree || treeHasSyntaxError(tree.rootNode)) return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
    let currentCwd = cwd;
    const commandNodes = findCommandNodes(tree.rootNode).sort((left, right) => left.startIndex - right.startIndex);
    const redirects = findBashRedirects(tree.rootNode);
    const heredocs = findBashHeredocs(tree.rootNode, command);
    const heredocsByOwner = new Map<number, BashHeredoc[]>();
    for (const heredoc of heredocs) {
      const owned = heredocsByOwner.get(heredoc.ownerStart) ?? [];
      owned.push(heredoc);
      heredocsByOwner.set(heredoc.ownerStart, owned);
    }
    const handledRedirects = new Set<BashRedirect>();
    for (const node of commandNodes) {
      const directDecision = checkBashValues(commandValues(node.text), config);
      if (directDecision) return directDecision;
      for (const redirect of redirects) {
        if (redirect.ownerStart !== node.startIndex) continue;
        const redirectDecision = pathRoleDecisions(redirect.paths, currentCwd, config, boundaryCwd);
        if (redirectDecision) return redirectDecision;
        handledRedirects.add(redirect);
      }
      const parts = commandParts(node);
      if (parts) {
        const nestedDecision = await inspectCommandParts(parts, config, currentCwd, depth, boundaryCwd);
        if (nestedDecision) return nestedDecision;
        currentCwd = bashWorkingDirectory(parts, currentCwd);
      }
      for (const heredoc of heredocsByOwner.get(node.startIndex) ?? []) {
        if (!heredoc.quoted && HEREDOC_EXPANSION_CHARS.test(heredoc.body)) continue;
        if (!parts || depth >= 3) continue;
        const heredocDecision: ToolCallEventResult | undefined = await inspectHeredocBody(heredoc.body, parts, config, currentCwd, depth, boundaryCwd);
        if (heredocDecision) return heredocDecision;
      }
    }
    for (const redirect of redirects) {
      if (handledRedirects.has(redirect)) continue;
      const redirectDecision = pathRoleDecisions(redirect.paths, currentCwd, config, boundaryCwd);
      if (redirectDecision) return redirectDecision;
    }
    return undefined;
  } catch {
    return inspectBashWithoutParser(command, config, cwd, boundaryCwd);
  } finally {
    tree?.delete();
  }
}
