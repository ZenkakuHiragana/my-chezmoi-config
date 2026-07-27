import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type KnowledgeCatalog,
  type KnowledgeSource,
  readInstructions,
} from "./config.js";

function sourceLine(source: KnowledgeSource): string {
  const compactDescription = source.description.replace(/\s+/gu, " ");
  return `- ${source.name}: ${compactDescription}`;
}

export function buildToolDescription(catalog: KnowledgeCatalog): string {
  const sourceLines = [...catalog.sources.values()].map(sourceLine).join("\n");
  return [
    "設定済みの情報源について、検索方法を返す。",
    "情報源を選ぶときは、次の説明にある保持範囲、使用条件、除外条件を照合する。",
    "利用可能な情報源:",
    sourceLines,
  ].join("\n");
}

export function createServer(catalog: KnowledgeCatalog): McpServer {
  const server = new McpServer({ name: "skill-kb", version: "0.1.0" });

  server.registerTool(
    "get_source",
    {
      title: "情報源の検索方法",
      description: buildToolDescription(catalog),
      inputSchema: {
        name: z.string().min(1).describe("ツール説明に列挙された情報源の名前"),
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
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}
