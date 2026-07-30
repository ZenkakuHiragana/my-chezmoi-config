import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type KnowledgeCatalog,
  type KnowledgeSource,
  readInstructions,
} from "./config.js";
import {
  buildCatalogState,
  CATALOG_RESOURCE,
  GUIDE_RESOURCES,
  readGuide,
} from "./guides.js";
import {
  observationSchema,
  WorkNoteStore,
  type WorkNoteStoreOptions,
} from "./work-notes.js";

function sourceLine(source: KnowledgeSource): string {
  const compactDescription = source.description.replace(/\s+/gu, " ");
  return `- ${source.name}: ${compactDescription}`;
}

export function buildToolDescription(catalog: KnowledgeCatalog): string {
  const sourceLines = [...catalog.sources.values()].map(sourceLine).join("\n");
  return [
    "設定済みの情報源について、検索方法を返す。",
    "情報源を選ぶときは、次の説明にある保持範囲、使用条件、除外条件を照合する。",
    "適合する情報源がなく新しい情報源の登録を提案する場合は、資料 skill-kb://guide/source-registration を読む。",
    "利用可能な情報源:",
    sourceLines,
  ].join("\n");
}

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

const sourceNamesSchema = z
  .array(z.string().min(1))
  .min(1)
  .describe(
    "現在の統合済みカタログに存在する情報源名を1件以上指定する。メモをどの調査で検索し、どの正式資料への反映を検討できるかを表す。自由なタグではない。",
  );

const workNoteContentSchema = {
  source_names: sourceNamesSchema,
  file_name: z
    .string()
    .min(1)
    .describe(
      "メモの識別子となる安全なMarkdownファイル名。絶対パス、ディレクトリ区切り、パストラバーサルは指定しない。",
    ),
  title: z.string().min(1).describe("メモの内容を識別できる表題"),
  claim: z
    .string()
    .min(1)
    .describe("将来の判断へ利用する解釈または一般化した主張"),
  evidence: z
    .string()
    .min(1)
    .describe("主張を支える資料、観測結果、実行結果、または追跡可能な根拠"),
  reasoning: z.string().min(1).describe("示した根拠から主張を導ける理由"),
  scope: z
    .string()
    .min(1)
    .describe("主張を適用できる対象、版、条件、環境などの範囲"),
  scope_basis: z
    .string()
    .min(1)
    .describe("どこまで一般化でき、なぜその範囲より外へ広げないのかを示す理由"),
  defeaters: z
    .string()
    .min(1)
    .describe("主張を撤回すべき反例、条件、または観測結果"),
  revalidate_when: z
    .string()
    .min(1)
    .describe("版、環境、実装、前提など、根拠を再確認すべき変化"),
  observation: observationSchema
    .optional()
    .describe(
      "実験、実行結果、計測、再現操作に基づく場合の観測・再現情報。観測結果と主張を分けて記録する。",
    ),
};

export type CreateServerOptions = {
  workNotes?: WorkNoteStoreOptions;
};

export function createServer(
  catalog: KnowledgeCatalog,
  instructions: string,
  options: CreateServerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "skill-kb", version: "0.1.0" },
    { instructions },
  );
  const workNotes = new WorkNoteStore(catalog, options.workNotes);

  // 執筆規則は情報源0件でも公開する。情報源を登録する手順自体が必要になるため。
  for (const guide of GUIDE_RESOURCES) {
    server.registerResource(
      guide.name,
      guide.uri,
      {
        title: guide.title,
        description: guide.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: await readGuide(guide.fileName),
          },
        ],
      }),
    );
  }

  server.registerResource(
    CATALOG_RESOURCE.name,
    CATALOG_RESOURCE.uri,
    {
      title: CATALOG_RESOURCE.title,
      description: CATALOG_RESOURCE.description,
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            await buildCatalogState(catalog, workNotes),
            null,
            2,
          ),
        },
      ],
    }),
  );

  const tools = [
    server.registerTool(
      "get_source",
      {
        title: "情報源の検索方法",
        description: buildToolDescription(catalog),
        inputSchema: {
          name: z
            .string()
            .min(1)
            .describe("ツール説明に列挙された情報源の名前"),
        },
      },
      async ({ name }) => {
        const source = catalog.sources.get(name);
        if (!source) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown knowledge source: ${name}`,
              },
            ],
            isError: true,
          };
        }

        try {
          const instructions = await readInstructions(source);
          const result = {
            name: source.name,
            description: source.description,
            instructions,
          };
          return textResult(result);
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
    server.registerTool(
      "create_work_note",
      {
        title: "作業メモの作成",
        description:
          "人間が保存を明示的に承認した知見だけを新しい作業メモとして保存する。作業メモは低権威の補助情報であり、正本と矛盾する場合は正本を優先する。重要な判断へ使う前に根拠と現在の状態を再確認する。人間の承認前には呼び出さない。各項目の書き方と保存先の規則は資料 skill-kb://guide/work-note-authoring を読む。",
        inputSchema: workNoteContentSchema,
      },
      async (input) => {
        try {
          return textResult(await workNotes.create(input));
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
    server.registerTool(
      "update_work_note",
      {
        title: "作業メモの更新",
        description:
          "人間が更新を明示的に承認した既存の作業メモを更新する。呼出し前に read_work_note で現行全文を確認する。source_names は現行メモと同じ集合を指定し、対応する情報源は変更しない。作業メモは低権威の補助情報であり、正本と矛盾する場合は正本を優先する。人間の承認前には呼び出さない。各項目の書き方と更新時の制約は資料 skill-kb://guide/work-note-authoring を読む。",
        inputSchema: {
          ...workNoteContentSchema,
          change_reason: z
            .string()
            .min(1)
            .describe("既存メモを更新する理由と、何が変わったか"),
        },
      },
      async (input) => {
        try {
          return textResult(await workNotes.update(input));
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
    server.registerTool(
      "grep_work_notes",
      {
        title: "作業メモの検索",
        description:
          "指定した現在有効な情報源に対応する正規の作業メモをTypeScript／JavaScriptの正規表現で全文検索し、一致したファイル名だけを返す。抜粋を返さないため、利用時は read_work_note で全文を確認する。",
        inputSchema: {
          source_name: z
            .string()
            .min(1)
            .describe("現在の統合済みカタログに存在する一つの情報源名"),
          pattern: z
            .string()
            .describe("TypeScript／JavaScriptのRegExpへ渡す検索パターン"),
        },
      },
      async ({ source_name, pattern }) => {
        try {
          return textResult(await workNotes.grep(source_name, pattern));
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
    server.registerTool(
      "read_work_note",
      {
        title: "作業メモの全文取得",
        description:
          "指定した現在有効な情報源に対応する作業メモを省略せず全文取得する。作業メモは低権威の補助情報であり、重要な判断へ使う前に根拠、適用範囲、反証条件、再確認条件を現在の状態へ照合する。",
        inputSchema: {
          source_name: z
            .string()
            .min(1)
            .describe("現在の統合済みカタログに存在する一つの情報源名"),
          file_name: z
            .string()
            .min(1)
            .describe("grep_work_notes が返した作業メモのファイル名"),
        },
      },
      async ({ source_name, file_name }) => {
        try {
          return textResult(await workNotes.read(source_name, file_name));
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
  ];

  // 情報源が0件のときは、対応先を検証できないため全ツールを公開しない。
  // 一度登録してから取り消すのは、SDK が最初のツール登録で tools 能力を広告するためである。
  // 登録自体を省くと tools 能力が広告されず、クライアントの tools/list が失敗する。
  if (catalog.sources.size === 0) {
    for (const tool of tools) {
      tool.remove();
    }
  }

  return server;
}
