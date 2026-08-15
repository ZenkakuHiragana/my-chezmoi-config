import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCatalog } from "../src/config.js";
import {
  MAX_GREP_RESULTS,
  WorkNoteError,
  WorkNoteStore,
  type WorkNoteContent,
} from "../src/work-notes.js";

type Fixture = {
  root: string;
  home: string;
  workspace: string;
  globalRoot: string;
  projectRoot: string;
  store: WorkNoteStore;
};

async function makeFixture(
  options: { sameRoot?: boolean } = {},
): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-work-notes-"));
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const globalDirectory = path.join(home, ".config", "opencode");
  const projectDirectory = path.join(workspace, ".opencode");
  const globalConfig = path.join(globalDirectory, "KNOWLEDGE.yml");
  await Promise.all([
    mkdir(globalDirectory, { recursive: true }),
    mkdir(projectDirectory, { recursive: true }),
  ]);
  await writeFile(
    globalConfig,
    [
      "sources:",
      "  global-docs:",
      "    description: Global documents.",
      "    instructions: Search global documents.",
      "  shared:",
      "    description: Global shared documents.",
      "    instructions: Search global shared documents.",
    ].join("\n"),
  );
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  project-design:",
      "    description: Project design.",
      "    instructions: Search project design.",
      "  shared:",
      "    description: Project override.",
      "    instructions: Search project override.",
    ].join("\n"),
  );
  const catalog = await loadCatalog({
    cwd: workspace,
    homeDirectory: home,
  });
  const globalRoot = path.join(root, "central-work-notes");
  const projectRoot = options.sameRoot
    ? globalRoot
    : path.join(projectDirectory, "work-notes");
  let tick = 0;
  const store = new WorkNoteStore(catalog, {
    globalRoot,
    projectRoot,
    now: () => new Date(Date.UTC(2026, 6, 30, 7, 0, tick++)),
  });
  return { root, home, workspace, globalRoot, projectRoot, store };
}

async function withFixture(
  callback: (fixture: Fixture) => Promise<void>,
  options?: { sameRoot?: boolean },
): Promise<void> {
  const fixture = await makeFixture(options);
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

function note(
  fileName: string,
  sourceNames: string[],
  marker = "constant register c6",
): WorkNoteContent {
  return {
    source_names: sourceNames,
    file_name: fileName,
    title: `表題 ${fileName}`,
    claim: `主張 ${marker}`,
    evidence: "根拠となる実行結果",
    reasoning: "根拠が対象条件を直接観測しているため",
    scope: "確認した版と同じ条件",
    scope_basis: "他の版と環境は確認していないため",
    defeaters: "反対の実行結果が得られた場合",
    revalidate_when: "対象版または設定が変わった場合",
  };
}

test("stores global-only notes centrally and project or mixed notes locally", async () => {
  await withFixture(async ({ store, globalRoot, projectRoot }) => {
    const globalResult = await store.create(
      note("global-note.md", ["global-docs"]),
    );
    const projectResult = await store.create(
      note("project-note.md", ["project-design"]),
    );
    const mixedResult = await store.create(
      note("mixed-note.md", ["global-docs", "project-design"]),
    );
    const overriddenResult = await store.create(
      note("override-note.md", ["shared"]),
    );

    assert.equal(
      globalResult.saved_to,
      path.join(globalRoot, "global-note.md"),
    );
    assert.equal(
      projectResult.saved_to,
      path.join(projectRoot, "project-note.md"),
    );
    assert.equal(mixedResult.saved_to, path.join(projectRoot, "mixed-note.md"));
    assert.equal(
      overriddenResult.saved_to,
      path.join(projectRoot, "override-note.md"),
    );
  });
});

test("generates the required Markdown and omits empty observation sections", async () => {
  await withFixture(async ({ store, globalRoot }) => {
    await store.create(note("plain.md", ["global-docs"]));
    const plain = await readFile(path.join(globalRoot, "plain.md"), "utf8");
    assert.match(plain, /^---\nsource_names:\n  - global-docs\n/);
    assert.match(plain, /created_at: 2026-07-30T07:00:00\.000Z/);
    assert.match(plain, /## 主張\n\n主張 constant register c6/);
    assert.match(plain, /## 根拠から主張を導ける理由/);
    assert.match(plain, /## この適用範囲とした理由/);
    assert.match(plain, /## 反証条件/);
    assert.match(plain, /## 再確認条件/);
    assert.match(plain, /低権威の補助情報/);
    assert.doesNotMatch(plain, /## 観測・再現情報/);

    await store.create({
      ...note("observed.md", ["global-docs"]),
      observation: {
        target: "実行対象",
        version_or_commit: "abc123",
        environment: "Windows 11、Node.js 26",
        preconditions: "既定設定",
        method: "コマンドを3回実行",
        input: "sample",
        observed_result: "3回とも同じ値",
        repetitions_or_reproduction_status: "3/3",
      },
    });
    const observed = await readFile(
      path.join(globalRoot, "observed.md"),
      "utf8",
    );
    assert.match(observed, /## 観測・再現情報/);
    assert.match(observed, /### 観測結果\n\n3回とも同じ値/);
    assert.match(observed, /### 反復回数または再現状況\n\n3\/3/);
    assert.doesNotMatch(observed, /### 生の成果物/);
  });
});

test("rejects unknown sources, duplicate sources, unsafe names, and recreation", async () => {
  await withFixture(async ({ store }) => {
    await assert.rejects(
      store.create(note("missing.md", ["missing"])),
      /Unknown knowledge source/,
    );
    await assert.rejects(
      store.create(note("duplicate-source.md", ["global-docs", "global-docs"])),
      /must not contain duplicates/,
    );
    for (const fileName of [
      "../escape.md",
      "sub/note.md",
      "C:\\escape.md",
      "CON.md",
      "not-markdown.txt",
    ]) {
      await assert.rejects(
        store.create(note(fileName, ["global-docs"])),
        WorkNoteError,
      );
    }
    await store.create(note("existing.md", ["global-docs"]));
    await assert.rejects(
      store.create(note("existing.md", ["project-design"])),
      /use update_work_note/,
    );
  });
});

test("searches global notes plus the current project and isolates project sources", async () => {
  await withFixture(async ({ store, root, home, workspace }) => {
    await store.create(note("global.md", ["global-docs"], "needle"));
    await store.create(
      note("mixed.md", ["global-docs", "project-design"], "needle"),
    );
    await store.create(note("project.md", ["project-design"], "needle"));

    assert.deepEqual((await store.grep("global-docs", "needle")).matches, [
      "global.md",
      "mixed.md",
    ]);
    assert.deepEqual((await store.grep("project-design", "needle")).matches, [
      "mixed.md",
      "project.md",
    ]);
    assert.deepEqual((await store.grep("global-docs", "absent")).matches, []);
    await assert.rejects(
      store.grep("global-docs", "["),
      /Invalid regular expression/,
    );

    const otherWorkspace = path.join(root, "other-workspace");
    await mkdir(path.join(otherWorkspace, ".opencode"), { recursive: true });
    const otherCatalog = await loadCatalog({
      cwd: otherWorkspace,
      homeDirectory: home,
    });
    const otherStore = new WorkNoteStore(otherCatalog, {
      globalRoot: store.globalRoot,
      projectRoot: path.join(otherWorkspace, ".opencode", "work-notes"),
    });
    assert.deepEqual((await otherStore.grep("global-docs", "needle")).matches, [
      "global.md",
    ]);
    assert.equal(workspace.endsWith("workspace"), true);
  });
});

test("reads the full note only through a corresponding source", async () => {
  await withFixture(async ({ store, projectRoot }) => {
    await store.create(note("mixed.md", ["global-docs", "project-design"]));
    const result = await store.read("global-docs", "mixed.md");
    assert.match(result.markdown, /^---/);
    assert.match(result.markdown, /## 再確認条件/);
    assert.match(result.authority_notice, /現在の状態へ照合/);
    await assert.rejects(
      store.read("shared", "mixed.md"),
      /does not exist for knowledge source/,
    );

    await writeFile(
      path.join(projectRoot, "broken.md"),
      "---\nsource_names: nope\n---\n# broken\n",
    );
    await assert.rejects(
      store.read("project-design", "broken.md"),
      /Invalid work note frontmatter/,
    );
  });
});

test("updates notes, preserves creation time and history, and records reasons", async () => {
  await withFixture(async ({ store, globalRoot }) => {
    await store.create(note("changing.md", ["global-docs"], "before"));
    const result = await store.update({
      ...note("changing.md", ["global-docs"], "after"),
      change_reason: "追加検証で主張が変わったため",
    });
    assert.equal(result.updated_at, "2026-07-30T07:00:01.000Z");
    const current = await readFile(
      path.join(globalRoot, "changing.md"),
      "utf8",
    );
    assert.match(current, /created_at: 2026-07-30T07:00:00\.000Z/);
    assert.match(current, /updated_at: 2026-07-30T07:00:01\.000Z/);
    assert.match(current, /change_reason: 追加検証で主張が変わったため/);
    assert.match(current, /## 更新理由\n\n追加検証で主張が変わったため/);
    assert.match(current, /主張 after/);
    const historyDirectory = path.join(globalRoot, ".history", "changing.md");
    const historyFiles = await (
      await import("node:fs/promises")
    ).readdir(historyDirectory);
    assert.equal(historyFiles.length, 1);
    const old = await readFile(
      path.join(historyDirectory, historyFiles[0] ?? ""),
      "utf8",
    );
    assert.match(old, /主張 before/);
    assert.doesNotMatch(old, /主張 after/);
    assert.deepEqual((await store.grep("global-docs", "before")).matches, []);
  });
});

test("rejects changes to source associations during update", async () => {
  await withFixture(async ({ store, globalRoot, projectRoot }) => {
    await store.create(note("fixed-sources.md", ["global-docs"], "before"));
    await assert.rejects(
      store.update({
        ...note("fixed-sources.md", ["global-docs", "project-design"], "after"),
        change_reason: "対応先を変える",
      }),
      /source associations cannot be changed/,
    );
    assert.match(
      await readFile(path.join(globalRoot, "fixed-sources.md"), "utf8"),
      /主張 before/,
    );
    await assert.rejects(
      readFile(path.join(projectRoot, "fixed-sources.md"), "utf8"),
    );
  });
});

test("rejects missing and ambiguous updates", async () => {
  await withFixture(async ({ store, globalRoot, projectRoot }) => {
    await assert.rejects(
      store.update({
        ...note("missing.md", ["global-docs"]),
        change_reason: "存在しない",
      }),
      /does not exist/,
    );
    await Promise.all([
      mkdir(globalRoot, { recursive: true }),
      mkdir(projectRoot, { recursive: true }),
    ]);
    const content = [
      "---",
      "source_names:",
      "  - global-docs",
      "created_at: 2026-07-30T07:00:00.000Z",
      "updated_at: 2026-07-30T07:00:00.000Z",
      "---",
      "# duplicate",
      "",
    ].join("\n");
    await Promise.all([
      writeFile(path.join(globalRoot, "ambiguous.md"), content),
      writeFile(path.join(projectRoot, "ambiguous.md"), content),
    ]);
    await assert.rejects(
      store.update({
        ...note("ambiguous.md", ["global-docs"]),
        change_reason: "曖昧",
      }),
      /Ambiguous work note identifier/,
    );
  });
});

test("operates on notes when global and project roots coincide", async () => {
  await withFixture(
    async ({ store, globalRoot }) => {
      await store.create(note("same-root.md", ["global-docs"], "before"));
      await store.create(
        note("same-root-mixed.md", ["global-docs", "project-design"], "before"),
      );

      const readResult = await store.read("global-docs", "same-root.md");
      assert.match(readResult.markdown, /主張 before/);

      const grepResult = await store.grep("global-docs", "before");
      assert.deepEqual(
        new Set(grepResult.matches),
        new Set(["same-root-mixed.md", "same-root.md"]),
      );

      const updateResult = await store.update({
        ...note("same-root.md", ["global-docs"], "after"),
        change_reason: "同一パス環境の更新確認",
      });
      assert.equal(
        updateResult.saved_to,
        path.join(globalRoot, "same-root.md"),
      );
      const current = await readFile(
        path.join(globalRoot, "same-root.md"),
        "utf8",
      );
      assert.match(current, /主張 after/);
      assert.doesNotMatch(current, /主張 before/);
    },
    { sameRoot: true },
  );
});

test("returns fixed-order capped grep results without excerpts", async () => {
  await withFixture(async ({ store }) => {
    for (let index = MAX_GREP_RESULTS; index >= 0; index -= 1) {
      await store.create(
        note(
          `note-${index.toString().padStart(3, "0")}.md`,
          ["global-docs"],
          "cap-marker",
        ),
      );
    }
    const result = await store.grep("global-docs", "cap-marker");
    assert.equal(result.total_match_count, MAX_GREP_RESULTS + 1);
    assert.equal(result.returned_match_count, MAX_GREP_RESULTS);
    assert.equal(result.truncated, true);
    assert.match(result.note ?? "", /pattern/);
    assert.equal(result.matches[0], "note-000.md");
    assert.equal(
      result.matches[MAX_GREP_RESULTS - 1],
      `note-${(MAX_GREP_RESULTS - 1).toString().padStart(3, "0")}.md`,
    );
    assert.equal(JSON.stringify(result).includes("主張 cap-marker"), false);
  });
});
