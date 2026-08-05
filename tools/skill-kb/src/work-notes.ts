import {
  access,
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { KnowledgeCatalog, KnowledgeSource } from "./config.js";

const MAX_GREP_RESULTS = 100;
const AUTHORITY_NOTICE =
  "この作業メモは低権威の補助情報であり、正式な仕様、設計資料、公式資料、現在のコード、ユーザーの現在の明示判断より優先されない。重要な判断へ使う前に、根拠、適用範囲、反証条件、再確認条件を現在の状態へ照合する。作業メモを根拠として正式な情報源を自動更新しない。";

const metadataSchema = z
  .object({
    source_names: z.array(z.string().min(1)).min(1),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    change_reason: z.string().min(1).optional(),
  })
  .strict();

export const observationSchema = z
  .object({
    target: z.string().min(1).describe("実際に観測または再現した対象"),
    version_or_commit: z
      .string()
      .min(1)
      .describe("対象の版、commit、または状態を識別できる値"),
    environment: z
      .string()
      .min(1)
      .describe("OS、ランタイム、設定など結果に影響する実行環境"),
    preconditions: z
      .string()
      .min(1)
      .describe("観測または再現を成立させた前提条件"),
    method: z.string().min(1).describe("実際に行った観測または再現の方法"),
    input: z.string().min(1).describe("観測または再現へ与えた入力"),
    observed_result: z
      .string()
      .min(1)
      .describe("解釈を加えず、実際に確認した結果"),
    raw_artifacts: z
      .string()
      .min(1)
      .optional()
      .describe("ログ、出力ファイル、画像など生の成果物の場所または内容"),
    repetitions_or_reproduction_status: z
      .string()
      .min(1)
      .optional()
      .describe("反復回数、再現率、または再現状況"),
    known_limits: z
      .string()
      .min(1)
      .optional()
      .describe("記録できなかった条件や既知の限界"),
  })
  .strict();

export type WorkNoteObservation = z.infer<typeof observationSchema>;

export type WorkNoteContent = {
  source_names: string[];
  file_name: string;
  title: string;
  claim: string;
  evidence: string;
  reasoning: string;
  scope: string;
  scope_basis: string;
  defeaters: string;
  revalidate_when: string;
  observation?: WorkNoteObservation | undefined;
};

export type UpdateWorkNoteContent = WorkNoteContent & {
  change_reason: string;
};

type WorkNoteMetadata = z.infer<typeof metadataSchema>;

type ParsedWorkNote = {
  metadata: WorkNoteMetadata;
  markdown: string;
};

export class WorkNoteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkNoteError";
  }
}

export type WorkNoteStoreOptions = {
  globalRoot?: string;
  projectRoot?: string;
  now?: () => Date;
};

function defaultGlobalRoot(homeDirectory: string): string {
  return path.join(
    homeDirectory,
    ".local",
    "share",
    "chezmoi",
    ".opencode",
    "work-notes",
  );
}

function assertSafeFileName(fileName: string): void {
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  if (
    fileName.length === 0 ||
    fileName !== path.basename(fileName) ||
    path.isAbsolute(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    /[<>:"|?*\u0000-\u001f]/u.test(fileName) ||
    fileName.endsWith(".") ||
    fileName.endsWith(" ") ||
    !fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase() === ".md" ||
    windowsReserved.test(fileName)
  ) {
    throw new WorkNoteError(`Unsafe work note file name: ${fileName}`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function splitFrontmatter(markdown: string): {
  metadataText: string;
} {
  const normalized = markdown.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new WorkNoteError("Work note is missing YAML frontmatter");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new WorkNoteError("Work note has unterminated YAML frontmatter");
  }
  return { metadataText: normalized.slice(4, end) };
}

function parseWorkNote(markdown: string, fileName: string): ParsedWorkNote {
  let document: unknown;
  try {
    document = parse(splitFrontmatter(markdown).metadataText);
  } catch (error) {
    throw new WorkNoteError(`Invalid work note frontmatter: ${fileName}`, {
      cause: error,
    });
  }
  const metadata = metadataSchema.safeParse(document);
  if (!metadata.success) {
    throw new WorkNoteError(
      `Invalid work note frontmatter ${fileName}: ${z.prettifyError(metadata.error)}`,
    );
  }
  if (
    new Set(metadata.data.source_names).size !==
    metadata.data.source_names.length
  ) {
    throw new WorkNoteError(
      `Work note contains duplicate source names: ${fileName}`,
    );
  }
  return { metadata: metadata.data, markdown };
}

function observationMarkdown(observation: WorkNoteObservation): string {
  const rows: Array<[string, string | undefined]> = [
    ["対象", observation.target],
    ["対象バージョンまたはcommit", observation.version_or_commit],
    ["実行環境", observation.environment],
    ["前提条件", observation.preconditions],
    ["方法", observation.method],
    ["入力", observation.input],
    ["観測結果", observation.observed_result],
    ["生の成果物", observation.raw_artifacts],
    ["反復回数または再現状況", observation.repetitions_or_reproduction_status],
    ["記録できなかった条件や既知の限界", observation.known_limits],
  ];
  return [
    "## 観測・再現情報",
    "",
    ...rows
      .filter((row): row is [string, string] => row[1] !== undefined)
      .flatMap(([label, value]) => [`### ${label}`, "", value, ""]),
  ]
    .join("\n")
    .trimEnd();
}

function renderWorkNote(
  input: WorkNoteContent,
  metadata: WorkNoteMetadata,
): string {
  const frontmatter = stringify(metadata).trimEnd();
  const sections = [
    `# ${input.title}`,
    `> ${AUTHORITY_NOTICE}`,
    `## 主張\n\n${input.claim}`,
    `## 根拠\n\n${input.evidence}`,
    `## 根拠から主張を導ける理由\n\n${input.reasoning}`,
    `## 適用範囲\n\n${input.scope}`,
    `## この適用範囲とした理由\n\n${input.scope_basis}`,
    `## 反証条件\n\n${input.defeaters}`,
    `## 再確認条件\n\n${input.revalidate_when}`,
  ];
  if (metadata.change_reason !== undefined) {
    sections.push(`## 更新理由\n\n${metadata.change_reason}`);
  }
  if (input.observation !== undefined) {
    sections.push(observationMarkdown(input.observation));
  }
  return `---\n${frontmatter}\n---\n\n${sections.join("\n\n")}\n`;
}

function uniqueSourceNames(sourceNames: string[]): string[] {
  const normalized = sourceNames.map((name) => name.trim());
  if (normalized.some((name) => name.length === 0)) {
    throw new WorkNoteError("source_names must not contain blank names");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new WorkNoteError("source_names must not contain duplicates");
  }
  return normalized;
}

function timestampName(timestamp: string): string {
  return timestamp.replace(/[:.]/gu, "-");
}

export class WorkNoteStore {
  readonly globalRoot: string;
  readonly projectRoot: string;
  readonly #catalog: KnowledgeCatalog;
  readonly #now: () => Date;

  constructor(catalog: KnowledgeCatalog, options: WorkNoteStoreOptions = {}) {
    this.#catalog = catalog;
    this.globalRoot = path.resolve(
      options.globalRoot ?? defaultGlobalRoot(catalog.homeDirectory),
    );
    this.projectRoot = path.resolve(
      options.projectRoot ??
        path.join(catalog.workspace, ".opencode", "work-notes"),
    );
    this.#now = options.now ?? (() => new Date());
  }

  #source(name: string): KnowledgeSource {
    const source = this.#catalog.sources.get(name);
    if (!source) {
      throw new WorkNoteError(`Unknown knowledge source: ${name}`);
    }
    return source;
  }

  #sources(sourceNames: string[]): KnowledgeSource[] {
    return uniqueSourceNames(sourceNames).map((name) => this.#source(name));
  }

  #targetRoot(sources: KnowledgeSource[]): string {
    return sources.some((source) => source.scope === "project")
      ? this.projectRoot
      : this.globalRoot;
  }

  #searchRoots(source: KnowledgeSource): string[] {
    const roots =
      source.scope === "project"
        ? [this.projectRoot]
        : [this.globalRoot, this.projectRoot];
    // グローバル保存先とプロジェクト保存先が同一パスになる環境では重複探索しない。
    return [...new Set(roots)];
  }

  #visibleRoots(): string[] {
    // グローバル保存先とプロジェクト保存先が同一パスになる環境では重複探索しない。
    return [...new Set([this.globalRoot, this.projectRoot])];
  }

  async #findByFileName(fileName: string, roots: string[]): Promise<string[]> {
    assertSafeFileName(fileName);
    const candidates = roots.map((root) => path.join(root, fileName));
    const states = await Promise.all(candidates.map(isRegularFile));
    return candidates.filter((_, index) => states[index]);
  }

  async #assertIdentifierAvailable(fileName: string): Promise<void> {
    const matches = await this.#findByFileName(fileName, this.#visibleRoots());
    if (matches.length > 0) {
      throw new WorkNoteError(
        `Work note already exists; use update_work_note: ${fileName}`,
      );
    }
  }

  async #writeComplete(
    filePath: string,
    markdown: string,
    replace: boolean,
  ): Promise<void> {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
      if (replace) {
        await rename(temporary, filePath);
      } else {
        try {
          await link(temporary, filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new WorkNoteError(
              `Work note already exists; use update_work_note: ${path.basename(filePath)}`,
            );
          }
          throw error;
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  #assertStoredInExpectedRoot(
    metadata: WorkNoteMetadata,
    actualRoot: string,
    fileName: string,
  ): void {
    const expectedRoot = this.#targetRoot(this.#sources(metadata.source_names));
    if (expectedRoot !== actualRoot) {
      throw new WorkNoteError(
        `Work note is stored outside its required scope: ${fileName}`,
      );
    }
  }

  async #archivePath(
    root: string,
    fileName: string,
    updatedAt: string,
  ): Promise<string> {
    const directory = path.join(root, ".history", fileName);
    await mkdir(directory, { recursive: true });
    const stem = timestampName(updatedAt);
    for (let suffix = 0; ; suffix += 1) {
      const candidate = path.join(
        directory,
        suffix === 0 ? `${stem}.md` : `${stem}-${suffix}.md`,
      );
      if (!(await pathExists(candidate))) {
        return candidate;
      }
    }
  }

  async create(input: WorkNoteContent): Promise<{
    file_name: string;
    source_names: string[];
    saved_to: string;
    created_at: string;
  }> {
    assertSafeFileName(input.file_name);
    const sources = this.#sources(input.source_names);
    await this.#assertIdentifierAvailable(input.file_name);
    const timestamp = this.#now().toISOString();
    const sourceNames = sources.map((source) => source.name);
    const markdown = renderWorkNote(
      { ...input, source_names: sourceNames },
      {
        source_names: sourceNames,
        created_at: timestamp,
        updated_at: timestamp,
      },
    );
    const target = path.join(this.#targetRoot(sources), input.file_name);
    await this.#writeComplete(target, markdown, false);
    return {
      file_name: input.file_name,
      source_names: sourceNames,
      saved_to: target,
      created_at: timestamp,
    };
  }

  async update(input: UpdateWorkNoteContent): Promise<{
    file_name: string;
    source_names: string[];
    saved_to: string;
    updated_at: string;
  }> {
    assertSafeFileName(input.file_name);
    const matches = await this.#findByFileName(
      input.file_name,
      this.#visibleRoots(),
    );
    if (matches.length === 0) {
      throw new WorkNoteError(`Work note does not exist: ${input.file_name}`);
    }
    if (matches.length > 1) {
      throw new WorkNoteError(
        `Ambiguous work note identifier: ${input.file_name}`,
      );
    }
    const currentPath = matches[0];
    if (currentPath === undefined) {
      throw new WorkNoteError(`Work note does not exist: ${input.file_name}`);
    }
    const currentMarkdown = await readFile(currentPath, "utf8");
    const current = parseWorkNote(currentMarkdown, input.file_name);
    this.#assertStoredInExpectedRoot(
      current.metadata,
      path.dirname(currentPath),
      input.file_name,
    );
    const requestedSourceNames = this.#sources(input.source_names)
      .map((source) => source.name)
      .sort((left, right) => left.localeCompare(right, "en"));
    const currentSourceNames = [...current.metadata.source_names].sort(
      (left, right) => left.localeCompare(right, "en"),
    );
    if (
      requestedSourceNames.length !== currentSourceNames.length ||
      requestedSourceNames.some(
        (sourceName, index) => sourceName !== currentSourceNames[index],
      )
    ) {
      throw new WorkNoteError(
        `Work note source associations cannot be changed: ${input.file_name}`,
      );
    }
    const sourceNames = current.metadata.source_names;
    const currentRoot = path.dirname(currentPath);
    const targetPath = currentPath;
    const timestamp = this.#now().toISOString();
    const updatedMarkdown = renderWorkNote(
      { ...input, source_names: sourceNames },
      {
        source_names: sourceNames,
        created_at: current.metadata.created_at,
        updated_at: timestamp,
        change_reason: input.change_reason,
      },
    );
    const archivePath = await this.#archivePath(
      currentRoot,
      input.file_name,
      current.metadata.updated_at,
    );
    await copyFile(currentPath, archivePath, constants.COPYFILE_EXCL);
    await this.#writeComplete(targetPath, updatedMarkdown, true);
    return {
      file_name: input.file_name,
      source_names: sourceNames,
      saved_to: targetPath,
      updated_at: timestamp,
    };
  }

  async grep(
    sourceName: string,
    pattern: string,
  ): Promise<{
    source_name: string;
    pattern: string;
    matches: string[];
    total_match_count: number;
    returned_match_count: number;
    truncated: boolean;
    note?: string;
  }> {
    const source = this.#source(sourceName);
    let expression: RegExp;
    try {
      expression = new RegExp(pattern);
    } catch (error) {
      throw new WorkNoteError(`Invalid regular expression: ${pattern}`, {
        cause: error,
      });
    }

    const matched = new Set<string>();
    const seen = new Set<string>();
    for (const root of this.#searchRoots(source)) {
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
          continue;
        }
        try {
          assertSafeFileName(entry.name);
          const markdown = await readFile(path.join(root, entry.name), "utf8");
          const note = parseWorkNote(markdown, entry.name);
          this.#assertStoredInExpectedRoot(note.metadata, root, entry.name);
          if (!note.metadata.source_names.includes(sourceName)) {
            continue;
          }
          if (seen.has(entry.name)) {
            throw new WorkNoteError(
              `Ambiguous work note identifier: ${entry.name}`,
            );
          }
          seen.add(entry.name);
          if (expression.test(markdown)) {
            matched.add(entry.name);
          }
        } catch (error) {
          if (
            error instanceof WorkNoteError &&
            error.message.startsWith("Ambiguous")
          ) {
            throw error;
          }
          // grep_work_notes searches only valid, regular work notes.
        }
      }
    }
    const allMatches = [...matched].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    const matches = allMatches.slice(0, MAX_GREP_RESULTS);
    const truncated = matches.length < allMatches.length;
    return {
      source_name: sourceName,
      pattern,
      matches,
      total_match_count: allMatches.length,
      returned_match_count: matches.length,
      truncated,
      ...(truncated
        ? { note: "結果が上限を超えたため、pattern を絞って再検索すること。" }
        : {}),
    };
  }

  async read(
    sourceName: string,
    fileName: string,
  ): Promise<{
    source_name: string;
    file_name: string;
    markdown: string;
    authority_notice: string;
  }> {
    const source = this.#source(sourceName);
    const matches = await this.#findByFileName(
      fileName,
      this.#searchRoots(source),
    );
    const corresponding: ParsedWorkNote[] = [];
    for (const match of matches) {
      const note = parseWorkNote(await readFile(match, "utf8"), fileName);
      this.#assertStoredInExpectedRoot(
        note.metadata,
        path.dirname(match),
        fileName,
      );
      if (note.metadata.source_names.includes(sourceName)) {
        corresponding.push(note);
      }
    }
    if (corresponding.length === 0) {
      throw new WorkNoteError(
        `Work note does not exist for knowledge source ${sourceName}: ${fileName}`,
      );
    }
    if (corresponding.length > 1) {
      throw new WorkNoteError(`Ambiguous work note identifier: ${fileName}`);
    }
    const note = corresponding[0];
    if (note === undefined) {
      throw new WorkNoteError(`Work note does not exist: ${fileName}`);
    }
    return {
      source_name: sourceName,
      file_name: fileName,
      markdown: note.markdown,
      authority_notice: AUTHORITY_NOTICE,
    };
  }
}

export { AUTHORITY_NOTICE, MAX_GREP_RESULTS };
