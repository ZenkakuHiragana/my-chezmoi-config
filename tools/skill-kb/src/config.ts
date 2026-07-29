import { access, readFile, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const instructionFileSchema = z
  .object({
    file: z.string().min(1),
  })
  .strict();

const rawSourceSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    instructions: z.union([z.string().min(1), instructionFileSchema]),
  })
  .strict();

const rawConfigSchema = z
  .object({
    sources: z.array(rawSourceSchema),
  })
  .strict();

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

export type KnowledgeSource = {
  name: string;
  description: string;
  instructions: InlineInstructions | FileInstructions;
  scope: SourceScope;
  configPath: string;
};

export type KnowledgeCatalog = {
  sources: ReadonlyMap<string, KnowledgeSource>;
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

type LoadedConfig = {
  scope: SourceScope;
  path: string;
  sources: KnowledgeSource[];
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

async function resolveInstructionFile(
  declaredPath: string,
  configPath: string,
  scopeRoot: string,
): Promise<string> {
  if (path.isAbsolute(declaredPath)) {
    throw new ConfigurationError(
      `instructions.file must be relative in ${configPath}: ${declaredPath}`,
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
      `instructions.file cannot be resolved in ${configPath}: ${declaredPath}`,
      { cause: error },
    );
  }

  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new ConfigurationError(
      `instructions.file escapes its allowed scope in ${configPath}: ${declaredPath}`,
    );
  }

  const fileStat = await stat(canonicalFile);
  if (!fileStat.isFile()) {
    throw new ConfigurationError(
      `instructions.file is not a regular file in ${configPath}: ${declaredPath}`,
    );
  }

  return canonicalFile;
}

async function loadConfig(
  configPath: string,
  scope: SourceScope,
  workspace: string,
): Promise<LoadedConfig> {
  let document: unknown;
  try {
    document = parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new ConfigurationError(
      `Cannot read YAML configuration: ${configPath}`,
      {
        cause: error,
      },
    );
  }

  const parsed = rawConfigSchema.safeParse(document);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid YAML configuration ${configPath}: ${z.prettifyError(parsed.error)}`,
    );
  }

  const scopeRoot = scope === "global" ? path.dirname(configPath) : workspace;
  const seenNames = new Set<string>();
  const sources: KnowledgeSource[] = [];

  for (const rawSource of parsed.data.sources) {
    const name = rawSource.name.trim();
    const description = rawSource.description.trim();
    if (!isNonBlank(name)) {
      throw new ConfigurationError(
        `Source name must not be blank in ${configPath}`,
      );
    }
    if (!isNonBlank(description)) {
      throw new ConfigurationError(
        `Source description must not be blank for ${name} in ${configPath}`,
      );
    }
    if (seenNames.has(name)) {
      throw new ConfigurationError(
        `Duplicate source name in ${configPath}: ${name}`,
      );
    }
    seenNames.add(name);

    let instructions: InlineInstructions | FileInstructions;
    if (typeof rawSource.instructions === "string") {
      if (!isNonBlank(rawSource.instructions)) {
        throw new ConfigurationError(
          `Source instructions must not be blank for ${name} in ${configPath}`,
        );
      }
      instructions = { kind: "inline", text: rawSource.instructions };
    } else {
      await resolveInstructionFile(
        rawSource.instructions.file,
        configPath,
        scopeRoot,
      );
      instructions = {
        kind: "file",
        declaredPath: rawSource.instructions.file,
        scopeRoot,
      };
    }

    sources.push({
      name,
      description,
      instructions,
      scope,
      configPath,
    });
  }

  return { scope, path: configPath, sources };
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

  const [hasGlobal, hasProject] = await Promise.all([
    pathExists(globalConfigPath),
    pathExists(projectConfigPath),
  ]);

  const loaded: LoadedConfig[] = [];
  if (hasGlobal) {
    loaded.push(await loadConfig(globalConfigPath, "global", workspace));
  }
  if (hasProject) {
    loaded.push(await loadConfig(projectConfigPath, "project", workspace));
  }

  const sources = new Map<string, KnowledgeSource>();
  for (const config of loaded) {
    for (const source of config.sources) {
      sources.set(source.name, source);
    }
  }

  return {
    sources,
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
    const currentPath = await resolveInstructionFile(
      source.instructions.declaredPath,
      source.configPath,
      source.instructions.scopeRoot,
    );
    return await readFile(currentPath, "utf8");
  } catch (error) {
    throw new ConfigurationError(
      `Cannot read instructions for ${source.name}: ${source.instructions.declaredPath}`,
      { cause: error },
    );
  }
}
