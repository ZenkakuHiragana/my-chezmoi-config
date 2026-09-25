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
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "knowledge-finder");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools, []);
  } finally {
    await client.close();
  }
}

test("connects and publishes no tool when no configuration file exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-absent-"));
  await mkdir(path.join(root, "workspace"));
  try {
    await assertNoPublishedTool(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("connects and publishes no tool when the source map is empty", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-empty-"));
  const projectDirectory = path.join(root, "workspace", ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    "sources: {}\n",
  );
  try {
    await assertNoPublishedTool(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes no query tool when no source has a query module", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-no-query-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  instructions-only:",
      "    description: Instructions-only source.",
      "    instructions: Read the source.",
    ].join("\n"),
  );
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "knowledge-finder");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["get_source"]);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the MCP connection and publishes no tool for an invalid document", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-invalid-document-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "source:",
      "  invalid-document:",
      "    description: Invalid document.",
      "    instructions: Read the source.",
    ].join("\n"),
  );
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "knowledge-finder");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools, []);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the MCP connection and publishes the guide for a YAML parse error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-parse-error-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(path.join(projectDirectory, "KNOWLEDGE.yml"), "sources: [");
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools, []);
    const listedResources = await client.listResources();
    assert.deepEqual(
      listedResources.resources.map((resource) => resource.uri),
      ["knowledge-finder://guide/source-registration"],
    );
    const guide = await client.readResource({
      uri: "knowledge-finder://guide/source-registration",
    });
    assert.match(resourceText(guide), /## 誤りの扱い/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes source registration instructions and guide when no source is configured", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-guides-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const serverPath = path.resolve("dist", "src", "index.js");
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: workspace,
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: path.join(root, "missing.yml") }),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);

    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /情報源/);
    assert.match(instructions, /根拠/);
    assert.match(instructions, /正本/);
    assert.match(instructions, /コードや実行中の対象を直接調べる用途には使わない/);
    assert.ok(Buffer.byteLength(instructions, "utf8") <= 2048);

    const listed = await client.listResources();
    assert.deepEqual(listed.resources.map((resource) => resource.uri).sort(), [
      "knowledge-finder://guide/source-registration",
    ]);

    const guide = await client.readResource({
      uri: "knowledge-finder://guide/source-registration",
    });
    assert.match(resourceText(guide), /## 反映条件/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("publishes source tools and rejects removed work-note operations over stdio", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-finder-integration-"));
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
      "  official-api:",
      "    description: Use for the official API.",
      "    instructions: Fetch the official API page.",
      "    query_module: ./official-api.mts",
      "    query_options:",
      "      corpus: test",
      "  shared:",
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
      "  shared:",
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
    env: childEnvironment({ KNOWLEDGE_FINDER_CONFIG: globalConfig }),
    stderr: "pipe",
  });
  const client = new Client({ name: "knowledge-finder-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "knowledge-finder");
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "get_source",
      "query_source",
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
        "get_source",
        "query_source",
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

    for (const name of ["create_work_note", "update_work_note", "grep_work_notes", "read_work_note"]) {
      const result = await client.callTool({ name, arguments: {} }, CallToolResultSchema);
      assert.equal(result.isError, true);
      assert.match(textResult(result), /not found/i);
    }

  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
