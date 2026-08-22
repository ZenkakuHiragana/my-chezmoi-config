import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { BashNode, BashParser, TreeSitterModule } from "./types.ts";

const PARSER_WASM_PATHS = {
  bash: "tree-sitter-bash/tree-sitter-bash.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
} as const;
type ParserKind = keyof typeof PARSER_WASM_PATHS;

async function loadParser(kind: ParserKind): Promise<BashParser | null> {
  try {
    const extensionRequire = createRequire(import.meta.url);
    const webPath = extensionRequire.resolve("web-tree-sitter");
    const webWasm = extensionRequire.resolve("web-tree-sitter/web-tree-sitter.wasm");
    const wasmPath = extensionRequire.resolve(PARSER_WASM_PATHS[kind]);
    const treeSitter = (await import(pathToFileURL(webPath).href)) as unknown as TreeSitterModule;
    await treeSitter.Parser.init({ locateFile: () => webWasm });
    const parser = new treeSitter.Parser();
    parser.setLanguage(await treeSitter.Language.load(wasmPath));
    return parser;
  } catch {
    return null;
  }
}

const parserPromises = new Map<ParserKind, Promise<BashParser | null>>();
export function getParser(kind: ParserKind): Promise<BashParser | null> {
  let promise = parserPromises.get(kind);
  if (!promise) {
    promise = loadParser(kind);
    parserPromises.set(kind, promise);
  }
  return promise;
}

export function getBashParser(): Promise<BashParser | null> {
  return getParser("bash");
}


export function findCommandNodes(root: BashNode): BashNode[] {
  const commands: BashNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "command") commands.push(node);
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return commands;
}

export function treeHasSyntaxError(root: BashNode): boolean {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "ERROR" || node.isMissing) return true;
    for (let index = node.childCount - 1; index >= 0; index -= 1) {
      const child = node.child(index);
      if (child) stack.push(child);
    }
  }
  return false;
}
