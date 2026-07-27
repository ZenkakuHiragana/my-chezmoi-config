import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

function childEnvironment(
  extra: Record<string, string>,
): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return { ...inherited, ...extra };
}

function textResult(result: unknown): string {
  const parsed = CallToolResultSchema.safeParse(result);
  if (!parsed.success) {
    assert.fail(parsed.error.message);
  }
  const item = parsed.data.content.find(
    (content): content is { type: "text"; text: string } =>
      content.type === "text",
  );
  assert.ok(item);
  return item.text;
}

test("publishes one dynamic tool and returns inline and external instructions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-integration-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  const globalDirectory = path.join(root, "global");
  const globalConfig = path.join(globalDirectory, "KNOWLEDGE.yml");
  const instructionsFile = path.join(projectDirectory, "project-search.md");
  await Promise.all([
    mkdir(projectDirectory, { recursive: true }),
    mkdir(globalDirectory, { recursive: true }),
  ]);
  await writeFile(
    globalConfig,
    [
      "sources:",
      "  - name: official-api",
      "    description: Use for the official API.",
      "    instructions: Fetch the official API page.",
      "  - name: shared",
      "    description: Global shared source.",
      "    instructions: Global shared instructions.",
    ].join("\n"),
  );
  await writeFile(instructionsFile, "Read the project documents.");
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  - name: shared",
      "    description: Project shared source.",
      "    instructions:",
      "      file: project-search.md",
    ].join("\n"),
  );

  const serverPath = path.resolve("dist", "src", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ SKILL_KB_CONFIG: globalConfig }),
    stderr: "pipe",
  });
  const client = new Client({ name: "skill-kb-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 1);
    const tool = listed.tools[0];
    assert.ok(tool);
    assert.equal(tool.name, "get_source");
    assert.match(
      tool.description ?? "",
      /official-api: Use for the official API\./,
    );
    assert.match(tool.description ?? "", /shared: Project shared source\./);
    assert.doesNotMatch(tool.description ?? "", /Global shared source/);

    const inlineResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "official-api" },
      },
      CallToolResultSchema,
    );
    assert.equal(inlineResult.isError, undefined);
    assert.deepEqual(JSON.parse(textResult(inlineResult)), {
      name: "official-api",
      description: "Use for the official API.",
      instructions: "Fetch the official API page.",
    });

    const fileResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "shared" },
      },
      CallToolResultSchema,
    );
    assert.deepEqual(JSON.parse(textResult(fileResult)), {
      name: "shared",
      description: "Project shared source.",
      instructions: "Read the project documents.",
    });

    await writeFile(instructionsFile, "Read the updated project documents.");
    const updatedResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "shared" },
      },
      CallToolResultSchema,
    );
    assert.equal(
      JSON.parse(textResult(updatedResult)).instructions,
      "Read the updated project documents.",
    );

    const unknownResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "missing" },
      },
      CallToolResultSchema,
    );
    assert.equal(unknownResult.isError, true);
    assert.match(textResult(unknownResult), /Unknown knowledge source/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
