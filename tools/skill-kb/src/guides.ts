import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeCatalog, SourceScope } from "./config.js";
import type { WorkNoteStore } from "./work-notes.js";

// 実行時は dist/src/guides.js なので、パッケージ直下の guides/ を2階層上から解決する。
const guideDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "guides",
);

const SERVER_INSTRUCTIONS_FILE = "server-instructions.md";

export class GuideError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GuideError";
  }
}

export type GuideResource = {
  uri: string;
  name: string;
  title: string;
  description: string;
  fileName: string;
};

export const GUIDE_RESOURCES: readonly GuideResource[] = [
  {
    uri: "skill-kb://guide/source-registration",
    name: "source-registration-guide",
    title: "情報源の登録規則",
    description:
      "KNOWLEDGE.yml へ情報源を登録、変更、削除するときの規則。設定ファイルの場所、併合規則、description と instructions の書き方、パス制約、反映に必要な再起動条件を含む。情報源の設定を書き換える前に読む。",
    fileName: "source-registration.md",
  },
  {
    uri: "skill-kb://guide/work-note-authoring",
    name: "work-note-authoring-guide",
    title: "作業メモの執筆規則",
    description:
      "作業メモを作成、更新するときの規則。人間の承認手順、情報源との対応づけ、保存先と検索範囲、各項目の書き方、観測情報、更新時の制約を含む。create_work_note と update_work_note を呼ぶ前に読む。",
    fileName: "work-note-authoring.md",
  },
];

export const CATALOG_RESOURCE = {
  uri: "skill-kb://state/catalog",
  name: "current-catalog",
  title: "現在の設定状態",
  description:
    "起動時に解決した設定ファイルのパスと存在、併合後の情報源一覧とその scope、作業メモの保存先。どのファイルへ情報源を書き足すか、メモがどこへ保存されるかを判断するために読む。",
} as const;

export type CatalogStateSource = {
  name: string;
  scope: SourceScope;
  description: string;
  config_path: string;
  instructions: { kind: "inline" } | { kind: "file"; declared_path: string };
};

export type CatalogState = {
  global_config_path: string;
  global_config_exists: boolean;
  project_config_path: string;
  project_config_exists: boolean;
  workspace: string;
  work_note_roots: { global: string; project: string };
  tools_published: boolean;
  source_count: number;
  sources: CatalogStateSource[];
  notice: string;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readGuide(fileName: string): Promise<string> {
  const filePath = path.join(guideDirectory, fileName);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new GuideError(`Cannot read bundled guide: ${filePath}`, {
      cause: error,
    });
  }
}

export async function buildServerInstructions(
  catalog: KnowledgeCatalog,
): Promise<string> {
  const overview = (await readGuide(SERVER_INSTRUCTIONS_FILE)).trimEnd();
  const names = [...catalog.sources.keys()];
  const sourceLine =
    names.length === 0
      ? "- 有効な情報源: 0件。ツールは公開されない。"
      : `- 有効な情報源: ${names.length}件（${names.join("、")}）`;
  return [
    overview,
    "",
    "## 現在の状態",
    "",
    `- グローバル設定: ${catalog.globalConfigPath}`,
    `- プロジェクト設定: ${catalog.projectConfigPath}`,
    sourceLine,
    "",
  ].join("\n");
}

export async function buildCatalogState(
  catalog: KnowledgeCatalog,
  workNotes: Pick<WorkNoteStore, "globalRoot" | "projectRoot">,
): Promise<CatalogState> {
  const [globalConfigExists, projectConfigExists] = await Promise.all([
    pathExists(catalog.globalConfigPath),
    pathExists(catalog.projectConfigPath),
  ]);
  const sources = [...catalog.sources.values()].map(
    (source): CatalogStateSource => ({
      name: source.name,
      scope: source.scope,
      description: source.description,
      config_path: source.configPath,
      instructions:
        source.instructions.kind === "inline"
          ? { kind: "inline" }
          : { kind: "file", declared_path: source.instructions.declaredPath },
    }),
  );
  return {
    global_config_path: catalog.globalConfigPath,
    global_config_exists: globalConfigExists,
    project_config_path: catalog.projectConfigPath,
    project_config_exists: projectConfigExists,
    workspace: catalog.workspace,
    work_note_roots: {
      global: workNotes.globalRoot,
      project: workNotes.projectRoot,
    },
    tools_published: sources.length > 0,
    source_count: sources.length,
    sources,
    notice:
      "この状態は起動時に解決した設定である。設定を変更した場合、反映条件と書き方は skill-kb://guide/source-registration を読む。",
  };
}

export { SERVER_INSTRUCTIONS_FILE, guideDirectory };
