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
import {
  buildQueryToolDescription,
  buildToolDescription,
} from "../src/server.js";

type Fixture = {
  root: string;
  home: string;
  workspace: string;
  globalConfig: string;
  globalLocalConfig: string;
  projectConfig: string;
  projectLocalConfig: string;
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
    globalLocalConfig: path.join(globalDirectory, "KNOWLEDGE.local.yml"),
    projectConfig: path.join(projectDirectory, "KNOWLEDGE.yml"),
    projectLocalConfig: path.join(
      projectDirectory,
      "KNOWLEDGE.local.yml",
    ),
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
        "  official-api:",
        "    description: Public API reference.",
        "    instructions: Fetch the official JSON article.",
      ].join("\n"),
    );

    const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
    const source = catalog.sources.get("official-api");
    assert.ok(source);
    assert.equal(source.scope, "global");
    assert.equal(source.configPath, globalConfig);
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
        "  project-design:",
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

test("merges precedence layers and lets the project source override the global source", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  shared:",
          "    description: Global description.",
          "    instructions: Global instructions.",
          "  global-only:",
          "    description: Global-only source.",
          "    instructions: Global-only instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  shared:",
          "    description: Project description.",
          "    instructions: Project instructions.",
          "  project-only:",
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
      assert.equal(shared.configPath, projectConfig);
      assert.equal(await readInstructions(shared), "Project instructions.");
    },
  );
});

test("applies local overlays in field order and preserves omitted fields", async () => {
  await withFixture(
    async ({
      home,
      workspace,
      globalConfig,
      globalLocalConfig,
      projectConfig,
      projectLocalConfig,
    }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  layered:",
          "    description: Global description.",
          "    instructions: Global instructions.",
        ].join("\n"),
      );
      await writeFile(
        globalLocalConfig,
        [
          "sources:",
          "  layered:",
          "    description: Global local description.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  layered:",
          "    instructions: Project instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectLocalConfig,
        [
          "sources:",
          "  layered:",
          "    description: Project local description.",
        ].join("\n"),
      );

      const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
      const source = catalog.sources.get("layered");
      assert.ok(source);
      assert.equal(source.description, "Project local description.");
      assert.equal(await readInstructions(source), "Project instructions.");
      assert.equal(source.scope, "project");
      assert.equal(source.configPath, projectConfig);
    },
  );
});

test("builds the tool descriptions from effective sources", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  first:",
        "    description: First description.",
        "    instructions: First instructions.",
        "  second:",
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
    assert.match(buildQueryToolDescription(catalog), /- なし/);
  });
});

test("loads a named query module and passes query_options unchanged", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    const modulePath = path.join(workspace, "query.mts");
    await writeFile(
      modulePath,
      [
        "export async function query(query: string, options: unknown): Promise<string> {",
        "  return JSON.stringify({ query, options });",
        "}",
      ].join("\n"),
    );
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  searchable:",
        "    description: Searchable source.",
        "    instructions: Read the source.",
        "    query_module: ../query.mts",
        "    query_options:",
        "      corpus_root: C:/local/corpus",
        "      mode: exact",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    const source = catalog.sources.get("searchable");
    assert.ok(source?.queryModule);
    assert.equal(
      await source.queryModule.query("find this", source.queryModule.options),
      JSON.stringify({
        query: "find this",
        options: { corpus_root: "C:/local/corpus", mode: "exact" },
      }),
    );
  });
});

test("excludes an invalid query module without stopping catalog loading", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    const modulePath = path.join(workspace, "invalid.mts");
    await writeFile(modulePath, "export default 123;\n");
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  invalid-query:",
        "    description: Invalid query module.",
        "    instructions: Read the source.",
        "    query_module: ../invalid.mts",
        "  valid:",
        "    description: Valid source.",
        "    instructions: Read the valid source.",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.has("invalid-query"), false);
    assert.equal(catalog.sources.has("valid"), true);
    assert.match(catalog.diagnostics.join("\n"), /invalid-query/);
  });
});

test("excludes query_options without a query module", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  options-only:",
        "    description: Options-only source.",
        "    instructions: Read the source.",
        "    query_options:",
        "      endpoint: https://example.invalid",
        "  valid:",
        "    description: Valid source.",
        "    instructions: Read the valid source.",
      ].join("\n"),
    );
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.has("options-only"), false);
    assert.equal(catalog.sources.has("valid"), true);
    assert.match(
      catalog.diagnostics.join("\n"),
      /options-only.*query_options requires query_module/s,
    );
  });
});

test("invalidates a lower-precedence source when a later entry is invalid", async () => {
  await withFixture(async ({ home, workspace, globalConfig, projectLocalConfig }) => {
    await writeFile(
      globalConfig,
      [
        "sources:",
        "  overridden:",
        "    description: Global source.",
        "    instructions: Global instructions.",
      ].join("\n"),
    );
    await writeFile(
      projectLocalConfig,
      [
        "sources:",
        "  overridden:",
        "    description: Broken override.",
        "    instructions: Local instructions.",
        "    unexpected: true",
      ].join("\n"),
    );

    const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
    assert.equal(catalog.sources.has("overridden"), false);
    assert.match(catalog.diagnostics.join("\n"), /overridden/);
  });
});

test("ignores an invalid configuration file and preserves valid layers", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig, projectLocalConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  retained:",
          "    description: Global source.",
          "    instructions: Global instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  project-base:",
          "    description: Project source.",
          "    instructions: Project instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectLocalConfig,
        [
          "source:",
          "  project-base:",
          "    instructions: Local instructions.",
        ].join("\n"),
      );

      const catalog = await loadCatalog({
        cwd: workspace,
        homeDirectory: home,
      });
      assert.equal(catalog.sources.has("retained"), true);
      assert.equal(catalog.sources.has("project-base"), true);
      assert.equal(
        await readInstructions(catalog.sources.get("project-base")!),
        "Project instructions.",
      );
      assert.match(
        catalog.diagnostics.join("\n"),
        /Invalid knowledge configuration/,
      );
    },
  );
});

test("ignores a YAML parse error in one file and preserves valid layers", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig, projectLocalConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  retained:",
          "    description: Global source.",
          "    instructions: Global instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  project-base:",
          "    description: Project source.",
          "    instructions: Project instructions.",
        ].join("\n"),
      );
      await writeFile(projectLocalConfig, "sources: [");

      const catalog = await loadCatalog({
        cwd: workspace,
        homeDirectory: home,
      });
      assert.equal(catalog.sources.has("retained"), true);
      assert.equal(catalog.sources.has("project-base"), true);
      assert.match(
        catalog.diagnostics.join("\n"),
        /YAML parse error/,
      );
    },
  );
});

test("applies a valid global local file when the global base file is invalid", async () => {
  await withFixture(async ({ home, workspace, globalConfig, globalLocalConfig }) => {
    await writeFile(globalConfig, "source:\n  global-only:\n");
    await writeFile(
      globalLocalConfig,
      [
        "sources:",
        "  global-only:",
        "    description: Global local source.",
        "    instructions: Global local instructions.",
      ].join("\n"),
    );

    const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
    const source = catalog.sources.get("global-only");
    assert.ok(source);
    assert.equal(source.scope, "global");
    assert.equal(source.configPath, globalLocalConfig);
    assert.equal(await readInstructions(source), "Global local instructions.");
    assert.match(
      catalog.diagnostics.join("\n"),
      /Invalid knowledge configuration/,
    );
  });
});

test("applies a valid project local file when the project base file is invalid", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig, projectLocalConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  retained:",
          "    description: Global source.",
          "    instructions: Global instructions.",
        ].join("\n"),
      );
      await writeFile(projectConfig, "sources: [");
      await writeFile(
        projectLocalConfig,
        [
          "sources:",
          "  project-only:",
          "    description: Project local source.",
          "    instructions: Project local instructions.",
        ].join("\n"),
      );

      const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
      assert.equal(catalog.sources.has("retained"), true);
      const source = catalog.sources.get("project-only");
      assert.ok(source);
      assert.equal(source.scope, "project");
      assert.equal(source.configPath, projectLocalConfig);
      assert.equal(await readInstructions(source), "Project local instructions.");
      assert.match(
        catalog.diagnostics.join("\n"),
        /YAML parse error/,
      );
    },
  );
});

test("reconstructs a tombstoned source from a later valid entry", async () => {
  await withFixture(
    async ({ home, workspace, globalConfig, projectConfig, projectLocalConfig }) => {
      await writeFile(
        globalConfig,
        [
          "sources:",
          "  layered:",
          "    description: Global source.",
          "    instructions: Global instructions.",
        ].join("\n"),
      );
      await writeFile(
        projectConfig,
        [
          "sources:",
          "  layered:",
          "    description: Broken source.",
          "    instructions: Broken instructions.",
          "    unexpected: true",
        ].join("\n"),
      );
      await writeFile(
        projectLocalConfig,
        [
          "sources:",
          "  layered:",
          "    description: Reconstructed source.",
          "    instructions: Reconstructed instructions.",
        ].join("\n"),
      );

      const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
      const source = catalog.sources.get("layered");
      assert.ok(source);
      assert.equal(source.description, "Reconstructed source.");
      assert.equal(source.configPath, projectLocalConfig);
      assert.equal(
        await readInstructions(source),
        "Reconstructed instructions.",
      );
      assert.match(catalog.diagnostics.join("\n"), /layered/);
    },
  );
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
        "  external:",
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
    assert.deepEqual(catalog.diagnostics, []);
  });
});

test("treats an empty source map like a missing configuration", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(projectConfig, "sources: {}\n");
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
  });
});

test("rejects the previous sequence source schema", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  - name: legacy",
        "    description: Legacy source.",
        "    instructions: Legacy instructions.",
      ].join("\n"),
    );
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
    assert.match(
      catalog.diagnostics.join("\n"),
      /Invalid knowledge configuration/,
    );
  });
});

test("diagnoses YAML parse errors and readable invalid configuration", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    const missingGlobal = path.join(workspace, "missing.yml");

    await writeFile(projectConfig, "sources: [");
    const parseCatalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: missingGlobal,
    });
    assert.equal(parseCatalog.sources.size, 0);
    assert.match(parseCatalog.diagnostics.join("\n"), /YAML parse error/);

    await writeFile(
      projectConfig,
      [
        "sources:",
        "  extra:",
        "    description: Has an unknown field.",
        "    instructions: Search.",
        "    unexpected: true",
      ].join("\n"),
    );
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: missingGlobal,
    });
    assert.equal(catalog.sources.size, 0);
    assert.match(catalog.diagnostics.join("\n"), /extra/);
  });
});

test("ignores a configuration file that cannot be read", async () => {
  await withFixture(async ({ home, workspace, globalConfig, projectConfig }) => {
    await writeFile(
      globalConfig,
      [
        "sources:",
        "  retained:",
        "    description: Global source.",
        "    instructions: Global instructions.",
      ].join("\n"),
    );
    await mkdir(projectConfig);

    const catalog = await loadCatalog({ cwd: workspace, homeDirectory: home });
    assert.equal(catalog.sources.has("retained"), true);
    assert.match(
      catalog.diagnostics.join("\n"),
      /Cannot read configuration file/,
    );
  });
});

test("reports duplicate source map keys as YAML parse errors", async () => {
  await withFixture(async ({ workspace, projectConfig }) => {
    await writeFile(
      projectConfig,
      [
        "sources:",
        "  duplicate:",
        "    description: First.",
        "    instructions: First.",
        "  duplicate:",
        "    description: Second.",
        "    instructions: Second.",
      ].join("\n"),
    );
    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
    assert.match(catalog.diagnostics.join("\n"), /YAML parse error/);
  });
});

test("excludes missing, absolute, and out-of-scope instruction files", async () => {
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
          "  invalid-file:",
          "    description: Invalid file.",
          "    instructions:",
          `      file: ${JSON.stringify(file)}`,
        ].join("\n"),
      );
      const catalog = await loadCatalog({
        cwd: workspace,
        globalConfigPath: missingGlobal,
      });
      assert.equal(catalog.sources.size, 0);
      assert.match(catalog.diagnostics.join("\n"), /invalid-file/);
    }
  });
});

test("excludes a junction that escapes the project scope", async () => {
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
        "  junction:",
        "    description: Junction escape.",
        "    instructions:",
        "      file: ../linked-outside/search.md",
      ].join("\n"),
    );

    const catalog = await loadCatalog({
      cwd: workspace,
      globalConfigPath: path.join(workspace, "missing.yml"),
    });
    assert.equal(catalog.sources.size, 0);
    assert.match(catalog.diagnostics.join("\n"), /escapes its allowed scope/);
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
        "  changing-link:",
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
