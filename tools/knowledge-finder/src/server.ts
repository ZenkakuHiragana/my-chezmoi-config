import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type KnowledgeCatalog,
  type KnowledgeSource,
  readInstructions,
} from "./config.js";
import { GUIDE_RESOURCES, readGuide } from "./guides.js";

function sourceLine(source: KnowledgeSource): string {
  const compactDescription = source.description.replace(/\s+/gu, " ");
  return `- ${source.name}: ${compactDescription}`;
}

export function buildToolDescription(catalog: KnowledgeCatalog): string {
  const sourceLines = [...catalog.sources.values()].map(sourceLine).join("\n");
  return [
    "設定済みの情報源について、検索方法を返す。",
    "情報源を選ぶときは、次の説明にある保持範囲、使用条件、除外条件を照合する。",
    "適合する情報源がなく新しい情報源の登録を提案する場合は、資料 knowledge-finder://guide/source-registration を読む。",
    "利用可能な情報源:",
    sourceLines,
  ].join("\n");
}

export function buildQueryToolDescription(catalog: KnowledgeCatalog): string {
  const querySources = [...catalog.sources.values()]
    .filter((source) => source.queryModule !== undefined)
    .map((source) => `- ${source.name}`)
    .join("\n");
  return [
    "設定された情報源の query_module へ問いを渡し、検索対象の候補結果を返す。",
    "query_source の結果は正本の引用ではない。必要な情報源を指定して正本を確認する。",
    "利用可能な情報源:",
    querySources || "- なし",
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

export function createServer(
  catalog: KnowledgeCatalog,
  instructions: string,
): McpServer {
  const server = new McpServer(
    { name: "knowledge-finder", version: "0.1.0" },
    { instructions },
  );

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

  const hasQuerySources = [...catalog.sources.values()].some(
    (source) => source.queryModule !== undefined,
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
          return textResult({
            instructions,
            scope: source.scope,
            config_path: source.configPath,
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    ),
    ...(hasQuerySources
      ? [
          server.registerTool(
            "query_source",
            {
              title: "情報源の候補検索",
              description: buildQueryToolDescription(catalog),
              inputSchema: {
                name: z
                  .string()
                  .min(1)
                  .describe("query_module が設定された情報源の名前"),
                query: z
                  .string()
                  .min(1)
                  .describe("候補検索へ渡す自然文の問い"),
              },
            },
            async ({ name, query }) => {
              const source = catalog.sources.get(name);
              if (!source) {
                return errorResult(new Error(`Unknown knowledge source: ${name}`));
              }
              if (source.queryModule === undefined) {
                return errorResult(
                  new Error(`Knowledge source has no query_module: ${name}`),
                );
              }

              try {
                const result = await source.queryModule.query(
                  query,
                  source.queryModule.options,
                );
                if (typeof result !== "string") {
                  throw new Error(
                    `query_module returned a non-string result: ${name}`,
                  );
                }
                return textResult({ result });
              } catch (error) {
                return errorResult(error);
              }
            },
          ),
        ]
      : []),
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
