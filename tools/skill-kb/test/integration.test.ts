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

function resourceText(result: { contents: unknown[] }): string {
  const item = result.contents[0] as { text?: unknown } | undefined;
  assert.ok(item);
  const text = item.text;
  assert.equal(typeof text, "string");
  return text as string;
}

async function assertNoPublishedTool(root: string): Promise<void> {
  const workspace = path.join(root, "workspace");
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "skill-kb-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ SKILL_KB_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools, []);
  } finally {
    await client.close();
  }
}

test("connects and publishes no tool when no configuration file exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-absent-"));
  await mkdir(path.join(root, "workspace"));
  try {
    await assertNoPublishedTool(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("connects and publishes no tool when the source list is empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-empty-"));
  const projectDirectory = path.join(root, "workspace", ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    "sources: []\n",
  );
  try {
    await assertNoPublishedTool(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes no query tool when no source has a query module", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-no-query-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  - name: instructions-only",
      "    description: Instructions-only source.",
      "    instructions: Read the source.",
    ].join("\n"),
  );
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "skill-kb-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ SKILL_KB_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(
      listed.tools.some((tool) => tool.name === "query_source"),
      false,
    );
    assert.equal(
      listed.tools.some((tool) => tool.name === "get_source"),
      true,
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the MCP connection and publishes no tool for an invalid document", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-invalid-document-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "source:",
      "  - name: invalid-document",
      "    description: Invalid document.",
      "    instructions: Read the source.",
    ].join("\n"),
  );
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "skill-kb-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ SKILL_KB_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools, []);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes source registration instructions and guide when no source is configured", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-guides-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "skill-kb-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ SKILL_KB_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);

    const instructions = client.getInstructions() ?? "";
    assert.equal(
      instructions.trim(),
      [
        "skill-kb は、ローカルに設定された情報源へ到達する検索方法を提供する MCP サーバーである。",
        "情報源の登録・変更・削除、または検索手順の作成・変更を行うときは、`skill-kb://guide/source-registration` を読む。",
      ].join("\n"),
    );
    assert.ok(Buffer.byteLength(instructions, "utf8") <= 2048);

    const listed = await client.listResources();
    assert.deepEqual(listed.resources.map((resource) => resource.uri).sort(), [
      "skill-kb://guide/source-registration",
    ]);

    const guide = await client.readResource({
      uri: "skill-kb://guide/source-registration",
    });
    assert.match(resourceText(guide), /## 反映条件/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes all tools and supports work-note operations over stdio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-integration-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  const globalDirectory = path.join(root, "global");
  const globalConfig = path.join(globalDirectory, "KNOWLEDGE.yml");
  const projectConfig = path.join(projectDirectory, "KNOWLEDGE.yml");
  const instructionsFile = path.join(projectDirectory, "project-search.md");
  const queryModuleFile = path.join(globalDirectory, "official-api.mts");
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
      "    query_module: ./official-api.mts",
      "    query_options:",
      "      corpus: test",
      "  - name: shared",
      "    description: Global shared source.",
      "    instructions: Global shared instructions.",
    ].join("\n"),
  );
  await writeFile(
    queryModuleFile,
    [
      "export async function query(query: string, options: unknown): Promise<string> {",
      "  if (query === \"throw\") throw new Error(\"query failed\");",
      "  return `${query}:${JSON.stringify(options)}`;",
      "}",
    ].join("\n"),
  );
  await writeFile(instructionsFile, "Read the project documents.");
  await writeFile(
    projectConfig,
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
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "create_work_note",
      "get_source",
      "grep_work_notes",
      "query_source",
      "read_work_note",
      "update_work_note",
    ]);
    const tool = listed.tools.find(
      (candidate) => candidate.name === "get_source",
    );
    assert.ok(tool);
    assert.match(
      tool.description ?? "",
      /official-api: Use for the official API\./,
    );
    assert.match(tool.description ?? "", /shared: Project shared source\./);
    assert.doesNotMatch(tool.description ?? "", /Global shared source/);
    const queryTool = listed.tools.find(
      (candidate) => candidate.name === "query_source",
    );
    assert.ok(queryTool);
    assert.match(queryTool.description ?? "", /official-api/);

    const inlineResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "official-api" },
      },
      CallToolResultSchema,
    );
    assert.equal(inlineResult.isError, undefined);
    assert.deepEqual(JSON.parse(textResult(inlineResult)), {
      instructions: "Fetch the official API page.",
      scope: "global",
      config_path: globalConfig,
    });

    const fileResult = await client.callTool(
      {
        name: "get_source",
        arguments: { name: "shared" },
      },
      CallToolResultSchema,
    );
    assert.deepEqual(JSON.parse(textResult(fileResult)), {
      instructions: "Read the project documents.",
      scope: "project",
      config_path: projectConfig,
    });
    const queryResult = await client.callTool(
      {
        name: "query_source",
        arguments: { name: "official-api", query: "find" },
      },
      CallToolResultSchema,
    );
    assert.deepEqual(JSON.parse(textResult(queryResult)), {
      result: 'find:{"corpus":"test"}',
    });
    const queryFailure = await client.callTool(
      {
        name: "query_source",
        arguments: { name: "official-api", query: "throw" },
      },
      CallToolResultSchema,
    );
    assert.equal(queryFailure.isError, true);
    assert.match(textResult(queryFailure), /query failed/);
    assert.deepEqual(
      (await client.listTools()).tools.map((candidate) => candidate.name).sort(),
      [
        "create_work_note",
        "get_source",
        "grep_work_notes",
        "query_source",
        "read_work_note",
        "update_work_note",
      ],
    );

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

    const noteArguments = {
      source_names: ["shared"],
      file_name: "stdio-note.md",
      title: "stdio 統合試験",
      claim: "stdio 経由で作業メモを扱える",
      evidence: "MCPクライアントから各ツールを呼び出した結果",
      reasoning: "公開された実経路を直接使用しているため",
      scope: "このビルドと試験環境",
      scope_basis: "他の版は試していないため",
      defeaters: "いずれかの呼出しが失敗した場合",
      revalidate_when: "MCP SDKまたはツール契約が変わった場合",
    };
    const createResult = await client.callTool(
      {
        name: "create_work_note",
        arguments: noteArguments,
      },
      CallToolResultSchema,
    );
    assert.equal(createResult.isError, undefined);
    assert.equal(
      JSON.parse(textResult(createResult)).file_name,
      "stdio-note.md",
    );

    const grepResult = await client.callTool(
      {
        name: "grep_work_notes",
        arguments: { source_name: "shared", pattern: "stdio 経由" },
      },
      CallToolResultSchema,
    );
    assert.deepEqual(JSON.parse(textResult(grepResult)).matches, [
      "stdio-note.md",
    ]);

    const readResult = await client.callTool(
      {
        name: "read_work_note",
        arguments: { source_name: "shared", file_name: "stdio-note.md" },
      },
      CallToolResultSchema,
    );
    assert.match(JSON.parse(textResult(readResult)).markdown, /## 再確認条件/);

    const updateResult = await client.callTool(
      {
        name: "update_work_note",
        arguments: {
          ...noteArguments,
          claim: "stdio 経由で作業メモを作成、検索、読取り、更新できる",
          change_reason: "更新経路も確認するため",
        },
      },
      CallToolResultSchema,
    );
    assert.equal(updateResult.isError, undefined);
    const updatedRead = await client.callTool(
      {
        name: "read_work_note",
        arguments: { source_name: "shared", file_name: "stdio-note.md" },
      },
      CallToolResultSchema,
    );
    assert.match(
      JSON.parse(textResult(updatedRead)).markdown,
      /更新経路も確認するため/,
    );
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
