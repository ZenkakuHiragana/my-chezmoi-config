import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCatalog } from "./config.js";
import { buildServerInstructions } from "./guides.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const configuredPath = process.env.SKILL_KB_CONFIG;
  const catalog = await loadCatalog(
    configuredPath === undefined ? {} : { globalConfigPath: configuredPath },
  );
  for (const diagnostic of catalog.diagnostics) {
    console.error(`[skill-kb] ${diagnostic}`);
  }
  if (catalog.sources.size === 0) {
    const checkedPaths = [
      catalog.globalConfigPath,
      path.join(
        path.dirname(catalog.globalConfigPath),
        "KNOWLEDGE.local.yml",
      ),
      catalog.projectConfigPath,
      path.join(
        path.dirname(catalog.projectConfigPath),
        "KNOWLEDGE.local.yml",
      ),
    ];
    console.error(
      `[skill-kb] No knowledge source is configured, so no tool is published. Checked ${checkedPaths.join(", ")}`,
    );
  }
  const server = createServer(catalog, await buildServerInstructions());
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[skill-kb] ${message}`);
  process.exitCode = 1;
});
