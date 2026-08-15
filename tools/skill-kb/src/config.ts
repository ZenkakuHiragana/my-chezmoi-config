import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { z } from "zod";

const instructionFileSchema = z
  .object({
    file: z.string().min(1),
  })
  .strict();

const rawSourceSchema = z
  .object({
    description: z.string().min(1).optional(),
    instructions: z.union([z.string().min(1), instructionFileSchema]).optional(),
    query_module: z.string().min(1).optional(),
    query_options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const rawDocumentSchema = z
  .object({
    sources: z.record(z.string(), z.unknown()),
  })
  .strict();

type RawInstructions = string | { file: string };
type RawSource = {
  description?: string | undefined;
  instructions?: RawInstructions | undefined;
  query_module?: string | undefined;
  query_options?: Record<string, unknown> | undefined;
};
type RawSourceEntry = {
  name: string;
  source: RawSource;
};

type SourceFieldName =
  | "description"
  | "instructions"
  | "query_module"
  | "query_options";

export type SourceScope = "global" | "project";

export type InlineInstructions = {
  kind: "inline";
  text: string;
};

export type FileInstructions = {
  kind: "file";
  declaredPath: string;
  scopeRoot: string;
};

export type QueryFunction = (
  query: string,
  options: unknown,
) => Promise<string>;

export type QueryModule = {
  path: string;
  query: QueryFunction;
  options: unknown;
};

export type KnowledgeSource = {
  name: string;
  description: string;
  instructions: InlineInstructions | FileInstructions;
  queryModule?: QueryModule;
  scope: SourceScope;
  configPath: string;
};

export type KnowledgeCatalog = {
  sources: ReadonlyMap<string, KnowledgeSource>;
  diagnostics: readonly string[];
  globalConfigPath: string;
  projectConfigPath: string;
  workspace: string;
  homeDirectory: string;
};

export type LoadCatalogOptions = {
  cwd?: string;
  homeDirectory?: string;
  globalConfigPath?: string;
};

type SourceOrigin = {
  scope: SourceScope;
  configPath: string;
  scopeRoot: string;
};

type MergedSource = {
  name: string;
  description?: string | undefined;
  instructions?: RawInstructions | undefined;
  query_module?: string | undefined;
  query_options?: Record<string, unknown> | undefined;
  origins: Partial<Record<SourceFieldName, SourceOrigin>>;
};

type LoadedLayer = {
  entries: RawSourceEntry[];
  invalidNames: ReadonlySet<string>;
  diagnostics: string[];
};

export class ConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function resolveDeclaredFile(
  declaredPath: string,
  configPath: string,
  scopeRoot: string,
  fieldName: string,
): Promise<string> {
  if (path.isAbsolute(declaredPath)) {
    throw new ConfigurationError(
      `${fieldName} must be relative in ${configPath}: ${declaredPath}`,
    );
  }

  const lexicalPath = path.resolve(path.dirname(configPath), declaredPath);

  let canonicalRoot: string;
  let canonicalFile: string;
  try {
    [canonicalRoot, canonicalFile] = await Promise.all([
      realpath(scopeRoot),
      realpath(lexicalPath),
    ]);
  } catch (error) {
    throw new ConfigurationError(
      `${fieldName} cannot be resolved in ${configPath}: ${declaredPath}`,
      { cause: error },
    );
  }

  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new ConfigurationError(
      `${fieldName} escapes its allowed scope in ${configPath}: ${declaredPath}`,
    );
  }

  const fileStat = await stat(canonicalFile);
  if (!fileStat.isFile()) {
    throw new ConfigurationError(
      `${fieldName} is not a regular file in ${configPath}: ${declaredPath}`,
    );
  }

  return canonicalFile;
}

function formatDocumentDiagnostic(
  configPath: string,
  message: string,
): string {
  return `Invalid knowledge configuration ${configPath}: ${message}`;
}

function formatSourceDiagnostic(
  configPath: string,
  name: string | undefined,
  message: string,
): string {
  const source = name === undefined ? "source" : `source ${name}`;
  return `Invalid ${source} in ${configPath}: ${message}`;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function loadLayer(
  layer: SourceOrigin,
): Promise<LoadedLayer | undefined> {
  let contents: string;
  try {
    contents = await readFile(layer.configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      entries: [],
      invalidNames: new Set(),
      diagnostics: [
        formatDocumentDiagnostic(
          layer.configPath,
          `Cannot read configuration file: ${message}`,
        ),
      ],
    };
  }

  let document: unknown;
  try {
    document = parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      entries: [],
      invalidNames: new Set(),
      diagnostics: [
        formatDocumentDiagnostic(
          layer.configPath,
          `YAML parse error: ${message}`,
        ),
      ],
    };
  }

  const parsedDocument = rawDocumentSchema.safeParse(document);
  if (!parsedDocument.success) {
    return {
      entries: [],
      invalidNames: new Set(),
      diagnostics: [
        formatDocumentDiagnostic(
          layer.configPath,
          z.prettifyError(parsedDocument.error),
        ),
      ],
    };
  }

  const diagnostics: string[] = [];
  const validEntries: RawSourceEntry[] = [];
  const invalidNames = new Set<string>();

  for (const [name, rawEntry] of Object.entries(parsedDocument.data.sources)) {
    if (!isNonBlank(name)) {
      diagnostics.push(
        formatSourceDiagnostic(
          layer.configPath,
          undefined,
          "Source name must not be blank",
        ),
      );
      continue;
    }

    const parsedEntry = rawSourceSchema.safeParse(rawEntry);
    if (!parsedEntry.success) {
      invalidNames.add(name);
      diagnostics.push(
        formatSourceDiagnostic(
          layer.configPath,
          name,
          z.prettifyError(parsedEntry.error),
        ),
      );
      continue;
    }

    validEntries.push({ name, source: parsedEntry.data });
  }

  return { entries: validEntries, invalidNames, diagnostics };
}

function mergeEntry(
  mergedSources: Map<string, MergedSource>,
  name: string,
  entry: RawSource,
  origin: SourceOrigin,
): void {
  const current =
    mergedSources.get(name) ??
    ({ name, origins: {} } satisfies MergedSource);

  if (Object.hasOwn(entry, "description")) {
    current.description = entry.description;
    current.origins.description = origin;
  }
  if (Object.hasOwn(entry, "instructions")) {
    current.instructions = entry.instructions;
    current.origins.instructions = origin;
  }
  if (Object.hasOwn(entry, "query_module")) {
    current.query_module = entry.query_module;
    current.origins.query_module = origin;
  }
  if (Object.hasOwn(entry, "query_options")) {
    current.query_options = entry.query_options;
    current.origins.query_options = origin;
  }

  mergedSources.set(name, current);
}

function getQueryFunction(value: unknown): QueryFunction | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const query = (value as { query?: unknown }).query;
  return typeof query === "function" ? (query as QueryFunction) : undefined;
}

async function resolveEffectiveSource(
  merged: MergedSource,
): Promise<KnowledgeSource> {
  const description = merged.description?.trim();
  if (description === undefined || !isNonBlank(description)) {
    throw new ConfigurationError("Source description must not be blank");
  }

  const rawInstructions = merged.instructions;
  const instructionsOrigin = merged.origins.instructions;
  if (rawInstructions === undefined || instructionsOrigin === undefined) {
    throw new ConfigurationError("Source instructions must be configured");
  }

  let instructions: InlineInstructions | FileInstructions;
  if (typeof rawInstructions === "string") {
    if (!isNonBlank(rawInstructions)) {
      throw new ConfigurationError("Source instructions must not be blank");
    }
    instructions = { kind: "inline", text: rawInstructions };
  } else {
    await resolveDeclaredFile(
      rawInstructions.file,
      instructionsOrigin.configPath,
      instructionsOrigin.scopeRoot,
      "instructions.file",
    );
    instructions = {
      kind: "file",
      declaredPath: rawInstructions.file,
      scopeRoot: instructionsOrigin.scopeRoot,
    };
  }

  if (
    merged.query_options !== undefined &&
    merged.query_module === undefined
  ) {
    throw new ConfigurationError(
      "query_options requires query_module",
    );
  }

  let queryModule: QueryModule | undefined;
  if (merged.query_module !== undefined) {
    const queryOrigin = merged.origins.query_module;
    if (queryOrigin === undefined) {
      throw new ConfigurationError("query_module declaration has no origin");
    }

    const modulePath = await resolveDeclaredFile(
      merged.query_module,
      queryOrigin.configPath,
      queryOrigin.scopeRoot,
      "query_module",
    );

    let moduleNamespace: unknown;
    try {
      moduleNamespace = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      throw new ConfigurationError(
        `Cannot load query_module for ${merged.name}: ${merged.query_module}`,
        { cause: error },
      );
    }

    const query = getQueryFunction(moduleNamespace);
    if (query === undefined) {
      throw new ConfigurationError(
        `query_module must export a function named query for ${merged.name}`,
      );
    }

    queryModule = {
      path: modulePath,
      query,
      options: merged.query_options,
    };
  }

  return {
    name: merged.name,
    description,
    instructions,
    ...(queryModule === undefined ? {} : { queryModule }),
    scope: instructionsOrigin.scope,
    configPath: instructionsOrigin.configPath,
  };
}

export async function loadCatalog(
  options: LoadCatalogOptions = {},
): Promise<KnowledgeCatalog> {
  const workspace = path.resolve(options.cwd ?? process.cwd());
  const homeDirectory = options.homeDirectory ?? homedir();
  const globalConfigPath = path.resolve(
    options.globalConfigPath ??
      path.join(homeDirectory, ".config", "opencode", "KNOWLEDGE.yml"),
  );
  const projectConfigPath = path.join(workspace, ".opencode", "KNOWLEDGE.yml");
  const layers: SourceOrigin[] = [
    {
      scope: "global",
      configPath: globalConfigPath,
      scopeRoot: path.dirname(globalConfigPath),
    },
    {
      scope: "global",
      configPath: path.join(
        path.dirname(globalConfigPath),
        "KNOWLEDGE.local.yml",
      ),
      scopeRoot: path.dirname(globalConfigPath),
    },
    {
      scope: "project",
      configPath: projectConfigPath,
      scopeRoot: workspace,
    },
    {
      scope: "project",
      configPath: path.join(
        path.dirname(projectConfigPath),
        "KNOWLEDGE.local.yml",
      ),
      scopeRoot: workspace,
    },
  ];
  const diagnostics: string[] = [];
  const mergedSources = new Map<string, MergedSource>();
  const invalidNames = new Set<string>();

  for (const layer of layers) {
    const loaded = await loadLayer(layer);
    if (loaded === undefined) {
      continue;
    }
    diagnostics.push(...loaded.diagnostics);

    for (const name of loaded.invalidNames) {
      invalidNames.add(name);
      mergedSources.delete(name);
    }
    for (const { name, source } of loaded.entries) {
      if (invalidNames.has(name)) {
        invalidNames.delete(name);
        mergedSources.delete(name);
      }
      mergeEntry(mergedSources, name, source, layer);
    }
  }

  const sources = new Map<string, KnowledgeSource>();
  for (const [name, merged] of mergedSources) {
    if (invalidNames.has(name)) {
      continue;
    }
    try {
      sources.set(name, await resolveEffectiveSource(merged));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`Invalid source ${name}: ${message}`);
    }
  }

  return {
    sources,
    diagnostics,
    globalConfigPath,
    projectConfigPath,
    workspace,
    homeDirectory,
  };
}

export async function readInstructions(
  source: KnowledgeSource,
): Promise<string> {
  if (source.instructions.kind === "inline") {
    return source.instructions.text;
  }

  try {
    const currentPath = await resolveDeclaredFile(
      source.instructions.declaredPath,
      source.configPath,
      source.instructions.scopeRoot,
      "instructions.file",
    );
    return await readFile(currentPath, "utf8");
  } catch (error) {
    throw new ConfigurationError(
      `Cannot read instructions for ${source.name}: ${source.instructions.declaredPath}`,
      { cause: error },
    );
  }
}
