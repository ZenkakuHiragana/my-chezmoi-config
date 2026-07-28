import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ConfigurationError,
  loadCatalog,
  readInstructions,
} from "../src/config.js";
import { buildToolDescription } from "../src/server.js";

type Fixture = {
  root: string;
  home: string;
  workspace: string;
  globalConfig: string;
  projectConfig: string;
};

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const globalDirectory = path.join(home, ".config", "opencode");
  const projectDirectory = path.join(workspace, ".opencode");
  await Promise.all([
    mkdir(globalDirectory, { recursive: true }),
    mkdir(projectDirectory, { recursive: true }),
  ]);
  return {
    root,
    home,
    workspace,
    globalConfig: path.join(globalDirectory, "KNOWLEDGE.yml"),
    projectConfig: path.join(projectDirectory, "KNOWLEDGE.yml"),
  };
}

async function withFixture(
  callback: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await makeFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

test("loads the default global configuration", async () => {
  await withFixture(async ({ home, workspace, globalConfig }) => {
    await writeFile(
      globalConfig,
      [
        "sources:",
        "  - name: official-api",
        "    description: Public API reference.",
        "    instructions: Fetch the official JSON article.",
      ].join("\n"),
    );

    const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
    const source = catalog.sources.get("official-api");
    assert.ok(source);
    assert.equal(source.scope, "global");
    assert.equal(
      await readInstructions(source),
      "Fetch the official JSON article.",
    );
  });
});

test("loads a project configuration when the global configuration is absent", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: project-design",
        "    description: Project design decisions.",
        "    instructions: Search the local design documents.",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 1);
    assert.equal(catalog.sources.get("project-design")?.scope, "project");
  });
});

test("merges both scopes and lets the project source override the global source", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  - name: shared",
          "    description: Global description.",
          "    instructions: Global instructions.",
          "  - name: global-only",
          "    description: Global-only source.",
          "    instructions: Global-only instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  - name: shared",
          "    description: Project description.",
          "    instructions: Project instructions.",
          "  - name: project-only",
          "    description: Project-only source.",
          "    instructions: Project-only instructions.",
        ].join("\n"),
      );

      const catalog = await loadCatalog({
        cwd: workspace,
        homeDirectory: home,
      });
      assert.deepEqual(
        [...catalog.sources.keys()],
        ["shared", "global-only", "project-only"],
      );
      const shared = catalog.sources.get("shared");
      assert.ok(shared);
      assert.equal(shared.scope, "project");
      assert.equal(shared.description, "Project description.");
      assert.equal(await readInstructions(shared), "Project instructions.");
    },
  );
});

test("builds the tool description from every effective source", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: first",
        "    description: First description.",
        "    instructions: First instructions.",
        "  - name: second",
        "    description: Second description.",
        "    instructions: Second instructions.",
      ].join("\n"),
    );
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    const description = buildToolDescription(catalog);
    assert.match(description, /- first: First description\./);
    assert.match(description, /- second: Second description\./);
  });
});

test("reads an external instruction file on every call", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    const documents = path.join(workspace, "documents");
    const instructionsFile = path.join(documents, "search.md");
    await mkdir(documents);
    await writeFile(instructionsFile, "first procedure");
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: external",
        "    description: External instructions.",
        "    instructions:",
        "      file: ../documents/search.md",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    const source = catalog.sources.get("external");
    assert.ok(source);
    assert.equal(await readInstructions(source), "first procedure");
    await writeFile(instructionsFile, "second procedure");
    assert.equal(await readInstructions(source), "second procedure");
  });
});

test("returns an empty catalog when no configuration exists", async () => {
  await withFixture(async ({ workspace }) => {
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
  });
});

test("treats an empty source list like a missing configuration", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(projectConfig, "sources: []\n");
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
  });
});

test("rejects malformed and unknown-field configurations", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    const missingGlobal = path.join(workspace, "missing.yml");

    await writeFile(projectConfig, "sources: [");
    await assert.rejects(
      loadCatalog({ cwd: workspace, globalConfigPath: missingGlobal }),
      ConfigurationError,
    );

    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: extra",
        "    description: Has an unknown field.",
        "    instructions: Search.",
        "    unexpected: true",
      ].join("\n"),
    );
    await assert.rejects(
      loadCatalog({ cwd: workspace, globalConfigPath: missingGlobal }),
      ConfigurationError,
    );
  });
});

test("rejects duplicate names inside one configuration", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        '  - name: " duplicate "',
        "    description: First.",
        "    instructions: First.",
        "  - name: duplicate",
        "    description: Second.",
        "    instructions: Second.",
      ].join("\n"),
    );
    await assert.rejects(
      loadCatalog({
        cwd: workspace,
        globalConfigPath: path.join(workspace, "missing.yml"),
      }),
      /Duplicate source name/,
    );
  });
});

test("rejects missing, absolute, and out-of-scope instruction files", async () => {
  await withFixture(async ({ root, workspace, projectConfig }) => {
    const missingGlobal = path.join(workspace, "missing.yml");
    const outsideFile = path.join(root, "outside.md");
    await writeFile(outsideFile, "outside");

    const cases = [
      "missing.md",
      outsideFile.replaceAll("\\", "/"),
      "../../outside.md",
    ];

    for (const file of cases) {
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  - name: invalid-file",
          "    description: Invalid file.",
          "    instructions:",
          `      file: ${JSON.stringify(file)}`,
        ].join("\n"),
      );
      await assert.rejects(
        loadCatalog({ cwd: workspace, globalConfigPath: missingGlobal }),
        ConfigurationError,
      );
    }
  });
});

test("rejects a junction that escapes the project scope", async () => {
  await withFixture(async ({ root, workspace, projectConfig }) => {
    const outsideDirectory = path.join(root, "outside");
    const outsideFile = path.join(outsideDirectory, "search.md");
    const link = path.join(workspace, "linked-outside");
    await mkdir(outsideDirectory);
    await writeFile(outsideFile, "outside");
    await symlink(outsideDirectory, link, "junction");
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: junction",
        "    description: Junction escape.",
        "    instructions:",
        "      file: ../linked-outside/search.md",
      ].join("\n"),
    );

    await assert.rejects(
      loadCatalog({
        cwd: workspace,
        globalConfigPath: path.join(workspace, "missing.yml"),
      }),
      /escapes its allowed scope/,
    );
  });
});

test("revalidates the instruction path on every call", async () => {
  await withFixture(async ({ root, workspace, projectConfig }) => {
    const insideDirectory = path.join(workspace, "documents");
    const instructionPath = path.join(insideDirectory, "search.md");
    const outsideFile = path.join(root, "outside.md");
    await mkdir(insideDirectory);
    await writeFile(instructionPath, "inside");
    await writeFile(outsideFile, "outside");
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: changing-link",
        "    description: Revalidated path.",
        "    instructions:",
        "      file: ../documents/search.md",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    const source = catalog.sources.get("changing-link");
    assert.ok(source);
    assert.equal(await readInstructions(source), "inside");

    await rm(instructionPath);
    await symlink(outsideFile, instructionPath, "file");
    await assert.rejects(readInstructions(source), ConfigurationError);
  });
});
